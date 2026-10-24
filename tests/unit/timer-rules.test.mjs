import assert from "node:assert/strict";
import test from "node:test";
import { getTimerState, isWithinCompletedWindow } from "../../js/core/timer-rules.js";

const now = Date.parse("2030-05-22T12:00:00Z");

test("marks future timers active and soon", () => {
  assert.equal(stateAt(5 * 60).status.label, "Активен");
  assert.equal(stateAt(4 * 60).status.label, "Скоро");
});

test("uses structure-specific post timer windows", () => {
  assert.equal(stateAfter("Athanor", 10).phase, "repair");
  assert.equal(stateAfter("Athanor", 16).isCompleted, true);
  assert.equal(stateAfter("Customs Office", 90).phase, "repair");
  assert.equal(stateAfter("Customs Office", 121).isCompleted, true);
  for (const structure of ["Metenox Moon Drill", "IHub", "TCU", "POS"]) {
    assert.equal(stateAfter(structure, 20).phase, "pending-result");
    assert.equal(stateAfter(structure, 31).isCompleted, true);
  }
});

test("explicit result completes a timer immediately", () => {
  const state = getTimerState({
    object_name: "Customs Office",
    end_at: new Date(now + 60 * 60 * 1000).toISOString(),
    updated_at: new Date(now - 60 * 1000).toISOString(),
    note: "Защищена"
  }, now);
  assert.equal(state.isCompleted, true);
  assert.equal(state.status.label, "Завершён");
});

test("filters completed timers by 12 and 24 hour windows", () => {
  const hour = 60 * 60 * 1000;
  assert.equal(isWithinCompletedWindow(11.9 * hour, 12 * hour), true);
  assert.equal(isWithinCompletedWindow(12.1 * hour, 12 * hour), false);
  assert.equal(isWithinCompletedWindow(23.9 * hour, 24 * hour), true);
  assert.equal(isWithinCompletedWindow(24.1 * hour, 24 * hour), false);
});

function stateAt(minutesUntilEnd) {
  return getTimerState({
    object_name: "Athanor",
    end_at: new Date(now + minutesUntilEnd * 60 * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
    note: ""
  }, now);
}

function stateAfter(objectName, minutesAfterEnd) {
  return getTimerState({
    object_name: objectName,
    end_at: new Date(now - minutesAfterEnd * 60 * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
    note: ""
  }, now);
}
