import assert from "node:assert/strict";
import test from "node:test";
import { parseTimerInput } from "../../js/core/timer-parser.js";

test("parses README timer formats", () => {
  const input = [
    "III Hokage > Customs Office* (Yehaba II*) [The Weak And The Scrawny]<br>1,7 а.е.<br>Укрепленный режим до 2030.05.23 10:37:54",
    "[12:44:39] Tygarin Kvazovsky > Hakatiz - 7-6<br>8,4 AU<br>Reinforced until 2030.05.22 13:08:10",
    "Hakatiz - 7-6\n9 149 м\nВ оборонном режиме до 2030.05.22 14:08:10"
  ].join("\n");
  const timers = parseTimerInput(input);
  assert.equal(timers.length, 3);
  assert.deepEqual(
    pick(timers[0]),
    { title: "III Hokage", system: "Yehaba", object_name: "Customs Office", structure: "Yehaba II", owner: "The Weak And The Scrawny" }
  );
  assert.deepEqual(pick(timers[1]), { title: "", system: "Hakatiz", object_name: "", structure: "7-6", owner: "" });
  assert.equal(timers[2].mode, "В оборонном режиме");
});

test("parses compact Customs Office line", () => {
  const [timer] = parseTimerInput("Luciela Spartacus > Customs Office* (Balas I*) [The Weak And The Scrawny]560 560 кмУкрепленный режим до 2030.05.23 10:56:56");
  assert.deepEqual(
    pick(timer),
    { title: "Luciela Spartacus", system: "Balas", object_name: "Customs Office", structure: "Balas I", owner: "The Weak And The Scrawny" }
  );
});

test("defaults override every parsed field", () => {
  const [timer] = parseTimerInput(
    "Hakatiz - 7-6\nВ оборонном режиме до 2030.05.22 13:08:10",
    { title: "Corp", system: "Amarr", object_name: "Athanor", structure: "Amarr VIII", owner: "Alliance", distance: "Оборона", mode: "Armor" }
  );
  assert.deepEqual(
    pick(timer),
    { title: "Corp", system: "Amarr", object_name: "Athanor", structure: "Amarr VIII", owner: "Alliance" }
  );
  assert.equal(timer.distance, "Оборона");
  assert.equal(timer.mode, "Armor");
});

test("rejects impossible UTC dates instead of normalizing them", () => {
  assert.throws(
    () => parseTimerInput("Hakatiz - 7-6\nReinforced until 2026.02.31 25:00:00"),
    /Некорректная дата:.*2026\.02\.31 25:00:00/
  );
  assert.throws(
    () => parseTimerInput("Hakatiz - 7-6\nReinforced until 2026.04.31 12:00:00"),
    /Некорректная дата/
  );
});

test("accepts leap day only in a leap year", () => {
  assert.equal(parseTimerInput("Hakatiz - 7-6\nReinforced until 2028.02.29 23:59:59")[0].end_at, "2028-02-29T23:59:59.000Z");
  assert.throws(
    () => parseTimerInput("Hakatiz - 7-6\nReinforced until 2027.02.29 23:59:59"),
    /Некорректная дата/
  );
});

function pick(timer) {
  return {
    title: timer.title,
    system: timer.system,
    object_name: timer.object_name,
    structure: timer.structure,
    owner: timer.owner
  };
}
