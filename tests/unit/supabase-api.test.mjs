import assert from "node:assert/strict";
import test from "node:test";
import { createTimerboardApi } from "../../js/services/supabase-api.js";

test("maps timer and fleet operations to the documented RPC contract", async () => {
  const calls = [];
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      return Promise.resolve({ data: [], error: null });
    }
  };
  const api = createTimerboardApi(client);

  await api.addTimers("main", "admin", [{ system: "Hakatiz" }]);
  await api.patchTimer("main", "admin", "timer-1", { owner: "Corp" }, "2030-01-01T00:00:00Z");
  await api.setFleetTimerResult("main", "view", "fleet-key", "fleet-1", "timer-1", "Защищена");

  assert.deepEqual(calls, [
    { name: "add_timers", params: {
      p_board_id: "main", p_admin_key: "admin", p_timers: [{ system: "Hakatiz" }]
    } },
    { name: "patch_timer_admin_fields", params: {
      p_board_id: "main", p_admin_key: "admin", p_id: "timer-1",
      p_changes: { owner: "Corp" }, p_expected_updated_at: "2030-01-01T00:00:00Z"
    } },
    { name: "set_fleet_timer_result", params: {
      p_board_id: "main", p_view_key: "view", p_access_key: "fleet-key",
      p_fleet_id: "fleet-1", p_timer_id: "timer-1", p_result: "Защищена"
    } }
  ]);
});
