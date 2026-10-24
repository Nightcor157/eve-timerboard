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

export async function planFleetAssignmentsV2({
  fleets,
  targets,
  resolveSystem,
  getRoute,
  now = Date.now(),
  onProgress = null,
  maxPasses = 2,
  maxCandidateEvaluations = 1200
}) {
  const startedAt = Date.now();
  const routeCache = new Map();
  const cachedRoute = async (originId, destinationId) => {
    const key = `${Number(originId)}:${Number(destinationId)}`;
    if (!routeCache.has(key)) {
      routeCache.set(key, Promise.resolve(getRoute(originId, destinationId)).then((route) => {
        if (!Array.isArray(route) || !route.length) throw new Error(`Пустой маршрут: ${key}`);
        return route.map(Number);
      }));
    }
    return routeCache.get(key);
  };

  const baselineAssignments = await planFleetAssignments({
    fleets,
    targets,
    resolveSystem,
    getRoute: cachedRoute,
    now,
    onProgress
  });
  const context = createPlannerContext(fleets, targets, resolveSystem, cachedRoute, now);
  const baselineSequences = sequencesFromAssignments(fleets, targets, baselineAssignments);
  let current = await evaluateSequences(baselineSequences, context);
  const baselineMetrics = { ...current.metrics };
  let candidateEvaluations = 0;
  let completedPasses = 0;

  for (let pass = 0; pass < maxPasses && candidateEvaluations < maxCandidateEvaluations; pass += 1) {
    let best = current;
    const fleetIds = fleets.map((fleet) => String(fleet.fleet_id));

    for (const sourceFleetId of fleetIds) {
      const sourceTimers = current.sequences.get(sourceFleetId) || [];
      for (const timer of sourceTimers) {
        for (const destinationFleetId of fleetIds) {
          if (destinationFleetId === sourceFleetId || candidateEvaluations >= maxCandidateEvaluations) continue;
          const sequences = cloneSequences(current.sequences);
          sequences.set(sourceFleetId, sequences.get(sourceFleetId).filter((item) => String(item.id) !== String(timer.id)));
          sequences.set(destinationFleetId, sortTargets([...sequences.get(destinationFleetId), timer]));
          const candidate = await evaluateSequences(sequences, context);
          candidateEvaluations += 1;
          if (comparePlanMetrics(candidate.metrics, best.metrics) < 0) best = candidate;
        }
      }
    }

    const assigned = fleetIds.flatMap((fleetId) =>
      (current.sequences.get(fleetId) || []).map((timer) => ({ fleetId, timer }))
    );
    for (let leftIndex = 0; leftIndex < assigned.length && candidateEvaluations < maxCandidateEvaluations; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < assigned.length && candidateEvaluations < maxCandidateEvaluations; rightIndex += 1) {
        const left = assigned[leftIndex];
        const right = assigned[rightIndex];
        if (left.fleetId === right.fleetId) continue;
        const sequences = cloneSequences(current.sequences);
        sequences.set(left.fleetId, sortTargets(sequences.get(left.fleetId).map((timer) =>
          String(timer.id) === String(left.timer.id) ? right.timer : timer
        )));
        sequences.set(right.fleetId, sortTargets(sequences.get(right.fleetId).map((timer) =>
          String(timer.id) === String(right.timer.id) ? left.timer : timer
        )));
        const candidate = await evaluateSequences(sequences, context);
        candidateEvaluations += 1;
        if (comparePlanMetrics(candidate.metrics, best.metrics) < 0) best = candidate;
      }
    }

    completedPasses += 1;
    if (comparePlanMetrics(best.metrics, current.metrics) >= 0) break;
    current = best;
  }

  return {
    assignments: current.assignments,
    baselineAssignments,
    baselineMetrics,
    metrics: {
      ...current.metrics,
      candidateEvaluations,
      passes: completedPasses,
      calculationMs: Date.now() - startedAt
    },
    improved: comparePlanMetrics(current.metrics, baselineMetrics) < 0
  };
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

