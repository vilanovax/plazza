import { request, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_DIR = path.join(__dirname, ".auth");
export const AUTH_FILE = path.join(AUTH_DIR, "admin.json");

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3001";
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/auth/login", {
    data: { username: "admin", password: "admin1234" },
  });
  if (!res.ok()) {
    throw new Error(`E2E global login failed (${res.status()}): ${await res.text()}`);
  }
  await ctx.storageState({ path: AUTH_FILE });
  await ctx.dispose();
}
