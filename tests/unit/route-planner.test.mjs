import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePlanMetrics,
  planFleetAssignments,
  planFleetAssignmentsV2,
  planSequentialRoute
} from "../../js/core/route-planner.js";

const now = Date.parse("2030-05-22T12:00:00Z");
const systems = new Map([
  ["a", { id: 1, name: "A" }],
  ["b", { id: 2, name: "B" }],
  ["c", { id: 3, name: "C" }],
  ["d", { id: 4, name: "D" }]
]);
const routes = new Map([
  ["1:2", [1, 2]], ["4:2", [4, 3, 2]],
  ["2:3", [2, 3]], ["4:3", [4, 3]],
  ["1:3", [1, 2, 3]], ["3:2", [3, 2]]
]);
const resolveSystem = (name) => systems.get(String(name).toLowerCase());
const getRoute = async (from, to) => from === to ? [from] : routes.get(`${from}:${to}`);

test("assigns each target once using the existing greedy ordering", async () => {
  const fleets = [
    { fleet_id: "fleet-1", current_system: "A", seconds_per_jump: 60, service_minutes: 5 },
    { fleet_id: "fleet-2", current_system: "D", seconds_per_jump: 60, service_minutes: 5 }
  ];
  const targets = [
    { id: "timer-2", system: "C", end_at: new Date(now + 20 * 60 * 1000).toISOString() },
    { id: "timer-1", system: "B", end_at: new Date(now + 10 * 60 * 1000).toISOString() }
  ];
  const assignments = await planFleetAssignments({ fleets, targets, resolveSystem, getRoute, now });
  assert.deepEqual(assignments.map((item) => [item.timer_id, item.fleet_id, item.route_order, item.jump_count]), [
    ["timer-1", "fleet-1", 1, 1],
    ["timer-2", "fleet-2", 1, 1]
  ]);
  assert.equal(new Set(assignments.map((item) => item.timer_id)).size, targets.length);
});

test("builds a deterministic sequential route for one fleet", async () => {
  const targets = [
    { id: "timer-1", system: "B", end_at: new Date(now + 10 * 60 * 1000).toISOString() },
    { id: "timer-2", system: "C", end_at: new Date(now + 20 * 60 * 1000).toISOString() }
  ];
  const candidates = await planSequentialRoute({
    originSystem: systems.get("a"),
    fleet: { seconds_per_jump: 60, service_minutes: 5 },
    targets,
    resolveSystem,
    getRoute,
    now
  });
  assert.deepEqual(candidates.map((item) => item.routeIds), [[1, 2], [2, 3]]);
  assert.deepEqual(candidates.map((item) => item.jumps), [1, 1]);
  assert.ok(candidates.every((item) => Number.isFinite(item.marginMs)));
});

test("v2 uses all available fleets while still reducing jumps", async () => {
  const v2Routes = new Map([
    ["1:2", [1, 2]],
    ["4:2", [4, 5, 2]],
    ["2:3", [2, 3]],
    ["4:3", [4, 6, 7, 8, 9, 3]],
    ["1:3", [1, 2, 3]],
    ["3:2", [3, 2]]
  ]);
  const v2GetRoute = async (from, to) => from === to ? [from] : v2Routes.get(`${from}:${to}`);
  const fleets = [
    { fleet_id: "fleet-1", current_system: "A", seconds_per_jump: 60, service_minutes: 0 },
    { fleet_id: "fleet-2", current_system: "D", seconds_per_jump: 60, service_minutes: 0 }
  ];
  const targets = [
    { id: "timer-1", system: "B", end_at: new Date(now + 10 * 60 * 1000).toISOString() },
    { id: "timer-2", system: "C", end_at: new Date(now + 11 * 60 * 1000).toISOString() }
  ];

  const baseline = await planFleetAssignments({ fleets, targets, resolveSystem, getRoute: v2GetRoute, now });
  assert.deepEqual(baseline.map((item) => item.fleet_id), ["fleet-1", "fleet-2"]);
  const result = await planFleetAssignmentsV2({ fleets, targets, resolveSystem, getRoute: v2GetRoute, now });
  assert.deepEqual(result.assignments.map((item) => item.fleet_id), ["fleet-1", "fleet-2"]);
  assert.equal(result.baselineMetrics.totalJumps, 6);
  assert.equal(result.metrics.totalJumps, 4);
  assert.equal(result.metrics.idleFleetCount, 0);
  assert.equal(result.metrics.assignmentSpread, 0);
  assert.equal(result.metrics.lateCount, 0);
  assert.equal(result.improved, true);
  assert.ok(comparePlanMetrics(result.metrics, result.baselineMetrics) < 0);
  assert.ok(result.metrics.candidateEvaluations > 0);
});

