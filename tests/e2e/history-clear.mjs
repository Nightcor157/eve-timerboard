import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";
import { futureIso, makeTimer, pastIso } from "../fixtures/timers.mjs";

await runBrowserTest("completed history cleanup", async ({ page }) => {
  const timers = [
    makeTimer({ id: "active", end_at: futureIso(1) }),
    makeTimer({ id: "repair", end_at: pastIso(0, 5) }),
    makeTimer({ id: "completed-result", object_name: "Metenox Moon Drill", end_at: futureIso(1), note: "Защищена" }),
    makeTimer({ id: "completed-customs", object_name: "Customs Office", end_at: pastIso(3) })
  ];
  await page.addInitScript((initialTimers) => {
    localStorage.setItem("eve_timerboard_view_key_main", "view-test-key");
    window.__timers = initialTimers;
    window.__rpcLog = [];
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          window.__rpcLog.push({ name, args });
          if (name === "list_fleets_admin") return args.p_admin_key === "admin-test-key" ? { data: [], error: null } : { data: null, error: { message: "wrong admin key", code: "28000" } };
          if (name === "get_timers") return { data: window.__timers, error: null };
          if (name === "clear_timer_history") {
            window.__timers = window.__timers.filter((timer) => timer.id === "active" || timer.id === "repair");
            return { data: 2, error: null };
          }
          return { data: [], error: null };
        }
      })
    };
  }, timers);
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('tr[data-timer-id="active"]');
  assert.equal(await page.locator("#clearHistoryBtn").evaluate((element) => element.hidden), true);
  await page.click("#viewModeBtn");
  await page.waitForFunction(() => document.querySelector("#adminAccessDialog")?.open);
  await page.fill("#adminViewKey", "admin-test-key");
  await page.click("#confirmAdminAccessBtn");
  await page.waitForFunction(() => !document.querySelector("#adminPanel")?.hidden);
  assert.equal(await page.locator("#adminPanel #clearHistoryBtn").count(), 1);
  assert.equal(await page.locator("#clearHistoryBtn").evaluate((element) => element.hidden), false);
  assert.equal(await page.locator("#clearHistoryBtn").textContent(), "Очистить закрытые таймеры из БД");
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#clearHistoryBtn");
  await page.waitForFunction(() => document.querySelector("#adminStatus")?.textContent.includes("Удалено таймеров: 2"));
  assert.deepEqual(await page.locator("#timersBody tr[data-timer-id]").evaluateAll((rows) => rows.map((row) => row.dataset.timerId)), ["repair", "active"]);
  const clearCall = await page.evaluate(() => window.__rpcLog.find((item) => item.name === "clear_timer_history"));
  assert.deepEqual(clearCall.args, { p_board_id: "main", p_admin_key: "admin-test-key" });
});
