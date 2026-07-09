/**
 * Seed the default admin account. Run with: npm run db:seed
 * Credentials come from SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD.
 */
import bcrypt from "bcryptjs";
import { getPool, one } from "../src/lib/db";

const pool = getPool();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const explicitPassword = process.env.SEED_ADMIN_PASSWORD;
  // Never silently seed a predictable admin credential outside development.
  if (!explicitPassword && process.env.NODE_ENV === "production") {
    console.error("Refusing to seed a default admin password in production. Set SEED_ADMIN_PASSWORD.");
    process.exit(1);
  }
  const password = explicitPassword ?? "admin1234";

  const existing = await one<{ id: string }>("SELECT id FROM users WHERE username = $1", [username]);
  if (existing) {
    console.log(`Admin '${username}' already exists (${existing.id}).`);
  } else {
    const hash = await bcrypt.hash(password, 10);
    const row = await one<{ id: string }>(
      `INSERT INTO users (username, password_hash, display_name, role, chip_balance)
       VALUES ($1, $2, $3, 'admin', 0) RETURNING id`,
      [username, hash, "مدیر"]
    );
    console.log(`Created admin '${username}' (${row?.id}). Change the password after first login.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
