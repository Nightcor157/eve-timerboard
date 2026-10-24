import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";
import { futureIso, makeTimer } from "../fixtures/timers.mjs";

await runBrowserTest("fleet commander result controls", async ({ page }) => {
  const timerOne = makeTimer({ id: "timer-1", system: "Amarr", object_name: "Athanor", structure: "Amarr VIII", end_at: futureIso(8) });
  const timerTwo = makeTimer({ id: "timer-2", system: "Jita", object_name: "Metenox Moon Drill", structure: "Jita IV", distance: "Атака", end_at: futureIso(9) });
  const timerThreeEnd = futureIso(10);
  const firstEta = futureIso(1);
  const secondEta = futureIso(1, 1);
  await page.addInitScript(({ initialTimers, thirdEnd, etaOne, etaTwo }) => {
    localStorage.setItem("eve_timerboard_view_key_main", "view-test-key");
    let timerResult = "";
    const timers = () => initialTimers.map((timer) => timer.id === "timer-1" ? { ...timer, note: timerResult } : timer);
    window.__rpcLog = [];
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          window.__rpcLog.push({ name, args });
          if (name === "get_timers") return { data: timers(), error: null };
          if (name === "list_fleets") return { data: [{ fleet_id: "fleet-1", fleet_name: "Флот 1", fleet_color: "#27a7d8" }], error: null };
          if (name === "get_fleet_route") return { data: [{
            fleet_id: "fleet-1", fleet_name: "Флот 1", fleet_color: "#27a7d8", timer_id: "timer-1", timer_system: "Amarr", object_name: "Athanor", structure: "Amarr VIII", route_order: 1, jump_count: 2, eta_at: etaOne, end_at: initialTimers[0].end_at, result: timerResult,
            route_nodes: [{ id: 30000142, name: "Jita" }, { id: 30000144, name: "Perimeter" }, { id: 30002187, name: "Amarr" }]
          }, {
            fleet_id: "fleet-1", fleet_name: "Флот 1", fleet_color: "#27a7d8", timer_id: "timer-3", timer_system: "Hedion", object_name: "Metenox Moon Drill", structure: "Hedion I", route_order: 2, jump_count: 1, eta_at: etaTwo, end_at: thirdEnd, result: "",
            route_nodes: [{ id: 30002187, name: "Amarr" }, { id: 30002189, name: "Hedion" }]
          }], error: null };
          if (name === "set_fleet_timer_result") {
            timerResult = args.p_result;
            return { data: { id: args.p_timer_id, note: timerResult }, error: null };
          }
          return { data: [], error: null };
        }
      })
    };
  }, { initialTimers: [timerOne, timerTwo], thirdEnd: timerThreeEnd, etaOne: firstEta, etaTwo: secondEta });
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('tr[data-timer-id="timer-1"]');
  assert.equal(await page.locator("#timersBody .result-actions button").count(), 0);
  await page.click("#routesTab");
  await page.click("#fleetMapModeBtn");
  await page.waitForFunction(() => document.querySelectorAll("#fleetLoginSelect option").length > 1);
  await page.selectOption("#fleetLoginSelect", "fleet-1");
  await page.fill("#fleetLoginKey", "Флот 1: a1b2c3d4e5f60718293a4b5c");
  await page.click("#openFleetRouteBtn");
  await page.waitForFunction(() => document.querySelector("#fleetLoginStatus")?.textContent.includes("прямо в строке"));
  assert.equal(await page.locator("#routeList .route-result-actions button").count(), 6);
  assert.deepEqual(await routeEdges(page), ["30000142:30000144", "30000144:30002187", "30002187:30002189"]);
  await page.locator('#routeList .route-list-row[data-timer-id="timer-1"] [data-route-result="Защищена"]').click();
  await page.waitForFunction(() => !document.querySelector('.map-route-edges [data-from-id="30000142"]') && document.querySelector('.map-route-edges [data-from-id="30002187"][data-to-id="30002189"]'));
  assert.deepEqual(await routeEdges(page), ["30002187:30002189"]);
  await page.locator('#routeList .route-list-row[data-timer-id="timer-1"] [data-route-result=""]').click();
  await page.waitForFunction(() => window.__rpcLog.filter((item) => item.name === "set_fleet_timer_result").length >= 2);
  await page.click("#boardTab");
  assert.equal(await page.locator('#timersBody tr[data-timer-id="timer-1"] .result-actions button').count(), 3);
  assert.equal(await page.locator('#timersBody tr[data-timer-id="timer-2"] .result-actions button').count(), 0);
  assert.equal(await page.locator("#timersBody .table-control").count(), 0);
  await page.locator('#timersBody tr[data-timer-id="timer-1"] .result-action-btn').first().click();
  await page.waitForFunction(() => !document.querySelector('#timersBody tr[data-timer-id="timer-1"]'));
  const lastResultRpc = await page.evaluate(() => window.__rpcLog.filter((item) => item.name === "set_fleet_timer_result").at(-1));
  assert.equal(lastResultRpc.args.p_access_key, "A1B2C3D4E5F60718293A4B5C");
  assert.equal(lastResultRpc.args.p_timer_id, "timer-1");
});

function routeEdges(page) {
  return page.locator(".map-route-edges .route-edge").evaluateAll((edges) => edges.map((edge) => `${edge.dataset.fromId}:${edge.dataset.toId}`));
}
