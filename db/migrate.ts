/**
 * Minimal forward-only migration runner.
 * Applies every db/migrations/*.sql that hasn't been recorded yet, in order.
 * Run with: npm run db:migrate
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../src/lib/db";

const pool = getPool();

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function main() {
  const client = await pool.connect();
  try {
    // Serialise migration runs across concurrent deploys.
    await client.query("SELECT pg_advisory_lock(918273645)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name)
    );

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= skip ${file}`);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      console.log(`+ apply ${file}`);
      // A file may opt out of the wrapping transaction (needed for statements
      // like CREATE INDEX CONCURRENTLY, which can't run inside a transaction)
      // by including a `-- migrate:no-transaction` marker. Such a migration is
      // responsible for its own atomicity; we still record it once it succeeds.
      const noTx = /--\s*migrate:no-transaction/i.test(sql);
      if (noTx) {
        // Each statement runs on its own connection query: a multi-statement
        // query string is an implicit transaction block, which CREATE INDEX
        // CONCURRENTLY forbids. Statements are separated by an explicit `--;;`
        // delimiter line (not by guessing at `;`, which is legal inside
        // dollar-quoted bodies, string literals, and comments).
        const statements = sql
          .split(/^[ \t]*--;;[ \t]*$/m)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !/^(?:--[^\n]*\n?)*$/.test(s));
        try {
          for (const stmt of statements) await client.query(stmt);
          await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
        } catch (err) {
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
        }
      } else {
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
        }
      }
    }
    console.log("Migrations complete.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(918273645)").catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
