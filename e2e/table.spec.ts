import { test, expect } from "@playwright/test";
import { creditAdmin, uniqueSuffix, waitForLobby } from "./helpers";

test.describe("Cash table", () => {
  test.beforeEach(async ({ page }) => {
    await waitForLobby(page);
  });

  test("creates a table via API and connects over socket", async ({ page }) => {
    const name = `E2E Table ${uniqueSuffix()}`;
    const res = await page.request.post("/api/tables", {
      data: {
        name,
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 200,
        maxBuyIn: 2000,
        maxSeats: 6,
        thinkTimeSec: 30,
      },
    });
    expect(res.ok()).toBeTruthy();
    const { id } = (await res.json()) as { id: string };

    await page.goto(`/table/${id}`);
    await expect(page.getByText("متصل")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText("در انتظار بازیکنان")).toBeVisible();
  });

  test("admin can sit at a newly created table", async ({ page }) => {
    await creditAdmin(page.request, 10_000);

    const name = `E2E Sit ${uniqueSuffix()}`;
    const res = await page.request.post("/api/tables", {
      data: {
        name,
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 200,
        maxBuyIn: 2000,
        maxSeats: 6,
        thinkTimeSec: 30,
      },
    });
    const { id } = (await res.json()) as { id: string };

    await page.goto(`/table/${id}`);
    await expect(page.getByText("متصل")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "نشستن" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /نشستن روی صندلی/ })).toBeVisible();
    await dialog.getByRole("button", { name: "نشستن", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText("خالی")).toBeVisible();
  });

  test("creates a table from the lobby UI", async ({ page }) => {
    const name = `UI Table ${uniqueSuffix()}`;
    await page.getByRole("button", { name: /ساخت میز جدید/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator("#table-name").fill(name);
    await page.getByRole("button", { name: new RegExp(`ساخت «${name}»`) }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible({ timeout: 10_000 });
  });
});
