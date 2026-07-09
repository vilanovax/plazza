import { handler, error, json, requireAdmin } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import * as repo from "@/lib/repo";

export async function GET() {
  return handler(async () => {
    await requireAdmin();
    const users = await repo.listUsers();
    return json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        role: u.role,
        chipBalance: Number(u.chip_balance),
        isActive: u.is_active,
        createdAt: u.created_at,
      })),
    });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    await requireAdmin();
    const { username, password, displayName, role } = await req.json();
    if (!username || !password) return error("نام کاربری و رمز عبور لازم است");
    if (String(password).length < 6) return error("رمز عبور باید حداقل ۶ کاراکتر باشد");
    if (await repo.getUserByUsername(username)) return error("این نام کاربری قبلاً ثبت شده است", 409);
    const hash = await hashPassword(String(password));
    const user = await repo.createUser(
      String(username),
      hash,
      String(displayName || username),
      role === "admin" ? "admin" : "player"
    );
    return json({ id: user.id });
  });
}
