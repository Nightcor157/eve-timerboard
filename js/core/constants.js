export const STRUCTURE_TYPES = Object.freeze([
  "Astrahus",
  "Fortizar",
  "Keepstar",
  "Raitaru",
  "Azbel",
  "Sotiyo",
  "Athanor",
  "Tatara",
  "Metenox Moon Drill",
  "Customs Office",
  "IHub",
  "TCU",
  "POS"
]);

export const STRUCTURE_TYPE_OPTIONS = Object.freeze([
  ["", "—"],
  ...STRUCTURE_TYPES.map((value) => [value, value])
]);

export const TIMER_KINDS = Object.freeze(["Атака", "Оборона"]);
export const TIMER_KIND_OPTIONS = Object.freeze([
  ["", "—"],
  ...TIMER_KINDS.map((value) => [value, value])
]);

export const STRUCTURE_RESULTS = Object.freeze(["Защищена", "Уничтожена"]);
export const STRUCTURE_RESULT_OPTIONS = Object.freeze([
  ["", "—"],
  ...STRUCTURE_RESULTS.map((value) => [value, value])
]);

export const DEFAULT_POST_TIMER_STATE = Object.freeze({
  durationMs: 15 * 60 * 1000,
  label: "Ремонт",
  className: "is-repair"
});

export const POST_TIMER_STATES = new Map([
  ["Customs Office", Object.freeze({ durationMs: 2 * 60 * 60 * 1000, label: "Ремонт", className: "is-repair" })],
  ["Metenox Moon Drill", Object.freeze({ durationMs: 30 * 60 * 1000, label: "Ожидание итога", className: "is-pending-result" })],
  ["IHub", Object.freeze({ durationMs: 30 * 60 * 1000, label: "Идёт событие", className: "is-pending-result" })],
  ["TCU", Object.freeze({ durationMs: 30 * 60 * 1000, label: "Идёт событие", className: "is-pending-result" })],
  ["POS", Object.freeze({ durationMs: 30 * 60 * 1000, label: "Ожидание итога", className: "is-pending-result" })]
]);
