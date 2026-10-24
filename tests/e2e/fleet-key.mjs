import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";

await runBrowserTest("fleet key generation and copy", async ({ page }) => {
  const generatedKey = "A1B2C3D4E5F60718293A4B5C";
  await page.addInitScript((key) => {
    let fleets = [];
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          if (name === "list_fleets_admin") return { data: fleets, error: null };
          if (name === "get_timers") return { data: [], error: null };
          if (name === "create_fleet") {
            fleets = [{
              fleet_id: "fleet-1",
              fleet_name: args.p_name,
              fleet_color: args.p_color,
              current_system: args.p_current_system,
              seconds_per_jump: args.p_seconds_per_jump,
              service_minutes: args.p_service_minutes,
              key_hint: key.slice(-4),
              active: true
            }];
            return { data: [{ fleet_id: "fleet-1", fleet_name: args.p_name, generated_key: key, key_hint: key.slice(-4) }], error: null };
          }
          return { data: [], error: null };
        }
      })
    };
  }, generatedKey);
  await blockExternalRequests(page);
  await page.goto(`${baseURL}/?admin=1#board`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#adminAccessDialog")?.open);
  await page.fill("#adminViewKey", "admin-test-key");
  await page.click("#confirmAdminAccessBtn");
  await page.waitForFunction(() => !document.querySelector("#adminPanel")?.hidden);
  await page.click("#routesTab");
  await page.click("#fleetMapModeBtn");
  await page.fill("#newFleetName", "Флот 1");
  await page.fill("#newFleetSystem", "Jita");
  await page.click("#createFleetBtn");
  await page.waitForFunction(() => !document.querySelector("#generatedFleetKey")?.hidden);
  assert.equal(await page.locator("#generatedFleetKeyValue").textContent(), generatedKey);
  assert.match(await page.locator("#generatedFleetKeyLabel").textContent(), /Флот 1/);
  await page.click("#copyFleetKeyBtn");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), generatedKey);
  assert.match(await page.locator("#fleetAdminStatus").textContent(), /скопирован/i);
}, { permissions: ["clipboard-read", "clipboard-write"] });
