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

function locationHash(url) {
  return new URL(url).hash;
}
