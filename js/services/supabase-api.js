let sharedClient = null;
let sharedSignature = "";
let sharedApi = null;

export function hasSupabaseConfig(config = window.EVE_TIMERBOARD_CONFIG || {}) {
  return Boolean(
    config.supabaseUrl &&
    config.supabaseKey &&
    !String(config.supabaseUrl).includes("YOUR-PROJECT") &&
    !String(config.supabaseKey).includes("YOUR-SUPABASE") &&
    window.supabase
  );
}

export function getSupabaseClient(config = window.EVE_TIMERBOARD_CONFIG || {}) {
  if (!hasSupabaseConfig(config)) return null;
  const signature = `${config.supabaseUrl}\n${config.supabaseKey}`;
  if (!sharedClient || sharedSignature !== signature) {
    sharedClient = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
    sharedSignature = signature;
    sharedApi = null;
  }
  return sharedClient;
}

export function getTimerboardApi(config = window.EVE_TIMERBOARD_CONFIG || {}) {
  const client = getSupabaseClient(config);
  if (!client) return null;
  if (!sharedApi) sharedApi = createTimerboardApi(client);
  return sharedApi;
}

export function createTimerboardApi(client) {
  const rpc = (name, params) => client.rpc(name, params);
  const setFleetTimerResult = async (
    boardId,
    viewKey,
    accessKey,
    fleetId,
    timerId,
    result,
    expectedUpdatedAt
  ) => {
    const legacyParams = {
      p_board_id: boardId,
      p_view_key: viewKey,
      p_access_key: accessKey,
      p_fleet_id: fleetId,
      p_timer_id: timerId,
      p_result: result
    };
    if (!expectedUpdatedAt) return rpc("set_fleet_timer_result", legacyParams);

    const response = await rpc("set_fleet_timer_result", {
      ...legacyParams,
      p_expected_updated_at: expectedUpdatedAt
    });
    if (!isMissingRpcSignature(response.error)) return response;
    return rpc("set_fleet_timer_result", legacyParams);
  };

  return Object.freeze({
    listFleetsAdmin: (boardId, adminKey) => rpc("list_fleets_admin", {
      p_board_id: boardId,
      p_admin_key: adminKey
    }),
    getTimers: (boardId, viewKey) => rpc("get_timers", {
      p_board_id: boardId,
      p_view_key: viewKey
    }),
    setViewKey: (boardId, adminKey, viewKey) => rpc("set_timerboard_view_key", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_view_key: viewKey
    }),
    addTimers: (boardId, adminKey, timers) => rpc("add_timers", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_timers: timers
    }),
    deleteTimer: (boardId, adminKey, timerId) => rpc("delete_timer", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_id: timerId
    }),
    clearTimerHistory: (boardId, adminKey) => rpc("clear_timer_history", {
      p_board_id: boardId,
      p_admin_key: adminKey
    }),
    setFleetTimerResult,
    patchTimer: (boardId, adminKey, timerId, changes, expectedUpdatedAt) =>
      rpc("patch_timer_admin_fields", {
        p_board_id: boardId,
        p_admin_key: adminKey,
        p_id: timerId,
        p_changes: changes,
        p_expected_updated_at: expectedUpdatedAt
      }),
    listFleets: (boardId, viewKey) => rpc("list_fleets", {
      p_board_id: boardId,
      p_view_key: viewKey
    }),
    createFleet: (boardId, adminKey, fleet) => rpc("create_fleet", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_name: fleet.name,
      p_color: fleet.color,
      p_current_system: fleet.currentSystem,
      p_seconds_per_jump: fleet.secondsPerJump,
      p_service_minutes: fleet.serviceMinutes
    }),
    updateFleet: (boardId, adminKey, fleetId, fleet) => rpc("update_fleet", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_fleet_id: fleetId,
      p_name: fleet.name,
      p_color: fleet.color,
      p_current_system: fleet.currentSystem,
      p_seconds_per_jump: fleet.secondsPerJump,
      p_service_minutes: fleet.serviceMinutes,
      p_active: fleet.active
    }),
    rotateFleetKey: (boardId, adminKey, fleetId) => rpc("rotate_fleet_key", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_fleet_id: fleetId
    }),
    deleteFleet: (boardId, adminKey, fleetId) => rpc("delete_fleet", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_fleet_id: fleetId
    }),
    replaceFleetAssignments: (boardId, adminKey, assignments) => rpc("replace_fleet_assignments", {
      p_board_id: boardId,
      p_admin_key: adminKey,
      p_assignments: assignments
    }),
    getFleetRoute: (boardId, viewKey, fleetId, fleetKey) => rpc("get_fleet_route", {
      p_board_id: boardId,
      p_view_key: viewKey,
      p_fleet_id: fleetId,
      p_fleet_key: fleetKey
    }),
    getAllFleetRoutes: (boardId, adminKey) => rpc("get_all_fleet_routes", {
      p_board_id: boardId,
      p_admin_key: adminKey
    })
  });
}

function isMissingRpcSignature(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || error.details || "");
  return code === "PGRST202" || code === "42883" ||
    /could not find.*function|function .* does not exist/i.test(message);
}
