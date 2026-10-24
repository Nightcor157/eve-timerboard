import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";
import { makeTimer } from "../fixtures/timers.mjs";

await runBrowserTest("admin view access", async ({ page, context }) => {
  const timers = [makeTimer({ id: "timer-1", system: "Hakatiz", object_name: "Metenox Moon Drill", structure: "7-6" })];
  await context.addInitScript((initialTimers) => {
    if (location.origin !== "null") {
      localStorage.setItem("eve_timerboard_view_key_main", "view-test-key");
    }
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          if (name === "list_fleets_admin") return args.p_admin_key === "admin-test-key"
            ? { data: [], error: null }
            : { data: null, error: { message: "wrong admin key", code: "28000" } };
          if (name === "get_timers") return { data: initialTimers, error: null };
          return { data: [], error: null };
        }
      })
    };
  }, timers);
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('tr[data-timer-id="timer-1"]');
  assert.equal(await page.locator("#viewModeBtn").textContent(), "Вид: пользователь");
  assert.equal(await page.locator("#adminPanel").evaluate((element) => element.hidden), true);
  assert.equal(await page.locator("#timersBody .table-control").count(), 0);

  await page.click("#viewModeBtn");
  await page.waitForFunction(() => document.querySelector("#adminAccessDialog")?.open);
  await page.fill("#adminViewKey", "wrong-key");
  await page.click("#confirmAdminAccessBtn");
  await page.waitForFunction(() => document.querySelector("#adminAccessStatus")?.textContent.includes("неверный"));
  assert.equal(await page.locator("#adminPanel").evaluate((element) => element.hidden), true);

  await page.fill("#adminViewKey", "admin-test-key");
  await page.click("#confirmAdminAccessBtn");
  await page.waitForFunction(() => !document.querySelector("#adminPanel")?.hidden && document.querySelectorAll("#timersBody .table-control").length > 0);
  assert.equal(await page.locator("#viewModeBtn").textContent(), "Вид: админ");
  assert.match(page.url(), /[?&]admin=1/);

  await page.click("#viewModeBtn");
  await page.waitForFunction(() => document.querySelector("#adminPanel")?.hidden && document.querySelectorAll("#timersBody .table-control").length === 0);
  assert.doesNotMatch(page.url(), /[?&]admin=1/);
  await page.click("#viewModeBtn");
  await page.waitForFunction(() => !document.querySelector("#adminPanel")?.hidden);
  assert.equal(await page.locator("#adminAccessDialog").evaluate((element) => element.open), false);

  await page.evaluate(() => localStorage.clear());
  const freshPage = await context.newPage();
  await blockExternalRequests(freshPage);
  await freshPage.goto(`${baseURL}/?admin=1#board`, { waitUntil: "domcontentloaded" });
  await freshPage.waitForFunction(() => document.querySelector("#adminAccessDialog")?.open);
  assert.equal(await freshPage.locator("#adminAccessDialog").evaluate((element) => element.open), true);
  await freshPage.close();
});
