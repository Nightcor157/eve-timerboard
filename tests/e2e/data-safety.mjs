import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";
import { futureIso, makeTimer } from "../fixtures/timers.mjs";

const ADMIN_KEY = "admin-test-key";
const VIEW_KEY = "view-test-key";

await runBrowserTest("admin timer patch and conflict", async ({ page }) => {
  const original = makeTimer({
    id: "timer-1",
    system: "Hakatiz",
    owner: "Original Alliance",
    updated_at: "2026-10-24T10:00:00.000Z"
  });
  await page.addInitScript(({ timer, adminKey, viewKey }) => {
    localStorage.setItem("eve_timerboard_view_key_main", viewKey);
    let current = { ...timer };
    let shouldConflict = false;
    window.__patchCalls = [];
    window.__enableConflict = () => {
      shouldConflict = true;
      current = { ...current, owner: "External Alliance", updated_at: "2026-10-24T10:05:00.000Z" };
    };
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          if (name === "get_timers") return { data: [current], error: null };
          if (name === "list_fleets_admin") return args.p_admin_key === adminKey
            ? { data: [], error: null }
            : { data: null, error: { message: "wrong admin key", code: "28000" } };
          if (name === "patch_timer_admin_fields") {
            window.__patchCalls.push(args);
            if (shouldConflict) {
              shouldConflict = false;
              return { data: null, error: { message: "timer update conflict", code: "40001" } };
            }
            current = {
              ...current,
              ...args.p_changes,
              updated_at: "2026-10-24T10:01:00.000Z"
            };
            return { data: current, error: null };
          }
          return { data: [], error: null };
        }
      })
    };
  }, { timer: original, adminKey: ADMIN_KEY, viewKey: VIEW_KEY });
  await blockExternalRequests(page);
  await openAdmin(page);

  const systemInput = page.locator('tr[data-timer-id="timer-1"] [data-field="system"] input');
  await systemInput.fill("Amarr");
  await systemInput.press("Enter");
  await page.waitForFunction(() => window.__patchCalls.length === 1);
  const firstPatch = await page.evaluate(() => window.__patchCalls[0]);
  assert.deepEqual(firstPatch, {
    p_board_id: "main",
    p_admin_key: ADMIN_KEY,
    p_id: "timer-1",
    p_changes: { system: "Amarr" },
    p_expected_updated_at: original.updated_at
  });
  await page.waitForFunction(() => document.querySelector('tr[data-timer-id="timer-1"] [data-field="system"] input')?.value === "Amarr");

  await page.evaluate(() => window.__enableConflict());
  const ownerInput = page.locator('tr[data-timer-id="timer-1"] [data-field="owner"] input');
  await ownerInput.fill("My Replacement");
  await ownerInput.press("Enter");
  await page.waitForFunction(() => document.querySelector("#adminStatus")?.textContent.includes("уже был изменён"));
  await page.waitForFunction(() => document.querySelector('tr[data-timer-id="timer-1"] [data-field="owner"] input')?.value === "External Alliance");
  const secondPatch = await page.evaluate(() => window.__patchCalls[1]);
  assert.deepEqual(secondPatch.p_changes, { owner: "My Replacement" });
  assert.equal(secondPatch.p_expected_updated_at, "2026-10-24T10:01:00.000Z");
});

await runBrowserTest("latest timer load wins", async ({ page }) => {
  const stale = makeTimer({ id: "timer-stale", system: "Stale System" });
  const fresh = makeTimer({ id: "timer-fresh", system: "Fresh System" });
  await page.addInitScript(({ staleTimer, freshTimer, viewKey }) => {
    localStorage.setItem("eve_timerboard_view_key_main", viewKey);
    window.__getTimerCalls = 0;
    window.supabase = {
      createClient: () => ({
        rpc: async (name) => {
          if (name !== "get_timers") return { data: [], error: null };
          window.__getTimerCalls += 1;
          if (window.__getTimerCalls === 1) {
            return new Promise((resolve) => setTimeout(() => resolve({ data: [staleTimer], error: null }), 180));
          }
          return { data: [freshTimer], error: null };
        }
      })
    };
  }, { staleTimer: stale, freshTimer: fresh, viewKey: VIEW_KEY });
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__getTimerCalls === 1);
  await page.evaluate(() => document.querySelector("#refreshBtn").click());
  await page.waitForSelector('tr[data-timer-id="timer-fresh"]');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('tr[data-timer-id="timer-fresh"]').count(), 1);
  assert.equal(await page.locator('tr[data-timer-id="timer-stale"]').count(), 0);
});

