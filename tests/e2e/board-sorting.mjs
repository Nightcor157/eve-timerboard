import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";
import { futureIso, makeTimer } from "../fixtures/timers.mjs";

await runBrowserTest("board sorting", async ({ page }) => {
  const timers = [
    makeTimer({ id: "3", system: "Zayi", object_name: "Customs Office", structure: "III", title: "Zulu", owner: "Gamma", mode: "Reinforced", distance: "Оборона", end_at: futureIso(30) }),
    makeTimer({ id: "1", system: "Amarr", object_name: "Athanor", structure: "I", title: "Alpha", owner: "Beta", mode: "Armor", distance: "Атака", end_at: futureIso(10) }),
    makeTimer({ id: "2", system: "Hek", object_name: "Metenox Moon Drill", structure: "II", title: "Middle", owner: "Alpha", mode: "Shield", distance: "Оборона", end_at: futureIso(20) })
  ];
  await page.addInitScript((initialTimers) => {
    localStorage.setItem("eve_timerboard_view_key_main", "view-test-key");
    window.supabase = { createClient: () => ({ rpc: async (name) => name === "get_timers" ? { data: initialTimers, error: null } : { data: [], error: null } }) };
  }, timers);
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#timersBody tr[data-timer-id]").length === 3);

  const rowIds = () => page.locator("#timersBody tr[data-timer-id]").evaluateAll((rows) => rows.map((row) => row.dataset.timerId));
  assert.equal(await page.locator("#timersTable th[data-sort-key]").count(), 11);
  assert.deepEqual(await rowIds(), ["1", "2", "3"]);
  await page.click('#timersTable th[data-sort-key="system"] .table-sort-button');
  assert.deepEqual(await rowIds(), ["1", "2", "3"]);
  await page.click('#timersTable th[data-sort-key="system"] .table-sort-button');
  assert.deepEqual(await rowIds(), ["3", "2", "1"]);
  await page.click('#timersTable th[data-sort-key="end_at"] .table-sort-button');
  assert.deepEqual(await rowIds(), ["1", "2", "3"]);
  await page.click('#timersTable th[data-sort-key="end_at"] .table-sort-button');
  assert.deepEqual(await rowIds(), ["3", "2", "1"]);
  await page.click('#timersTable th[data-sort-key="object_name"] .table-sort-button');
  assert.deepEqual(await rowIds(), ["1", "3", "2"]);
  assert.equal(await page.locator('#timersTable th[data-sort-key="object_name"]').getAttribute("aria-sort"), "ascending");
});
