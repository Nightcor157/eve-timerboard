import assert from "node:assert/strict";
import { baseURL, blockExternalRequests, runBrowserTest } from "../helpers/browser.mjs";
import { futureIso, makeTimer } from "../fixtures/timers.mjs";

const timers = [
  makeTimer({ id: "timer-1", system: "Perimeter", object_name: "Metenox Moon Drill", structure: "Perimeter I", distance: "Оборона", end_at: futureIso(8) }),
  makeTimer({ id: "timer-2", system: "New Caldari", object_name: "Customs Office", structure: "New Caldari I", distance: "Атака", end_at: futureIso(9) })
];

for (const device of [
  { name: "desktop", viewport: { width: 1440, height: 1000 } },
  { name: "mobile", viewport: { width: 390, height: 844 } }
]) {
  await runBrowserTest(`general route ${device.name}`, async ({ page }) => {
    await page.addInitScript((initialTimers) => {
      localStorage.setItem("eve_timerboard_view_key_main", "view-test-key");
      window.__routeTimers = initialTimers;
      window.supabase = {
        createClient: () => ({
          rpc: async (name) => {
            if (name === "get_timers") return { data: window.__routeTimers, error: null };
            if (name === "list_fleets") return { data: [], error: null };
            return { data: [], error: null };
          }
        })
      };
    }, timers);
    await blockExternalRequests(page);
    await page.goto(`${baseURL}/#board`, { waitUntil: "domcontentloaded" });
    await page.click("#routesTab");
    await page.fill("#generalOriginSystem", "Jita");
    await page.fill("#generalSecondsPerJump", "60");
    await page.fill("#generalServiceMinutes", "10");
    await page.click("#buildGeneralRouteBtn");
    await page.waitForFunction(() => document.querySelector("#generalRouteStatus")?.textContent.includes("Маршрут построен"));
    assert.deepEqual(await page.locator("#routeList .route-list-row > td:nth-child(9)").allTextContents(), ["1 прыжок", "2 прыжка"]);

    await page.click('#routeList th[data-route-sort-key="system"] .table-sort-button');
    assert.deepEqual(await page.locator("#routeList .route-list-system").allTextContents(), ["New Caldari", "Perimeter"]);
    await page.click('#routeList th[data-route-sort-key="system"] .table-sort-button');
    assert.deepEqual(await page.locator("#routeList .route-list-system").allTextContents(), ["Perimeter", "New Caldari"]);
    await page.click("#fleetMapModeBtn");
    await page.click("#generalMapModeBtn");
    await page.waitForFunction(() => document.querySelectorAll("#routeList .route-list-row").length === 2);
    assert.deepEqual(await page.locator("#routeList .route-list-row > td:nth-child(9)").allTextContents(), ["1 прыжок", "2 прыжка"]);

    await selectMultiFilter(page, "#generalTimerKindFilter", ["Оборона"]);
    await selectMultiFilter(page, "#generalObjectFilter", ["Metenox Moon Drill", "Customs Office"]);
    await page.click("#buildGeneralRouteBtn");
    await page.waitForFunction(() => document.querySelectorAll("#routeList .route-list-row").length === 1);
    assert.deepEqual(await page.locator("#routeList .route-list-system").allTextContents(), ["Perimeter"]);
    const countdownBefore = await page.locator("#routeList [data-route-countdown]").first().textContent();
    await page.waitForFunction((previousValue) => {
      return document.querySelector("#routeList [data-route-countdown]")?.textContent !== previousValue;
    }, countdownBefore, { timeout: 3000 });
    const countdownAfter = await page.locator("#routeList [data-route-countdown]").first().textContent();
    assert.notEqual(countdownAfter, countdownBefore);
    assert.equal(await page.locator(".map-route-node.is-target").count(), 1);
    assert.ok((await page.locator(".map-region-label").allTextContents()).includes("The Forge"));
    assert.deepEqual(await page.locator("#generalRoutePanel [data-filter-summary]").allTextContents(), ["Оборона", "Metenox Moon Drill + Customs Office"]);

    await page.evaluate(() => {
      const source = window.__routeTimers[0];
      window.__routeTimers = [...window.__routeTimers, {
        ...source,
        id: "timer-auto-refresh",
        system: "Jita",
        structure: "Jita IV",
        updated_at: new Date(Date.parse(source.updated_at) + 1000).toISOString()
      }];
      document.querySelector("#refreshBtn").click();
    });
    await page.waitForFunction(() => document.querySelectorAll("#routeList .route-list-row").length === 2);
    assert.ok((await page.locator("#routeList .route-list-system").allTextContents()).includes("Jita"));

    if (device.name === "desktop") {
      const map = page.locator("#routeMap");
      const initialHeight = await map.evaluate((element) => element.getBoundingClientRect().height);
      await page.click("#routeZoomInBtn");
      const zoom = Number(await page.locator("#routeMap .route-map-stage").getAttribute("data-zoom"));
      assert.ok(zoom > 1, "zoom button must increase map scale");

      const viewBoxBeforePan = await page.locator("#routeMap svg").getAttribute("viewBox");
      const box = await map.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30);
      await page.mouse.up();
      assert.notEqual(await page.locator("#routeMap svg").getAttribute("viewBox"), viewBoxBeforePan);

      await page.locator("#routeMapResizeHandle").focus();
      await page.keyboard.press("ArrowDown");
      const resizedHeight = await map.evaluate((element) => element.getBoundingClientRect().height);
      assert.ok(resizedHeight > initialHeight, "keyboard resize must increase map height");

      await page.click("#fleetMapModeBtn");
      await page.click("#generalMapModeBtn");
      await page.waitForFunction(() => Number(document.querySelector("#routeMap .route-map-stage")?.dataset.zoom) > 1);
    }
  }, { viewport: device.viewport });
}

async function selectMultiFilter(page, selector, values) {
  await page.click(`${selector} summary`);
  await page.click(`${selector} [data-filter-action="none"]`);
  for (const value of values) {
    await page.locator(`${selector} input[type="checkbox"]`).evaluateAll((inputs, selectedValue) => {
      const input = inputs.find((candidate) => candidate.value === selectedValue);
      if (!input) throw new Error(`Filter option not found: ${selectedValue}`);
      input.click();
    }, value);
  }
  await page.click(`${selector} summary`);
}