await runBrowserTest("access key change invalidates old load", async ({ page }) => {
  const fresh = makeTimer({ id: "timer-fresh", system: "Fresh System" });
  await page.addInitScript(({ timer }) => {
    localStorage.setItem("eve_timerboard_view_key_main", "old-view-key");
    window.__getTimerCalls = 0;
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          if (name !== "get_timers") return { data: [], error: null };
          window.__getTimerCalls += 1;
          if (args.p_view_key === "old-view-key") {
            return new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: "wrong view key", code: "28000" } }), 180));
          }
          return { data: [timer], error: null };
        }
      })
    };
  }, { timer: fresh });
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__getTimerCalls === 1);
  await page.evaluate(() => {
    const input = document.querySelector("#viewKey");
    input.value = "new-view-key";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#unlockViewBtn").click();
  });
  await page.waitForSelector('tr[data-timer-id="timer-fresh"]');
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#viewKeyPanel").evaluate((element) => element.hidden), true);
  assert.equal(await page.locator('tr[data-timer-id="timer-fresh"]').count(), 1);
});

await runBrowserTest("atomic timer batch add", async ({ page }) => {
  await installBatchMock(page, false);
  await blockExternalRequests(page);
  await openAdmin(page);
  const raw = makeTimerInput(40);
  await page.fill("#timerInput", raw);
  await page.click("#addBtn");
  await page.waitForFunction(() => document.querySelector("#adminStatus")?.textContent.includes("Добавлено таймеров: 40"));
  const calls = await page.evaluate(() => window.__writeCalls);
  assert.equal(calls.filter((call) => call.name === "add_timers").length, 1);
  assert.equal(calls.filter((call) => call.name === "add_timer").length, 0);
  assert.equal(calls.find((call) => call.name === "add_timers").args.p_timers.length, 40);
  assert.equal(await page.locator("#timerInput").inputValue(), "");
});

await runBrowserTest("failed timer batch keeps input", async ({ page }) => {
  await installBatchMock(page, true);
  await blockExternalRequests(page);
  await openAdmin(page);
  const raw = makeTimerInput(3);
  await page.fill("#timerInput", raw);
  await page.click("#addBtn");
  await page.waitForFunction(() => document.querySelector("#adminStatus")?.textContent.includes("supabase/schema.sql"));
  assert.equal(await page.locator("#timerInput").inputValue(), raw);
  const calls = await page.evaluate(() => window.__writeCalls);
  assert.equal(calls.filter((call) => call.name === "add_timers").length, 1);
  assert.equal(calls.filter((call) => call.name === "add_timer").length, 0);
});

async function openAdmin(page) {
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.click("#viewModeBtn");
  await page.waitForFunction(() => document.querySelector("#adminAccessDialog")?.open);
  await page.fill("#adminViewKey", ADMIN_KEY);
  await page.click("#confirmAdminAccessBtn");
  await page.waitForFunction(() => !document.querySelector("#adminPanel")?.hidden);
}

async function installBatchMock(page, failBatch) {
  await page.addInitScript(({ adminKey, viewKey, shouldFail }) => {
    localStorage.setItem("eve_timerboard_view_key_main", viewKey);
    window.__writeCalls = [];
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          if (name === "get_timers") return { data: [], error: null };
          if (name === "list_fleets_admin") return args.p_admin_key === adminKey ? { data: [], error: null } : { data: null, error: { message: "wrong admin key" } };
          if (name === "add_timers" || name === "add_timer") window.__writeCalls.push({ name, args });
          if (name === "add_timers" && shouldFail) return { data: null, error: { message: "Could not find the function public.add_timers in the schema cache", code: "PGRST202" } };
          if (name === "add_timers") return { data: args.p_timers.map((timer, index) => ({ ...timer, id: `new-${index + 1}` })), error: null };
          return { data: [], error: null };
        }
      })
    };
  }, { adminKey: ADMIN_KEY, viewKey: VIEW_KEY, shouldFail: failBatch });
}

function makeTimerInput(count) {
  return Array.from({ length: count }, (_, index) => [
    `System ${index + 1} - Structure ${index + 1}`,
    `В оборонном режиме до 2030.05.${String((index % 28) + 1).padStart(2, "0")} 13:08:10`
  ].join("\n")).join("\n");
}
