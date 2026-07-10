/**
 * Rebuild materialized player stats from hand_players + ledger_entries.
 *
 *   npm run db:rebuild-stats              # full rebuild (truncate + upsert)
 *   npm run db:rebuild-stats -- --user=UUID
 *   npm run db:rebuild-stats -- --check   # report drift, no writes
 */
import { getPool } from "../src/lib/db";
import {
  findStatsDrift,
  rebuildAllPlayerStats,
  rebuildPlayerStats,
} from "../src/lib/stats/rebuild";

function usage(): never {
  console.log(`Usage:
  npm run db:rebuild-stats [-- --user=<uuid>] [--check]

  --user=<uuid>  Rebuild one player only (other users untouched)
  --check        Compare cache vs source tables; exit 1 if drift found`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let userId: string | undefined;
  let check = false;
  for (const arg of argv) {
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg.startsWith("--user=")) {
      userId = arg.slice("--user=".length).trim();
      if (!userId) usage();
      continue;
    }
    if (arg === "--help" || arg === "-h") usage();
    console.error(`Unknown argument: ${arg}`);
    usage();
  }
  if (check && userId === undefined) {
    // --check without --user scans all players
  }
  return { userId, check };
}

async function main() {
  const { userId, check } = parseArgs(process.argv.slice(2));

  if (check) {
    const drift = await findStatsDrift(userId);
    if (drift.length === 0) {
      console.log(userId ? `No drift for user ${userId}.` : "No stats drift detected.");
      await getPool().end();
      return;
    }
    console.log(`Found ${drift.length} drift(s):`);
    for (const row of drift) {
      const where =
        row.scope === "table"
          ? `table=${row.tableId} user=${row.userId}`
          : `user=${row.userId}`;
      console.log(`  [${row.scope}] ${where} ${row.field}: cached=${row.cached} expected=${row.expected}`);
    }
    await getPool().end();
    process.exit(1);
  }

  const result = userId
    ? await rebuildPlayerStats(userId)
    : await rebuildAllPlayerStats();

  if (userId) {
    console.log(
      `Rebuilt stats for ${userId}: ${result.globalRows} global row(s), ${result.tableRows} table row(s); removed ${result.removedGlobal} stale global, ${result.removedTable} stale table.`
    );
  } else {
    console.log(
      `Full rebuild complete: ${result.globalRows} global row(s), ${result.tableRows} table row(s).`
    );
  }
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
