import { handler, json, requireAdmin } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function GET() {
  return handler(async () => {
    await requireAdmin();
    const [pending, users, tables] = await Promise.all([
      repo.listPendingTopups(),
      repo.listUsers(),
      repo.listOpenTables(),
    ]);
    const names = new Map(users.map((u) => [u.id, u.display_name]));
    const tableNames = new Map(tables.map((t) => [t.id, t.name]));
    return json({
      topups: pending.map((t) => ({
        id: t.id,
        userId: t.user_id,
        userName: names.get(t.user_id) ?? "?",
        tableId: t.table_id,
        tableName: tableNames.get(t.table_id) ?? "?",
        amount: Number(t.amount),
        createdAt: t.created_at,
      })),
    });
  });
}
