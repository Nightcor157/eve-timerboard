import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";

await runBrowserTest("routes require view access", async ({ page }) => {
  await page.addInitScript(() => {
    window.__authorized = true;
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          if (name === "get_timers") {
            if (!window.__authorized || args.p_view_key !== "view-test-key") {
              return { data: null, error: { message: "wrong view key", code: "28000" } };
            }
            return { data: [], error: null };
          }
          if (name === "list_fleets") return { data: [], error: null };
          return { data: [], error: null };
        }
      })
    };
  });
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#routes`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#viewKeyPanel")?.hidden);
  assert.equal(await page.locator("#routesView").evaluate((element) => element.hidden), true);
  assert.equal(await page.locator("#routesTab").getAttribute("aria-disabled"), "true");
  assert.equal(await page.locator("#routesTab").evaluate((element) => element.classList.contains("is-locked")), true);

  await page.locator("#routesTab").dispatchEvent("click");
  assert.equal(await page.locator("#viewKeyPanel").evaluate((element) => element.hidden), false);
  await page.fill("#viewKey", "view-test-key");
  await page.click("#unlockViewBtn");
  await page.waitForFunction(() => !document.querySelector("#routesTab")?.classList.contains("is-locked"));
  await page.click("#routesTab");
  await page.waitForFunction(() => !document.querySelector("#routesView")?.hidden);
  assert.equal(locationHash(await page.url()), "#routes");

  await page.evaluate(() => { window.__authorized = false; });
  await page.click("#refreshBtn");
  await page.waitForFunction(() => document.querySelector("#routesView")?.hidden && document.querySelector("#routesTab")?.classList.contains("is-locked"));
  assert.equal(await page.locator("#fleetLoginKey").inputValue(), "");
  assert.equal(await page.locator("#boardView").evaluate((element) => element.hidden), false);
});

await runBrowserTest("latest fleet list response wins", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("eve_timerboard_view_key_main", "view-test-key");
    window.__fleetListCalls = 0;
    window.supabase = {
      createClient: () => ({
        rpc: async (name) => {
          if (name === "get_timers") return { data: [], error: null };
          if (name !== "list_fleets") return { data: [], error: null };
          window.__fleetListCalls += 1;
          if (window.__fleetListCalls === 1) {
            return new Promise((resolve) => setTimeout(() => resolve({
              data: [{ fleet_id: "fleet-stale", fleet_name: "Старый флот", fleet_color: "#27a7d8" }],
              error: null
            }), 180));
          }
          return {
            data: [{ fleet_id: "fleet-fresh", fleet_name: "Актуальный флот", fleet_color: "#27a7d8" }],
            error: null
          };
        }
      })
    };
  });
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector("#routesTab")?.classList.contains("is-locked"));
  await page.evaluate(() => {
    document.querySelector("#routesTab").click();
    document.querySelector("#routesTab").click();
  });
  await page.waitForFunction(() => window.__fleetListCalls >= 2 && document.querySelector('#fleetLoginSelect option[value="fleet-fresh"]'));
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#fleetLoginSelect option[value="fleet-fresh"]').count(), 1);
  assert.equal(await page.locator('#fleetLoginSelect option[value="fleet-stale"]').count(), 0);
});

function locationHash(url) {
  return new URL(url).hash;
}
