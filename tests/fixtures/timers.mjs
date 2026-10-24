export function futureIso(hours = 1, minutes = 0) {
  return new Date(Date.now() + (hours * 60 + minutes) * 60 * 1000).toISOString();
}

export function pastIso(hours = 1, minutes = 0) {
  return new Date(Date.now() - (hours * 60 + minutes) * 60 * 1000).toISOString();
}

export function makeTimer(overrides = {}) {
  const id = overrides.id || `timer-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    board_id: "main",
    raw_text: "",
    title: "Test Corp",
    system: "Jita",
    object_name: "Athanor",
    structure: `${id} I`,
    owner: "Test Alliance",
    distance: "Оборона",
    mode: "Reinforced",
    end_at: futureIso(6),
    note: "",
    completed_at: null,
    created_at: pastIso(24),
    updated_at: pastIso(0, 1),
    ...overrides
  };
}
