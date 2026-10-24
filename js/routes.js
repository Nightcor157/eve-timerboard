(function () {
  "use strict";

  const CONFIG = window.EVE_TIMERBOARD_CONFIG || {};
  const BOARD_ID = CONFIG.boardId || "main";
  let adminViewEnabled = document.body.classList.contains("is-admin-view");
  const ESI_BASE = "https://esi.evetech.net";
  const ESI_COMPATIBILITY_DATE = "2025-09-30";
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

  const hasSupabaseConfig = Boolean(
    CONFIG.supabaseUrl &&
    CONFIG.supabaseKey &&
    !String(CONFIG.supabaseUrl).includes("YOUR-PROJECT") &&
    !String(CONFIG.supabaseKey).includes("YOUR-SUPABASE") &&
    window.supabase
  );

  const db = hasSupabaseConfig
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey)
    : null;

  const state = {
    mapMode: "general",
    fleets: [],
    adminFleets: [],
    routeRows: [],
    hiddenFleetIds: new Set(),
    selectedFleetId: "",
    selectedFleetKey: "",
    boardAccessFleetId: "",
    generalPlan: null,
    routeCache: new Map(),
    nameCache: new Map(),
    idNameCache: new Map(),
    systemCatalog: [],
    systemById: new Map(),
    systemByName: new Map(),
    systemsByRegion: new Map(),
    regionById: new Map(),
    systemCatalogPromise: null,
    autocompleteInput: null,
    autocompleteItems: [],
    autocompleteIndex: -1,
    mapZoom: 1,
    mapViewX: 0,
    mapViewY: 0,
    mapSignature: "",
    mapDrag: null,
    mapResize: null,
    mapViewByMode: {
      general: { signature: "", zoom: 1, viewX: 0, viewY: 0 },
      fleet: { signature: "", zoom: 1, viewX: 0, viewY: 0 }
    },
    lastMapRoutes: null,
    loadingFleets: false
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

  init();

  function init() {
    els.generalOriginSystem.value = localStorage.getItem(GENERAL_ORIGIN_KEY) || "";
    els.generalServiceMinutes.value = localStorage.getItem(GENERAL_SERVICE_KEY) || "10";
    restoreRouteMapHeight();
    loadSystemCatalog().catch(() => {});
    bindSystemAutocomplete(els.generalOriginSystem);
    bindSystemAutocomplete(els.newFleetSystem);
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
    window.addEventListener("eve-timerboard:board-result-updated", () => {
      if (state.mapMode === "fleet") reloadCurrentRoute();
    });
    window.addEventListener("eve-timerboard:admin-view-changed", (event) => {
      adminViewEnabled = Boolean(event.detail && event.detail.enabled);
      if (adminViewEnabled) viewAccessGranted = true;
      updateRoutesAccess();
      setMapMode(state.mapMode);
      if (!els.routesView.hidden) loadRouteData();
    });
    window.addEventListener("eve-timerboard:view-access-changed", (event) => {
      viewAccessGranted = Boolean(event.detail && event.detail.granted);
      updateRoutesAccess();
    });
    els.routeZoomOutBtn.addEventListener("click", () => changeRouteZoom(-0.5));
    els.routeZoomResetBtn.addEventListener("click", resetRouteZoom);
    els.routeZoomInBtn.addEventListener("click", () => changeRouteZoom(0.5));
    els.routeMap.addEventListener("wheel", handleRouteMapWheel, { passive: false });
    els.routeMap.addEventListener("pointerdown", startRouteMapPan);
    els.routeMap.addEventListener("pointermove", moveRouteMapPan);
    els.routeMap.addEventListener("pointerup", stopRouteMapPan);
    els.routeMap.addEventListener("pointercancel", stopRouteMapPan);
    els.routeMapResizeHandle.addEventListener("pointerdown", startRouteMapResize);
    els.routeMapResizeHandle.addEventListener("pointermove", moveRouteMapResize);
    els.routeMapResizeHandle.addEventListener("pointerup", stopRouteMapResize);
    els.routeMapResizeHandle.addEventListener("pointercancel", stopRouteMapResize);
    els.routeMapResizeHandle.addEventListener("keydown", handleRouteMapResizeKeydown);
    window.addEventListener("resize", () => {
      if (!els.routesView.hidden && els.routeMap.querySelector(".route-map-stage svg")) applyRouteZoom();
    }, { passive: true });

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

  function applyHashView() {
    showMainView(window.location.hash === "#routes" ? "routes" : "board", false);
  }

  function handleRoutesTabClick(event) {
    if (!canOpenRoutes()) {
      event.preventDefault();
      showMainView("board");
      window.dispatchEvent(new CustomEvent("eve-timerboard:request-view-access"));
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
    if (state.mapViewByMode[state.mapMode].signature === state.mapSignature) {
      saveRouteViewport();
    }
    state.mapMode = mode;
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
    if (state.loadingFleets) return;
    state.loadingFleets = true;
    try {
      if (adminViewEnabled) {
        const adminKey = getAdminKey();
        if (!adminKey) {
          setLine(els.fleetAdminStatus, "Введи главный админ-ключ на вкладке доски.", true);
          return;
        }
        await loadAdminFleets();
        if (state.mapMode === "fleet") await loadAllFleetRoutes();
      } else {
        const readKey = getReadKey();
        if (!readKey) {
          setLine(els.fleetLoginStatus, "Сначала открой доску ключом просмотра.", true);
          return;
        }
        await loadPublicFleets();
      }
    } catch (err) {
      const message = friendlyError(err);
      setLine(els.fleetLoginStatus, message, true);
      setLine(els.fleetAdminStatus, message, true);
    } finally {
      state.loadingFleets = false;
    }
  }

  async function loadPublicFleets() {
    const { data, error } = await db.rpc("list_fleets", {
      p_board_id: BOARD_ID,
      p_view_key: getReadKey()
    });
    if (error) throw error;
    state.fleets = data || [];
    renderFleetSelect();
    setLine(els.fleetLoginStatus, state.fleets.length ? "" : "Активных флотов пока нет.", false);
  }

  async function loadAdminFleets() {
    const { data, error } = await db.rpc("list_fleets_admin", {
      p_board_id: BOARD_ID,
      p_admin_key: getAdminKey()
    });
    if (error) throw error;
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
    hideSystemSuggestions();
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
    els.fleetProfilesList.querySelectorAll('input[data-field="system"]').forEach(bindSystemAutocomplete);
  }

  async function createFleet() {
    hideSystemSuggestions();
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
      const { data, error } = await db.rpc("create_fleet", {
        p_board_id: BOARD_ID,
        p_admin_key: adminKey,
        p_name: name,
        p_color: els.newFleetColor.value,
        p_current_system: system,
        p_seconds_per_jump: boundedNumber(els.newFleetSecondsPerJump.value, 5, 3600, 60),
        p_service_minutes: boundedNumber(els.newFleetServiceMinutes.value, 0, 240, 10)
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
    hideSystemSuggestions();
    button.disabled = true;
    try {
      const draft = await readFleetDraft(row, fleetId);
      const { error } = await db.rpc("update_fleet", {
        p_board_id: BOARD_ID,
        p_admin_key: getAdminKey(),
        p_fleet_id: fleetId,
        p_name: draft.name,
        p_color: draft.color,
        p_current_system: draft.current_system,
        p_seconds_per_jump: draft.seconds_per_jump,
        p_service_minutes: draft.service_minutes,
        p_active: draft.active
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
      const { error } = await db.rpc("update_fleet", {
        p_board_id: BOARD_ID,
        p_admin_key: getAdminKey(),
        p_fleet_id: fleetId,
        p_name: draft.name,
        p_color: draft.color,
        p_current_system: draft.current_system,
        p_seconds_per_jump: draft.seconds_per_jump,
        p_service_minutes: draft.service_minutes,
        p_active: draft.active
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
      const { data, error } = await db.rpc("rotate_fleet_key", {
        p_board_id: BOARD_ID,
        p_admin_key: getAdminKey(),
        p_fleet_id: fleetId
      });
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
      const { error } = await db.rpc("delete_fleet", {
        p_board_id: BOARD_ID,
        p_admin_key: getAdminKey(),
        p_fleet_id: fleetId
      });
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
    hideSystemSuggestions();
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

      const fleetStates = fleets.map((fleet) => {
        const system = resolved.get(normalizeName(fleet.current_system));
        if (!system) throw new Error(`Система флота не найдена в каталоге EVE: ${fleet.current_system}`);
        return {
          fleet,
          currentId: system.id,
          availableAt: Date.now(),
          order: 0
        };
      });

      const assignments = [];
      const sortedTargets = targets.slice().sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
      for (let index = 0; index < sortedTargets.length; index += 1) {
        const timer = sortedTargets[index];
        setLine(
          els.fleetAdminStatus,
          `Расчёт цели ${index + 1} из ${sortedTargets.length}: ${timer.system}…`,
          false
        );
        const targetSystem = resolved.get(normalizeName(timer.system));
        if (!targetSystem) throw new Error(`Система таймера не найдена в каталоге EVE: ${timer.system}`);

        const options = await Promise.all(fleetStates.map((fleetState) =>
          calculateFleetTargetOption(fleetState, targetSystem, timer)
        ));

        options.sort((a, b) => {
          if (Boolean(a.lateness) !== Boolean(b.lateness)) return a.lateness ? 1 : -1;
          if (a.lateness !== b.lateness) return a.lateness - b.lateness;
          if (a.arrivalAt !== b.arrivalAt) return a.arrivalAt - b.arrivalAt;
          return a.jumps - b.jumps;
        });

        const best = options[0];
        best.fleetState.order += 1;
        assignments.push({
          fleet_id: best.fleetState.fleet.fleet_id,
          timer_id: timer.id,
          route_order: best.fleetState.order,
          jump_count: best.jumps,
          eta_at: new Date(best.arrivalAt).toISOString(),
          route_ids: best.routeIds
        });

        advanceFleetState(best, targetSystem, timer);
      }

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

      const { data, error } = await db.rpc("replace_fleet_assignments", {
        p_board_id: BOARD_ID,
        p_admin_key: getAdminKey(),
        p_assignments: payload
      });
      if (error) throw error;
      setLine(
        els.fleetAdminStatus,
        `Маршруты рассчитаны. Фильтр: ${describeRouteFilters(filters)}. Назначено целей: ${Number(data || payload.length)}.`,
        false
      );
      await loadAllFleetRoutes();
    } catch (err) {
      setLine(els.fleetAdminStatus, `Расчёт не сохранён: ${friendlyError(err)}`, true);
    } finally {
      els.calculateFleetRoutesBtn.disabled = false;
    }
  }

  async function calculateFleetTargetOption(fleetState, targetSystem, timer) {
    const routeIds = await getRoute(fleetState.currentId, targetSystem.id);
    const jumps = Math.max(0, routeIds.length - 1);
    const arrivalAt = fleetState.availableAt + jumps * Number(fleetState.fleet.seconds_per_jump) * 1000;
    const deadline = new Date(timer.end_at).getTime();
    return {
      fleetState,
      routeIds,
      jumps,
      arrivalAt,
      lateness: Math.max(0, arrivalAt - deadline)
    };
  }

  function advanceFleetState(option, targetSystem, timer) {
    const deadline = new Date(timer.end_at).getTime();
    option.fleetState.availableAt = Math.max(option.arrivalAt, deadline) +
      Number(option.fleetState.fleet.service_minutes) * 60 * 1000;
    option.fleetState.currentId = targetSystem.id;
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

    els.buildGeneralRouteBtn.disabled = true;
    setLine(els.generalRouteStatus, "Сравниваю активные таймеры…", false);
    try {
      const origin = await requireSystemName(enteredOrigin, els.generalOriginSystem);
      els.generalOriginSystem.value = origin;
      const timers = await loadTimersForRoutes(readKey);
      const filters = readRouteFilters(els.generalTimerKindFilter, els.generalObjectFilter);
      const targets = activeRouteTargets(timers, filters);
      if (!targets.length) {
        throw new Error(`Нет будущих активных таймеров под фильтр «${describeRouteFilters(filters)}».`);
      }

      const resolved = await resolveSystemNames([origin, ...targets.map((timer) => timer.system)]);
      const originSystem = resolved.get(normalizeName(origin));
      if (!originSystem) throw new Error(`Система не найдена в каталоге EVE: ${origin}`);

      const fleetState = {
        fleet: {
          seconds_per_jump: secondsPerJump,
          service_minutes: serviceMinutes
        },
        currentId: originSystem.id,
        availableAt: Date.now(),
        order: 0
      };
      const candidates = [];
      const sortedTargets = targets.slice().sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
      for (let index = 0; index < sortedTargets.length; index += 1) {
        const timer = sortedTargets[index];
        setLine(
          els.generalRouteStatus,
          `Расчёт цели ${index + 1} из ${sortedTargets.length}: ${timer.system}…`,
          false
        );
        const targetSystem = resolved.get(normalizeName(timer.system));
        if (!targetSystem) throw new Error(`Система таймера не найдена в каталоге EVE: ${timer.system}`);
        const option = await calculateFleetTargetOption(fleetState, targetSystem, timer);
        fleetState.order += 1;
        candidates.push({
          timer,
          targetSystem,
          routeIds: option.routeIds,
          jumps: option.jumps,
          eta: option.arrivalAt,
          marginMs: new Date(timer.end_at).getTime() - option.arrivalAt
        });
        advanceFleetState(option, targetSystem, timer);
      }

      if (!candidates.length) throw new Error("Не удалось построить путь ни к одной цели.");
      const recommended = candidates[0];
      const allRouteIds = [...new Set(candidates.flatMap((candidate) => candidate.routeIds))];
      const names = await resolveIdsToNames(allRouteIds);
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
      setLine(els.generalRouteStatus, friendlyError(err), true);
    } finally {
      els.buildGeneralRouteBtn.disabled = false;
    }
  }

  function renderGeneralPlan(plan) {
    renderRouteMap(plan.routes);
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
          ${renderRouteTableHead(false)}
          <tbody>
            ${candidates.map((candidate, index) => `
              <tr class="route-list-row ${candidate.marginMs < 0 ? "is-late" : ""}">
                <td class="route-list-order">${index + 1}</td>
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
    const saved = localStorage.getItem(FLEET_KEY_PREFIX + fleetId) || "";
    els.fleetLoginKey.value = saved;
    els.rememberFleetKey.checked = Boolean(saved);
  }

  function rememberCurrentFleetKey() {
    const fleetId = els.fleetLoginSelect.value;
    if (!fleetId) return;
    if (els.rememberFleetKey.checked && els.fleetLoginKey.value.trim()) {
      localStorage.setItem(FLEET_KEY_PREFIX + fleetId, els.fleetLoginKey.value.trim());
    } else {
      localStorage.removeItem(FLEET_KEY_PREFIX + fleetId);
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

    els.openFleetRouteBtn.disabled = true;
    try {
      const { data, error } = await db.rpc("get_fleet_route", {
        p_board_id: BOARD_ID,
        p_view_key: getReadKey(),
        p_fleet_id: fleetId,
        p_fleet_key: fleetKey
      });
      if (error) throw error;
      state.selectedFleetId = fleetId;
      state.selectedFleetKey = fleetKey;
      state.routeRows = data || [];
      publishFleetBoardAccess(fleetId, fleetKey, state.routeRows);
      rememberCurrentFleetKey();
      const fleet = state.fleets.find((item) => item.fleet_id === fleetId);
      renderFleetRoutes(state.routeRows, fleet ? fleet.fleet_name : "Флот");
      setLine(els.fleetLoginStatus, "Маршрут открыт. Итог можно поставить прямо в строке цели или на доске.", false);
    } catch (err) {
      state.selectedFleetKey = "";
      publishFleetBoardAccess("", "", []);
      setLine(els.fleetLoginStatus, friendlyError(err), true);
    } finally {
      els.openFleetRouteBtn.disabled = false;
    }
  }

  async function loadAllFleetRoutes() {
    if (!getAdminKey()) return;
    const { data, error } = await db.rpc("get_all_fleet_routes", {
      p_board_id: BOARD_ID,
      p_admin_key: getAdminKey()
    });
    if (error) throw error;
    state.routeRows = data || [];
    renderFleetRoutes(state.routeRows, "Все флоты");
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
    renderRouteMap(
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
    els.routeWorkspaceHint.textContent = state.hiddenFleetIds.size && fleetFilterEnabled
      ? `Назначено целей: ${rows.length}. На карте показано: ${visibleActiveCount} из ${activeCount} активных.`
      : `Назначено целей: ${rows.length}. На карте осталось: ${activeCount}.`;
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
    const sorted = rows.slice().sort((a, b) => String(a.fleet_name).localeCompare(String(b.fleet_name), "ru") || a.route_order - b.route_order);
    els.routeList.innerHTML = `
      <div class="route-table-wrap">
        <table class="route-table">
          ${renderRouteTableHead(true)}
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

  function renderRouteTableHead(showFleet) {
    return `
      <thead>
        <tr>
          <th>№</th>
          ${showFleet ? "<th>Флот</th>" : ""}
          <th>Система</th>
          <th>Объект</th>
          <th>Структура</th>
          <th>Корпорация</th>
          <th>Альянс</th>
          <th>Режим</th>
          <th>Таймер</th>
          <th>Прыжки</th>
          <th>ETA, EVE/UTC</th>
          <th>Укреплён до, EVE/UTC</th>
          <th>До таймера</th>
          <th>Запас</th>
          <th>Статус</th>
          <th>Итог</th>
        </tr>
      </thead>`;
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
      const { error } = await db.rpc("set_fleet_timer_result", {
        p_board_id: BOARD_ID,
        p_view_key: getReadKey(),
        p_access_key: state.selectedFleetKey,
        p_fleet_id: state.selectedFleetId,
        p_timer_id: row.timer_id,
        p_result: nextResult
      });
      if (error) throw error;
      state.routeRows = state.routeRows.map((item) =>
        String(item.timer_id) === String(row.timer_id) && String(item.fleet_id) === String(row.fleet_id)
          ? { ...item, result: nextResult }
          : item
      );
      const fleet = state.fleets.find((item) => String(item.fleet_id) === String(state.selectedFleetId));
      renderFleetRoutes(state.routeRows, fleet ? fleet.fleet_name : "Флот");
      setLine(els.fleetLoginStatus, nextResult ? `Итог «${nextResult}» сохранён.` : "Итог сброшен.", false);
      window.dispatchEvent(new CustomEvent("eve-timerboard:route-result-updated", {
        detail: { timerId: String(row.timer_id), result: nextResult }
      }));
    } catch (err) {
      setLine(els.fleetLoginStatus, `Ошибка итога: ${friendlyError(err)}`, true);
      const fleet = state.fleets.find((item) => String(item.fleet_id) === String(state.selectedFleetId));
      renderFleetRoutes(state.routeRows, fleet ? fleet.fleet_name : "Флот");
    }
  }

  function publishFleetBoardAccess(fleetId, fleetKey, rows) {
    state.boardAccessFleetId = fleetId || "";
    window.dispatchEvent(new CustomEvent("eve-timerboard:fleet-board-access", {
      detail: fleetId && fleetKey ? {
        fleetId,
        fleetKey,
        timerIds: (rows || []).map((row) => String(row.timer_id))
      } : null
    }));
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
    const { data, error } = await db.rpc("get_timers", {
      p_board_id: BOARD_ID,
      p_view_key: accessKey
    });
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
    if (state.systemCatalog.length) return state.systemCatalog;
    if (state.systemCatalogPromise) return state.systemCatalogPromise;
    state.systemCatalogPromise = Promise.all([
      fetch(SYSTEM_CATALOG_URL).then((response) => {
        if (!response.ok) throw new Error(`Каталог систем не загрузился: HTTP ${response.status}`);
        return response.json();
      }),
      fetch(REGION_CATALOG_URL)
        .then((response) => response.ok ? response.json() : { regions: [] })
        .catch(() => ({ regions: [] }))
    ])
      .then(([payload, regionPayload]) => {
        const systems = Array.isArray(payload.systems) ? payload.systems : [];
        if (!systems.length) throw new Error("Каталог систем пуст.");
        const regions = Array.isArray(regionPayload.regions) ? regionPayload.regions : [];
        regions.forEach((region) => {
          const id = Number(region.id);
          if (id && region.name) state.regionById.set(id, String(region.name));
        });
        state.systemCatalog = systems;
        for (const system of systems) {
          const normalized = {
            ...system,
            id: Number(system.id),
            x: Number(system.x),
            y: Number(system.y),
            security: Number(system.security || 0),
            regionId: Number(system.regionId || 0),
            neighbors: Array.isArray(system.neighbors) ? system.neighbors.map(Number) : []
          };
          state.systemById.set(normalized.id, normalized);
          state.systemByName.set(normalizeName(normalized.name), normalized);
          if (!state.systemsByRegion.has(normalized.regionId)) {
            state.systemsByRegion.set(normalized.regionId, []);
          }
          state.systemsByRegion.get(normalized.regionId).push(normalized);
          state.nameCache.set(normalizeName(normalized.name), { id: normalized.id, name: normalized.name });
          state.idNameCache.set(normalized.id, normalized.name);
        }
        return state.systemCatalog;
      });
    return state.systemCatalogPromise;
  }

  async function requireSystemName(value, input) {
    const entered = String(value || "").trim();
    if (!entered) throw new Error("Укажите систему.");
    await loadSystemCatalog();
    const system = state.systemByName.get(normalizeName(entered));
    if (!system) {
      if (input) input.classList.add("is-invalid");
      throw new Error(`Система «${entered}» не найдена. Выберите существующую систему из подсказок.`);
    }
    if (input) input.classList.remove("is-invalid");
    return system.name;
  }

  function bindSystemAutocomplete(input) {
    if (!input || input.dataset.systemAutocompleteBound === "1") return;
    input.dataset.systemAutocompleteBound = "1";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.addEventListener("input", () => {
      input.classList.remove("is-invalid");
      showSystemSuggestions(input);
    });
    input.addEventListener("focus", () => showSystemSuggestions(input));
    input.addEventListener("keydown", handleSystemSuggestionKeydown);
    input.addEventListener("blur", () => window.setTimeout(() => {
      if (state.autocompleteInput === input) hideSystemSuggestions();
    }, 120));
  }

  function getSystemSuggestionList() {
    let list = document.getElementById("systemSuggestionList");
    if (list) return list;
    list = document.createElement("div");
    list.id = "systemSuggestionList";
    list.className = "system-suggestions";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    list.addEventListener("mousedown", (event) => {
      const option = event.target.closest("button[data-suggestion-index]");
      if (!option) return;
      event.preventDefault();
      chooseSystemSuggestion(Number(option.dataset.suggestionIndex));
    });
    document.body.appendChild(list);
    window.addEventListener("resize", positionSystemSuggestionList);
    window.addEventListener("scroll", positionSystemSuggestionList, true);
    return list;
  }

  async function showSystemSuggestions(input) {
    state.autocompleteInput = input;
    const term = normalizeName(input.value);
    if (!term) {
      hideSystemSuggestions();
      return;
    }
    try {
      await loadSystemCatalog();
    } catch (_err) {
      hideSystemSuggestions();
      return;
    }
    if (state.autocompleteInput !== input) return;
    const prefix = [];
    const contains = [];
    for (const system of state.systemCatalog) {
      const name = normalizeName(system.name);
      if (name.startsWith(term)) prefix.push(system);
      else if (name.includes(term)) contains.push(system);
      if (prefix.length >= 10) break;
    }
    state.autocompleteItems = prefix.concat(contains).slice(0, 10);
    state.autocompleteIndex = -1;
    const list = getSystemSuggestionList();
    if (!state.autocompleteItems.length) {
      list.innerHTML = '<div class="system-suggestion-empty">Система не найдена</div>';
    } else {
      list.innerHTML = state.autocompleteItems.map((system, index) => `
        <button type="button" role="option" data-suggestion-index="${index}">
          <strong>${escapeHtml(system.name)}</strong>
          <span>${formatSecurity(system.security)}</span>
        </button>
      `).join("");
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    positionSystemSuggestionList();
  }

  function handleSystemSuggestionKeydown(event) {
    if (state.autocompleteInput !== event.currentTarget || !state.autocompleteItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.autocompleteIndex = Math.min(state.autocompleteItems.length - 1, state.autocompleteIndex + 1);
      renderSystemSuggestionSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.autocompleteIndex = Math.max(0, state.autocompleteIndex - 1);
      renderSystemSuggestionSelection();
    } else if (event.key === "Enter" && state.autocompleteIndex >= 0) {
      event.preventDefault();
      chooseSystemSuggestion(state.autocompleteIndex);
    } else if (event.key === "Escape") {
      hideSystemSuggestions();
    }
  }

  function renderSystemSuggestionSelection() {
    const list = getSystemSuggestionList();
    list.querySelectorAll("button[data-suggestion-index]").forEach((option, index) => {
      option.classList.toggle("is-active", index === state.autocompleteIndex);
    });
  }

  function chooseSystemSuggestion(index) {
    const input = state.autocompleteInput;
    const system = state.autocompleteItems[index];
    if (!input || !system) return;
    input.value = system.name;
    input.classList.remove("is-invalid");
    hideSystemSuggestions();
    input.focus();
  }

  function positionSystemSuggestionList() {
    const input = state.autocompleteInput;
    const list = document.getElementById("systemSuggestionList");
    if (!input || !list || list.hidden) return;
    const rect = input.getBoundingClientRect();
    list.style.left = `${Math.max(8, rect.left)}px`;
    list.style.top = `${rect.bottom + 4}px`;
    list.style.width = `${Math.max(220, rect.width)}px`;
  }

  function hideSystemSuggestions() {
    const list = document.getElementById("systemSuggestionList");
    if (state.autocompleteInput) state.autocompleteInput.setAttribute("aria-expanded", "false");
    if (list) list.hidden = true;
    state.autocompleteInput = null;
    state.autocompleteItems = [];
    state.autocompleteIndex = -1;
  }

  async function resolveSystemNames(names) {
    await loadSystemCatalog().catch(() => {});
    const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
    const missing = uniqueNames.filter((name) => !state.nameCache.has(normalizeName(name)));
    if (missing.length) {
      const data = await fetchJson(`${ESI_BASE}/latest/universe/ids/?datasource=tranquility&language=en`, {
        method: "POST",
        body: JSON.stringify(missing)
      });
      for (const system of data.systems || []) {
        const normalized = { id: Number(system.id), name: system.name };
        state.nameCache.set(normalizeName(system.name), normalized);
        state.idNameCache.set(normalized.id, normalized.name);
      }
    }
    return state.nameCache;
  }

  async function resolveIdsToNames(ids) {
    const uniqueIds = [...new Set(ids.map(Number).filter(Number.isFinite))];
    const missing = uniqueIds.filter((id) => !state.idNameCache.has(id));
    for (let index = 0; index < missing.length; index += 1000) {
      const chunk = missing.slice(index, index + 1000);
      const data = await fetchJson(`${ESI_BASE}/latest/universe/names/?datasource=tranquility`, {
        method: "POST",
        body: JSON.stringify(chunk)
      });
      for (const item of data || []) {
        if (item.category === "solar_system") state.idNameCache.set(Number(item.id), item.name);
      }
    }
    return state.idNameCache;
  }

  async function getRoute(originId, destinationId) {
    const origin = Number(originId);
    const destination = Number(destinationId);
    if (origin === destination) return [origin];
    const cacheKey = `${origin}:${destination}`;
    if (state.routeCache.has(cacheKey)) return state.routeCache.get(cacheKey);

    await loadSystemCatalog().catch(() => {});
    const catalogRoute = findCatalogRoute(origin, destination);
    if (catalogRoute) {
      state.routeCache.set(cacheKey, catalogRoute);
      return catalogRoute;
    }

    let route;
    try {
      route = await fetchJson(`${ESI_BASE}/route/${origin}/${destination}`, {
        method: "POST",
        body: JSON.stringify({ preference: "Shorter", security_penalty: 50 })
      });
      if (route && Array.isArray(route.route)) route = route.route;
    } catch (err) {
      if (!/404|405|compatibility/i.test(String(err && err.message))) throw err;
      route = await fetchJson(
        `${ESI_BASE}/latest/route/${origin}/${destination}/?datasource=tranquility&flag=shortest`,
        { method: "GET" }
      );
    }

    if (!Array.isArray(route) || !route.length) throw new Error("ESI вернул пустой маршрут.");
    const normalized = route.map(Number);
    state.routeCache.set(cacheKey, normalized);
    return normalized;
  }

  function findCatalogRoute(origin, destination) {
    if (!state.systemById.has(origin) || !state.systemById.has(destination)) return null;
    const queue = [origin];
    const previous = new Map([[origin, null]]);

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const system = state.systemById.get(current);
      for (const neighbor of system.neighbors) {
        const id = Number(neighbor);
        if (previous.has(id)) continue;
        previous.set(id, current);
        if (id === destination) {
          const route = [destination];
          let cursor = current;
          while (cursor !== null) {
            route.push(cursor);
            cursor = previous.get(cursor) ?? null;
          }
          route.reverse();
          return route;
        }
        queue.push(id);
      }
    }
    return null;
  }

  async function fetchJson(url, options) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Compatibility-Date": ESI_COMPATIBILITY_DATE,
          ...(options && options.headers ? options.headers : {})
        }
      });
      if (!response.ok) {
        let details = "";
        try { details = JSON.stringify(await response.json()); } catch (_err) { details = response.statusText; }
        throw new Error(`ESI ${response.status}: ${details}`);
      }
      return response.json();
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("ESI не ответил за 25 секунд.");
      throw err;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function renderRouteMap(routes, emptyMessage = "Активных участков маршрута не осталось.") {
    const validRoutes = routes.filter((route) => Array.isArray(route.nodes) && route.nodes.length);
    if (!validRoutes.length) {
      renderEmptyRouteMap(emptyMessage);
      return;
    }

    if (state.mapViewByMode[state.mapMode].signature === state.mapSignature) {
      saveRouteViewport();
    }
    state.lastMapRoutes = validRoutes;
    state.mapSignature = createRouteMapSignature(validRoutes);
    const savedView = state.mapViewByMode[state.mapMode];
    const viewport = savedView.signature === state.mapSignature
      ? { ...savedView }
      : { signature: state.mapSignature, zoom: 1, viewX: 0, viewY: 0 };
    if (state.systemById.size) {
      renderSpatialRouteMap(validRoutes, viewport);
      return;
    }

    renderLinearRouteMap(validRoutes, viewport);
    loadSystemCatalog().then(() => {
      if (state.lastMapRoutes === validRoutes) renderSpatialRouteMap(validRoutes, viewport);
    }).catch(() => {});
  }

  function renderEmptyRouteMap(message) {
    if (state.mapViewByMode[state.mapMode].signature === state.mapSignature) {
      saveRouteViewport();
    }
    state.lastMapRoutes = null;
    state.mapSignature = "";
    state.mapZoom = MAP_MIN_ZOOM;
    state.mapDrag = null;
    els.routeMap.classList.remove("has-map", "is-panning", "is-zoomed");
    els.routeMap.innerHTML = `<div class="route-map-empty">${escapeHtml(message)}</div>`;
  }

  function createRouteMapSignature(routes) {
    return routes.map((route) => {
      const targets = route.targetIds ? [...route.targetIds].map(Number).sort((a, b) => a - b) : [];
      const segments = getRouteSegments(route)
        .map((segment) => segment.map((node) => Number(node.id)).join(","))
        .join(";");
      return `${route.name || "route"}:${segments}:${targets.join(",")}`;
    }).join("|");
  }

  function getRouteSegments(route) {
    if (Array.isArray(route.segments)) {
      return route.segments.filter((segment) => Array.isArray(segment) && segment.length);
    }
    return Array.isArray(route.nodes) && route.nodes.length ? [route.nodes] : [];
  }

  function renderSpatialRouteMap(routes, viewport) {
    const width = 1400;
    const height = 760;
    const padding = 72;
    const routeIds = new Set();
    const startIds = new Set();
    const targetIds = new Set();
    const routeNodeInfo = new Map();

    routes.forEach((route) => {
      const color = safeColor(route.color);
      route.nodes.forEach((node, index) => {
        const id = Number(node.id);
        if (!state.systemById.has(id)) return;
        routeIds.add(id);
        if (!routeNodeInfo.has(id)) {
          routeNodeInfo.set(id, {
            id,
            name: node.name,
            color,
            isStart: false,
            isTarget: false,
            step: index
          });
        }
        const info = routeNodeInfo.get(id);
        const isTarget = Boolean(route.targetIds && route.targetIds.has(id));
        info.isStart = info.isStart || index === 0;
        info.isTarget = info.isTarget || isTarget;
        if (index === 0) startIds.add(id);
        if (isTarget) targetIds.add(id);
        if (isTarget) info.color = color;
        info.step = Math.min(info.step, index);
      });
    });

    const { visibleIds, includedRegions } = collectRegionalMapSystems(routeIds, startIds, targetIds);
    const visibleSystems = [...visibleIds].map((id) => state.systemById.get(id)).filter(Boolean);
    if (!visibleSystems.length) {
      renderLinearRouteMap(routes, viewport);
      return;
    }

    const xValues = visibleSystems.map((system) => system.x);
    const yValues = visibleSystems.map((system) => system.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const rangeX = Math.max(1, maxX - minX);
    const rangeY = Math.max(1, maxY - minY);
    const scale = Math.min((width - padding * 2) / rangeX, (height - padding * 2) / rangeY);
    const usedWidth = rangeX * scale;
    const usedHeight = rangeY * scale;
    const offsetX = (width - usedWidth) / 2;
    const offsetY = (height - usedHeight) / 2;
    const positions = new Map(visibleSystems.map((system) => [system.id, {
      x: offsetX + (system.x - minX) * scale,
      y: offsetY + (maxY - system.y) * scale
    }]));

    const contextEdges = [];
    const seenContextEdges = new Set();
    for (const system of visibleSystems) {
      for (const neighborId of system.neighbors) {
        if (!visibleIds.has(neighborId)) continue;
        const key = system.id < neighborId ? `${system.id}:${neighborId}` : `${neighborId}:${system.id}`;
        if (seenContextEdges.has(key)) continue;
        seenContextEdges.add(key);
        const from = positions.get(system.id);
        const to = positions.get(neighborId);
        const neighbor = state.systemById.get(neighborId);
        const edgeClass = neighbor && neighbor.regionId !== system.regionId ? "is-region-link" : "";
        if (from && to) contextEdges.push(`<line class="${edgeClass}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`);
      }
    }

    const routeEdges = [];
    routes.forEach((route) => {
      const color = safeColor(route.color);
      getRouteSegments(route).forEach((segment) => {
        for (let index = 1; index < segment.length; index += 1) {
          const fromId = Number(segment[index - 1].id);
          const toId = Number(segment[index].id);
          const from = positions.get(fromId);
          const to = positions.get(toId);
          if (!from || !to) continue;
          routeEdges.push(`<line class="route-edge" data-from-id="${fromId}" data-to-id="${toId}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}"></line>`);
        }
      });
    });

    const contextNodes = visibleSystems
      .filter((system) => !routeIds.has(system.id))
      .map((system) => {
        const point = positions.get(system.id);
        return `<g class="map-context-node" data-region-id="${system.regionId}" transform="translate(${point.x} ${point.y})">
          <circle r="3.5" fill="${securityColor(system.security)}"></circle>
          <title>${escapeHtml(system.name)} (${formatSecurity(system.security)})</title>
        </g>`;
      });

    const labeledRegionIds = new Set(includedRegions);
    routeIds.forEach((id) => {
      const regionId = state.systemById.get(id)?.regionId;
      if (regionId) labeledRegionIds.add(regionId);
    });
    const regionPoints = new Map();
    visibleSystems.forEach((system) => {
      if (!system.regionId || !labeledRegionIds.has(system.regionId) || !positions.has(system.id)) return;
      if (!regionPoints.has(system.regionId)) regionPoints.set(system.regionId, []);
      regionPoints.get(system.regionId).push(positions.get(system.id));
    });
    const regionLabels = [...regionPoints.entries()].map(([regionId, points]) => {
      const regionName = state.regionById.get(regionId);
      if (!regionName || !points.length) return "";
      const minRegionX = Math.min(...points.map((point) => point.x));
      const maxRegionX = Math.max(...points.map((point) => point.x));
      const minRegionY = Math.min(...points.map((point) => point.y));
      const maxRegionY = Math.max(...points.map((point) => point.y));
      const x = (minRegionX + maxRegionX) / 2;
      const y = (minRegionY + maxRegionY) / 2;
      return `<text class="map-region-label" data-region-id="${regionId}" x="${x}" y="${y}">${escapeHtml(regionName)}</text>`;
    });

    const labelEvery = Math.max(1, Math.ceil(routeNodeInfo.size / 10));
    const routeNodes = [...routeNodeInfo.values()].map((info) => {
      const point = positions.get(info.id);
      const system = state.systemById.get(info.id);
      if (!point || !system) return "";
      const showLabel = info.isStart || info.isTarget || routeNodeInfo.size <= 8 || info.step % labelEvery === 0;
      const classes = ["map-route-node"];
      if (info.isStart) classes.push("is-start");
      if (info.isTarget) classes.push("is-target");
      const meta = info.isStart && info.isTarget ? "старт / таймер" : info.isStart ? "старт" : info.isTarget ? "таймер" : "";
      const labelAnchor = point.x > width - 150 ? "end" : point.x < 150 ? "start" : "middle";
      const labelX = labelAnchor === "end" ? -10 : labelAnchor === "start" ? 10 : 0;
      return `<g class="${classes.join(" ")}" style="--route-color:${info.color}" transform="translate(${point.x} ${point.y})">
        ${info.isTarget ? `<circle class="route-target-ring" r="15"></circle>` : ""}
        <circle class="route-core" r="${info.isTarget ? 8 : info.isStart ? 7 : 5}"></circle>
        <text class="route-system-label ${showLabel ? "" : "is-detail-label"}" x="${labelX}" y="-12" text-anchor="${labelAnchor}">${escapeHtml(system.name)}</text>
        ${meta ? `<text class="route-node-meta" x="${labelX}" y="22" text-anchor="${labelAnchor}">${meta}</text>` : ""}
        <title>${escapeHtml(system.name)} (${formatSecurity(system.security)})${meta ? `, ${meta}` : ""}</title>
      </g>`;
    });

    state.mapZoom = normalizeMapZoom(viewport && viewport.zoom);
    els.routeMap.classList.add("has-map");
    els.routeMap.innerHTML = `
      <div class="route-map-stage" data-region-count="${includedRegions.size}" data-system-count="${visibleSystems.length}">
        <svg viewBox="0 0 ${width} ${height}" data-base-view-box="0 0 ${width} ${height}" role="img" aria-label="Карта маршрутов по координатам EVE" preserveAspectRatio="xMidYMid meet">
          <g class="map-context-edges">${contextEdges.join("")}</g>
          <g class="map-region-labels" aria-hidden="true">${regionLabels.join("")}</g>
          <g class="map-context-nodes">${contextNodes.join("")}</g>
          <g class="map-route-edges">${routeEdges.join("")}</g>
          <g class="map-route-nodes">${routeNodes.join("")}</g>
        </svg>
      </div>`;
    restoreRouteViewport(viewport);
  }

  function collectRegionalMapSystems(routeIds, startIds, targetIds) {
    const visibleIds = new Set(routeIds);
    const regionScores = new Map();
    const scoreRegion = (id, score) => {
      const system = state.systemById.get(id);
      if (!system || !system.regionId) return;
      regionScores.set(system.regionId, (regionScores.get(system.regionId) || 0) + score);
    };

    routeIds.forEach((id) => scoreRegion(id, 1));
    startIds.forEach((id) => scoreRegion(id, 1000));
    targetIds.forEach((id) => scoreRegion(id, 2000));

    const includedRegions = new Set();
    const priorityRegions = new Set();
    [...startIds, ...targetIds].forEach((id) => {
      const regionId = state.systemById.get(id)?.regionId;
      if (regionId) priorityRegions.add(regionId);
    });
    let regionalSystemCount = 0;
    const rankedRegions = [...regionScores.entries()].sort((a, b) => b[1] - a[1]);
    for (const [regionId] of rankedRegions) {
      const systems = state.systemsByRegion.get(regionId) || [];
      if (!systems.length) continue;
      const isPriority = priorityRegions.has(regionId);
      if (!isPriority && regionalSystemCount + systems.length > MAP_REGION_SYSTEM_LIMIT) continue;
      includedRegions.add(regionId);
      regionalSystemCount += systems.length;
      systems.forEach((system) => visibleIds.add(system.id));
    }

    let frontier = [...routeIds];
    for (let depth = 0; depth < 2; depth += 1) {
      const next = [];
      for (const id of frontier) {
        const system = state.systemById.get(id);
        if (!system) continue;
        for (const neighborId of system.neighbors) {
          if (!state.systemById.has(neighborId) || visibleIds.has(neighborId)) continue;
          visibleIds.add(neighborId);
          next.push(neighborId);
        }
      }
      frontier = next;
    }

    return { visibleIds, includedRegions };
  }

  function renderLinearRouteMap(validRoutes, viewport) {

    const compact = window.matchMedia("(max-width: 560px)").matches;
    const maxNodeCount = Math.max(...validRoutes.map((route) => route.nodes.length));
    const width = compact ? 360 : 1200;
    const laneHeight = Math.max(135, Math.floor(680 / validRoutes.length));
    const height = compact
      ? Math.max(520, maxNodeCount * 92 + 80)
      : Math.max(520, laneHeight * validRoutes.length + 80);
    const left = 80;
    const right = width - 80;
    const edgeParts = [];
    const nodeParts = [];

    validRoutes.forEach((route, laneIndex) => {
      const color = safeColor(route.color);
      const y = 70 + laneIndex * laneHeight + laneHeight / 2;
      const count = route.nodes.length;
      const positions = route.nodes.map((node, index) => ({
        ...node,
        x: compact
          ? width * (laneIndex + 1) / (validRoutes.length + 1)
          : count === 1 ? width / 2 : left + (right - left) * index / (count - 1),
        y: compact
          ? 60 + (height - 120) * (count === 1 ? 0.5 : index / (count - 1))
          : y + (index % 2 === 0 ? -12 : 12)
      }));
      const positionById = new Map(positions.map((node) => [Number(node.id), node]));

      getRouteSegments(route).forEach((segment) => {
        for (let index = 1; index < segment.length; index += 1) {
          const fromId = Number(segment[index - 1].id);
          const toId = Number(segment[index].id);
          const from = positionById.get(fromId);
          const to = positionById.get(toId);
          if (!from || !to) continue;
          edgeParts.push(`<path class="route-edge" data-from-id="${fromId}" data-to-id="${toId}" d="M ${from.x} ${from.y} L ${to.x} ${to.y}" stroke="${color}" />`);
        }
      });

      positions.forEach((node, index) => {
        const isTarget = route.targetIds && route.targetIds.has(Number(node.id));
        const labelX = compact ? (node.x > width / 2 ? -13 : 13) : 0;
        const labelY = compact ? -4 : -15;
        const labelAnchor = compact ? (node.x > width / 2 ? "end" : "start") : "middle";
        const metaX = compact ? labelX : 0;
        const metaY = compact ? 13 : 25;
        nodeParts.push(`
          <g class="route-node ${isTarget ? "is-target" : ""}" style="--route-color:${color}" transform="translate(${node.x} ${node.y})">
            <circle r="${isTarget ? 9 : 6}" stroke="${color}"></circle>
            <text x="${labelX}" y="${labelY}" text-anchor="${labelAnchor}">${escapeHtml(node.name)}</text>
            <text class="route-node-meta" x="${metaX}" y="${metaY}" text-anchor="${labelAnchor}">${index === 0 ? "старт" : isTarget ? "таймер" : `${index}`}</text>
          </g>`);
      });
    });

    state.mapZoom = normalizeMapZoom(viewport && viewport.zoom);
    els.routeMap.classList.add("has-map");
    els.routeMap.innerHTML = `
      <div class="route-map-stage">
        <svg viewBox="0 0 ${width} ${height}" data-base-view-box="0 0 ${width} ${height}" role="img" aria-label="Схема маршрутов флотов" preserveAspectRatio="xMidYMid meet">
          ${edgeParts.join("")}
          ${nodeParts.join("")}
        </svg>
      </div>`;
    restoreRouteViewport(viewport);
  }

  function changeRouteZoom(delta) {
    setRouteZoom(state.mapZoom + delta);
  }

  function handleRouteMapWheel(event) {
    if (!els.routeMap.querySelector(".route-map-stage") || !event.deltaY) return;
    event.preventDefault();
    setRouteZoom(state.mapZoom * (event.deltaY < 0 ? 1.18 : 1 / 1.18), event.clientX, event.clientY);
  }

  function setRouteZoom(value, clientX, clientY) {
    const stage = els.routeMap.querySelector(".route-map-stage");
    const svg = stage && stage.querySelector("svg");
    if (!svg) return;
    const nextZoom = normalizeMapZoom(value);
    if (nextZoom === state.mapZoom) return;

    const rect = els.routeMap.getBoundingClientRect();
    const ratioX = Number.isFinite(clientX)
      ? Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
      : 0.5;
    const ratioY = Number.isFinite(clientY)
      ? Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)))
      : 0.5;
    const currentView = getVisibleMapViewport(svg, state.mapZoom);
    const anchorWorldX = currentView.x + currentView.width * ratioX;
    const anchorWorldY = currentView.y + currentView.height * ratioY;
    const nextView = getVisibleMapViewport(svg, nextZoom);

    state.mapZoom = nextZoom;
    state.mapViewX = anchorWorldX - nextView.width * ratioX;
    state.mapViewY = anchorWorldY - nextView.height * ratioY;
    applyRouteZoom();
    saveRouteViewport();
  }

  function normalizeMapZoom(value) {
    const zoom = Number(value);
    if (!Number.isFinite(zoom)) return MAP_MIN_ZOOM;
    return Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, Math.round(zoom * 100) / 100));
  }

  function startRouteMapPan(event) {
    if (event.button !== 0 || !els.routeMap.querySelector(".route-map-stage")) return;
    if (event.pointerType === "touch" && state.mapZoom <= MAP_MIN_ZOOM) return;
    state.mapDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      viewX: state.mapViewX,
      viewY: state.mapViewY,
      viewport: getVisibleMapViewport(els.routeMap.querySelector("svg"), state.mapZoom)
    };
    els.routeMap.classList.add("is-panning");
    els.routeMap.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveRouteMapPan(event) {
    if (!state.mapDrag || state.mapDrag.pointerId !== event.pointerId) return;
    const viewport = state.mapDrag.viewport;
    state.mapViewX = state.mapDrag.viewX - (event.clientX - state.mapDrag.x) * viewport.width / Math.max(1, els.routeMap.clientWidth);
    state.mapViewY = state.mapDrag.viewY - (event.clientY - state.mapDrag.y) * viewport.height / Math.max(1, els.routeMap.clientHeight);
    applyRouteViewBox();
    event.preventDefault();
  }

  function stopRouteMapPan(event) {
    if (!state.mapDrag || state.mapDrag.pointerId !== event.pointerId) return;
    if (els.routeMap.hasPointerCapture(event.pointerId)) {
      els.routeMap.releasePointerCapture(event.pointerId);
    }
    state.mapDrag = null;
    els.routeMap.classList.remove("is-panning");
    saveRouteViewport();
  }

  function restoreRouteMapHeight() {
    const savedHeight = Number(localStorage.getItem(MAP_HEIGHT_KEY));
    if (Number.isFinite(savedHeight) && savedHeight > 0) {
      els.routeMap.style.height = `${clampRouteMapHeight(savedHeight)}px`;
    }
  }

  function startRouteMapResize(event) {
    if (event.button !== 0) return;
    state.mapResize = {
      pointerId: event.pointerId,
      y: event.clientY,
      height: els.routeMap.getBoundingClientRect().height
    };
    els.routeMapResizeHandle.classList.add("is-resizing");
    els.routeMapResizeHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveRouteMapResize(event) {
    if (!state.mapResize || state.mapResize.pointerId !== event.pointerId) return;
    const height = clampRouteMapHeight(state.mapResize.height + event.clientY - state.mapResize.y);
    els.routeMap.style.height = `${height}px`;
    applyRouteZoom();
    event.preventDefault();
  }

  function stopRouteMapResize(event) {
    if (!state.mapResize || state.mapResize.pointerId !== event.pointerId) return;
    if (els.routeMapResizeHandle.hasPointerCapture(event.pointerId)) {
      els.routeMapResizeHandle.releasePointerCapture(event.pointerId);
    }
    state.mapResize = null;
    els.routeMapResizeHandle.classList.remove("is-resizing");
    localStorage.setItem(MAP_HEIGHT_KEY, String(Math.round(els.routeMap.getBoundingClientRect().height)));
  }

  function handleRouteMapResizeKeydown(event) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const step = event.shiftKey ? 100 : 40;
    const height = clampRouteMapHeight(els.routeMap.getBoundingClientRect().height + direction * step);
    els.routeMap.style.height = `${height}px`;
    applyRouteZoom();
    localStorage.setItem(MAP_HEIGHT_KEY, String(Math.round(height)));
    event.preventDefault();
  }

  function clampRouteMapHeight(value) {
    return Math.max(320, Math.min(1200, Math.round(Number(value) || 0)));
  }

  function resetRouteZoom() {
    state.mapZoom = MAP_MIN_ZOOM;
    state.mapViewX = 0;
    state.mapViewY = 0;
    applyRouteZoom();
    saveRouteViewport();
  }

  function applyRouteZoom() {
    const stage = els.routeMap.querySelector(".route-map-stage");
    if (stage) {
      stage.style.width = "100%";
      stage.style.height = "100%";
      stage.dataset.zoom = String(state.mapZoom);
    }
    const svg = stage && stage.querySelector("svg");
    if (svg) {
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.removeProperty("transform");
      svg.style.removeProperty("transform-origin");
    }
    const baseView = getBaseMapViewport(svg);
    const mapWidth = els.routeMap.clientWidth || (baseView && baseView.baseWidth) || 1;
    const mapHeight = els.routeMap.clientHeight || (baseView && baseView.baseHeight) || 1;
    const fitScale = baseView && baseView.baseWidth && baseView.baseHeight
      ? Math.max(0.05, Math.min(mapWidth / baseView.baseWidth, mapHeight / baseView.baseHeight))
      : 1;
    const zoomProgress = (state.mapZoom - MAP_MIN_ZOOM) / (MAP_MAX_ZOOM - MAP_MIN_ZOOM);
    const viewportCompensation = 1 + Math.max(0, 1 / fitScale - 1) * zoomProgress;
    const labelGrowth = 1 + Math.min(0.36, Math.max(0, state.mapZoom - 1) * 0.12);
    const markerGrowth = 1 + Math.min(0.75, Math.max(0, state.mapZoom - 1) * 0.12);
    els.routeMap.style.setProperty("--route-label-font-size", `${13 * labelGrowth * viewportCompensation / state.mapZoom}px`);
    els.routeMap.style.setProperty("--route-meta-font-size", `${11 * labelGrowth * viewportCompensation / state.mapZoom}px`);
    els.routeMap.style.setProperty("--route-label-stroke-width", `${4 * viewportCompensation / state.mapZoom}px`);
    els.routeMap.style.setProperty("--region-label-font-size", `${28 * viewportCompensation / state.mapZoom}px`);
    els.routeMap.style.setProperty("--region-label-stroke-width", `${5 * viewportCompensation / state.mapZoom}px`);
    const markerScale = markerGrowth * viewportCompensation / state.mapZoom;
    els.routeMap.style.setProperty("--route-marker-scale", String(markerScale));
    els.routeMap.style.setProperty("--route-edge-stroke-width", `${4 * markerScale}px`);
    els.routeMap.style.setProperty("--context-edge-stroke-width", `${1.05 * markerScale}px`);
    els.routeMap.style.setProperty("--region-edge-dasharray", `${4 * markerScale}px ${4 * markerScale}px`);
    els.routeMap.style.setProperty("--route-label-translate-y", `${12 * (1 - markerScale)}px`);
    els.routeMap.style.setProperty("--route-emphasis-label-translate-y", `${12 - 20 * markerScale}px`);
    els.routeMap.style.setProperty("--route-meta-translate-y", `${22 * (markerScale - 1)}px`);
    els.routeMap.classList.toggle("is-zoomed", state.mapZoom >= 1.5);
    els.routeZoomOutBtn.disabled = state.mapZoom <= MAP_MIN_ZOOM;
    els.routeZoomInBtn.disabled = state.mapZoom >= MAP_MAX_ZOOM;
    applyRouteViewBox();
  }

  function getBaseMapViewport(svg) {
    if (!svg) return null;
    const values = String(svg.dataset.baseViewBox || "").trim().split(/\s+/).map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
    const [baseX, baseY, baseWidth, baseHeight] = values;
    const mapWidth = els.routeMap.clientWidth || baseWidth;
    const mapHeight = els.routeMap.clientHeight || baseHeight;
    const containerAspect = Math.max(0.01, mapWidth / Math.max(1, mapHeight));
    const baseAspect = baseWidth / Math.max(1, baseHeight);
    let width = baseWidth;
    let height = baseHeight;
    if (containerAspect > baseAspect) {
      width = baseHeight * containerAspect;
    } else {
      height = baseWidth / containerAspect;
    }
    return {
      x: baseX - (width - baseWidth) / 2,
      y: baseY - (height - baseHeight) / 2,
      width,
      height,
      baseWidth,
      baseHeight
    };
  }

  function getVisibleMapViewport(svg, zoom = state.mapZoom) {
    const base = getBaseMapViewport(svg) || { x: 0, y: 0, width: 1, height: 1 };
    const normalizedZoom = normalizeMapZoom(zoom);
    const width = base.width / normalizedZoom;
    const height = base.height / normalizedZoom;
    const maxX = base.x + base.width - width;
    const maxY = base.y + base.height - height;
    return {
      x: Math.max(base.x, Math.min(maxX, Number(state.mapViewX) || 0)),
      y: Math.max(base.y, Math.min(maxY, Number(state.mapViewY) || 0)),
      width,
      height
    };
  }

  function applyRouteViewBox() {
    const svg = els.routeMap.querySelector(".route-map-stage svg");
    if (!svg) return;
    const viewport = getVisibleMapViewport(svg, state.mapZoom);
    state.mapViewX = viewport.x;
    state.mapViewY = viewport.y;
    svg.setAttribute("viewBox", `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
  }

  function saveRouteViewport() {
    if (!state.mapSignature || !els.routeMap.querySelector(".route-map-stage")) return;
    state.mapViewByMode[state.mapMode] = {
      signature: state.mapSignature,
      zoom: state.mapZoom,
      viewX: state.mapViewX,
      viewY: state.mapViewY
    };
  }

  function restoreRouteViewport(viewport) {
    const view = viewport || {};
    state.mapZoom = normalizeMapZoom(view.zoom);
    state.mapViewX = Number(view.viewX) || 0;
    state.mapViewY = Number(view.viewY) || 0;
    state.mapViewByMode[state.mapMode] = {
      signature: state.mapSignature,
      zoom: state.mapZoom,
      viewX: state.mapViewX,
      viewY: state.mapViewY
    };
    applyRouteZoom();
    saveRouteViewport();
  }

  function clearRouteWorkspace(message, clearText = true) {
    state.lastMapRoutes = null;
    state.mapSignature = "";
    state.mapZoom = MAP_MIN_ZOOM;
    state.mapDrag = null;
    els.routeMap.classList.remove("has-map", "is-panning", "is-zoomed");
    els.routeMap.innerHTML = `<div class="route-map-empty">${escapeHtml(message)}</div>`;
    els.routeLegend.innerHTML = "";
    els.routeList.innerHTML = "";
    if (clearText) {
      els.routeWorkspaceTitle.textContent = "Операционная карта";
      els.routeWorkspaceHint.textContent = message;
    }
    applyRouteZoom();
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
    if (/28000/i.test(message)) return "Неверный ключ доступа.";
    if (/duplicate key.*fleet_profiles|fleet_profiles_board_id_name/i.test(message)) return "Флот с таким названием уже существует.";
    if (/function .* does not exist|schema cache|list_fleets|create_fleet/i.test(message)) {
      return "В Supabase нужно выполнить актуальный supabase/schema.sql.";
    }
    if (/Failed to fetch|NetworkError/i.test(message)) return "Не удалось связаться с ESI или Supabase.";
    return message;
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

  function formatUtc(value) {
    const date = typeof value === "number" ? new Date(value) : new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }

  function formatSignedDuration(ms) {
    const sign = ms < 0 ? "−" : "+";
    const totalMinutes = Math.floor(Math.abs(ms) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return `${sign}${days ? `${days} д ` : ""}${pad(hours)}:${pad(minutes)}`;
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.EVE_FLEET_ROUTER = {
    activeRouteTargets,
    formatSignedDuration,
    normalizeName
  };
})();