export function comparePlanMetrics(a, b) {
  for (const key of ["lateCount", "totalLatenessMs", "totalJumps", "workloadSpreadMs"]) {
    const difference = Number(a[key] || 0) - Number(b[key] || 0);
    if (difference) return difference;
  }
  return 0;
}

function createPlannerContext(fleets, targets, resolveSystem, getRoute, now) {
  const fleetById = new Map();
  const startSystemByFleetId = new Map();
  for (const fleet of fleets) {
    const fleetId = String(fleet.fleet_id);
    const system = resolveSystem(fleet.current_system);
    if (!system) throw new Error(`Система флота не найдена в каталоге EVE: ${fleet.current_system}`);
    fleetById.set(fleetId, fleet);
    startSystemByFleetId.set(fleetId, system);
  }
  const targetSystemById = new Map();
  for (const timer of targets) {
    const system = resolveSystem(timer.system);
    if (!system) throw new Error(`Система таймера не найдена в каталоге EVE: ${timer.system}`);
    targetSystemById.set(String(timer.id), system);
  }
  return { fleets, fleetById, startSystemByFleetId, targetSystemById, getRoute, now };
}

function sequencesFromAssignments(fleets, targets, assignments) {
  const timersById = new Map(targets.map((timer) => [String(timer.id), timer]));
  const sequences = new Map(fleets.map((fleet) => [String(fleet.fleet_id), []]));
  assignments.slice().sort((a, b) => Number(a.route_order) - Number(b.route_order)).forEach((assignment) => {
    const timer = timersById.get(String(assignment.timer_id));
    if (timer) sequences.get(String(assignment.fleet_id)).push(timer);
  });
  for (const [fleetId, timers] of sequences) sequences.set(fleetId, sortTargets(timers));
  return sequences;
}

async function evaluateSequences(sequences, context) {
  const assignments = [];
  const workloads = [];
  let lateCount = 0;
  let totalLatenessMs = 0;
  let totalJumps = 0;

  for (const fleet of context.fleets) {
    const fleetId = String(fleet.fleet_id);
    const timers = sortTargets(sequences.get(fleetId) || []);
    let currentSystemId = context.startSystemByFleetId.get(fleetId).id;
    let availableAt = context.now;
    let workloadMs = 0;
    for (let index = 0; index < timers.length; index += 1) {
      const timer = timers[index];
      const targetSystem = context.targetSystemById.get(String(timer.id));
      const routeIds = await context.getRoute(currentSystemId, targetSystem.id);
      const jumps = Math.max(0, routeIds.length - 1);
      const travelMs = jumps * Number(fleet.seconds_per_jump) * 1000;
      const arrivalAt = availableAt + travelMs;
      const deadline = new Date(timer.end_at).getTime();
      const latenessMs = Math.max(0, arrivalAt - deadline);
      if (latenessMs > 0) lateCount += 1;
      totalLatenessMs += latenessMs;
      totalJumps += jumps;
      workloadMs += travelMs + Number(fleet.service_minutes) * 60 * 1000;
      assignments.push({
        fleet_id: fleet.fleet_id,
        timer_id: timer.id,
        route_order: index + 1,
        jump_count: jumps,
        eta_at: new Date(arrivalAt).toISOString(),
        route_ids: routeIds,
        lateness_ms: latenessMs
      });
      availableAt = Math.max(arrivalAt, deadline) + Number(fleet.service_minutes) * 60 * 1000;
      currentSystemId = targetSystem.id;
    }
    workloads.push(workloadMs);
  }

  return {
    assignments,
    sequences: cloneSequences(sequences),
    metrics: {
      lateCount,
      totalLatenessMs,
      totalJumps,
      workloadSpreadMs: workloads.length ? Math.max(...workloads) - Math.min(...workloads) : 0
    }
  };
}

function cloneSequences(sequences) {
  return new Map([...sequences.entries()].map(([fleetId, timers]) => [fleetId, timers.slice()]));
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
