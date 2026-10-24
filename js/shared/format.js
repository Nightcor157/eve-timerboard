import { STRUCTURE_TYPES } from "../core/constants.js";

export function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\*+$/g, "")
    .trim();
}

export function normalizeStructureType(value) {
  const text = cleanText(value);
  return STRUCTURE_TYPES.find((option) => option.toLowerCase() === text.toLowerCase()) || "";
}

export function normalizeTimerKind(value) {
  const text = cleanText(value);
  if (/^атака$/i.test(text)) return "Атака";
  if (/^оборона$/i.test(text)) return "Оборона";
  return "";
}

export function normalizeStructureResult(value) {
  const text = cleanText(value);
  if (/^защищена$/i.test(text)) return "Защищена";
  if (/^уничтожена$/i.test(text)) return "Уничтожена";
  return "";
}

export function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "ru", { numeric: true, sensitivity: "base" });
}

export function formatRemaining(ms) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days} д ${clock}` : clock;
}

export function formatUtc(value) {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "—";
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join(".") + " " + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join(":");
}

export function parseUtcInput(value) {
  const match = String(value || "").trim().match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return "";
  const [, year, month, day, hour, minute, second = "0"] = match;
  return utcPartsToIso(year, month, day, hour, minute, second);
}

export function utcPartsToIso(year, month, day, hour, minute, second = 0) {
  const parts = [year, month, day, hour, minute, second].map(Number);
  if (!parts.every(Number.isInteger)) return "";
  const [y, m, d, h, min, sec] = parts;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31 || h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) {
    return "";
  }
  const date = new Date(Date.UTC(y, m - 1, d, h, min, sec));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d ||
      date.getUTCHours() !== h || date.getUTCMinutes() !== min || date.getUTCSeconds() !== sec) {
    return "";
  }
  return date.toISOString();
}

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