test("v2 balances targets by workload while preserving deadlines", async () => {
  const balancedSystems = new Map(Array.from({ length: 8 }, (_, index) => [
    `s${index + 1}`,
    { id: index + 1, name: `S${index + 1}` }
  ]));
  const balancedResolve = (name) => balancedSystems.get(String(name).toLowerCase());
  const balancedRoute = async (from, to) => from === to ? [from] : [from, to];
  const fleets = Array.from({ length: 4 }, (_, index) => ({
    fleet_id: `fleet-${index + 1}`,
    current_system: "S1",
    seconds_per_jump: 60,
    service_minutes: 5
  }));
  const targets = Array.from({ length: 6 }, (_, index) => ({
    id: `timer-${index + 1}`,
    system: `S${index + 2}`,
    end_at: new Date(now + (60 + index * 10) * 60 * 1000).toISOString()
  }));

  const result = await planFleetAssignmentsV2({
    fleets,
    targets,
    resolveSystem: balancedResolve,
    getRoute: balancedRoute,
    now
  });
  const counts = fleets.map((fleet) => result.assignments.filter((item) => item.fleet_id === fleet.fleet_id).length);
  assert.equal(result.metrics.lateCount, 0);
  assert.equal(result.metrics.idleFleetCount, 0);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test("v2 never scores worse than baseline across 40-target scenarios", async () => {
  for (let scenario = 0; scenario < 4; scenario += 1) {
    const scenarioSystems = new Map();
    for (let id = 1; id <= 48; id += 1) scenarioSystems.set(`s${id}`, { id, name: `S${id}` });
    const scenarioResolve = (name) => scenarioSystems.get(String(name).toLowerCase());
    const scenarioRoute = async (from, to) => {
      if (from === to) return [from];
      const jumps = 1 + ((Math.abs(Number(from) * 7 - Number(to) * 3) + scenario) % 8);
      return [from, ...Array.from({ length: jumps - 1 }, (_, index) => 1000 + from * 100 + to * 10 + index), to];
    };
    const scenarioFleets = Array.from({ length: 4 }, (_, index) => ({
      fleet_id: `fleet-${index + 1}`,
      current_system: `S${index * 10 + 1}`,
      seconds_per_jump: 45 + index * 10,
      service_minutes: 4 + index
    }));
    const scenarioTargets = Array.from({ length: 40 }, (_, index) => ({
      id: `timer-${scenario}-${index}`,
      system: `S${5 + ((index * 11 + scenario * 3) % 44)}`,
      end_at: new Date(now + (20 + index * 7) * 60 * 1000).toISOString()
    }));
    const result = await planFleetAssignmentsV2({
      fleets: scenarioFleets,
      targets: scenarioTargets,
      resolveSystem: scenarioResolve,
      getRoute: scenarioRoute,
      now,
      maxCandidateEvaluations: 900
    });
    assert.ok(comparePlanMetrics(result.metrics, result.baselineMetrics) <= 0, `scenario ${scenario}`);
    assert.equal(result.assignments.length, 40);
    assert.equal(new Set(result.assignments.map((item) => item.timer_id)).size, 40);
    assert.equal(result.metrics.idleFleetCount, 0, `scenario ${scenario}: idle fleet`);
  }
});
