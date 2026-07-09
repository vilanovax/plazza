import { handler, error, json } from "@/lib/api";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import * as repo from "@/lib/repo";

export async function POST(req: Request) {
  return handler(async () => {
    const { username, password, displayName } = await req.json();
    if (!username || !password) return error("نام کاربری و رمز عبور لازم است");
    if (String(password).length < 6) return error("رمز عبور باید حداقل ۶ کاراکتر باشد");

    const settings = await repo.getSettings();
    if (!settings.allow_self_register) return error("ثبت‌نام خودکار غیرفعال است؛ با مدیر تماس بگیرید", 403);

    if (await repo.getUserByUsername(username)) return error("این نام کاربری قبلاً ثبت شده است", 409);

    const hash = await hashPassword(String(password));
    const user = await repo.createUser(String(username), hash, String(displayName || username), "player");
    await setSessionCookie({ sub: user.id, username: user.username, role: user.role });
    return json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
  });
}
