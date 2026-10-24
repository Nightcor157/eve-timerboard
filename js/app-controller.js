const listeners = new Map();

export const appController = Object.freeze({
  on(type, listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
    return () => listeners.get(type)?.delete(listener);
  },

  emit(type, detail = null) {
    const event = Object.freeze({ type, detail });
    for (const listener of listeners.get(type) || []) listener(event);
  }
});

export const APP_EVENTS = Object.freeze({
  ADMIN_VIEW_CHANGED: "admin-view-changed",
  VIEW_ACCESS_CHANGED: "view-access-changed",
  REQUEST_VIEW_ACCESS: "request-view-access",
  FLEET_BOARD_ACCESS: "fleet-board-access",
  ROUTE_RESULT_UPDATED: "route-result-updated",
  BOARD_RESULT_UPDATED: "board-result-updated"
});
