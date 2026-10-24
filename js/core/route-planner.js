export async function planFleetAssignments({
  fleets,
  targets,
  resolveSystem,
  getRoute,
  now = Date.now(),
  onProgress = null
}) {
  const fleetStates = fleets.map((fleet) => {
    const system = resolveSystem(fleet.current_system);
    if (!system) throw new Error(`Система флота не найдена в каталоге EVE: ${fleet.current_system}`);
    return { fleet, currentId: system.id, availableAt: now, order: 0 };
  });

  const assignments = [];
  const sortedTargets = sortTargets(targets);
  for (let index = 0; index < sortedTargets.length; index += 1) {
    const timer = sortedTargets[index];
    if (onProgress) onProgress({ index, total: sortedTargets.length, timer });
    const targetSystem = resolveSystem(timer.system);
    if (!targetSystem) throw new Error(`Система таймера не найдена в каталоге EVE: ${timer.system}`);
    const options = await Promise.all(fleetStates.map((fleetState) =>
      calculateFleetTargetOption(fleetState, targetSystem, timer, getRoute)
    ));
    options.sort(compareRouteOptions);
    const best = options[0];
    best.fleetState.order += 1;
    assignments.push({
      fleet_id: best.fleetState.fleet.fleet_id,
      timer_id: timer.id,
      route_order: best.fleetState.order,
      jump_count: best.jumps,
      eta_at: new Date(best.arrivalAt).toISOString(),
      route_ids: best.routeIds
    });
    advanceFleetState(best, targetSystem, timer);
  }
  return assignments;
}

export async function planSequentialRoute({
  originSystem,
  fleet,
  targets,
  resolveSystem,
  getRoute,
  now = Date.now(),
  onProgress = null
}) {
  const fleetState = { fleet, currentId: originSystem.id, availableAt: now, order: 0 };
  const candidates = [];
  const sortedTargets = sortTargets(targets);
  for (let index = 0; index < sortedTargets.length; index += 1) {
    const timer = sortedTargets[index];
    if (onProgress) onProgress({ index, total: sortedTargets.length, timer });
    const targetSystem = resolveSystem(timer.system);
    if (!targetSystem) throw new Error(`Система таймера не найдена в каталоге EVE: ${timer.system}`);
    const option = await calculateFleetTargetOption(fleetState, targetSystem, timer, getRoute);
    fleetState.order += 1;
    candidates.push({
      timer,
      targetSystem,
      routeIds: option.routeIds,
      jumps: option.jumps,
      eta: option.arrivalAt,
      marginMs: new Date(timer.end_at).getTime() - option.arrivalAt
    });
    advanceFleetState(option, targetSystem, timer);
  }
  return candidates;
}

export function compareRouteOptions(a, b) {
  if (Boolean(a.lateness) !== Boolean(b.lateness)) return a.lateness ? 1 : -1;
  if (a.lateness !== b.lateness) return a.lateness - b.lateness;
  if (a.arrivalAt !== b.arrivalAt) return a.arrivalAt - b.arrivalAt;
  return a.jumps - b.jumps;
}

async function calculateFleetTargetOption(fleetState, targetSystem, timer, getRoute) {
  const routeIds = await getRoute(fleetState.currentId, targetSystem.id);
  const jumps = Math.max(0, routeIds.length - 1);
  const arrivalAt = fleetState.availableAt + jumps * Number(fleetState.fleet.seconds_per_jump) * 1000;
  const deadline = new Date(timer.end_at).getTime();
  return {
    fleetState,
    routeIds,
    jumps,
    arrivalAt,
    lateness: Math.max(0, arrivalAt - deadline)
  };
}

function advanceFleetState(option, targetSystem, timer) {
  const deadline = new Date(timer.end_at).getTime();
  option.fleetState.availableAt = Math.max(option.arrivalAt, deadline) +
    Number(option.fleetState.fleet.service_minutes) * 60 * 1000;
  option.fleetState.currentId = targetSystem.id;
}

function sortTargets(targets) {
  return targets.slice().sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
}
