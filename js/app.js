import {
  STRUCTURE_RESULT_OPTIONS,
  STRUCTURE_TYPE_OPTIONS,
  TIMER_KIND_OPTIONS
} from "./core/constants.js";
import { parseTimerInput } from "./core/timer-parser.js";
import { getTimerState, isWithinCompletedWindow } from "./core/timer-rules.js";
import { getTimerboardApi, hasSupabaseConfig as isSupabaseConfigured } from "./services/supabase-api.js";
import {
  cleanText,
  escapeHtml,
  formatUtc,
  normalizeStructureResult,
  normalizeStructureType,
  normalizeTimerKind,
  parseUtcInput
} from "./shared/format.js";
import { APP_EVENTS, appController } from "./app-controller.js";
import { sortBoardTimers } from "./ui/board-view.js";

(function () {
  "use strict";

  const CONFIG = window.EVE_TIMERBOARD_CONFIG || {};
  const BOARD_ID = CONFIG.boardId || "main";
  const POLL_MS = Number(CONFIG.pollEveryMs || 15000);
  const ADMIN_REQUESTED = new URLSearchParams(window.location.search).has("admin");
  const LOCAL_KEY = `eve_timerboard_${BOARD_ID}`;
  const ADMIN_KEY_STORAGE = `eve_timerboard_admin_key_${BOARD_ID}`;
  const VIEW_KEY_STORAGE = `eve_timerboard_view_key_${BOARD_ID}`;
  const hasSupabaseConfig = isSupabaseConfigured(CONFIG);
  const db = getTimerboardApi(CONFIG);

  let timers = [];
  let lastRenderedSignature = "";
  let fleetBoardAccess = null;
  let showEndedBeforeAdmin = false;
  let adminViewEnabled = false;
  let adminKeyValidated = false;
  let viewAccessGranted = false;
  let boardSort = { key: "end_at", direction: "asc" };
  let loadGeneration = 0;
  let timersDataSignature = "";

  const els = {
    configWarning: document.getElementById("configWarning"),
    viewKeyPanel: document.getElementById("viewKeyPanel"),
    viewKey: document.getElementById("viewKey"),
    rememberViewKey: document.getElementById("rememberViewKey"),
    unlockViewBtn: document.getElementById("unlockViewBtn"),
    viewStatus: document.getElementById("viewStatus"),
    boardPanel: document.getElementById("boardPanel"),
    adminPanel: document.getElementById("adminPanel"),
    adminKey: document.getElementById("adminKey"),
    rememberKey: document.getElementById("rememberKey"),
    newViewKey: document.getElementById("newViewKey"),
    saveViewKeyBtn: document.getElementById("saveViewKeyBtn"),
    timerInput: document.getElementById("timerInput"),
    defaultSystem: document.getElementById("defaultSystem"),
    defaultObjectName: document.getElementById("defaultObjectName"),
    defaultStructure: document.getElementById("defaultStructure"),
    defaultTitle: document.getElementById("defaultTitle"),
    defaultOwner: document.getElementById("defaultOwner"),
    defaultMode: document.getElementById("defaultMode"),
    defaultTimerKind: document.getElementById("defaultTimerKind"),
    clearDefaultsBtn: document.getElementById("clearDefaultsBtn"),
    addBtn: document.getElementById("addBtn"),
    previewBtn: document.getElementById("previewBtn"),
    clearInputBtn: document.getElementById("clearInputBtn"),
    parsePreview: document.getElementById("parsePreview"),
    adminStatus: document.getElementById("adminStatus"),
    timersTable: document.getElementById("timersTable"),
    timersBody: document.getElementById("timersBody"),
    timerRowTemplate: document.getElementById("timerRowTemplate"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    showEnded: document.getElementById("showEnded"),
    endedWindow: document.getElementById("endedWindow"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    exportCsvBtn: document.getElementById("exportCsvBtn"),
    statActive: document.getElementById("statActive"),
    statSoon: document.getElementById("statSoon"),
    statEnded: document.getElementById("statEnded"),
    viewModeBtn: document.getElementById("viewModeBtn"),
    adminAccessDialog: document.getElementById("adminAccessDialog"),
    adminAccessForm: document.getElementById("adminAccessForm"),
    adminViewKey: document.getElementById("adminViewKey"),
    rememberAdminViewKey: document.getElementById("rememberAdminViewKey"),
    adminAccessStatus: document.getElementById("adminAccessStatus"),
    confirmAdminAccessBtn: document.getElementById("confirmAdminAccessBtn"),
    closeAdminAccessBtn: document.getElementById("closeAdminAccessBtn"),
    cancelAdminAccessBtn: document.getElementById("cancelAdminAccessBtn")
  };

  init();

  function init() {
    populateSelect(els.defaultObjectName, STRUCTURE_TYPE_OPTIONS);
    populateSelect(els.defaultTimerKind, TIMER_KIND_OPTIONS);
    if (!hasSupabaseConfig) {
      els.configWarning.hidden = false;
    }

    localStorage.removeItem(ADMIN_KEY_STORAGE);
    const savedKey = sessionStorage.getItem(ADMIN_KEY_STORAGE);
    if (savedKey) {
      els.adminKey.value = savedKey;
      els.rememberKey.checked = true;
      els.adminViewKey.value = savedKey;
      els.rememberAdminViewKey.checked = true;
    }

    const savedViewKey = localStorage.getItem(VIEW_KEY_STORAGE);
    if (savedViewKey) {
      els.viewKey.value = savedViewKey;
      els.rememberViewKey.checked = true;
    }

    els.addBtn.addEventListener("click", addTimersFromInput);
    els.previewBtn.addEventListener("click", showPreview);
    els.clearDefaultsBtn.addEventListener("click", clearTimerDefaults);
    els.clearInputBtn.addEventListener("click", () => {
      els.timerInput.value = "";
      els.parsePreview.hidden = true;
      els.adminStatus.textContent = "";
    });
    els.refreshBtn.addEventListener("click", loadTimers);
    els.unlockViewBtn.addEventListener("click", unlockView);
    els.saveViewKeyBtn.addEventListener("click", saveViewKey);
    els.searchInput.addEventListener("input", renderTimers);
    els.sortSelect.addEventListener("change", handleSortSelectChange);
    els.timersTable.querySelector("thead").addEventListener("click", handleBoardHeaderSort);
    els.showEnded.addEventListener("change", renderTimers);
    els.endedWindow.addEventListener("change", renderTimers);
    els.clearHistoryBtn.addEventListener("click", clearTimerHistory);
    els.exportCsvBtn.addEventListener("click", exportCsv);
    els.viewModeBtn.addEventListener("click", toggleAdminView);
    els.adminAccessForm.addEventListener("submit", submitAdminAccess);
    els.closeAdminAccessBtn.addEventListener("click", closeAdminAccessDialog);
    els.cancelAdminAccessBtn.addEventListener("click", closeAdminAccessDialog);
    els.adminAccessDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeAdminAccessDialog();
    });
    els.rememberKey.addEventListener("change", () => {
      if (!els.rememberKey.checked) sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      if (els.rememberKey.checked && els.adminKey.value.trim()) {
        sessionStorage.setItem(ADMIN_KEY_STORAGE, els.adminKey.value.trim());
      }
    });
    els.adminKey.addEventListener("change", () => {
      adminKeyValidated = false;
      els.adminViewKey.value = els.adminKey.value.trim();
      if (els.rememberKey.checked) {
        sessionStorage.setItem(ADMIN_KEY_STORAGE, els.adminKey.value.trim());
      }
      loadTimers();
    });
    els.adminKey.addEventListener("input", () => {
      adminKeyValidated = false;
      invalidateTimerLoads();
    });
    els.rememberViewKey.addEventListener("change", () => {
      if (!els.rememberViewKey.checked) localStorage.removeItem(VIEW_KEY_STORAGE);
      if (els.rememberViewKey.checked && els.viewKey.value.trim()) {
        localStorage.setItem(VIEW_KEY_STORAGE, els.viewKey.value.trim());
      }
    });
    els.viewKey.addEventListener("keydown", (event) => {
      if (event.key === "Enter") unlockView();
    });
    els.viewKey.addEventListener("input", invalidateTimerLoads);
    appController.on(APP_EVENTS.FLEET_BOARD_ACCESS, applyFleetBoardAccess);
    appController.on(APP_EVENTS.ROUTE_RESULT_UPDATED, applyRouteResultUpdate);
    appController.on(APP_EVENTS.REQUEST_VIEW_ACCESS, () => {
      if (adminViewEnabled) return;
      showViewGate("Введите ключ просмотра, чтобы открыть маршруты.", false);
      window.setTimeout(() => els.viewKey.focus(), 0);
    });

    applyAdminView(false, false);
    loadTimers();
    if (ADMIN_REQUESTED) requestAdminView();
    window.setInterval(tick, 1000);
    window.setInterval(loadTimers, POLL_MS);
  }

  function populateSelect(select, options) {
    select.textContent = "";
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
  }

  function toggleAdminView() {
    if (adminViewEnabled) {
      applyAdminView(false);
      loadTimers();
      return;
    }
    requestAdminView();
  }

  async function requestAdminView() {
    const knownKey = els.adminKey.value.trim() || els.adminViewKey.value.trim();
    if (knownKey && adminKeyValidated) {
      applyAdminView(true);
      await loadTimers();
      return;
    }
    if (knownKey && await validateAdminKey(knownKey, false)) {
      finishAdminAccess(knownKey);
      return;
    }
    openAdminAccessDialog(knownKey ? "Сохранённый админ-ключ не подошёл. Введите актуальный ключ." : "");
  }

  async function submitAdminAccess(event) {
    event.preventDefault();
    const adminKey = els.adminViewKey.value.trim();
    if (!adminKey) {
      setAdminAccessStatus("Введите админ-ключ.", true);
      return;
    }
    if (!await validateAdminKey(adminKey, true)) return;
    finishAdminAccess(adminKey);
  }

  async function validateAdminKey(adminKey, showError) {
    if (!db) {
      if (showError) setAdminAccessStatus("Для проверки ключа сначала подключите Supabase.", true);
      return false;
    }
    els.confirmAdminAccessBtn.disabled = true;
    if (showError) setAdminAccessStatus("Проверяю ключ...", false);
    try {
      const { error } = await db.listFleetsAdmin(BOARD_ID, adminKey);
      if (error) throw error;
      adminKeyValidated = true;
      return true;
    } catch (err) {
      adminKeyValidated = false;
      if (showError) setAdminAccessStatus(friendlyDbError(err), true);
      return false;
    } finally {
      els.confirmAdminAccessBtn.disabled = false;
    }
  }

  function finishAdminAccess(adminKey) {
    els.adminKey.value = adminKey;
    els.adminViewKey.value = adminKey;
    els.rememberKey.checked = els.rememberAdminViewKey.checked;
    if (els.rememberAdminViewKey.checked) {
      sessionStorage.setItem(ADMIN_KEY_STORAGE, adminKey);
    } else {
      sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    }
    closeAdminAccessDialog();
    applyAdminView(true);
    loadTimers();
  }

  function applyAdminView(enabled, updateHistory = true) {
    const wasAdminViewEnabled = adminViewEnabled;
    adminViewEnabled = Boolean(enabled);
    if (adminViewEnabled && !wasAdminViewEnabled) {
      showEndedBeforeAdmin = els.showEnded.checked;
      els.showEnded.checked = true;
    } else if (!adminViewEnabled && wasAdminViewEnabled) {
      els.showEnded.checked = showEndedBeforeAdmin;
    }
    document.body.classList.toggle("is-admin-view", adminViewEnabled);
    els.adminPanel.hidden = !adminViewEnabled;
    document.querySelectorAll("th.admin-only").forEach((element) => {
      element.hidden = !adminViewEnabled;
    });
    els.clearHistoryBtn.hidden = !adminViewEnabled;
    els.viewModeBtn.textContent = adminViewEnabled ? "Вид: админ" : "Вид: пользователь";
    els.viewModeBtn.classList.toggle("is-admin", adminViewEnabled);
    els.viewModeBtn.setAttribute("aria-pressed", String(adminViewEnabled));
    els.viewModeBtn.title = adminViewEnabled
      ? "Переключиться на пользовательский вид"
      : "Переключиться на админский вид";
    lastRenderedSignature = "";
    renderTimers();

    if (updateHistory) {
      const url = new URL(window.location.href);
      if (adminViewEnabled) url.searchParams.set("admin", "1");
      else url.searchParams.delete("admin");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    appController.emit(APP_EVENTS.ADMIN_VIEW_CHANGED, { enabled: adminViewEnabled });
  }

  function openAdminAccessDialog(message) {
    els.adminViewKey.value = els.adminKey.value.trim() || els.adminViewKey.value.trim();
    setAdminAccessStatus(message || "", Boolean(message));
    if (!els.adminAccessDialog.open) els.adminAccessDialog.showModal();
    window.setTimeout(() => els.adminViewKey.focus(), 0);
  }

  function closeAdminAccessDialog() {
    if (els.adminAccessDialog.open) els.adminAccessDialog.close();
    setAdminAccessStatus("", false);
  }

  function setAdminAccessStatus(message, isError) {
    els.adminAccessStatus.textContent = message || "";
    els.adminAccessStatus.className = `status-line ${isError ? "error" : message ? "ok" : ""}`;
  }

  async function loadTimers() {
    const requestGeneration = ++loadGeneration;
    const requestedKey = db ? getReadKey() : "";
    try {
      if (db) {
        if (!requestedKey) {
          setViewAccessGranted(false);
          timers = [];
          renderTimers();
          showViewGate("Введите ключ просмотра, чтобы открыть доску.", false);
          return;
        }

        const { data, error } = await db.getTimers(BOARD_ID, requestedKey);

        if (!isCurrentTimerLoad(requestGeneration, requestedKey)) return;
        if (error) throw error;
        setViewAccessGranted(true);
        hideViewGate();
        timers = (data || []).map(normalizeTimer);
      } else {
        setViewAccessGranted(true);
        timers = readLocalTimers().map(normalizeTimer);
      }
      renderTimers();
      publishTimersRefresh();
    } catch (err) {
      if (!isCurrentTimerLoad(requestGeneration, requestedKey)) return;
      const message = friendlyDbError(err);
      if (/ключ просмотра|get_timers|permission|28000|wrong/i.test(message)) {
        setViewAccessGranted(false);
        timers = [];
        renderTimers();
        showViewGate(message, true);
        return;
      }
      setStatus(`Ошибка загрузки: ${message}`, true);
    }
  }

  function invalidateTimerLoads() {
    loadGeneration += 1;
  }

  function isCurrentTimerLoad(requestGeneration, requestedKey) {
    return requestGeneration === loadGeneration && (!db || requestedKey === getReadKey());
  }

  function setViewAccessGranted(granted) {
    viewAccessGranted = Boolean(granted);
    document.body.classList.toggle("has-view-access", viewAccessGranted);
    appController.emit(APP_EVENTS.VIEW_ACCESS_CHANGED, { granted: viewAccessGranted });
  }

  function publishTimersRefresh() {
    const nextSignature = timers
      .map((timer) => `${timer.id}:${timer.updated_at}:${timer.completed_at || ""}`)
      .sort()
      .join("|");
    if (nextSignature === timersDataSignature) return;
    timersDataSignature = nextSignature;
    appController.emit(APP_EVENTS.TIMERS_REFRESHED, { signature: nextSignature });
  }

  function getReadKey() {
    const adminKey = els.adminKey.value.trim();
    if (adminViewEnabled && adminKey) return adminKey;
    return els.viewKey.value.trim();
  }

  async function unlockView() {
    const viewKey = els.viewKey.value.trim();
    if (!viewKey) {
      showViewGate("Введи ключ просмотра.", true);
      return;
    }
    if (els.rememberViewKey.checked) {
      localStorage.setItem(VIEW_KEY_STORAGE, viewKey);
    }
    await loadTimers();
  }

  function showViewGate(message, isError) {
    if (!db || adminViewEnabled && els.adminKey.value.trim()) return;
    els.viewKeyPanel.hidden = false;
    els.boardPanel.hidden = true;
    els.viewStatus.textContent = message || "";
    els.viewStatus.className = `status-line ${isError ? "error" : ""}`;
  }

  function hideViewGate() {
    els.viewKeyPanel.hidden = true;
    els.boardPanel.hidden = false;
    els.viewStatus.textContent = "";
    if (els.rememberViewKey.checked && els.viewKey.value.trim()) {
      localStorage.setItem(VIEW_KEY_STORAGE, els.viewKey.value.trim());
    }
  }

  async function saveViewKey() {
    if (!db) {
      setStatus("Ключ просмотра нужен только для Supabase-режима.", true);
      return;
    }

    const adminKey = els.adminKey.value.trim();
    const newViewKey = els.newViewKey.value.trim();
    if (!adminKey) {
      setStatus("Для смены ключа просмотра нужен админ-ключ.", true);
      return;
    }
    if (newViewKey.length < 12) {
      setStatus("Ключ просмотра должен быть минимум 12 символов.", true);
      return;
    }

    els.saveViewKeyBtn.disabled = true;
    try {
      const { error } = await db.setViewKey(BOARD_ID, adminKey, newViewKey);
      if (error) throw error;

      els.newViewKey.value = "";
      els.viewKey.value = newViewKey;
      if (els.rememberViewKey.checked) localStorage.setItem(VIEW_KEY_STORAGE, newViewKey);
      setStatus("Ключ просмотра обновлён.", false);
      await loadTimers();
    } catch (err) {
      setStatus(`Ошибка смены ключа просмотра: ${friendlyDbError(err)}`, true);
    } finally {
      els.saveViewKeyBtn.disabled = false;
    }
  }

  function normalizeTimer(row) {
    return {
      id: row.id || cryptoRandomId(),
      board_id: row.board_id || BOARD_ID,
      raw_text: row.raw_text || "",
      title: row.title || "",
      system: row.system || "",
      object_name: row.object_name || "",
      structure: row.structure || "",
      owner: row.owner || "",
      distance: row.distance || "",
      mode: row.mode || "",
      end_at: row.end_at,
      note: row.note || "",
      completed_at: row.completed_at || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || row.created_at || row.end_at
    };
  }

  async function addTimersFromInput() {
    const raw = els.timerInput.value.trim();
    if (!raw) {
      setStatus("Вставь строку из EVE.", true);
      return;
    }

    let parsed;
    try {
      parsed = parseInputWithDefaults(raw);
    } catch (err) {
      setStatus(err.message || String(err), true);
      return;
    }

    if (!parsed.length) {
      setStatus("Не нашёл ни одного таймера. Проверь формат строки.", true);
      return;
    }

    const adminKey = els.adminKey.value.trim();
    if (db && !adminKey) {
      setStatus("Для онлайн-добавления нужен админ-ключ.", true);
      return;
    }

    els.addBtn.disabled = true;
    try {
      let addedCount = parsed.length;
      if (db) {
        const payload = parsed.map((timer) => ({
          raw_text: timer.raw_text || "",
          title: timer.title || "",
          system: timer.system || "",
          object_name: normalizeStructureType(timer.object_name),
          structure: timer.structure || "",
          owner: timer.owner || "",
          distance: normalizeTimerKind(timer.distance),
          mode: timer.mode || "",
          end_at: timer.end_at,
          note: normalizeStructureResult(timer.note)
        }));
        const { data, error } = await db.addTimers(BOARD_ID, adminKey, payload);
        if (error) throw error;
        if (Array.isArray(data)) addedCount = data.length;
        else if (Number.isFinite(Number(data))) addedCount = Number(data);
      } else {
        const local = readLocalTimers();
        const createdAt = new Date().toISOString();
        parsed.forEach((timer) => local.push({
          ...timer,
          id: cryptoRandomId(),
          board_id: BOARD_ID,
          created_at: createdAt,
          updated_at: createdAt
        }));
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
      }

      if (els.rememberKey.checked && adminKey) {
        sessionStorage.setItem(ADMIN_KEY_STORAGE, adminKey);
      }

      els.timerInput.value = "";
      els.parsePreview.hidden = true;
      setStatus(`Добавлено таймеров: ${addedCount}.`, false);
      await loadTimers();
    } catch (err) {
      setStatus(`Ошибка добавления: ${friendlyDbError(err)}`, true);
    } finally {
      els.addBtn.disabled = false;
    }
  }

  async function deleteTimer(id) {
    if (!adminViewEnabled) return;
    const timer = timers.find((t) => t.id === id);
    const label = timer ? `${timer.system || "?"} / ${formatUtc(timer.end_at)}` : id;
    if (!window.confirm(`Удалить таймер ${label}?`)) return;

    try {
      if (db) {
        const adminKey = els.adminKey.value.trim();
        if (!adminKey) {
          setStatus("Для удаления нужен админ-ключ.", true);
          return;
        }
        const { error } = await db.deleteTimer(BOARD_ID, adminKey, id);
        if (error) throw error;
      } else {
        const local = readLocalTimers().filter((t) => t.id !== id);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
      }
      setStatus("Таймер удалён.", false);
      await loadTimers();
    } catch (err) {
      setStatus(`Ошибка удаления: ${friendlyDbError(err)}`, true);
    }
  }

  async function clearTimerHistory() {
    if (!adminViewEnabled) return;
    const now = Date.now();
    const completedCount = timers.filter((timer) => getTimerState(timer, now).isCompleted).length;
    if (!completedCount) {
      setStatus("История уже пуста: завершённых таймеров нет.", false);
      return;
    }
    if (!window.confirm(
      `Удалить всю историю завершённых таймеров (${completedCount})?\n\nАктивные таймеры и таймеры в фазе ремонта останутся.`
    )) return;

    els.clearHistoryBtn.disabled = true;
    try {
      let deletedCount = completedCount;
      if (db) {
        const adminKey = els.adminKey.value.trim();
        if (!adminKey) {
          setStatus("Для очистки истории нужен админ-ключ.", true);
          return;
        }
        const { data, error } = await db.clearTimerHistory(BOARD_ID, adminKey);
        if (error) throw error;
        const rpcCount = Number(data);
        if (Number.isFinite(rpcCount)) deletedCount = rpcCount;
      } else {
        const local = readLocalTimers();
        const active = local.filter((timer) => !getTimerState(normalizeTimer(timer), now).isCompleted);
        deletedCount = local.length - active.length;
        localStorage.setItem(LOCAL_KEY, JSON.stringify(active));
      }
      setStatus(`История очищена. Удалено таймеров: ${deletedCount}.`, false);
      await loadTimers();
    } catch (err) {
      setStatus(`Ошибка очистки истории: ${friendlyDbError(err)}`, true);
    } finally {
      els.clearHistoryBtn.disabled = false;
    }
  }

  function showPreview() {
    try {
      const parsed = parseInputWithDefaults(els.timerInput.value.trim());
      if (!parsed.length) {
        setStatus("Не нашёл таймеров для проверки.", true);
        return;
      }
      els.parsePreview.innerHTML = parsed.map((t) => `
        <div class="preview-card">
          <strong>${escapeHtml(t.system || "—")}</strong>
          <span>${escapeHtml(t.object_name || "тип не указан")} · ${escapeHtml(t.structure || "структура не указана")}</span>
          <small>${escapeHtml(t.title || "без корпорации")} · ${escapeHtml(t.owner || "без альянса")} · ${escapeHtml(t.mode || "режим не указан")} · ${escapeHtml(t.distance || "тип таймера не указан")} · ${escapeHtml(formatUtc(t.end_at))}</small>
        </div>
      `).join("");
      els.parsePreview.hidden = false;
      setStatus(`Распознано таймеров: ${parsed.length}.`, false);
    } catch (err) {
      els.parsePreview.hidden = true;
      setStatus(err.message || String(err), true);
    }
  }

  function parseInputWithDefaults(input) {
    return parseTimerInput(input, getTimerDefaults());
  }

  function getTimerDefaults() {
    return {
      title: cleanText(els.defaultTitle.value),
      system: cleanText(els.defaultSystem.value),
      object_name: normalizeStructureType(els.defaultObjectName.value),
      structure: cleanText(els.defaultStructure.value),
      owner: cleanText(els.defaultOwner.value),
      distance: normalizeTimerKind(els.defaultTimerKind.value),
      mode: cleanText(els.defaultMode.value)
    };
  }

  function clearTimerDefaults() {
    [
      els.defaultSystem,
      els.defaultObjectName,
      els.defaultStructure,
      els.defaultTitle,
      els.defaultOwner,
      els.defaultMode,
      els.defaultTimerKind
    ].forEach((control) => { control.value = ""; });
    els.parsePreview.hidden = true;
    setStatus("Параметры по умолчанию очищены.", false);
  }

  function renderTimers() {
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("table-control")) return;

    const now = Date.now();
    const search = els.searchInput.value.trim().toLowerCase();
    const showEnded = els.showEnded.checked;
    const endedWindowMs = getEndedWindowMs();

    const enriched = timers.map((timer) => ({ ...timer, ...getTimerState(timer, now) }));

    const activeCount = enriched.filter((timer) => !timer.isCompleted).length;
    const soonCount = enriched.filter((timer) => timer.isSoon).length;
    const endedCount = enriched.filter((timer) => timer.isCompleted).length;

    els.statActive.textContent = String(activeCount);
    els.statSoon.textContent = String(soonCount);
    els.statEnded.textContent = String(endedCount);

    const visible = sortBoardTimers(enriched
      .filter((timer) => !timer.isCompleted || showEnded && isWithinCompletedWindow(timer.completedAgeMs, endedWindowMs))
      .filter((timer) => !search || searchableText(timer).includes(search)), boardSort, now);

    updateBoardSortHeaders();

    const signature = JSON.stringify({
      rows: visible.map((t) => [
        t.id,
        t.system,
        t.object_name,
        t.structure,
        t.title,
        t.owner,
        t.mode,
        t.distance,
        t.end_at,
        t.note,
        t.status.label
      ]),
      search,
      sortKey: boardSort.key,
      sortDirection: boardSort.direction,
      showEnded,
      endedWindow: els.endedWindow.value,
      adminMode: adminViewEnabled,
      fleetBoardAccess: fleetBoardAccess
        ? [fleetBoardAccess.fleetId, ...fleetBoardAccess.timerIds].join(":")
        : ""
    });
    if (signature === lastRenderedSignature) return;
    lastRenderedSignature = signature;

    if (!visible.length) {
      els.timersBody.innerHTML = `<tr><td colspan="12" class="empty">Нет таймеров.</td></tr>`;
      return;
    }

    els.timersBody.innerHTML = "";
    for (const timer of visible) {
      const row = els.timerRowTemplate.content.firstElementChild.cloneNode(true);
      row.className = timer.status.className;
      row.dataset.timerId = timer.id;

      if (adminViewEnabled) {
        setEditableCell(row, "system", timer.system, (value) => saveTimerAdminFields(timer, { system: value }));
      } else {
        setCell(row, "system", timer.system || "—");
      }
      makeSystemCellCopyable(row);
      if (adminViewEnabled) {
        setSelectCell(row, "object_name", STRUCTURE_TYPE_OPTIONS, normalizeStructureType(timer.object_name), (value) => saveTimerAdminFields(timer, { object_name: value }));
      } else {
        setCell(row, "object_name", normalizeStructureType(timer.object_name) || "—");
      }
      if (adminViewEnabled) {
        setEditableCell(row, "structure", timer.structure, (value) => saveTimerAdminFields(timer, { structure: value }));
        setEditableCell(row, "title", timer.title, (value) => saveTimerAdminFields(timer, { title: value }));
        setEditableCell(row, "owner", timer.owner, (value) => saveTimerAdminFields(timer, { owner: value }));
        setEditableCell(row, "mode", timer.mode, (value) => saveTimerAdminFields(timer, { mode: value }));
      } else {
        setCell(row, "structure", timer.structure || "—");
        setCell(row, "title", timer.title || "—");
        setCell(row, "owner", timer.owner || "—");
        setCell(row, "mode", timer.mode || "—");
      }
      if (adminViewEnabled) {
        setSelectCell(row, "timer_kind", TIMER_KIND_OPTIONS, normalizeTimerKind(timer.distance), (value) => saveTimerAdminFields(timer, { distance: value }));
      } else {
        setTimerKindCell(row, "timer_kind", normalizeTimerKind(timer.distance));
      }
      if (adminViewEnabled) {
        setEditableCell(row, "end_at", formatUtc(timer.end_at), (value) => saveTimerAdminFields(timer, { end_at: value }), "2026.05.22 13:08:10");
      } else {
        setCell(row, "end_at", formatUtc(timer.end_at));
      }
      setCell(row, "remaining", timer.remainingText);
      setCell(row, "status", timer.status.label);
      if (adminViewEnabled) {
        setResultButtons(row, "result", normalizeStructureResult(timer.note), (value) => saveTimerAdminFields(timer, { note: value }));
      } else if (canFleetEditResult(timer.id)) {
        setResultButtons(row, "result", normalizeStructureResult(timer.note), (value) => saveFleetBoardResult(timer, value));
      } else {
        setStructureResultCell(row, "result", normalizeStructureResult(timer.note));
      }

      const actionsCell = row.querySelector('[data-field="actions"]');
      if (adminViewEnabled) {
        actionsCell.hidden = false;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "danger-btn";
        btn.textContent = "Удалить";
        btn.addEventListener("click", () => deleteTimer(timer.id));
        actionsCell.appendChild(btn);
      }

      els.timersBody.appendChild(row);
    }
  }

  function applyFleetBoardAccess(event) {
    const detail = event && event.detail;
    fleetBoardAccess = detail && detail.fleetId && detail.fleetKey
      ? {
          fleetId: String(detail.fleetId),
          fleetKey: String(detail.fleetKey),
          timerIds: new Set((detail.timerIds || []).map(String))
        }
      : null;
    lastRenderedSignature = "";
    renderTimers();
  }

  function applyRouteResultUpdate(event) {
    const detail = event && event.detail;
    if (!detail || !detail.timerId) return;
    const result = normalizeStructureResult(detail.result);
    timers = timers.map((timer) => String(timer.id) === String(detail.timerId) ? {
      ...timer,
      note: result,
      completed_at: detail.completedAt || (result ? new Date().toISOString() : null),
      updated_at: detail.updatedAt || new Date().toISOString()
    } : timer);
    if (result) els.showEnded.checked = true;
    lastRenderedSignature = "";
    renderTimers();
    void loadTimers();
  }

  function canFleetEditResult(timerId) {
    return !adminViewEnabled &&
      fleetBoardAccess &&
      fleetBoardAccess.timerIds.has(String(timerId));
  }

  async function saveFleetBoardResult(timer, value) {
    if (!db || !canFleetEditResult(timer.id)) return;
    try {
      const { data, error } = await db.setFleetTimerResult(
        BOARD_ID,
        getReadKey(),
        fleetBoardAccess.fleetKey,
        fleetBoardAccess.fleetId,
        timer.id,
        normalizeStructureResult(value),
        timer.updated_at
      );
      if (error) throw error;
      if (!data) throw new Error("set_fleet_timer_result returned no timer");
      const serverTimer = normalizeTimer(data);
      timers = timers.map((item) => item.id === timer.id ? serverTimer : item);
      lastRenderedSignature = "";
      renderTimers();
      appController.emit(APP_EVENTS.BOARD_RESULT_UPDATED);
    } catch (err) {
      if (isTimerUpdateConflict(err)) {
        setStatus("Итог уже изменён в другом окне. Доска обновлена, повторите действие при необходимости.", true);
        await loadTimers();
        return;
      }
      setStatus(`Ошибка результата: ${friendlyDbError(err)}`, true);
      lastRenderedSignature = "";
      renderTimers();
    }
  }

  function setCell(row, field, value) {
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (cell) cell.textContent = value;
  }

  function makeSystemCellCopyable(row) {
    const cell = row.querySelector('[data-field="system"]');
    if (!cell) return;

    const input = cell.querySelector("input");
    const copySystem = async () => {
      const system = cleanText(input ? input.value : cell.textContent);
      if (!system || system === "—") return;

      const copied = await copyTextToClipboard(system);
      cell.classList.remove("is-copied", "is-copy-failed");
      cell.classList.add(copied ? "is-copied" : "is-copy-failed");
      window.setTimeout(() => {
        cell.classList.remove("is-copied", "is-copy-failed");
      }, 900);
    };

    cell.classList.add("copyable-system");
    cell.title = "Нажмите, чтобы скопировать название системы";
    cell.addEventListener("click", copySystem);

    if (!input) {
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `Скопировать систему ${cleanText(cell.textContent)}`);
      cell.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        copySystem();
      });
    }
  }

  async function copyTextToClipboard(value) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_error) {
        // Use the fallback below when clipboard permission is unavailable.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  function setTimerKindCell(row, field, value) {
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (!cell) return;

    const kind = normalizeTimerKind(value);
    cell.textContent = "";
    if (!kind) {
      cell.textContent = "—";
      return;
    }

    const badge = document.createElement("span");
    badge.className = `timer-kind-badge ${timerKindClass(kind)}`;
    badge.textContent = kind;
    cell.appendChild(badge);
  }

  function setStructureResultCell(row, field, value) {
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (!cell) return;

    const result = normalizeStructureResult(value);
    cell.textContent = "";
    if (!result) {
      cell.textContent = "—";
      return;
    }

    const badge = document.createElement("span");
    badge.className = `result-badge ${structureResultClass(result)}`;
    badge.textContent = result;
    cell.appendChild(badge);
  }

  function setResultButtons(row, field, value, onSave) {
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (!cell) return;

    const current = normalizeStructureResult(value);
    const group = document.createElement("div");
    group.className = "result-actions";

    for (const [resultValue, label] of STRUCTURE_RESULT_OPTIONS.filter(([optionValue]) => optionValue)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `result-action-btn ${structureResultClass(resultValue)} ${current === resultValue ? "is-selected-result" : ""}`;
      btn.textContent = label;
      btn.addEventListener("click", async () => {
        const nextValue = current === resultValue ? "" : resultValue;
        group.querySelectorAll("button").forEach((button) => { button.disabled = true; });
        await onSave(nextValue);
      });
      group.appendChild(btn);
    }

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "result-action-btn result-reset-btn";
    resetBtn.textContent = "Сброс";
    resetBtn.disabled = !current;
    resetBtn.addEventListener("click", async () => {
      group.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      await onSave("");
    });
    group.appendChild(resetBtn);

    cell.textContent = "";
    cell.appendChild(group);
  }

  function setEditableCell(row, field, value, onSave, placeholder = "") {
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (!cell) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "table-control table-input";
    input.value = value || "";
    input.placeholder = placeholder;

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") {
        input.value = value || "";
        input.blur();
      }
    });

    input.addEventListener("blur", async () => {
      const nextValue = input.value.trim();
      const previousValue = String(value || "").trim();
      if (nextValue === previousValue) return;

      input.disabled = true;
      await onSave(nextValue);
      input.disabled = false;
    });

    cell.textContent = "";
    cell.appendChild(input);
  }

  function setSelectCell(row, field, options, value, onChange) {
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (!cell) return;

    const select = document.createElement("select");
    select.className = `table-control table-select ${timerKindClass(value)} ${structureResultClass(value)}`;
    for (const [optionValue, label] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = options.some(([optionValue]) => optionValue === value) ? value : "";
    select.addEventListener("change", async () => {
      select.classList.remove("is-attack-kind", "is-defense-kind");
      select.classList.remove("is-defended-result", "is-destroyed-result");
      const nextClass = timerKindClass(select.value);
      if (nextClass) select.classList.add(nextClass);
      const nextResultClass = structureResultClass(select.value);
      if (nextResultClass) select.classList.add(nextResultClass);
      select.disabled = true;
      await onChange(select.value);
      select.disabled = false;
    });
    cell.textContent = "";
    cell.appendChild(select);
  }

  async function saveTimerAdminFields(timer, changes) {
    if (!adminViewEnabled) return;
    const patch = {};
    for (const [field, value] of Object.entries(changes)) {
      if (["title", "system", "structure", "owner", "mode"].includes(field)) patch[field] = cleanText(value);
      else if (field === "object_name") patch[field] = normalizeStructureType(value);
      else if (field === "distance") patch[field] = normalizeTimerKind(value);
      else if (field === "note") patch[field] = normalizeStructureResult(value);
      else if (field === "end_at") {
        const parsedEndAt = parseUtcInput(value);
        if (!parsedEndAt) {
          setStatus("Дата должна быть в формате 2026.05.22 13:08:10.", true);
          await loadTimers();
          return;
        }
        patch[field] = parsedEndAt;
      }
    }
    if (!Object.keys(patch).length) return;

    try {
      if (db) {
        const adminKey = els.adminKey.value.trim();
        if (!adminKey) {
          setStatus("Для изменения таймера нужен админ-ключ.", true);
          await loadTimers();
          return;
        }

        const { data, error } = await db.patchTimer(
          BOARD_ID,
          adminKey,
          timer.id,
          patch,
          timer.updated_at
        );
        if (error) throw error;
        if (!data) throw new Error("patch_timer_admin_fields returned no timer");
        const serverTimer = normalizeTimer(data);
        timers = timers.map((item) => item.id === timer.id ? serverTimer : item);
      } else {
        let localTimer = null;
        const local = readLocalTimers().map((item) => item.id === timer.id ? (localTimer = {
          ...item,
          ...patch,
          completed_at: Object.hasOwn(patch, "note")
            ? normalizeStructureResult(patch.note) ? new Date().toISOString() : null
            : item.completed_at || null,
          updated_at: new Date().toISOString()
        }) : item);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
        if (localTimer) timers = timers.map((item) => item.id === timer.id ? normalizeTimer(localTimer) : item);
      }

      setStatus("Таймер обновлён.", false);
      lastRenderedSignature = "";
      renderTimers();
    } catch (err) {
      if (isTimerUpdateConflict(err)) {
        setStatus("Таймер уже был изменён. Данные обновлены, повторите правку при необходимости.", true);
        await loadTimers();
        return;
      }
      setStatus(`Ошибка обновления: ${friendlyDbError(err)}`, true);
      await loadTimers();
    }
  }

  function isTimerUpdateConflict(err) {
    const message = err && (err.message || err.details) ? `${err.message || ""} ${err.details || ""}` : String(err || "");
    return err?.code === "40001" || /timer update conflict/i.test(message);
  }

  function timerKindClass(value) {
    const kind = normalizeTimerKind(value);
    if (kind === "Атака") return "is-attack-kind";
    if (kind === "Оборона") return "is-defense-kind";
    return "";
  }

  function structureResultClass(value) {
    const result = normalizeStructureResult(value);
    if (result === "Защищена") return "is-defended-result";
    if (result === "Уничтожена") return "is-destroyed-result";
    return "";
  }

  function getEndedWindowMs() {
    if (!els.endedWindow || els.endedWindow.value === "all") return Infinity;
    const hours = Number(els.endedWindow.value || 24);
    return Number.isFinite(hours) && hours > 0 ? hours * 3600 * 1000 : 24 * 3600 * 1000;
  }

  function handleSortSelectChange() {
    const sortKeys = { time: "end_at", title: "title", system: "system" };
    if (sortKeys[els.sortSelect.value]) {
      boardSort = { key: sortKeys[els.sortSelect.value], direction: "asc" };
    }
    lastRenderedSignature = "";
    renderTimers();
  }

  function handleBoardHeaderSort(event) {
    const header = event.target.closest("th[data-sort-key]");
    if (!header) return;
    const key = header.dataset.sortKey;
    boardSort = boardSort.key === key
      ? { key, direction: boardSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" };
    const selectValues = { end_at: "time", title: "title", system: "system" };
    els.sortSelect.value = boardSort.direction === "asc" && selectValues[key] ? selectValues[key] : "custom";
    lastRenderedSignature = "";
    renderTimers();
  }

  function updateBoardSortHeaders() {
    els.timersTable.querySelectorAll("th[data-sort-key]").forEach((header) => {
      const active = header.dataset.sortKey === boardSort.key;
      header.setAttribute("aria-sort", active ? boardSort.direction === "asc" ? "ascending" : "descending" : "none");
    });
  }

  function tick() {
    updateLiveTimerCells();
    renderTimers();
  }

  function updateLiveTimerCells() {
    const timersById = new Map(timers.map((timer) => [String(timer.id), timer]));
    const now = Date.now();

    els.timersBody.querySelectorAll("tr[data-timer-id]").forEach((row) => {
      const timer = timersById.get(row.dataset.timerId);
      if (!timer) return;

      const state = getTimerState(timer, now);
      row.className = state.status.className;
      setCell(row, "remaining", state.remainingText);
      setCell(row, "status", state.status.label);
    });
  }

  function searchableText(timer) {
    return [timer.system, normalizeStructureType(timer.object_name), timer.structure, timer.title, timer.owner, timer.mode, normalizeTimerKind(timer.distance), normalizeStructureResult(timer.note), timer.raw_text]
      .join(" ")
      .toLowerCase();
  }

  function readLocalTimers() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    } catch (_err) {
      return [];
    }
  }

  function exportCsv() {
    const rows = [["system", "object_type", "structure", "corporation", "alliance", "mode", "timer_kind", "end_at_utc", "remaining", "status", "result"]];
    const now = Date.now();
    timers
      .slice()
      .sort((a, b) => new Date(a.end_at).getTime() - new Date(b.end_at).getTime())
      .forEach((timer) => {
        const state = getTimerState(timer, now);
        rows.push([
          timer.system,
          normalizeStructureType(timer.object_name),
          timer.structure,
          timer.title,
          timer.owner,
          timer.mode,
          normalizeTimerKind(timer.distance),
          formatUtc(timer.end_at),
          state.remainingText,
          state.status.label,
          normalizeStructureResult(timer.note)
        ]);
      });

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eve-timers-${BOARD_ID}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = String(value || "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function setStatus(text, isError) {
    els.adminStatus.textContent = text;
    els.adminStatus.className = `status-line ${isError ? "error" : "ok"}`;
  }

  function friendlyDbError(err) {
    const message = err && (err.message || err.details || err.hint) ? `${err.message || ""} ${err.details || ""} ${err.hint || ""}`.trim() : String(err);
    if (/wrong view key/i.test(message)) return "неверный ключ просмотра";
    if (/view key is not configured/i.test(message)) return "ключ просмотра ещё не настроен";
    if (/set_timerboard_view_key/i.test(message)) return "в Supabase нужно выполнить SQL для ключа просмотра";
    if (/get_timers/i.test(message)) return "в Supabase нужно выполнить SQL для ключа просмотра";
    if (/wrong admin key|28000/i.test(message)) return "неверный админ-ключ";
    if (/clear_timer_history/i.test(message)) return "в Supabase нужно обновить полную схему из supabase/schema.sql";
    if (/add_timers|patch_timer_admin_fields/i.test(message) && /function|schema cache|does not exist/i.test(message)) {
      return "в Supabase нужно выполнить обновлённый файл supabase/schema.sql";
    }
    if (/update_timer_admin_fields/i.test(message)) return "в Supabase нужно добавить функцию update_timer_admin_fields";
    if (/function .* does not exist|schema cache|add_timer/i.test(message)) return "SQL-схема Supabase не установлена или не обновлена";
    return message;
  }

  function cryptoRandomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

})();
