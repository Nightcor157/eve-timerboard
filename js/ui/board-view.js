import {
  compareText,
  normalizeStructureResult,
  normalizeStructureType,
  normalizeTimerKind
} from "../shared/format.js";

export function sortBoardTimers(timers, sort, now = Date.now()) {
  return timers.slice().sort((a, b) => compareTimers(a, b, sort, now));
}

export function compareTimers(a, b, sort, now = Date.now()) {
  const direction = sort.direction === "desc" ? -1 : 1;
  const result = compareBoardSortValue(a, b, sort.key, now) || compareTime(a, b) || compareText(a.system, b.system);
  return result * direction;
}

function compareBoardSortValue(a, b, key, now) {
  if (key === "end_at") return compareTime(a, b);
  if (key === "remaining") {
    const aRemaining = a.isCompleted ? 0 : Math.max(0, new Date(a.end_at).getTime() - now);
    const bRemaining = b.isCompleted ? 0 : Math.max(0, new Date(b.end_at).getTime() - now);
    return aRemaining - bRemaining;
  }
  if (key === "object_name") return compareText(normalizeStructureType(a.object_name), normalizeStructureType(b.object_name));
  if (key === "timer_kind") return compareText(normalizeTimerKind(a.distance), normalizeTimerKind(b.distance));
  if (key === "status") return compareText(a.status.label, b.status.label);
  if (key === "result") return compareText(normalizeStructureResult(a.note), normalizeStructureResult(b.note));
  return compareText(a[key], b[key]);
}

function compareTime(a, b) {
  return new Date(a.end_at).getTime() - new Date(b.end_at).getTime();
}
