import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { baseURL, launchBrowser } from "../helpers/browser.mjs";
import { projectRoot } from "../helpers/server.mjs";

const artifactsDir = resolve(projectRoot, "tests/artifacts");
const catalog = JSON.parse(await readFile(resolve(projectRoot, "data/solar-systems.json"), "utf8"));
const systems = catalog.systems;
const byId = new Map(systems.map((system) => [Number(system.id), system]));
const byName = new Map(systems.map((system) => [system.name, system]));
const routeCache = new Map();

function shortestRoute(originId, destinationId) {
  const origin = Number(originId);
  const destination = Number(destinationId);
  const cacheKey = `${origin}:${destination}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);
  if (origin === destination) return [origin];
  const queue = [origin];
  const previous = new Map([[origin, null]]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const neighbor of byId.get(current)?.neighbors || []) {
      const id = Number(neighbor);
      if (previous.has(id)) continue;
      previous.set(id, current);
      if (id === destination) {
        const route = [destination];
        let cursor = current;
        while (cursor !== null) {
          route.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        route.reverse();
        routeCache.set(cacheKey, route);
        return route;
      }
      queue.push(id);
    }
  }
  throw new Error(`No route ${origin} -> ${destination}`);
}

function nearestUniqueSystems(startName, count, used) {
  const start = byName.get(startName);
  const queue = [Number(start.id)];
  const visited = new Set(queue);
  const found = [];
  for (let index = 0; index < queue.length && found.length < count; index += 1) {
    const current = queue[index];
    if (current !== Number(start.id) && !used.has(current)) {
      used.add(current);
      found.push(byId.get(current));
    }
    for (const neighbor of byId.get(current)?.neighbors || []) {
      const id = Number(neighbor);
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(id);
    }
  }
  assert.equal(found.length, count, `Not enough systems near ${startName}`);
  return found;
}

function makeFleets(starts, speeds = []) {
  return starts.map((start, index) => ({
    fleet_id: `fleet-${index + 1}`,
    fleet_name: `Флот ${index + 1}`,
    fleet_color: ["#27a7d8", "#5ca66f", "#c28a55", "#a073b8"][index],
    current_system: start,
    seconds_per_jump: speeds[index] || 60,
    service_minutes: 5,
    key_hint: `00${index + 1}`,
    active: true
  }));
}

function makeTimers(clusterStarts, timing = {}) {
  const total = 40;
  const used = new Set(clusterStarts.map((name) => Number(byName.get(name).id)));
  const clusterCounts = timing.clusterCounts || clusterStarts.map(() => total / clusterStarts.length);
  assert.equal(clusterCounts.reduce((sum, count) => sum + count, 0), total);
  const clusters = clusterStarts.map((start, index) => nearestUniqueSystems(start, clusterCounts[index], used));
  const base = Date.now() + (timing.leadMinutes ?? 120) * 60000;
  const timers = [];
  for (let wave = 0; wave < Math.max(...clusterCounts); wave += 1) {
    for (let cluster = 0; cluster < clusters.length; cluster += 1) {
      if (wave >= clusterCounts[cluster]) continue;
      const target = clusters[cluster][wave];
      timers.push({
        id: `timer-${timers.length + 1}`,
        system: target.name,
        object_name: ["Athanor", "Metenox Moon Drill", "Customs Office"][wave % 3],
        structure: `${target.name} ${wave + 1}`,
        title: `Corp ${cluster + 1}`,
        owner: `Alliance ${cluster + 1}`,
        mode: "Reinforced",
        distance: cluster % 2 ? "Атака" : "Оборона",
        end_at: new Date(base + (wave * (timing.waveMinutes ?? 60) + cluster * (timing.clusterMinutes ?? 6)) * 60000).toISOString(),
        note: ""
      });
    }
  }
  return timers;
}

async function selectMultiFilter(page, selector, values) {
  if (!values) return;
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

async function runScenario(browser, definition) {
  const fleets = makeFleets(definition.fleetStarts, definition.speeds);
  const timers = makeTimers(definition.timerClusters, definition.timing);
  const timerKinds = definition.filters?.timerKinds || (definition.filters?.timerKind ? [definition.filters.timerKind] : null);
  const objectNames = definition.filters?.objectNames || (definition.filters?.objectName ? [definition.filters.objectName] : null);
  const eligibleTimers = timers.filter((timer) =>
    (!timerKinds || timerKinds.includes(timer.distance)) &&
    (!objectNames || objectNames.includes(timer.object_name))
  );
  const page = await browser.newPage({ viewport: definition.viewport || { width: 2400, height: 1200 } });
  const browserErrors = [];
  const esiCalls = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.addInitScript(({ initialFleets, initialTimers }) => {
    let assignments = [];
    window.__assignments = assignments;
    window.supabase = {
      createClient: () => ({
        rpc: async (name, args) => {
          if (name === "get_timers") return { data: initialTimers, error: null };
          if (name === "list_fleets_admin") return { data: initialFleets, error: null };
          if (name === "replace_fleet_assignments") {
            assignments = args.p_assignments;
            window.__assignments = assignments;
            return { data: assignments.length, error: null };
          }
          if (name === "get_all_fleet_routes") return {
            data: assignments.map((assignment) => {
              const fleet = initialFleets.find((item) => item.fleet_id === assignment.fleet_id);
              const timer = initialTimers.find((item) => item.id === assignment.timer_id);
              return {
                ...assignment,
                fleet_name: fleet.fleet_name,
                fleet_color: fleet.fleet_color,
                fleet_current_system: fleet.current_system,
                timer_system: timer.system,
                object_name: timer.object_name,
                structure: timer.structure,
                corporation: timer.title,
                alliance: timer.owner,
                timer_kind: timer.distance,
                mode: timer.mode,
                end_at: timer.end_at,
                result: timer.note
              };
            }),
            error: null
          };
          return { data: [], error: null };
        }
      })
    };
  }, { initialFleets: fleets, initialTimers: timers });

  const localOrigin = new URL(baseURL).origin;
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (new URL(url).origin === localOrigin) return route.continue();
    const match = url.match(/esi\.evetech\.net\/route\/(\d+)\/(\d+)/);
    if (match) {
      const origin = Number(match[1]);
      const destination = Number(match[2]);
      esiCalls.push(`${origin}:${destination}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ route: shortestRoute(origin, destination) }) });
    }
    return route.abort();
  });

  try {
    await page.goto(`${baseURL}/?admin=1#board`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#adminAccessDialog")?.open);
    await page.fill("#adminViewKey", "admin-test-key");
    await page.click("#confirmAdminAccessBtn");
    await page.waitForFunction(() => !document.querySelector("#adminPanel")?.hidden);
    await page.click("#routesTab");
    await page.click("#fleetMapModeBtn");
    await page.waitForFunction((count) => document.querySelectorAll(".fleet-profile-row").length === count, fleets.length);
    await selectMultiFilter(page, "#fleetTimerKindFilter", timerKinds);
    await selectMultiFilter(page, "#fleetObjectFilter", objectNames);
    const startedAt = Date.now();
    await page.click("#calculateFleetRoutesBtn");
    await page.waitForFunction(() => document.querySelector("#fleetAdminStatus")?.textContent.includes("Маршруты рассчитаны"), null, { timeout: 60000 });
    const plannerStatus = await page.locator("#fleetAdminStatus").textContent();
    assert.match(plannerStatus, /Опозданий: \d+, прыжков: \d+, разброс нагрузки:/);
    const calculationMs = Date.now() - startedAt;
    const assignments = await page.evaluate(() => window.__assignments);
    const timerById = new Map(timers.map((timer) => [timer.id, timer]));
    const counts = Object.fromEntries(fleets.map((fleet) => [fleet.fleet_name, 0]));
    const totalJumps = Object.fromEntries(fleets.map((fleet) => [fleet.fleet_name, 0]));
    const workloadMinutes = Object.fromEntries(fleets.map((fleet) => [fleet.fleet_name, 0]));
    const uniqueTimers = new Set();
    let lateAssignments = 0;

    for (const fleet of fleets) {
      const rows = assignments.filter((assignment) => assignment.fleet_id === fleet.fleet_id).sort((a, b) => a.route_order - b.route_order);
      counts[fleet.fleet_name] = rows.length;
      totalJumps[fleet.fleet_name] = rows.reduce((sum, row) => sum + Number(row.jump_count), 0);
      workloadMinutes[fleet.fleet_name] = Number((totalJumps[fleet.fleet_name] * fleet.seconds_per_jump / 60 + rows.length * fleet.service_minutes).toFixed(1));
      let expectedStart = Number(byName.get(fleet.current_system).id);
      let previousEta = 0;
      rows.forEach((row, index) => {
        const nodes = row.route_nodes || [];
        const timer = timerById.get(row.timer_id);
        const targetId = Number(byName.get(timer.system).id);
        assert.equal(row.route_order, index + 1, `${fleet.fleet_name}: route order`);
        assert.equal(uniqueTimers.has(row.timer_id), false, `Duplicate ${row.timer_id}`);
        uniqueTimers.add(row.timer_id);
        assert.equal(Number(nodes[0]?.id), expectedStart, `${fleet.fleet_name}: segment start`);
        assert.equal(Number(nodes.at(-1)?.id), targetId, `${fleet.fleet_name}: segment target`);
        assert.equal(Number(row.jump_count), Math.max(0, nodes.length - 1), `${fleet.fleet_name}: jump count`);
        const eta = new Date(row.eta_at).getTime();
        if (eta > new Date(timer.end_at).getTime()) lateAssignments += 1;
        assert.ok(eta >= previousEta, `${fleet.fleet_name}: ETA moved backwards`);
        previousEta = eta;
        expectedStart = targetId;
      });
    }

    assert.equal(assignments.length, eligibleTimers.length, "Every eligible timer must be assigned");
    assert.equal(uniqueTimers.size, eligibleTimers.length, "Every assignment must be unique");
    assert.equal(await page.locator("#routeList .route-list-row").count(), eligibleTimers.length, "Route table row count");
    assert.equal(await page.locator("#routeList [data-route-countdown]").count(), eligibleTimers.length, "Countdown cell count");
    assert.deepEqual(browserErrors, []);

    if (eligibleTimers.length >= fleets.length) {
      assert.ok(Math.min(...Object.values(counts)) > 0, "Every active fleet must receive a target");
    }
    if (definition.name === "defense-metenox-only") {
      assert.ok(
        Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1,
        "Filtered Metenox targets must stay evenly distributed"
      );
    }
    if (definition.name === "mixed-speed-tight") {
      const workloads = Object.values(workloadMinutes);
      assert.ok(Math.max(...workloads) - Math.min(...workloads) <= 6, "Mixed fleet workload must stay balanced");
      assert.ok(counts["Флот 1"] > counts["Флот 4"], "The faster fleet should receive more targets");
    }

    if (definition.name === "clustered") {
      await page.click('#routeList th[data-route-sort-key="system"] .table-sort-button');
      const ascending = await page.locator("#routeList .route-list-system").allTextContents();
      const expected = ascending.slice().sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
      assert.deepEqual(ascending, expected);
      await page.click('#routeList th[data-route-sort-key="system"] .table-sort-button');
      assert.deepEqual(await page.locator("#routeList .route-list-system").allTextContents(), expected.slice().reverse());
      await page.click('#routeList th[data-route-sort-key="jumps"] .table-sort-button');
      const jumps = (await page.locator("#routeList .route-list-row > td:nth-child(10)").allTextContents()).map((text) => Number(text.match(/\d+/)?.[0] || 0));
      assert.deepEqual(jumps, jumps.slice().sort((a, b) => a - b));

      const toggles = page.locator("#routeLegend input[data-fleet-visibility]");
      assert.equal(await toggles.count(), fleets.length);
      const edgeCount = await page.locator("#routeMap .route-edge").count();
      await toggles.nth(1).click({ force: true });
      await page.waitForFunction((before) => document.querySelectorAll("#routeMap .route-edge").length < before, edgeCount);
      assert.equal(await page.locator("#routeList .route-list-row").count(), eligibleTimers.length);
      for (let index = 0; index < fleets.length; index += 1) {
        await toggles.nth(index).evaluate((input) => { if (input.checked) input.click(); });
      }
      await page.waitForFunction(() => document.querySelector("#routeMap .route-map-empty")?.textContent.includes("Все флоты скрыты"));
      assert.equal(await page.locator("#routeList .route-list-row").count(), eligibleTimers.length);
    }

    return {
      scenario: definition.name,
      timers: timers.length,
      eligibleTimers: eligibleTimers.length,
      fleets: fleets.length,
      assignments: assignments.length,
      calculationMs,
      counts,
      totalJumps,
      workloadMinutes,
      minPerFleet: Math.min(...Object.values(counts)),
      maxPerFleet: Math.max(...Object.values(counts)),
      lateAssignments,
      esiCalls: esiCalls.length
    };
  } catch (error) {
    await mkdir(artifactsDir, { recursive: true });
    try {
      await page.screenshot({ path: resolve(artifactsDir, `fleet-stress-${definition.name}.png`), fullPage: true });
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    await page.close();
  }
}

const scenarios = [
  { name: "clustered", fleetStarts: ["Jita", "Amarr", "Dodixie", "Hek"], timerClusters: ["Jita", "Amarr", "Dodixie", "Hek"] },
  { name: "same-start", fleetStarts: ["Jita", "Jita", "Jita", "Jita"], timerClusters: ["Jita", "Jita", "Jita", "Jita"] },
  { name: "uneven-geography", fleetStarts: ["Jita", "Amarr", "Dodixie", "Hek"], timerClusters: ["Jita", "Amarr", "Dodixie", "Hek"], timing: { clusterCounts: [16, 8, 8, 8], leadMinutes: 180, waveMinutes: 45, clusterMinutes: 5 } },
  { name: "defense-metenox-only", fleetStarts: ["Jita", "Amarr", "Dodixie", "Hek"], timerClusters: ["Jita", "Amarr", "Dodixie", "Hek"], filters: { timerKind: "Оборона", objectName: "Metenox Moon Drill" } },
  { name: "attack-defense-two-structures", fleetStarts: ["Jita", "Amarr", "Dodixie", "Hek"], timerClusters: ["Jita", "Amarr", "Dodixie", "Hek"], filters: { timerKinds: ["Атака", "Оборона"], objectNames: ["Athanor", "Customs Office"] } },
  { name: "multifilter-mobile", fleetStarts: ["Jita", "Amarr", "Dodixie", "Hek"], timerClusters: ["Jita", "Amarr", "Dodixie", "Hek"], filters: { timerKinds: ["Атака", "Оборона"], objectNames: ["Athanor", "Customs Office"] }, viewport: { width: 390, height: 844 } },
  { name: "slightly-faster-fleet", fleetStarts: ["Jita", "Jita", "Jita", "Jita"], timerClusters: ["Jita", "Jita", "Jita", "Jita"], speeds: [50, 60, 60, 60], timing: { leadMinutes: 30, waveMinutes: 15, clusterMinutes: 2 } },
  { name: "mixed-speed-tight", fleetStarts: ["Jita", "Jita", "Jita", "Jita"], timerClusters: ["Jita", "Jita", "Jita", "Jita"], speeds: [30, 60, 90, 120], timing: { leadMinutes: 15, waveMinutes: 5, clusterMinutes: 1 } }
];

const browser = await launchBrowser();
const results = [];
try {
  for (const scenario of scenarios) results.push(await runScenario(browser, scenario));
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
console.log(`PASS fleet routing stress (${results.length} scenarios)`);
