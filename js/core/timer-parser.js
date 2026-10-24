import {
  cleanText,
  normalizeStructureType,
  normalizeTimerKind
} from "../shared/format.js";

export function parseTimerInput(input, defaults = {}) {
  return splitTimerBlocks(input).map((block) => applyTimerDefaults(parseTimerBlock(block), defaults));
}

export function applyTimerDefaults(timer, defaults = {}) {
  return {
    ...timer,
    title: cleanText(defaults.title) || cleanText(timer.title),
    system: cleanText(defaults.system) || cleanText(timer.system),
    object_name: normalizeStructureType(defaults.object_name) || normalizeStructureType(timer.object_name),
    structure: cleanText(defaults.structure) || cleanText(timer.structure),
    owner: cleanText(defaults.owner) || cleanText(timer.owner),
    distance: normalizeTimerKind(defaults.distance) || normalizeTimerKind(timer.distance),
    mode: cleanText(defaults.mode) || cleanText(timer.mode)
  };
}

export function splitTimerBlocks(input) {
  const normalized = normalizeBreaks(input);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks = [];
  let current = [];

  for (const line of lines) {
    current.push(line);
    if (hasTimerDate(line)) {
      blocks.push(current.join("\n"));
      current = [];
    }
  }

  if (current.length && hasTimerDate(current.join("\n"))) blocks.push(current.join("\n"));
  return blocks.filter(hasTimerDate);
}

export function parseTimerBlock(block) {
  const lines = normalizeBreaks(block).split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines.find((line) => !hasTimerDate(line) && !isDistanceLine(line));
  if (!firstLine) throw new Error("Не нашёл строку с названием таймера.");

  const arrow = firstLine.match(/^(.*?)\s*>\s*(.*)$/);
  const title = arrow && !hasChatTimestamp(arrow[1]) ? cleanText(arrow[1]) : "";
  let right = cleanText(arrow ? arrow[2] : firstLine);

  const ownerMatch = right.match(/\[([^\]]+)\]\s*$/);
  const owner = ownerMatch ? cleanText(ownerMatch[1]) : "";
  if (ownerMatch) right = cleanText(right.replace(/\[([^\]]+)\]\s*$/, ""));

  let system = "";
  let object_name = "";
  let structure = "";
  const withObject = right.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (withObject) {
    const typeGuess = cleanText(withObject[1]);
    const location = cleanText(withObject[2]);
    object_name = normalizeStructureType(typeGuess);
    structure = object_name ? location : typeGuess;
    system = cleanText(location.replace(/\s+[IVXLCDM]+$/i, ""));
  } else {
    const withDash = right.match(/^(.+?)\s+-\s+(.+)$/);
    if (withDash) {
      system = cleanText(withDash[1]);
      structure = cleanText(withDash[2]);
    } else {
      structure = cleanText(right);
    }
  }

  const dateMatch = getTimerDateMatch(block);
  if (!dateMatch) throw new Error(`Не нашёл дату в формате 2026.05.25 14:42:47: ${firstLine}`);
  const [, year, month, day, hour, minute, second = "0"] = dateMatch;
  const endDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  if (Number.isNaN(endDate.getTime())) throw new Error(`Некорректная дата: ${dateMatch[0]}`);

  const modeLine = lines.find(hasTimerDate) || "";
  const mode = cleanText(modeLine.replace(/\s+(?:до|until)\s+\d{4}[.-]\d{1,2}[.-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?.*$/i, ""));
  return {
    raw_text: block,
    title,
    system,
    object_name,
    structure,
    owner,
    distance: "",
    mode,
    end_at: endDate.toISOString(),
    note: ""
  };
}

export function hasTimerDate(value) {
  return Boolean(getTimerDateMatch(value));
}

export function getTimerDateMatch(value) {
  return String(value || "").match(/(?:до|until)\s+(\d{4})[.-](\d{1,2})[.-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
}

export function normalizeBreaks(value) {
  return String(value || "")
    .replace(/&lt;br\s*\/?&gt;/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\])\s*(?=\d[\d \t]*(?:[,.]\d+)?[ \t]*(?:км|km|м|m|а\.?[ \t]*е\.?|au|a\.u\.))/gi, "$1\n")
    .replace(/(\d[\d \t]*(?:[,.]\d+)?[ \t]*(?:км|km|м|m)|\d+(?:[,.]\d+)?[ \t]*(?:а\.?[ \t]*е\.?|au|a\.u\.))\s*(?=(?:Укреп|В оборонном|Reinforced))/gi, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isDistanceLine(value) {
  return /^(\d+(?:[,.]\d+)?[ \t]*(?:а\.?[ \t]*е\.?|au|a\.u\.)|\d[\d \t]*(?:[,.]\d+)?[ \t]*(?:км|km|м|m))$/i.test(value);
}

function hasChatTimestamp(value) {
  return /^\s*\[\d{2}:\d{2}:\d{2}\]/.test(String(value || ""));
}
