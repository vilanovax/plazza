import { test, expect } from "@playwright/test";
import { loginAsAdmin, waitForLobby } from "./helpers";

test.describe("API health", () => {
  test("returns ok when database is reachable", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toEqual({ ok: true, db: "ok" });
  });
});

test.describe("Auth flow", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("admin can log in and reach lobby", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText("موجودی ژتون")).toBeVisible();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("wrong-password");
    await page.getByRole("button", { name: "ورود", exact: true }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Lobby", () => {
  test.beforeEach(async ({ page }) => {
    await waitForLobby(page);
  });

  test("shows tables tab and create button", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /میزها/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /ساخت میز جدید/ })).toBeVisible();
  });

  test("can open create table modal", async ({ page }) => {
    await page.getByRole("button", { name: /ساخت میز جدید/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "ساخت میز جدید" })).toBeVisible();
    await page.getByLabel("بستن").click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
