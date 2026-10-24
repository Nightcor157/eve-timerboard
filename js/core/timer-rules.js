import { DEFAULT_POST_TIMER_STATE, POST_TIMER_STATES } from "./constants.js";
import { formatRemaining, normalizeStructureResult, normalizeStructureType } from "../shared/format.js";

export function getTimerState(timer, now = Date.now()) {
  const endAtMs = new Date(timer.end_at).getTime();
  const mainRemainingMs = endAtMs - now;
  const result = normalizeStructureResult(timer.note);

  if (result) {
    const updatedAtMs = new Date(timer.updated_at).getTime();
    const completedAtMs = Number.isFinite(updatedAtMs) ? Math.max(endAtMs, updatedAtMs) : endAtMs;
    return completedTimerState(now, completedAtMs);
  }

  if (mainRemainingMs > 0) {
    const isSoon = mainRemainingMs <= 4 * 3600 * 1000;
    return {
      phase: "active",
      isCompleted: false,
      isSoon,
      completedAgeMs: 0,
      remainingText: formatRemaining(mainRemainingMs),
      status: isSoon
        ? { label: "Скоро", className: "is-soon" }
        : { label: "Активен", className: "is-active" }
    };
  }

  const structureType = normalizeStructureType(timer.object_name);
  const postTimerState = POST_TIMER_STATES.get(structureType) || DEFAULT_POST_TIMER_STATE;
  const postTimerEndAtMs = endAtMs + postTimerState.durationMs;
  const postTimerRemainingMs = postTimerEndAtMs - now;
  if (postTimerRemainingMs > 0) {
    return {
      phase: postTimerState.className === "is-repair" ? "repair" : "pending-result",
      isCompleted: false,
      isSoon: true,
      completedAgeMs: 0,
      remainingText: formatRemaining(postTimerRemainingMs),
      status: { label: postTimerState.label, className: postTimerState.className }
    };
  }

  return completedTimerState(now, postTimerEndAtMs);
}

export function isWithinCompletedWindow(completedAgeMs, windowMs) {
  const age = Number(completedAgeMs);
  const window = Number(windowMs);
  return Number.isFinite(age) && Number.isFinite(window) && age >= 0 && window >= 0 && age <= window;
}

function completedTimerState(now, completedAtMs) {
  return {
    phase: "completed",
    isCompleted: true,
    isSoon: false,
    completedAgeMs: Math.max(0, now - completedAtMs),
    remainingText: "00:00:00",
    status: { label: "Завершён", className: "is-ended" }
  };
}
