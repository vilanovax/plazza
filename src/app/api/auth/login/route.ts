import { handler, error, json } from "@/lib/api";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import * as repo from "@/lib/repo";

export async function POST(req: Request) {
  return handler(async () => {
    const { username, password } = await req.json();
    if (!username || !password) return error("نام کاربری و رمز عبور لازم است");

    const user = await repo.getUserByUsername(String(username));
    if (!user || !user.is_active) return error("نام کاربری یا رمز عبور نادرست است", 401);

    const hash = await repo.getPasswordHash(user.id);
    if (!hash || !(await verifyPassword(String(password), hash))) {
      return error("نام کاربری یا رمز عبور نادرست است", 401);
    }
    await setSessionCookie({ sub: user.id, username: user.username, role: user.role });
    return json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
  });
}
