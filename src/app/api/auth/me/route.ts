import { handler, json } from "@/lib/api";
import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";

export async function GET() {
  return handler(async () => {
    const session = await getSession();
    if (!session) return json({ user: null });
    const user = await repo.getUserById(session.sub);
    if (!user || !user.is_active) return json({ user: null });
    return json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        chipBalance: Number(user.chip_balance),
      },
    });
  });
}
