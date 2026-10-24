import assert from "node:assert/strict";
import test from "node:test";
import { planFleetAssignments, planSequentialRoute } from "../../js/core/route-planner.js";

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
