import assert from "node:assert/strict";
import test from "node:test";
import { sortBoardTimers } from "../../js/ui/board-view.js";
import { sortFleetRouteRows, sortGeneralRouteRows } from "../../js/ui/route-table-view.js";

test("sorts board rows without DOM state", () => {
  const rows = [
    { id: "b", system: "Beta", end_at: "2030-01-02T00:00:00Z", isCompleted: false, status: { label: "Активен" } },
    { id: "a", system: "Alpha", end_at: "2030-01-01T00:00:00Z", isCompleted: false, status: { label: "Скоро" } }
  ];
  assert.deepEqual(sortBoardTimers(rows, { key: "system", direction: "asc" }).map((row) => row.id), ["a", "b"]);
  assert.deepEqual(sortBoardTimers(rows, { key: "end_at", direction: "desc" }).map((row) => row.id), ["b", "a"]);
});

test("sorts route rows while retaining deterministic route order", () => {
  const candidates = [
    { timer: { system: "Beta", end_at: "2030-01-02T00:00:00Z" }, eta: 2, marginMs: 2 },
    { timer: { system: "Alpha", end_at: "2030-01-01T00:00:00Z" }, eta: 1, marginMs: 1 }
  ];
  assert.deepEqual(
    sortGeneralRouteRows(candidates, { key: "system", direction: "asc" }).map((row) => row.routeOrder),
    [2, 1]
  );
  const fleets = [
    { fleet_name: "2", route_order: 1 },
    { fleet_name: "1", route_order: 2 },
    { fleet_name: "1", route_order: 1 }
  ];
  assert.deepEqual(
    sortFleetRouteRows(fleets, { key: "default", direction: "asc" }).map((row) => `${row.fleet_name}:${row.route_order}`),
    ["1:1", "1:2", "2:1"]
  );
});
