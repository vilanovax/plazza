import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function waitForLobby(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("موجودی ژتون")).toBeVisible({ timeout: 15_000 });
}

export async function loginAs(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page).toHaveURL("/");
  await waitForLobby(page);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAs(page, "admin", "admin1234");
}

/** Credit the logged-in admin's chip bank (requires admin session cookies on `request`). */
export async function creditAdmin(request: APIRequestContext, amount: number): Promise<void> {
  const me = await request.get("/api/auth/me");
  expect(me.ok()).toBeTruthy();
  const { user } = (await me.json()) as { user: { id: string } | null };
  expect(user).toBeTruthy();
  const res = await request.post(`/api/admin/users/${user!.id}/credit`, { data: { amount } });
  expect(res.ok()).toBeTruthy();
}

export function uniqueSuffix(): string {
  return String(Date.now());
}
