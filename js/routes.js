import { STRUCTURE_TYPES, TIMER_KINDS } from "./core/constants.js";
import { APP_EVENTS, appController } from "./app-controller.js";
import { planFleetAssignmentsV2, planSequentialRoute } from "./core/route-planner.js";
import { getTimerboardApi, hasSupabaseConfig as isSupabaseConfigured } from "./services/supabase-api.js";
import { createSystemCatalogService } from "./services/system-catalog.js";
import { escapeHtml, formatUtc } from "./shared/format.js";
import { createRouteMapView } from "./ui/route-map-view.js";
import { sortFleetRouteRows, sortGeneralRouteRows } from "./ui/route-table-view.js";
import { createSystemAutocomplete } from "./ui/system-autocomplete.js";

(function () {
  "use strict";

  const CONFIG = window.EVE_TIMERBOARD_CONFIG || {};
  const BOARD_ID = CONFIG.boardId || "main";
  let adminViewEnabled = document.body.classList.contains("is-admin-view");
  const FLEET_KEY_PREFIX = `eve_timerboard_fleet_key_${BOARD_ID}_`;
  const GENERAL_ORIGIN_KEY = `eve_timerboard_route_origin_${BOARD_ID}`;
  const GENERAL_SERVICE_KEY = `eve_timerboard_route_service_${BOARD_ID}`;
  const MAP_HEIGHT_KEY = `eve_timerboard_route_map_height_${BOARD_ID}`;
  const SYSTEM_CATALOG_URL = "data/solar-systems.json?v=3646012";
  const REGION_CATALOG_URL = "data/regions.json?v=20261024";
  const MAP_MIN_ZOOM = 1;
  const MAP_MAX_ZOOM = 16;
  const MAP_REGION_SYSTEM_LIMIT = 900;
  let viewAccessGranted = document.body.classList.contains("has-view-access");

  const hasSupabaseConfig = isSupabaseConfigured(CONFIG);
  const db = getTimerboardApi(CONFIG);
  const systemCatalog = createSystemCatalogService({
    systemCatalogUrl: SYSTEM_CATALOG_URL,
    regionCatalogUrl: REGION_CATALOG_URL
  });
  const systemAutocomplete = createSystemAutocomplete({
    catalog: systemCatalog,
    escapeHtml,
    formatSecurity
  });

  const state = {
    mapMode: "general",
    fleets: [],
    adminFleets: [],
    routeRows: [],
    routeTableSort: {
      general: { key: "order", direction: "asc" },
      fleet: { key: "default", direction: "asc" }
    },
    hiddenFleetIds: new Set(),
    selectedFleetId: "",
    selectedFleetKey: "",
    boardAccessFleetId: "",
    generalPlan: null,
    lastPlanMetrics: null,
    routeLoadGeneration: 0,
    generalPlanGeneration: 0
  };

  const els = {
    boardView: document.getElementById("boardView"),
    routesView: document.getElementById("routesView"),
    boardTab: document.getElementById("boardTab"),
    routesTab: document.getElementById("routesTab"),
    generalMapModeBtn: document.getElementById("generalMapModeBtn"),
    fleetMapModeBtn: document.getElementById("fleetMapModeBtn"),
    generalRoutePanel: document.getElementById("generalRoutePanel"),
    generalOriginSystem: document.getElementById("generalOriginSystem"),
    generalSecondsPerJump: document.getElementById("generalSecondsPerJump"),
    generalServiceMinutes: document.getElementById("generalServiceMinutes"),
    generalTimerKindFilter: document.getElementById("generalTimerKindFilter"),
    generalObjectFilter: document.getElementById("generalObjectFilter"),
    buildGeneralRouteBtn: document.getElementById("buildGeneralRouteBtn"),
    generalRouteStatus: document.getElementById("generalRouteStatus"),
    fleetAccessPanel: document.getElementById("fleetAccessPanel"),
    fleetLoginSelect: document.getElementById("fleetLoginSelect"),
    fleetLoginKey: document.getElementById("fleetLoginKey"),
    rememberFleetKey: document.getElementById("rememberFleetKey"),
    openFleetRouteBtn: document.getElementById("openFleetRouteBtn"),
    fleetLoginStatus: document.getElementById("fleetLoginStatus"),
    fleetAdminPanel: document.getElementById("fleetAdminPanel"),
    calculateFleetRoutesBtn: document.getElementById("calculateFleetRoutesBtn"),
    fleetTimerKindFilter: document.getElementById("fleetTimerKindFilter"),
    fleetObjectFilter: document.getElementById("fleetObjectFilter"),
    newFleetName: document.getElementById("newFleetName"),
    newFleetSystem: document.getElementById("newFleetSystem"),
    newFleetColor: document.getElementById("newFleetColor"),
    newFleetSecondsPerJump: document.getElementById("newFleetSecondsPerJump"),
    newFleetServiceMinutes: document.getElementById("newFleetServiceMinutes"),
    createFleetBtn: document.getElementById("createFleetBtn"),
    generatedFleetKey: document.getElementById("generatedFleetKey"),
    generatedFleetKeyLabel: document.getElementById("generatedFleetKeyLabel"),
    generatedFleetKeyValue: document.getElementById("generatedFleetKeyValue"),
    copyFleetKeyBtn: document.getElementById("copyFleetKeyBtn"),
    fleetProfilesList: document.getElementById("fleetProfilesList"),
    fleetAdminStatus: document.getElementById("fleetAdminStatus"),
    routeWorkspaceTitle: document.getElementById("routeWorkspaceTitle"),
    routeWorkspaceHint: document.getElementById("routeWorkspaceHint"),
    reloadRouteBtn: document.getElementById("reloadRouteBtn"),
    routeZoomOutBtn: document.getElementById("routeZoomOutBtn"),
    routeZoomResetBtn: document.getElementById("routeZoomResetBtn"),
    routeZoomInBtn: document.getElementById("routeZoomInBtn"),
    routeMap: document.getElementById("routeMap"),
    routeMapResizeHandle: document.getElementById("routeMapResizeHandle"),
    routeLegend: document.getElementById("routeLegend"),
    routeList: document.getElementById("routeList"),
    adminKey: document.getElementById("adminKey"),
    viewKey: document.getElementById("viewKey"),
    refreshBtn: document.getElementById("refreshBtn")
  };

  const routeMapView = createRouteMapView({
    container: els.routeMap,
    resizeHandle: els.routeMapResizeHandle,
    zoomOutButton: els.routeZoomOutBtn,
    zoomResetButton: els.routeZoomResetBtn,
    zoomInButton: els.routeZoomInBtn,
    catalog: systemCatalog,
    storageKey: MAP_HEIGHT_KEY,
    escapeHtml,
    safeColor,
    formatSecurity,
    securityColor,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    regionSystemLimit: MAP_REGION_SYSTEM_LIMIT
  });

  init();

  function init() {
    removeLegacyFleetKeys();
    populateMultiFilter(els.generalTimerKindFilter, TIMER_KINDS);
    populateMultiFilter(els.generalObjectFilter, STRUCTURE_TYPES);
    populateMultiFilter(els.fleetTimerKindFilter, TIMER_KINDS);
    populateMultiFilter(els.fleetObjectFilter, STRUCTURE_TYPES);
    els.generalOriginSystem.value = localStorage.getItem(GENERAL_ORIGIN_KEY) || "";
    els.generalServiceMinutes.value = localStorage.getItem(GENERAL_SERVICE_KEY) || "10";
    routeMapView.bind();
    loadSystemCatalog().catch(() => {});
    systemAutocomplete.bind(els.generalOriginSystem);
    systemAutocomplete.bind(els.newFleetSystem);
    initMultiFilter(els.generalTimerKindFilter);
    initMultiFilter(els.generalObjectFilter);
    initMultiFilter(els.fleetTimerKindFilter);
    initMultiFilter(els.fleetObjectFilter);
    document.addEventListener("click", closeOtherMultiFilters);
    document.addEventListener("keydown", closeMultiFiltersOnEscape);

    els.boardTab.addEventListener("click", () => showMainView("board"));
    els.routesTab.addEventListener("click", handleRoutesTabClick);
    window.addEventListener("hashchange", applyHashView);

    els.generalMapModeBtn.addEventListener("click", () => setMapMode("general"));
    els.fleetMapModeBtn.addEventListener("click", () => setMapMode("fleet"));
    els.buildGeneralRouteBtn.addEventListener("click", buildGeneralRoute);
    els.openFleetRouteBtn.addEventListener("click", openSelectedFleetRoute);
    els.fleetLoginSelect.addEventListener("change", restoreSelectedFleetKey);
    els.fleetLoginKey.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openSelectedFleetRoute();
    });
    els.rememberFleetKey.addEventListener("change", rememberCurrentFleetKey);
    els.reloadRouteBtn.addEventListener("click", reloadCurrentRoute);
    appController.on(APP_EVENTS.BOARD_RESULT_UPDATED, () => {
      if (state.mapMode === "fleet") reloadCurrentRoute();
    });
    appController.on(APP_EVENTS.TIMERS_REFRESHED, () => {
      if (els.routesView.hidden) return;
      if (state.mapMode === "fleet") {
        void reloadCurrentRoute();
      } else if (state.generalPlan) {
        void buildGeneralRoute();
      }
    });
    appController.on(APP_EVENTS.ADMIN_VIEW_CHANGED, (event) => {
      adminViewEnabled = Boolean(event.detail && event.detail.enabled);
      if (adminViewEnabled) viewAccessGranted = true;
      updateRoutesAccess();
      setMapMode(state.mapMode);
      if (!els.routesView.hidden) loadRouteData();
    });
    appController.on(APP_EVENTS.VIEW_ACCESS_CHANGED, (event) => {
      viewAccessGranted = Boolean(event.detail && event.detail.granted);
      updateRoutesAccess();
    });
    els.createFleetBtn.addEventListener("click", createFleet);
    els.calculateFleetRoutesBtn.addEventListener("click", calculateFleetRoutes);
    els.copyFleetKeyBtn.addEventListener("click", copyGeneratedFleetKey);
    els.fleetProfilesList.addEventListener("click", handleFleetProfileAction);
    els.routeLegend.addEventListener("change", handleRouteLegendChange);
    els.routeList.addEventListener("click", handleRouteListClick);
    els.routeList.addEventListener("keydown", handleRouteListKeydown);
    window.setInterval(updateRouteCountdowns, 1000);

    if (els.adminKey) {
      els.adminKey.addEventListener("change", () => {
        if (!els.routesView.hidden) loadRouteData();
      });
    }

    setMapMode("general");
    updateRoutesAccess();
    applyHashView();
  }

  function populateMultiFilter(filter, values) {
    const container = filter.querySelector(".multi-filter-options");
    container.textContent = "";
    for (const value of values) {
      const label = document.createElement("label");
      label.className = "checkline multi-filter-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = true;
      const box = document.createElement("span");
      box.className = "checkbox-box";
      box.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = value;
      label.append(input, box, text);
      container.appendChild(label);
    }
  }

  function applyHashView() {
    showMainView(window.location.hash === "#routes" ? "routes" : "board", false);
  }

  function handleRoutesTabClick(event) {
    if (!canOpenRoutes()) {
      event.preventDefault();
      showMainView("board");
      appController.emit(APP_EVENTS.REQUEST_VIEW_ACCESS);
      return;
    }
    showMainView("routes");
  }

  function showMainView(view, updateHash = true) {
    const requestedRoutes = view === "routes";
    const showRoutes = requestedRoutes && canOpenRoutes();
    els.boardView.hidden = showRoutes;
    els.routesView.hidden = !showRoutes;
    els.boardTab.classList.toggle("is-active", !showRoutes);
    els.routesTab.classList.toggle("is-active", showRoutes);
    if (updateHash || requestedRoutes && !showRoutes) {
      history.replaceState(null, "", showRoutes ? "#routes" : "#board");
    }
    if (showRoutes) loadRouteData();
  }

  function canOpenRoutes() {
    return viewAccessGranted || adminViewEnabled;
  }

  function updateRoutesAccess() {
    const unlocked = canOpenRoutes();
    els.routesTab.classList.toggle("is-locked", !unlocked);
    els.routesTab.setAttribute("aria-disabled", String(!unlocked));
    els.routesTab.title = unlocked ? "" : "Сначала введите ключ просмотра";
    if (unlocked || els.routesView.hidden) return;

    state.fleets = [];
    state.adminFleets = [];
    state.routeRows = [];
    state.generalPlan = null;
    state.selectedFleetKey = "";
    els.fleetLoginKey.value = "";
    els.fleetLoginSelect.innerHTML = '<option value="">Выберите флот</option>';
    els.fleetProfilesList.innerHTML = "";
    publishFleetBoardAccess("", "", []);
    clearRouteWorkspace("Введите ключ просмотра, чтобы открыть маршруты.");
    showMainView("board");
  }

  function setMapMode(mode) {
    state.mapMode = mode;
    routeMapView.setMode(mode);
    const general = mode === "general";
    els.generalMapModeBtn.classList.toggle("is-selected", general);
    els.fleetMapModeBtn.classList.toggle("is-selected", !general);
    els.generalRoutePanel.hidden = !general;
    els.fleetAccessPanel.hidden = general || adminViewEnabled;
    els.fleetAdminPanel.hidden = general || !adminViewEnabled;
    if (general) {
      if (state.generalPlan) {
        renderGeneralPlan(state.generalPlan);
      } else {
        clearRouteWorkspace("Укажите стартовую систему выше и нажмите «Рассчитать».");
      }
      return;
    }

    clearRouteWorkspace(adminViewEnabled
      ? "Создай флоты или загрузи сохранённые маршруты."
      : "Выбери флот и введи его ключ.");
    loadRouteData();
  }

  async function loadRouteData() {
    if (!db) {
      setLine(els.fleetLoginStatus, "Для маршрутов требуется настроенный Supabase.", true);
      setLine(els.fleetAdminStatus, "Для маршрутов требуется настроенный Supabase.", true);
      return;
    }
    const requestGeneration = ++state.routeLoadGeneration;
    try {
      if (adminViewEnabled) {
        const adminKey = getAdminKey();
        if (!adminKey) {
          setLine(els.fleetAdminStatus, "Введи главный админ-ключ на вкладке доски.", true);
          return;
        }
        if (!await loadAdminFleets(requestGeneration)) return;
        if (state.mapMode === "fleet") await loadAllFleetRoutes(requestGeneration);
      } else {
        const readKey = getReadKey();
        if (!readKey) {
          setLine(els.fleetLoginStatus, "Сначала открой доску ключом просмотра.", true);
          return;
        }
        await loadPublicFleets(requestGeneration);
      }
    } catch (err) {
      if (requestGeneration !== state.routeLoadGeneration) return;
      const message = friendlyError(err);
      setLine(els.fleetLoginStatus, message, true);
      setLine(els.fleetAdminStatus, message, true);
    }
  }

  async function loadPublicFleets(requestGeneration = ++state.routeLoadGeneration) {
    const { data, error } = await db.listFleets(BOARD_ID, getReadKey());
    if (error) throw error;
    if (requestGeneration !== state.routeLoadGeneration) return false;
    state.fleets = data || [];
    renderFleetSelect();
    setLine(els.fleetLoginStatus, state.fleets.length ? "" : "Активных флотов пока нет.", false);
    return true;
  }

  async function loadAdminFleets(requestGeneration = ++state.routeLoadGeneration) {
    const { data, error } = await db.listFleetsAdmin(BOARD_ID, getAdminKey());
    if (error) throw error;
    if (requestGeneration !== state.routeLoadGeneration) return false;
    state.adminFleets = data || [];
    state.fleets = state.adminFleets
      .filter((fleet) => fleet.active)
      .map((fleet) => ({
        fleet_id: fleet.fleet_id,
        fleet_name: fleet.fleet_name,
        fleet_color: fleet.fleet_color
      }));
    renderFleetProfiles();
    renderFleetSelect();
    setLine(els.fleetAdminStatus, "", false);
    return true;
  }

  function renderFleetSelect() {
    const selected = els.fleetLoginSelect.value || state.selectedFleetId;
    els.fleetLoginSelect.innerHTML = '<option value="">Выберите флот</option>' + state.fleets
      .map((fleet) => `<option value="${escapeHtml(fleet.fleet_id)}">${escapeHtml(fleet.fleet_name)}</option>`)
      .join("");
    if (state.fleets.some((fleet) => fleet.fleet_id === selected)) {
      els.fleetLoginSelect.value = selected;
    }
    restoreSelectedFleetKey();
  }

  function renderFleetProfiles() {
    systemAutocomplete.hide();
    if (!state.adminFleets.length) {
      els.fleetProfilesList.innerHTML = '<div class="empty">Флоты ещё не созданы.</div>';
      return;
    }

    els.fleetProfilesList.innerHTML = state.adminFleets.map((fleet) => `
      <div class="fleet-profile-row" data-fleet-id="${escapeHtml(fleet.fleet_id)}">
        <label>
          Название
          <input data-field="name" type="text" maxlength="60" value="${escapeHtml(fleet.fleet_name)}" />
        </label>
        <label>
          Текущая система
          <input class="system-autocomplete" data-field="system" type="text" autocomplete="off" value="${escapeHtml(fleet.current_system)}" />
        </label>
        <label>
          Цвет
          <input data-field="color" type="color" value="${escapeHtml(fleet.fleet_color)}" />
        </label>
        <label>
          Секунд/прыжок
          <input data-field="seconds" type="number" min="5" max="3600" value="${Number(fleet.seconds_per_jump)}" />
        </label>
        <label>
          Минут на цели
          <input data-field="service" type="number" min="0" max="240" value="${Number(fleet.service_minutes)}" />
        </label>
        <div>
          <label class="checkline">
            <input data-field="active" type="checkbox" ${fleet.active ? "checked" : ""} />
            <span class="checkbox-box" aria-hidden="true"></span>
            <span>активен</span>
          </label>
          <div class="fleet-key-hint" title="Полный ключ не хранится">Ключ оканчивается на: ${escapeHtml(fleet.key_hint || "—")}</div>
          <div class="fleet-profile-actions">
            <button data-action="save" class="secondary-btn" type="button">Сохранить профиль</button>
            <button data-action="rotate" class="ghost-btn" type="button">Новый ключ</button>
            <button data-action="delete" class="danger-btn" type="button">Удалить</button>
          </div>
        </div>
      </div>
    `).join("");
    els.fleetProfilesList.querySelectorAll('input[data-field="system"]').forEach((input) => systemAutocomplete.bind(input));
  }

  async function createFleet() {
    systemAutocomplete.hide();
    const adminKey = getAdminKey();
    if (!adminKey) {
      setLine(els.fleetAdminStatus, "Нужен главный админ-ключ.", true);
      return;
    }
    const name = els.newFleetName.value.trim();
    const enteredSystem = els.newFleetSystem.value.trim();
    if (!name || !enteredSystem) {
      setLine(els.fleetAdminStatus, "Укажи название и текущую систему флота.", true);
      return;
    }

    els.createFleetBtn.disabled = true;
    try {
      const system = await requireSystemName(enteredSystem, els.newFleetSystem);
      els.newFleetSystem.value = system;
      const { data, error } = await db.createFleet(BOARD_ID, adminKey, {
        name,
        color: els.newFleetColor.value,
        currentSystem: system,
        secondsPerJump: boundedNumber(els.newFleetSecondsPerJump.value, 5, 3600, 60),
        serviceMinutes: boundedNumber(els.newFleetServiceMinutes.value, 0, 240, 10)
      });
      if (error) throw error;
      const created = data && data[0];
      if (created) showGeneratedKey(created.generated_key, created.fleet_name);
      els.newFleetName.value = "";
      els.newFleetSystem.value = "";
      await loadAdminFleets();
      setLine(els.fleetAdminStatus, `Флот «${name}» создан. Скопируй ключ сейчас.`, false);
    } catch (err) {
      setLine(els.fleetAdminStatus, `Ошибка создания: ${friendlyError(err)}`, true);
    } finally {
      els.createFleetBtn.disabled = false;
    }
  }

  async function handleFleetProfileAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest(".fleet-profile-row");
    if (!row) return;
    const fleetId = row.dataset.fleetId;
    const action = button.dataset.action;
    if (action === "save") await saveFleetProfile(row, fleetId, button);
    if (action === "rotate") await rotateFleetKey(fleetId, button);
    if (action === "delete") await deleteFleetProfile(fleetId, button);
  }

  async function saveFleetProfile(row, fleetId, button) {
    systemAutocomplete.hide();
    button.disabled = true;
    try {
      const draft = await readFleetDraft(row, fleetId);
      const { error } = await db.updateFleet(BOARD_ID, getAdminKey(), fleetId, {
        name: draft.name,
        color: draft.color,
        currentSystem: draft.current_system,
        secondsPerJump: draft.seconds_per_jump,
        serviceMinutes: draft.service_minutes,
        active: draft.active
      });
      if (error) throw error;
      await loadAdminFleets();
      setLine(els.fleetAdminStatus, `Профиль флота «${draft.name}» сохранён. Ключ флота не изменён. Для нового пути запусти перерасчёт.`, false);
    } catch (err) {
      setLine(els.fleetAdminStatus, `Ошибка сохранения: ${friendlyError(err)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function readFleetDraft(row, fleetId) {
    const name = row.querySelector('[data-field="name"]').value.trim();
    if (!name) throw new Error("У каждого флота должно быть название.");
    const systemInput = row.querySelector('[data-field="system"]');
    const currentSystem = await requireSystemName(systemInput.value, systemInput);
    systemInput.value = currentSystem;
    return {
      fleet_id: fleetId,
      name,
      color: row.querySelector('[data-field="color"]').value,
      current_system: currentSystem,
      seconds_per_jump: boundedNumber(row.querySelector('[data-field="seconds"]').value, 5, 3600, 60),
      service_minutes: boundedNumber(row.querySelector('[data-field="service"]').value, 0, 240, 10),
      active: row.querySelector('[data-field="active"]').checked
    };
  }

  function fleetDraftChanged(draft, saved) {
    return draft.name !== saved.fleet_name ||
      draft.color !== saved.fleet_color ||
      normalizeName(draft.current_system) !== normalizeName(saved.current_system) ||
      draft.seconds_per_jump !== Number(saved.seconds_per_jump) ||
      draft.service_minutes !== Number(saved.service_minutes) ||
      draft.active !== Boolean(saved.active);
  }

  async function saveFleetDraftsBeforeCalculation() {
    const rows = [...els.fleetProfilesList.querySelectorAll(".fleet-profile-row")];
    let changed = 0;
    for (const row of rows) {
      const fleetId = row.dataset.fleetId;
      const saved = state.adminFleets.find((fleet) => fleet.fleet_id === fleetId);
      if (!saved) continue;
      const draft = await readFleetDraft(row, fleetId);
      if (!fleetDraftChanged(draft, saved)) continue;
      const { error } = await db.updateFleet(BOARD_ID, getAdminKey(), fleetId, {
        name: draft.name,
        color: draft.color,
        currentSystem: draft.current_system,
        secondsPerJump: draft.seconds_per_jump,
        serviceMinutes: draft.service_minutes,
        active: draft.active
      });
      if (error) throw error;
      changed += 1;
    }
    if (changed) await loadAdminFleets();
    return changed;
  }

  async function rotateFleetKey(fleetId, button) {
    if (!window.confirm("Выпустить новый ключ? Старый ключ сразу перестанет работать.")) return;
    button.disabled = true;
    try {
      const { data, error } = await db.rotateFleetKey(BOARD_ID, getAdminKey(), fleetId);
      if (error) throw error;
      const rotated = data && data[0];
      const fleet = state.adminFleets.find((item) => item.fleet_id === fleetId);
      if (rotated) showGeneratedKey(rotated.generated_key, fleet ? fleet.fleet_name : "флот");
      await loadAdminFleets();
      setLine(els.fleetAdminStatus, `Новый ключ флота «${fleet ? fleet.fleet_name : "флот"}» выпущен. Скопируй его сейчас.`, false);
    } catch (err) {
      setLine(els.fleetAdminStatus, `Ошибка смены ключа: ${friendlyError(err)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteFleetProfile(fleetId, button) {
    const fleet = state.adminFleets.find((item) => item.fleet_id === fleetId);
    if (!window.confirm(`Удалить профиль «${fleet ? fleet.fleet_name : "флот"}» и его назначения?`)) return;
    button.disabled = true;
    try {
      const { error } = await db.deleteFleet(BOARD_ID, getAdminKey(), fleetId);
      if (error) throw error;
      await loadAdminFleets();
      await loadAllFleetRoutes();
      setLine(els.fleetAdminStatus, `Профиль флота «${fleet ? fleet.fleet_name : "флот"}» удалён.`, false);
    } catch (err) {
      setLine(els.fleetAdminStatus, `Ошибка удаления: ${friendlyError(err)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  function showGeneratedKey(key, fleetName) {
    els.generatedFleetKey.hidden = false;
    els.generatedFleetKey.dataset.fleetName = fleetName || "";
    els.generatedFleetKeyLabel.textContent = fleetName
      ? `Новый ключ флота «${fleetName}»:`
      : "Новый ключ:";
    els.generatedFleetKeyValue.dataset.key = String(key || "").trim();
    els.generatedFleetKeyValue.textContent = String(key || "").trim();
  }

  async function copyGeneratedFleetKey() {
    const key = (els.generatedFleetKeyValue.dataset.key || els.generatedFleetKeyValue.textContent || "").trim();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setLine(els.fleetAdminStatus, "Ключ флота скопирован без названия.", false);
    } catch (_err) {
      setLine(els.fleetAdminStatus, "Не удалось скопировать автоматически. Выдели ключ вручную.", true);
    }
  }

  async function calculateFleetRoutes() {
    systemAutocomplete.hide();
    if (!getAdminKey()) {
      setLine(els.fleetAdminStatus, "Нужен главный админ-ключ.", true);
      return;
    }
    els.calculateFleetRoutesBtn.disabled = true;
    setLine(els.fleetAdminStatus, "Проверяю и сохраняю изменения профилей…", false);
    try {
      const changedProfiles = await saveFleetDraftsBeforeCalculation();
      const fleets = state.adminFleets.filter((fleet) => fleet.active);
      if (!fleets.length) throw new Error("Создай и включи хотя бы один флот.");
      setLine(
        els.fleetAdminStatus,
        changedProfiles
          ? `Профилей обновлено: ${changedProfiles}. Загружаю таймеры и рассчитываю переходы…`
          : "Загружаю таймеры и рассчитываю переходы…",
        false
      );
      const timers = await loadTimersForRoutes(getAdminKey());
      const filters = readRouteFilters(els.fleetTimerKindFilter, els.fleetObjectFilter);
      const targets = activeRouteTargets(timers, filters);
      if (!targets.length) {
        throw new Error(`Нет будущих активных таймеров под фильтр «${describeRouteFilters(filters)}».`);
      }

      const resolved = await resolveSystemNames([
        ...fleets.map((fleet) => fleet.current_system),
        ...targets.map((timer) => timer.system)
      ]);

      const plan = await planFleetAssignmentsV2({
        fleets,
        targets,
        resolveSystem: (name) => resolved.get(normalizeName(name)),
        getRoute,
        now: Date.now(),
        onProgress: ({ index, total, timer }) => setLine(
          els.fleetAdminStatus,
          `Расчёт цели ${index + 1} из ${total}: ${timer.system}…`,
          false
        )
      });
      const assignments = plan.assignments;

      const routeIds = [...new Set(assignments.flatMap((item) => item.route_ids))];
      const routeNames = await resolveIdsToNames(routeIds);
      const payload = assignments.map((item) => ({
        fleet_id: item.fleet_id,
        timer_id: item.timer_id,
        route_order: item.route_order,
        jump_count: item.jump_count,
        eta_at: item.eta_at,
        route_nodes: item.route_ids.map((id) => ({ id, name: routeNames.get(Number(id)) || String(id) }))
      }));

      const { data, error } = await db.replaceFleetAssignments(BOARD_ID, getAdminKey(), payload);
      if (error) throw error;
      state.lastPlanMetrics = { ...plan.metrics, improved: plan.improved };
      setLine(
        els.fleetAdminStatus,
        `Маршруты рассчитаны. Фильтр: ${describeRouteFilters(filters)}. Назначено целей: ${Number(data || payload.length)}. ${formatPlanMetrics(state.lastPlanMetrics)}.`,
        false
      );
      await loadAllFleetRoutes();
    } catch (err) {
      setLine(els.fleetAdminStatus, `Расчёт не сохранён: ${friendlyError(err)}`, true);
    } finally {
      els.calculateFleetRoutesBtn.disabled = false;
    }
  }

  async function buildGeneralRoute() {
    const enteredOrigin = els.generalOriginSystem.value.trim();
    const secondsPerJump = boundedNumber(els.generalSecondsPerJump.value, 5, 3600, 60);
    const serviceMinutes = boundedNumber(els.generalServiceMinutes.value, 0, 240, 10);
    if (!enteredOrigin) {
      setLine(els.generalRouteStatus, "Укажите стартовую систему, в которой вы сейчас находитесь.", true);
      return;
    }
    const readKey = getReadKey();
    if (!readKey) {
      setLine(els.generalRouteStatus, "Сначала открой доску ключом просмотра.", true);
      return;
    }
    const requestGeneration = ++state.generalPlanGeneration;
    const isCurrentRequest = () => requestGeneration === state.generalPlanGeneration;

    els.buildGeneralRouteBtn.disabled = true;
    setLine(els.generalRouteStatus, "Сравниваю активные таймеры…", false);
    try {
      const origin = await requireSystemName(enteredOrigin, els.generalOriginSystem);
      if (!isCurrentRequest()) return;
      els.generalOriginSystem.value = origin;
      const timers = await loadTimersForRoutes(readKey);
      if (!isCurrentRequest()) return;
      const filters = readRouteFilters(els.generalTimerKindFilter, els.generalObjectFilter);
      const targets = activeRouteTargets(timers, filters);
      if (!targets.length) {
        throw new Error(`Нет будущих активных таймеров под фильтр «${describeRouteFilters(filters)}».`);
      }

      const resolved = await resolveSystemNames([origin, ...targets.map((timer) => timer.system)]);
      if (!isCurrentRequest()) return;
      const originSystem = resolved.get(normalizeName(origin));
      if (!originSystem) throw new Error(`Система не найдена в каталоге EVE: ${origin}`);

      const candidates = await planSequentialRoute({
        originSystem,
        fleet: {
          seconds_per_jump: secondsPerJump,
          service_minutes: serviceMinutes
        },
        targets,
        resolveSystem: (name) => resolved.get(normalizeName(name)),
        getRoute,
        now: Date.now(),
        onProgress: ({ index, total, timer }) => {
          if (isCurrentRequest()) {
            setLine(
              els.generalRouteStatus,
              `Расчёт цели ${index + 1} из ${total}: ${timer.system}…`,
              false
            );
          }
        }
      });
      if (!isCurrentRequest()) return;

      if (!candidates.length) throw new Error("Не удалось построить путь ни к одной цели.");
      const recommended = candidates[0];
      const allRouteIds = [...new Set(candidates.flatMap((candidate) => candidate.routeIds))];
      const names = await resolveIdsToNames(allRouteIds);
      if (!isCurrentRequest()) return;
      const nodes = [];
      const segments = [];
      for (const candidate of candidates) {
        const segment = candidate.routeIds.map((id) => ({
          id: Number(id),
          name: names.get(Number(id)) || String(id)
        }));
        segments.push(segment);
        for (const id of candidate.routeIds) {
          if (!nodes.length || nodes[nodes.length - 1].id !== Number(id)) {
            nodes.push({ id: Number(id), name: names.get(Number(id)) || String(id) });
          }
        }
      }

      localStorage.setItem(GENERAL_ORIGIN_KEY, origin);
      localStorage.setItem(GENERAL_SERVICE_KEY, String(serviceMinutes));
      state.generalPlan = {
        origin,
        candidates,
        recommended,
        secondsPerJump,
        serviceMinutes,
        filterDescription: describeRouteFilters(filters),
        routes: [{
          name: `${origin} → ${candidates[candidates.length - 1].timer.system}`,
          color: "#27a7d8",
          nodes,
          segments,
          targetIds: new Set(candidates.map((candidate) => Number(candidate.targetSystem.id)))
        }]
      };
      renderGeneralPlan(state.generalPlan);
      setLine(
        els.generalRouteStatus,
        `Маршрут построен. Фильтр: ${describeRouteFilters(filters)}. Следующая цель: ${recommended.timer.system}.`,
        false
      );
    } catch (err) {
      if (!isCurrentRequest()) return;
      setLine(els.generalRouteStatus, friendlyError(err), true);
    } finally {
      if (isCurrentRequest()) els.buildGeneralRouteBtn.disabled = false;
    }
  }

  function renderGeneralPlan(plan) {
    routeMapView.render(plan.routes);
    renderGeneralCandidates(
      plan.candidates,
      plan.recommended,
      plan.secondsPerJump,
      plan.serviceMinutes
    );
    els.routeWorkspaceTitle.textContent = `Следующая цель: ${plan.recommended.timer.system}`;
    els.routeWorkspaceHint.textContent = `Целей: ${plan.candidates.length}. Фильтр: ${plan.filterDescription || "все таймеры и объекты"}. Первый переход: ${formatJumpCount(plan.recommended.jumps)}, ETA ${formatUtc(plan.recommended.eta)}.`;
  }

  function renderGeneralCandidates(candidates, recommended, secondsPerJump, serviceMinutes) {
    const displayCandidates = sortGeneralRouteRows(candidates, state.routeTableSort.general);
    els.routeLegend.innerHTML = `
      <span class="route-legend-item">
        <span class="route-legend-swatch" style="--fleet-color:#27a7d8"></span>
        ${escapeHtml(recommended.timer.system)}
      </span>`;

    els.routeList.innerHTML = `
      <div class="route-recommendation">
        <div><strong>${escapeHtml(recommended.timer.system)}</strong><span>рекомендуемая следующая цель</span></div>
        <div><strong>${recommended.jumps}</strong><span>${escapeHtml(jumpWord(recommended.jumps))}</span></div>
        <div><strong>${escapeHtml(formatUtc(recommended.eta))}</strong><span>ETA, EVE/UTC</span></div>
        <div><strong class="route-countdown" data-route-countdown="${escapeHtml(recommended.timer.end_at)}">${escapeHtml(formatCountdown(new Date(recommended.timer.end_at).getTime() - Date.now()))}</strong><span>до таймера</span></div>
        <div><strong class="route-margin ${recommended.marginMs >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedDuration(recommended.marginMs))}</strong><span>запас</span></div>
      </div>
      <div class="route-table-wrap">
        <table class="route-table route-table-general">
          ${renderRouteTableHead(false, state.routeTableSort.general)}
          <tbody>
            ${displayCandidates.map(({ candidate, routeOrder }) => `
              <tr class="route-list-row ${candidate.marginMs < 0 ? "is-late" : ""}">
                <td class="route-list-order">${routeOrder}</td>
                ${renderCopyableSystemCell(candidate.timer.system)}
                <td>${routeValue(candidate.timer.object_name)}</td>
                <td>${routeValue(candidate.timer.structure)}</td>
                <td>${routeValue(candidate.timer.title)}</td>
                <td>${routeValue(candidate.timer.owner)}</td>
                <td>${routeValue(candidate.timer.mode)}</td>
                <td>${renderTimerKind(candidate.timer.distance)}</td>
                <td>${escapeHtml(formatJumpCount(candidate.jumps))}</td>
                <td class="route-time-cell">${escapeHtml(formatUtc(candidate.eta))}</td>
                <td class="route-time-cell">${escapeHtml(formatUtc(candidate.timer.end_at))}</td>
                ${renderRouteCountdownCell(candidate.timer.end_at)}
                <td class="route-margin ${candidate.marginMs >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedDuration(candidate.marginMs))}</td>
                <td>${renderRouteArrivalStatus(candidate.marginMs)}</td>
                <td><div class="route-result-summary">${renderReadonlyResult(candidate.timer.note)}</div></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="route-list-note">Расчёт: ${secondsPerJump} сек/прыжок · ${serviceMinutes} мин/цель</div>`;
    updateRouteCountdowns();
  }

  function restoreSelectedFleetKey() {
    const fleetId = els.fleetLoginSelect.value;
    if (state.boardAccessFleetId && state.boardAccessFleetId !== fleetId) {
      publishFleetBoardAccess("", "", []);
    }
    state.selectedFleetId = fleetId;
    if (!fleetId) {
      els.fleetLoginKey.value = "";
      els.rememberFleetKey.checked = false;
      return;
    }
    const saved = sessionStorage.getItem(FLEET_KEY_PREFIX + fleetId) || "";
    els.fleetLoginKey.value = saved;
    els.rememberFleetKey.checked = Boolean(saved);
  }

  function rememberCurrentFleetKey() {
    const fleetId = els.fleetLoginSelect.value;
    if (!fleetId) return;
    if (els.rememberFleetKey.checked && els.fleetLoginKey.value.trim()) {
      sessionStorage.setItem(FLEET_KEY_PREFIX + fleetId, els.fleetLoginKey.value.trim());
    } else {
      sessionStorage.removeItem(FLEET_KEY_PREFIX + fleetId);
    }
  }

  function removeLegacyFleetKeys() {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(FLEET_KEY_PREFIX)) localStorage.removeItem(key);
    }
  }

  async function openSelectedFleetRoute() {
    const fleetId = els.fleetLoginSelect.value;
    const fleetKey = normalizeFleetKeyInput(els.fleetLoginKey.value);
    if (!fleetId || !fleetKey) {
      setLine(els.fleetLoginStatus, "Выбери флот и введи его ключ.", true);
      return;
    }
    els.fleetLoginKey.value = fleetKey;
    const requestGeneration = ++state.routeLoadGeneration;

    els.openFleetRouteBtn.disabled = true;
    try {
      const { data, error } = await db.getFleetRoute(BOARD_ID, getReadKey(), fleetId, fleetKey);
      if (error) throw error;
      if (requestGeneration !== state.routeLoadGeneration) return;
      state.selectedFleetId = fleetId;
      state.selectedFleetKey = fleetKey;
      state.routeRows = data || [];
      publishFleetBoardAccess(fleetId, fleetKey, state.routeRows);
      rememberCurrentFleetKey();
      const fleet = state.fleets.find((item) => item.fleet_id === fleetId);
      renderFleetRoutes(state.routeRows, fleet ? fleet.fleet_name : "Флот");
      setLine(els.fleetLoginStatus, "Маршрут открыт. Итог можно поставить прямо в строке цели или на доске.", false);
    } catch (err) {
      if (requestGeneration !== state.routeLoadGeneration) return;
      state.selectedFleetKey = "";
      publishFleetBoardAccess("", "", []);
      setLine(els.fleetLoginStatus, friendlyError(err), true);
    } finally {
      if (requestGeneration === state.routeLoadGeneration) els.openFleetRouteBtn.disabled = false;
    }
  }

  async function loadAllFleetRoutes(requestGeneration = ++state.routeLoadGeneration) {
    if (!getAdminKey()) return;
    const { data, error } = await db.getAllFleetRoutes(BOARD_ID, getAdminKey());
    if (error) throw error;
    if (requestGeneration !== state.routeLoadGeneration) return false;
    state.routeRows = data || [];
    renderFleetRoutes(state.routeRows, "Все флоты");
    return true;
  }

  function renderFleetRoutes(rows, title) {
    els.routeWorkspaceTitle.textContent = title;
    if (!rows.length) {
      els.routeWorkspaceHint.textContent = "Сохранённых назначений пока нет.";
      clearRouteWorkspace("Маршрут пуст. Главный администратор должен выполнить расчёт.", false);
      return;
    }

    const groups = new Map();
    for (const row of rows) {
      const fleetId = String(row.fleet_id);
      if (!groups.has(fleetId)) {
        groups.set(fleetId, {
          id: fleetId,
          name: row.fleet_name,
          color: row.fleet_color || "#27a7d8",
          rows: []
        });
      }
      groups.get(fleetId).rows.push(row);
    }

    const currentFleetIds = new Set(groups.keys());
    for (const fleetId of state.hiddenFleetIds) {
      if (!currentFleetIds.has(fleetId)) state.hiddenFleetIds.delete(fleetId);
    }
    const fleetFilterEnabled = groups.size > 1;

    const routes = [...groups.values()].map((group) => {
      const nodes = [];
      const segments = [];
      const activeRows = group.rows
        .slice()
        .sort((a, b) => a.route_order - b.route_order)
        .filter((row) => !normalizeResult(row.result));
      for (const row of activeRows) {
        const segment = Array.isArray(row.route_nodes) ? row.route_nodes : [];
        const normalizedSegment = [];
        for (const node of segment) {
          const normalized = { id: Number(node.id), name: String(node.name || node.id) };
          if (!normalizedSegment.length || normalizedSegment[normalizedSegment.length - 1].id !== normalized.id) {
            normalizedSegment.push(normalized);
          }
          if (!nodes.length || nodes[nodes.length - 1].id !== normalized.id) {
            nodes.push(normalized);
          }
        }
        if (normalizedSegment.length) segments.push(normalizedSegment);
      }
      return {
        id: group.id,
        name: group.name,
        color: group.color,
        nodes,
        segments,
        targetIds: new Set(activeRows.map((row) => {
          const segment = Array.isArray(row.route_nodes) ? row.route_nodes : [];
          const last = segment[segment.length - 1];
          return last ? Number(last.id) : -1;
        }))
      };
    });

    const visibleRoutes = fleetFilterEnabled
      ? routes.filter((route) => !state.hiddenFleetIds.has(route.id))
      : routes;
    routeMapView.render(
      visibleRoutes,
      visibleRoutes.length ? "Активных участков маршрута не осталось." : "Все флоты скрыты фильтром."
    );
    els.routeLegend.innerHTML = [...groups.values()].map((group) => `
      ${fleetFilterEnabled ? `<label class="route-legend-item route-legend-filter" title="Показать или скрыть флот «${escapeHtml(group.name)}» на карте">
        <input class="route-legend-toggle" type="checkbox" data-fleet-visibility="${escapeHtml(group.id)}" ${state.hiddenFleetIds.has(group.id) ? "" : "checked"} aria-label="Показывать флот «${escapeHtml(group.name)}» на карте" />` : '<span class="route-legend-item">'}
        <span class="route-legend-swatch" style="--fleet-color:${safeColor(group.color)}"></span>
        <span class="route-legend-name">${escapeHtml(group.name)}</span>
      ${fleetFilterEnabled ? "</label>" : "</span>"}
    `).join("");
    const activeCount = rows.filter((row) => !normalizeResult(row.result)).length;
    const visibleFleetIds = new Set(visibleRoutes.map((route) => route.id));
    const visibleActiveCount = rows.filter((row) =>
      !normalizeResult(row.result) && visibleFleetIds.has(String(row.fleet_id))
    ).length;
    const routeSummary = state.hiddenFleetIds.size && fleetFilterEnabled
      ? `Назначено целей: ${rows.length}. На карте показано: ${visibleActiveCount} из ${activeCount} активных.`
      : `Назначено целей: ${rows.length}. На карте осталось: ${activeCount}.`;
    els.routeWorkspaceHint.textContent = adminViewEnabled && state.lastPlanMetrics
      ? `${routeSummary} ${formatPlanMetrics(state.lastPlanMetrics)}.`
      : routeSummary;
    renderFleetRouteRows(rows);
  }

  function handleRouteLegendChange(event) {
    const toggle = event.target.closest("input[data-fleet-visibility]");
    if (!toggle || state.mapMode !== "fleet") return;
    const fleetId = String(toggle.dataset.fleetVisibility || "");
    if (!fleetId) return;
    if (toggle.checked) state.hiddenFleetIds.delete(fleetId);
    else state.hiddenFleetIds.add(fleetId);
    renderFleetRoutes(state.routeRows, els.routeWorkspaceTitle.textContent || "Все флоты");
  }

  function renderFleetRouteRows(rows) {
    const sorted = sortFleetRouteRows(rows, state.routeTableSort.fleet);
    els.routeList.innerHTML = `
      <div class="route-table-wrap">
        <table class="route-table">
          ${renderRouteTableHead(true, state.routeTableSort.fleet)}
          <tbody>
            ${sorted.map((row) => {
              const marginMs = new Date(row.end_at).getTime() - new Date(row.eta_at).getTime();
              const result = normalizeResult(row.result);
              return `
                <tr class="route-list-row ${marginMs < 0 ? "is-late" : ""}" data-timer-id="${escapeHtml(row.timer_id)}" data-fleet-id="${escapeHtml(row.fleet_id)}">
                  <td class="route-list-order">${Number(row.route_order)}</td>
                  <td><span class="route-fleet-cell"><span class="route-legend-swatch" style="--fleet-color:${safeColor(row.fleet_color || "#27a7d8")}"></span>${escapeHtml(row.fleet_name)}</span></td>
                  ${renderCopyableSystemCell(row.timer_system)}
                  <td>${routeValue(row.object_name)}</td>
                  <td>${routeValue(row.structure)}</td>
                  <td>${routeValue(row.corporation)}</td>
                  <td>${routeValue(row.alliance)}</td>
                  <td>${routeValue(row.mode)}</td>
                  <td>${renderTimerKind(row.timer_kind)}</td>
                  <td>${escapeHtml(formatJumpCount(row.jump_count))}</td>
                  <td class="route-time-cell">${escapeHtml(formatUtc(row.eta_at))}</td>
                  <td class="route-time-cell">${escapeHtml(formatUtc(row.end_at))}</td>
                  ${renderRouteCountdownCell(row.end_at)}
                  <td class="route-margin ${marginMs >= 0 ? "is-positive" : "is-negative"}">${escapeHtml(formatSignedDuration(marginMs))}</td>
                  <td>${renderRouteArrivalStatus(marginMs)}</td>
                  <td><div class="route-result-summary">${renderRouteResultControl(row, result)}</div></td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
    updateRouteCountdowns();
  }

  function renderRouteTableHead(showFleet, sort) {
    const columns = [
      ["order", "№"],
      ...(showFleet ? [["fleet", "Флот"]] : []),
      ["system", "Система"],
      ["object_name", "Объект"],
      ["structure", "Структура"],
      ["corporation", "Корпорация"],
      ["alliance", "Альянс"],
      ["mode", "Режим"],
      ["timer_kind", "Таймер"],
      ["jumps", "Прыжки"],
      ["eta", "ETA, EVE/UTC"],
      ["end_at", "Укреплён до, EVE/UTC"],
      ["remaining", "До таймера"],
      ["margin", "Запас"],
      ["status", "Статус"],
      ["result", "Итог"]
    ];
    return `<thead><tr>${columns.map(([key, label]) => {
      const active = sort.key === key;
      const ariaSort = active ? sort.direction === "desc" ? "descending" : "ascending" : "none";
      return `<th data-route-sort-key="${key}" aria-sort="${ariaSort}"><button class="table-sort-button" type="button">${label}</button></th>`;
    }).join("")}</tr></thead>`;
  }

  function renderCopyableSystemCell(system) {
    const value = String(system || "").trim();
    if (!value) return '<td class="route-list-system">—</td>';
    const escaped = escapeHtml(value);
    return `<td class="route-list-system copyable-system" data-copy-system="${escaped}" tabindex="0" role="button" title="Нажмите, чтобы скопировать название системы" aria-label="Скопировать систему ${escaped}">${escaped}</td>`;
  }

  function renderRouteCountdownCell(endAt) {
    return `<td class="route-time-cell route-countdown" data-route-countdown="${escapeHtml(endAt)}">${escapeHtml(formatCountdown(new Date(endAt).getTime() - Date.now()))}</td>`;
  }

  function updateRouteCountdowns() {
    els.routeList.querySelectorAll("[data-route-countdown]").forEach((cell) => {
      const remainingMs = new Date(cell.dataset.routeCountdown || "").getTime() - Date.now();
      cell.textContent = formatCountdown(remainingMs);
      cell.classList.toggle("is-soon", remainingMs > 0 && remainingMs <= 4 * 60 * 60 * 1000);
      cell.classList.toggle("is-expired", remainingMs <= 0);
    });
  }

  function routeValue(value) {
    return escapeHtml(String(value || "").trim() || "—");
  }

  function renderTimerKind(value) {
    const kind = String(value || "").trim();
    if (!kind) return '<span class="route-list-meta">—</span>';
    const className = /^атака$/i.test(kind)
      ? "is-attack-kind"
      : /^оборона$/i.test(kind)
        ? "is-defense-kind"
        : "";
    return `<span class="timer-kind-badge ${className}">${escapeHtml(kind)}</span>`;
  }

  function renderRouteArrivalStatus(marginMs) {
    return marginMs >= 0
      ? '<span class="route-arrival-status is-on-time">Вовремя</span>'
      : '<span class="route-arrival-status is-delayed">Опоздание</span>';
  }

  function renderReadonlyResult(value) {
    const result = normalizeResult(value);
    return result
      ? `<span class="result-badge ${resultClass(result)}">${escapeHtml(result)}</span>`
      : '<span class="route-list-meta">Не поставлен</span>';
  }

  function renderRouteResultControl(row, result) {
    if (!canEditFleetRouteResult(row)) {
      return result
        ? `<span class="result-badge ${resultClass(result)}">${escapeHtml(result)}</span>`
        : '<span class="route-list-meta">Итог не поставлен</span>';
    }

    return `
      <div class="result-actions route-result-actions">
        <button class="result-action-btn is-defended-result ${result === "Защищена" ? "is-selected-result" : ""}" type="button" data-route-result="Защищена">Защищена</button>
        <button class="result-action-btn is-destroyed-result ${result === "Уничтожена" ? "is-selected-result" : ""}" type="button" data-route-result="Уничтожена">Уничтожена</button>
        <button class="result-action-btn result-reset-btn" type="button" data-route-result="" ${result ? "" : "disabled"}>Сброс</button>
      </div>`;
  }

  function canEditFleetRouteResult(row) {
    return !adminViewEnabled &&
      Boolean(state.selectedFleetKey) &&
      String(row.fleet_id) === String(state.selectedFleetId);
  }

  function handleRouteListClick(event) {
    const sortHeader = event.target.closest("th[data-route-sort-key]");
    if (sortHeader) {
      const mode = sortHeader.closest(".route-table-general") ? "general" : "fleet";
      const current = state.routeTableSort[mode];
      const key = sortHeader.dataset.routeSortKey;
      state.routeTableSort[mode] = current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" };
      if (mode === "general" && state.generalPlan) {
        renderGeneralCandidates(
          state.generalPlan.candidates,
          state.generalPlan.recommended,
          state.generalPlan.secondsPerJump,
          state.generalPlan.serviceMinutes
        );
      } else if (mode === "fleet") {
        renderFleetRouteRows(state.routeRows);
      }
      return;
    }
    const systemCell = event.target.closest("[data-copy-system]");
    if (systemCell) {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        copyRouteSystem(systemCell);
      }
      return;
    }
    handleRouteResultAction(event);
  }

  function handleRouteListKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const systemCell = event.target.closest("[data-copy-system]");
    if (!systemCell) return;
    event.preventDefault();
    copyRouteSystem(systemCell);
  }

  async function copyRouteSystem(cell) {
    const system = String(cell.dataset.copySystem || "").trim();
    if (!system) return;

    const copied = await copyTextToClipboard(system);
    cell.classList.remove("is-copied", "is-copy-failed");
    cell.classList.add(copied ? "is-copied" : "is-copy-failed");
    window.setTimeout(() => {
      cell.classList.remove("is-copied", "is-copy-failed");
    }, 900);
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

  async function handleRouteResultAction(event) {
    const button = event.target.closest("button[data-route-result]");
    if (!button) return;
    const routeRow = button.closest(".route-list-row[data-timer-id]");
    if (!routeRow) return;
    const row = state.routeRows.find((item) =>
      String(item.timer_id) === String(routeRow.dataset.timerId) &&
      String(item.fleet_id) === String(routeRow.dataset.fleetId)
    );
    if (!row || !canEditFleetRouteResult(row)) return;

    const selectedResult = normalizeResult(button.dataset.routeResult);
    const nextResult = selectedResult && normalizeResult(row.result) === selectedResult ? "" : selectedResult;
    const group = button.closest(".result-actions");
    if (group) group.querySelectorAll("button").forEach((item) => { item.disabled = true; });

    try {
      const { data, error } = await db.setFleetTimerResult(
        BOARD_ID,
        getReadKey(),
        state.selectedFleetKey,
        state.selectedFleetId,
        row.timer_id,
        nextResult,
        row.timer_updated_at
      );
      if (error) throw error;
      if (!data) throw new Error("set_fleet_timer_result returned no timer");
      state.routeRows = state.routeRows.map((item) =>
        String(item.timer_id) === String(row.timer_id) && String(item.fleet_id) === String(row.fleet_id)
          ? { ...item, result: data.note || "", timer_updated_at: data.updated_at }
          : item
      );
      const fleet = state.fleets.find((item) => String(item.fleet_id) === String(state.selectedFleetId));
      renderFleetRoutes(state.routeRows, fleet ? fleet.fleet_name : "Флот");
      setLine(els.fleetLoginStatus, nextResult ? `Итог «${nextResult}» сохранён.` : "Итог сброшен.", false);
      appController.emit(APP_EVENTS.ROUTE_RESULT_UPDATED, {
        timerId: String(row.timer_id),
        result: data.note || "",
        completedAt: data.completed_at || null,
        updatedAt: data.updated_at
      });
    } catch (err) {
      if (isTimerUpdateConflict(err)) {
        setLine(els.fleetLoginStatus, "Итог уже изменён в другом окне. Маршрут обновлён, повторите действие при необходимости.", true);
        await reloadCurrentRoute();
        return;
      }
      setLine(els.fleetLoginStatus, `Ошибка итога: ${friendlyError(err)}`, true);
      const fleet = state.fleets.find((item) => String(item.fleet_id) === String(state.selectedFleetId));
      renderFleetRoutes(state.routeRows, fleet ? fleet.fleet_name : "Флот");
    }
  }

  function publishFleetBoardAccess(fleetId, fleetKey, rows) {
    state.boardAccessFleetId = fleetId || "";
    appController.emit(APP_EVENTS.FLEET_BOARD_ACCESS, fleetId && fleetKey ? {
        fleetId,
        fleetKey,
        timerIds: (rows || []).map((row) => String(row.timer_id))
      } : null
    );
  }

  async function reloadCurrentRoute() {
    try {
      if (state.mapMode === "general") {
        if (els.generalOriginSystem.value.trim()) await buildGeneralRoute();
        return;
      }
      if (adminViewEnabled) {
        await loadAdminFleets();
        await loadAllFleetRoutes();
      } else if (state.selectedFleetId && state.selectedFleetKey) {
        els.fleetLoginSelect.value = state.selectedFleetId;
        els.fleetLoginKey.value = state.selectedFleetKey;
        await openSelectedFleetRoute();
      } else {
        await loadPublicFleets();
      }
    } catch (err) {
      const statusElement = adminViewEnabled ? els.fleetAdminStatus : els.fleetLoginStatus;
      setLine(statusElement, friendlyError(err), true);
    }
  }

  async function loadTimersForRoutes(accessKey) {
    const { data, error } = await db.getTimers(BOARD_ID, accessKey);
    if (error) throw error;
    return data || [];
  }

  function activeRouteTargets(timers, filters = {}) {
    const now = Date.now();
    const seen = new Set();
    const timerKinds = normalizedFilterSelection(filters, "timerKinds", "timerKind", "timerKindsAll");
    const objectNames = normalizedFilterSelection(filters, "objectNames", "objectName", "objectNamesAll");
    return timers.filter((timer) => {
      const key = timer.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return !normalizeResult(timer.note) &&
        String(timer.system || "").trim() &&
        (timerKinds.all || timerKinds.values.has(normalizeName(timer.distance))) &&
        (objectNames.all || objectNames.values.has(normalizeName(timer.object_name))) &&
        new Date(timer.end_at).getTime() > now;
    });
  }

  function readRouteFilters(timerKindControl, objectControl) {
    const timerKinds = readFilterControl(timerKindControl);
    const objectNames = readFilterControl(objectControl);
    return {
      timerKinds: timerKinds.values,
      timerKindsAll: timerKinds.all,
      objectNames: objectNames.values,
      objectNamesAll: objectNames.all
    };
  }

  function describeRouteFilters(filters = {}) {
    const timerKinds = normalizedFilterSelection(filters, "timerKinds", "timerKind", "timerKindsAll");
    const objectNames = normalizedFilterSelection(filters, "objectNames", "objectName", "objectNamesAll");
    const parts = [];
    if (!timerKinds.all) parts.push(describeFilterSelection(timerKinds, "таймеры не выбраны", "типа таймера"));
    if (!objectNames.all) parts.push(describeFilterSelection(objectNames, "объекты не выбраны", "типов объектов"));
    return parts.length ? parts.join(" · ") : "все таймеры и объекты";
  }

  function initMultiFilter(filter) {
    if (!filter || filter.tagName !== "DETAILS") return;
    filter.addEventListener("change", (event) => {
      if (event.target.matches('input[type="checkbox"]')) updateMultiFilterSummary(filter);
    });
    filter.addEventListener("click", (event) => {
      const action = event.target.closest("[data-filter-action]");
      if (!action) return;
      const checked = action.dataset.filterAction === "all";
      for (const checkbox of filter.querySelectorAll('input[type="checkbox"]')) {
        checkbox.checked = checked;
      }
      updateMultiFilterSummary(filter);
    });
    updateMultiFilterSummary(filter);
  }

  function updateMultiFilterSummary(filter) {
    const summary = filter.querySelector("[data-filter-summary]");
    if (!summary) return;
    const checkboxes = Array.from(filter.querySelectorAll('input[type="checkbox"]'));
    const selected = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
    const allSelected = checkboxes.length > 0 && selected.length === checkboxes.length;
    let label = filter.dataset.emptyLabel || "Ничего не выбрано";
    if (allSelected) label = filter.dataset.allLabel || "Выбрано всё";
    else if (selected.length <= 2 && selected.length > 0) label = selected.join(" + ");
    else if (selected.length > 2) label = `${selected.length} ${filter.dataset.countLabel || "выбрано"}`;
    summary.textContent = label;
    summary.title = selected.length ? selected.join(", ") : label;
  }

  function closeOtherMultiFilters(event) {
    for (const filter of [
      els.generalTimerKindFilter,
      els.generalObjectFilter,
      els.fleetTimerKindFilter,
      els.fleetObjectFilter
    ]) {
      if (filter && filter.open && !filter.contains(event.target)) filter.open = false;
    }
  }

  function closeMultiFiltersOnEscape(event) {
    if (event.key !== "Escape") return;
    for (const filter of [
      els.generalTimerKindFilter,
      els.generalObjectFilter,
      els.fleetTimerKindFilter,
      els.fleetObjectFilter
    ]) {
      if (filter && filter.open) filter.open = false;
    }
  }

  function readFilterControl(control) {
    if (!control) return { values: [], all: true };
    if (control.tagName === "DETAILS") {
      const checkboxes = Array.from(control.querySelectorAll('input[type="checkbox"]'));
      const values = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value.trim());
      return {
        values,
        all: checkboxes.length > 0 && values.length === checkboxes.length
      };
    }
    const value = String(control.value || "").trim();
    return { values: value ? [value] : [], all: !value };
  }

  function normalizedFilterSelection(filters, listKey, legacyKey, allKey) {
    const rawValues = Array.isArray(filters[listKey])
      ? filters[listKey]
      : filters[legacyKey]
        ? [filters[legacyKey]]
        : [];
    const labels = rawValues.map((value) => String(value || "").trim()).filter(Boolean);
    const values = new Set(labels.map(normalizeName).filter(Boolean));
    const all = typeof filters[allKey] === "boolean" ? filters[allKey] : values.size === 0;
    return { values, labels, all };
  }

  function describeFilterSelection(selection, emptyLabel, countLabel) {
    if (!selection.labels.length) return emptyLabel;
    if (selection.labels.length <= 2) return selection.labels.join(" + ");
    return `${selection.labels.length} ${countLabel}`;
  }

  async function loadSystemCatalog() {
    return systemCatalog.load();
  }

  async function requireSystemName(value, input) {
    const entered = String(value || "").trim();
    if (!entered) throw new Error("Укажите систему.");
    await loadSystemCatalog();
    const system = systemCatalog.findByName(entered);
    if (!system) {
      if (input) input.classList.add("is-invalid");
      throw new Error(`Система «${entered}» не найдена. Выберите существующую систему из подсказок.`);
    }
    if (input) input.classList.remove("is-invalid");
    return system.name;
  }

  async function resolveSystemNames(names) {
    return systemCatalog.resolveSystemNames(names);
  }

  async function resolveIdsToNames(ids) {
    return systemCatalog.resolveIdsToNames(ids);
  }

  async function getRoute(originId, destinationId) {
    return systemCatalog.getRoute(originId, destinationId);
  }

  function clearRouteWorkspace(message, clearText = true) {
    routeMapView.clear(message);
    els.routeLegend.innerHTML = "";
    els.routeList.innerHTML = "";
    if (clearText) {
      els.routeWorkspaceTitle.textContent = "Операционная карта";
      els.routeWorkspaceHint.textContent = message;
    }
  }

  function getAdminKey() {
    return els.adminKey ? els.adminKey.value.trim() : "";
  }

  function getReadKey() {
    if (adminViewEnabled && getAdminKey()) return getAdminKey();
    return els.viewKey ? els.viewKey.value.trim() : "";
  }

  function setLine(element, message, isError) {
    if (!element) return;
    element.textContent = message || "";
    element.className = `status-line ${isError ? "error" : message ? "ok" : ""}`;
  }

  function friendlyError(err) {
    const message = err && (err.message || err.details || err.hint)
      ? `${err.message || ""} ${err.details || ""} ${err.hint || ""}`.trim()
      : String(err || "Неизвестная ошибка");
    if (/wrong view key/i.test(message)) return "Неверный ключ просмотра.";
    if (/wrong fleet key/i.test(message)) return "Неверный ключ флота.";
    if (/fleet not found or inactive/i.test(message)) return "Флот не найден или выключен.";
    if (/wrong admin key/i.test(message)) return "Неверный главный админ-ключ.";
    if (/timer update conflict/i.test(message) || err?.code === "40001") return "Таймер уже изменён в другом окне.";
    if (/28000/i.test(message)) return "Неверный ключ доступа.";
    if (/duplicate key.*fleet_profiles|fleet_profiles_board_id_name/i.test(message)) return "Флот с таким названием уже существует.";
    if (/function .* does not exist|schema cache|list_fleets|create_fleet/i.test(message)) {
      return "В Supabase нужно выполнить актуальный supabase/schema.sql.";
    }
    if (/Failed to fetch|NetworkError/i.test(message)) return "Не удалось связаться с ESI или Supabase.";
    return message;
  }

  function isTimerUpdateConflict(err) {
    const message = err && (err.message || err.details) ? `${err.message || ""} ${err.details || ""}` : String(err || "");
    return err?.code === "40001" || /timer update conflict/i.test(message);
  }

  function normalizeResult(value) {
    const result = String(value || "").trim();
    return result === "Защищена" || result === "Уничтожена" ? result : "";
  }

  function normalizeFleetKeyInput(value) {
    const text = String(value || "").trim();
    const generatedKey = text.match(/(?:^|:\s*)([0-9a-f]{24})\s*$/i);
    return generatedKey ? generatedKey[1].toUpperCase() : text;
  }

  function resultClass(value) {
    const result = normalizeResult(value);
    if (result === "Защищена") return "is-defended-result";
    if (result === "Уничтожена") return "is-destroyed-result";
    return "";
  }

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function boundedNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function formatJumpCount(value) {
    const count = Math.max(0, Math.round(Number(value) || 0));
    return `${count} ${jumpWord(count)}`;
  }

  function jumpWord(value) {
    const count = Math.abs(Math.round(Number(value) || 0));
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return "прыжков";
    if (last === 1) return "прыжок";
    if (last >= 2 && last <= 4) return "прыжка";
    return "прыжков";
  }

  function formatSignedDuration(ms) {
    const sign = ms < 0 ? "−" : "+";
    const totalMinutes = Math.floor(Math.abs(ms) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return `${sign}${days ? `${days} д ` : ""}${pad(hours)}:${pad(minutes)}`;
  }

  function formatPlanMetrics(metrics) {
    const lateCount = Number(metrics && metrics.lateCount) || 0;
    const totalJumps = Number(metrics && metrics.totalJumps) || 0;
    const spreadMinutes = Math.round((Number(metrics && metrics.workloadSpreadMs) || 0) / 6000) / 10;
    const calculationMs = Number(metrics && metrics.calculationMs) || 0;
    const optimization = metrics && metrics.improved ? "v2 улучшил baseline" : "baseline сохранён";
    return `Опозданий: ${lateCount}, прыжков: ${totalJumps}, разброс нагрузки: ${spreadMinutes} мин, ${optimization}, расчёт: ${calculationMs} мс`;
  }

  function formatCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return days ? `${days} д ${clock}` : clock;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#27a7d8";
  }

  function formatSecurity(value) {
    const security = Number(value || 0);
    const rounded = security > 0 && security < 0.05 ? 0.1 : Math.round(security * 10) / 10;
    return rounded.toFixed(1);
  }

  function securityColor(value) {
    const security = Number(value || 0);
    if (security >= 0.5) return "#69aebf";
    if (security > 0) return "#b9a264";
    return "#9b6970";
  }

  window.EVE_FLEET_ROUTER = {
    activeRouteTargets,
    formatSignedDuration,
    normalizeName
  };
})();
