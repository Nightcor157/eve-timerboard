import { normalizeStructureResult } from "../shared/format.js";

export function sortGeneralRouteRows(candidates, sort) {
  const rows = candidates.map((candidate, index) => ({ candidate, routeOrder: index + 1 }));
  return sortRouteRows(rows, "general", sort);
}

export function sortFleetRouteRows(rows, sort) {
  return sortRouteRows(rows.slice(), "fleet", sort);
}

function sortRouteRows(rows, mode, sort) {
  if (mode === "fleet" && sort.key === "default") {
    return rows.sort((a, b) => compareText(a.fleet_name, b.fleet_name) || Number(a.route_order) - Number(b.route_order));
  }
  const direction = sort.direction === "desc" ? -1 : 1;
  return rows.sort((a, b) => {
    const result = compareValues(getSortValue(a, mode, sort.key), getSortValue(b, mode, sort.key));
    const fallback = mode === "general"
      ? a.routeOrder - b.routeOrder
      : compareText(a.fleet_name, b.fleet_name) || Number(a.route_order) - Number(b.route_order);
    return (result || fallback) * direction;
  });
}

function getSortValue(row, mode, key) {
  const candidate = mode === "general" ? row.candidate : null;
  const timer = candidate && candidate.timer;
  const endAt = mode === "general" ? timer.end_at : row.end_at;
  const etaAt = mode === "general" ? candidate.eta : row.eta_at;
  const marginMs = mode === "general"
    ? candidate.marginMs
    : new Date(row.end_at).getTime() - new Date(row.eta_at).getTime();
  if (key === "order") return mode === "general" ? row.routeOrder : Number(row.route_order);
  if (key === "fleet") return mode === "general" ? "" : row.fleet_name;
  if (key === "system") return mode === "general" ? timer.system : row.timer_system;
  if (key === "object_name") return mode === "general" ? timer.object_name : row.object_name;
  if (key === "structure") return mode === "general" ? timer.structure : row.structure;
  if (key === "corporation") return mode === "general" ? timer.title : row.corporation;
  if (key === "alliance") return mode === "general" ? timer.owner : row.alliance;
  if (key === "mode") return mode === "general" ? timer.mode : row.mode;
  if (key === "timer_kind") return mode === "general" ? timer.distance : row.timer_kind;
  if (key === "jumps") return Number(mode === "general" ? candidate.jumps : row.jump_count);
  if (key === "eta") return new Date(etaAt).getTime();
  if (key === "end_at" || key === "remaining") return new Date(endAt).getTime();
  if (key === "margin") return marginMs;
  if (key === "status") return marginMs >= 0 ? "Вовремя" : "Опоздание";
  if (key === "result") return normalizeStructureResult(mode === "general" ? timer.note : row.result);
  return "";
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
  }
  return compareText(a, b);
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "ru", { numeric: true, sensitivity: "base" });
}
