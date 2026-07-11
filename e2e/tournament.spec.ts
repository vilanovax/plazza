import { test, expect } from "@playwright/test";
import { creditAdmin, uniqueSuffix, waitForLobby } from "./helpers";
import { AUTH_FILE } from "./global-setup";

test.describe("Tournament", () => {
  test("shows a scheduled tournament on the detail page", async ({ page }) => {
    await waitForLobby(page);
    const name = `E2E Tourney ${uniqueSuffix()}`;
    const res = await page.request.post("/api/tournaments", {
      data: {
        name,
        buyInChips: 100,
        startingStack: 1500,
        maxPlayers: 6,
        startBigBlind: 20,
        levelMinutes: 10,
        levels: 12,
        rebuyAllowed: false,
      },
    });
    expect(res.ok()).toBeTruthy();
    const { id } = (await res.json()) as { id: string };

    await page.goto(`/tournament/${id}`);
    await expect(page.getByRole("heading", { name: `🏆 ${name}` })).toBeVisible({ timeout: 20_000 });
    // The status renders in both the hero badge and the info grid, so scope to
    // the hero status badge to avoid a strict-mode multi-match.
    await expect(page.locator(".tournament-hero-status")).toHaveText("در انتظار");
    await expect(page.getByText("جدول رده‌بندی")).toBeVisible();
  });

  test("admin can create a tournament from the lobby UI", async ({ page }) => {
    await waitForLobby(page);
    const name = `UI Tourney ${uniqueSuffix()}`;

    await page.getByRole("tab", { name: /تورنومنت‌ها/ }).click();
    await page.getByRole("button", { name: /ساخت تورنومنت/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator("#tournament-name").fill(name);
    await page.getByRole("button", { name: new RegExp(`ساخت «${name}»`) }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });

  test("admin can start a two-player tournament and see it running", async ({ browser, baseURL }) => {
    const suffix = uniqueSuffix();
    const playerUsername = `e2e${suffix}`;
    const playerPassword = "test1234";
    const tournamentName = `E2E Live ${suffix}`;

    const adminContext = await browser.newContext({ baseURL, storageState: AUTH_FILE });
    const adminPage = await adminContext.newPage();
    await creditAdmin(adminPage.request, 50_000);

    const playerRes = await adminPage.request.post("/api/admin/users", {
      data: { username: playerUsername, password: playerPassword, displayName: "E2E Player" },
    });
    expect(playerRes.ok()).toBeTruthy();
    const { id: playerId } = (await playerRes.json()) as { id: string };
    await adminPage.request.post(`/api/admin/users/${playerId}/credit`, { data: { amount: 50_000 } });

    const tRes = await adminPage.request.post("/api/tournaments", {
      data: {
        name: tournamentName,
        buyInChips: 100,
        startingStack: 1500,
        maxPlayers: 6,
        startBigBlind: 20,
        levelMinutes: 10,
        levels: 12,
        rebuyAllowed: false,
      },
    });
    const { id: tournamentId } = (await tRes.json()) as { id: string };

    const regAdmin = await adminPage.request.post(`/api/tournaments/${tournamentId}/register`, { method: "POST" });
    expect(regAdmin.ok()).toBeTruthy();

    const playerContext = await browser.newContext({ baseURL });
    const loginRes = await playerContext.request.post("/api/auth/login", {
      data: { username: playerUsername, password: playerPassword },
    });
    expect(loginRes.ok()).toBeTruthy();
    const playerPage = await playerContext.newPage();
    const regPlayer = await playerPage.request.post(`/api/tournaments/${tournamentId}/register`, { method: "POST" });
    expect(regPlayer.ok()).toBeTruthy();

    const start = await adminPage.request.post(`/api/tournaments/${tournamentId}/start`, { method: "POST" });
    expect(start.ok()).toBeTruthy();

    await adminPage.goto(`/tournament/${tournamentId}`);
    // Scope to the hero status badge (status also shows in the info grid).
    await expect(adminPage.locator(".tournament-hero-status")).toHaveText("در حال اجرا", { timeout: 20_000 });
    await expect(adminPage.getByRole("link", { name: /ورود به میز تورنومنت/ })).toBeVisible();

    await adminContext.close();
    await playerContext.close();
  });
});
