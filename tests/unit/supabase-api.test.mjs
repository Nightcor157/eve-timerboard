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
  await api.setFleetTimerResult("main", "view", "fleet-key", "fleet-1", "timer-1", "Защищена", "2030-01-02T00:00:00Z");

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
      p_fleet_id: "fleet-1", p_timer_id: "timer-1", p_result: "Защищена",
      p_expected_updated_at: "2030-01-02T00:00:00Z"
    } }
  ]);
});

test("uses the legacy fleet-result signature only while the new RPC is absent", async () => {
  const calls = [];
  const api = createTimerboardApi({
    rpc: async (name, params) => {
      calls.push({ name, params });
      if (Object.hasOwn(params, "p_expected_updated_at")) {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      }
      return { data: { id: params.p_timer_id, note: params.p_result }, error: null };
    }
  });

  const response = await api.setFleetTimerResult(
    "main",
    "view",
    "fleet-key",
    "fleet-1",
    "timer-1",
    "Защищена",
    "2030-01-02T00:00:00Z"
  );

  assert.equal(response.error, null);
  assert.equal(calls.length, 2);
  assert.ok(Object.hasOwn(calls[0].params, "p_expected_updated_at"));
  assert.equal(Object.hasOwn(calls[1].params, "p_expected_updated_at"), false);
});

test("does not hide access errors behind the legacy fleet-result call", async () => {
  const calls = [];
  const api = createTimerboardApi({
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: null, error: { code: "28000", message: "wrong fleet key" } };
    }
  });

  const response = await api.setFleetTimerResult(
    "main",
    "view",
    "wrong-key",
    "fleet-1",
    "timer-1",
    "Защищена",
    "2030-01-02T00:00:00Z"
  );

  assert.equal(response.error.code, "28000");
  assert.equal(calls.length, 1);
});
