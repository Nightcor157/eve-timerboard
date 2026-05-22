(function () {
  "use strict";

  const CONFIG = window.EVE_TIMERBOARD_CONFIG || {};
  const BOARD_ID = CONFIG.boardId || "main";
  const POLL_MS = Number(CONFIG.pollEveryMs || 15000);
  const ADMIN_MODE = new URLSearchParams(window.location.search).has("admin");
  const LOCAL_KEY = `eve_timerboard_${BOARD_ID}`;
  const ADMIN_KEY_STORAGE = `eve_timerboard_admin_key_${BOARD_ID}`;
  const STRUCTURE_TYPE_OPTIONS = [
    ["", "—"],
    ["Astrahus", "Astrahus"],
    ["Fortizar", "Fortizar"],
    ["Keepstar", "Keepstar"],
    ["Raitaru", "Raitaru"],
    ["Azbel", "Azbel"],
    ["Sotiyo", "Sotiyo"],
    ["Athanor", "Athanor"],
    ["Tatara", "Tatara"],
    ["Metenox Moon Drill", "Metenox Moon Drill"],
    ["Customs Office", "Customs Office"],
    ["IHub", "IHub"],
    ["TCU", "TCU"],
    ["POS", "POS"]
  ];
  const TIMER_KIND_OPTIONS = [
    ["", "—"],
    ["Атака", "Атака"],
    ["Оборона", "Оборона"]
  ];

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

  let timers = [];
  let lastRenderedSignature = "";

  const els = {
    configWarning: document.getElementById("configWarning"),
    adminPanel: document.getElementById("adminPanel"),
    adminKey: document.getElementById("adminKey"),
    rememberKey: document.getElementById("rememberKey"),
    timerInput: document.getElementById("timerInput"),
    addBtn: document.getElementById("addBtn"),
    previewBtn: document.getElementById("previewBtn"),
    clearInputBtn: document.getElementById("clearInputBtn"),
    parsePreview: document.getElementById("parsePreview"),
    adminStatus: document.getElementById("adminStatus"),
    timersBody: document.getElementById("timersBody"),
    timerRowTemplate: document.getElementById("timerRowTemplate"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    showEnded: document.getElementById("showEnded"),
    refreshBtn: document.getElementById("refreshBtn"),
    exportCsvBtn: document.getElementById("exportCsvBtn"),
    statActive: document.getElementById("statActive"),
    statSoon: document.getElementById("statSoon"),
    statEnded: document.getElementById("statEnded")
  };

  init();

  function init() {
    if (!hasSupabaseConfig) {
      els.configWarning.hidden = false;
    }

    if (ADMIN_MODE) {
      els.adminPanel.hidden = false;
      document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = false; });
    }

    const savedKey = localStorage.getItem(ADMIN_KEY_STORAGE);
    if (savedKey) {
      els.adminKey.value = savedKey;
      els.rememberKey.checked = true;
    }

    els.addBtn.addEventListener("click", addTimersFromInput);
    els.previewBtn.addEventListener("click", showPreview);
    els.clearInputBtn.addEventListener("click", () => {
      els.timerInput.value = "";
      els.parsePreview.hidden = true;
      els.adminStatus.textContent = "";
    });
    els.refreshBtn.addEventListener("click", loadTimers);
    els.searchInput.addEventListener("input", renderTimers);
    els.sortSelect.addEventListener("change", renderTimers);
    els.showEnded.addEventListener("change", renderTimers);
    els.exportCsvBtn.addEventListener("click", exportCsv);
    els.rememberKey.addEventListener("change", () => {
      if (!els.rememberKey.checked) localStorage.removeItem(ADMIN_KEY_STORAGE);
      if (els.rememberKey.checked && els.adminKey.value.trim()) {
        localStorage.setItem(ADMIN_KEY_STORAGE, els.adminKey.value.trim());
      }
    });
    els.adminKey.addEventListener("change", () => {
      if (els.rememberKey.checked) {
        localStorage.setItem(ADMIN_KEY_STORAGE, els.adminKey.value.trim());
      }
    });

    loadTimers();
    window.setInterval(tick, 1000);
    window.setInterval(loadTimers, POLL_MS);
  }

  async function loadTimers() {
    try {
      if (db) {
        const { data, error } = await db
          .from("timers")
          .select("id, board_id, raw_text, title, system, object_name, structure, owner, distance, mode, end_at, note, created_at")
          .eq("board_id", BOARD_ID)
          .order("end_at", { ascending: true });

        if (error) throw error;
        timers = (data || []).map(normalizeTimer);
      } else {
        timers = readLocalTimers().map(normalizeTimer);
      }
      renderTimers();
    } catch (err) {
      setStatus(`Ошибка загрузки: ${err.message || err}`, true);
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
      created_at: row.created_at || new Date().toISOString()
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
      parsed = parseInput(raw);
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
      if (db) {
        for (const timer of parsed) {
          const { error } = await db.rpc("add_timer", {
            p_board_id: BOARD_ID,
            p_admin_key: adminKey,
            p_raw_text: timer.raw_text,
            p_title: timer.title,
            p_system: timer.system,
            p_object_name: timer.object_name,
            p_structure: timer.structure,
            p_owner: timer.owner,
            p_distance: timer.distance,
            p_mode: timer.mode,
            p_end_at: timer.end_at,
            p_note: timer.note || ""
          });
          if (error) throw error;
        }
      } else {
        const local = readLocalTimers();
        parsed.forEach((timer) => local.push({ ...timer, id: cryptoRandomId(), board_id: BOARD_ID, created_at: new Date().toISOString() }));
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
      }

      if (els.rememberKey.checked && adminKey) {
        localStorage.setItem(ADMIN_KEY_STORAGE, adminKey);
      }

      els.timerInput.value = "";
      els.parsePreview.hidden = true;
      setStatus(`Добавлено таймеров: ${parsed.length}.`, false);
      await loadTimers();
    } catch (err) {
      setStatus(`Ошибка добавления: ${friendlyDbError(err)}`, true);
    } finally {
      els.addBtn.disabled = false;
    }
  }

  async function deleteTimer(id) {
    if (!ADMIN_MODE) return;
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
        const { error } = await db.rpc("delete_timer", {
          p_board_id: BOARD_ID,
          p_admin_key: adminKey,
          p_id: id
        });
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

  function showPreview() {
    try {
      const parsed = parseInput(els.timerInput.value.trim());
      if (!parsed.length) {
        setStatus("Не нашёл таймеров для проверки.", true);
        return;
      }
      els.parsePreview.innerHTML = parsed.map((t) => `
        <div class="preview-card">
          <strong>${escapeHtml(t.system || "—")}</strong>
          <span>${escapeHtml(t.structure || "—")}</span>
          <small>${escapeHtml(t.title || "—")} · ${escapeHtml(t.owner || "без владельца")} · ${escapeHtml(formatUtc(t.end_at))}</small>
        </div>
      `).join("");
      els.parsePreview.hidden = false;
      setStatus(`Распознано таймеров: ${parsed.length}.`, false);
    } catch (err) {
      els.parsePreview.hidden = true;
      setStatus(err.message || String(err), true);
    }
  }

  function parseInput(input) {
    const blocks = splitTimerBlocks(input);
    return blocks.map(parseTimerBlock);
  }

  function splitTimerBlocks(input) {
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

    if (current.length && hasTimerDate(current.join("\n"))) {
      blocks.push(current.join("\n"));
    }

    return blocks.filter(hasTimerDate);
  }

  function parseTimerBlock(block) {
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

    const distance = "";

    return {
      raw_text: block,
      title,
      system,
      object_name,
      structure,
      owner,
      distance,
      mode,
      end_at: endDate.toISOString(),
      note: ""
    };
  }

  function hasTimerDate(value) {
    return Boolean(getTimerDateMatch(value));
  }

  function getTimerDateMatch(value) {
    return String(value || "").match(/(?:до|until)\s+(\d{4})[.-](\d{1,2})[.-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  }

  function isDistanceLine(value) {
    return /^(\d+(?:[,.]\d+)?[ \t]*(?:а\.?[ \t]*е\.?|au|a\.u\.)|\d[\d \t]*(?:[,.]\d+)?[ \t]*(?:м|m))$/i.test(value);
  }

  function hasChatTimestamp(value) {
    return /^\s*\[\d{2}:\d{2}:\d{2}\]/.test(String(value || ""));
  }

  function normalizeBreaks(value) {
    return String(value || "")
      .replace(/&lt;br\s*\/?&gt;/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\*+$/g, "")
      .trim();
  }

  function renderTimers() {
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("table-control")) return;

    const now = Date.now();
    const search = els.searchInput.value.trim().toLowerCase();
    const sortMode = els.sortSelect.value;
    const showEnded = els.showEnded.checked;

    const enriched = timers.map((timer) => {
      const remainingMs = new Date(timer.end_at).getTime() - now;
      const status = getStatus(remainingMs);
      return { ...timer, remainingMs, status };
    });

    const activeCount = enriched.filter((t) => t.remainingMs > 0).length;
    const soonCount = enriched.filter((t) => t.remainingMs > 0 && t.remainingMs <= 4 * 3600 * 1000).length;
    const endedCount = enriched.filter((t) => t.remainingMs <= 0).length;

    els.statActive.textContent = String(activeCount);
    els.statSoon.textContent = String(soonCount);
    els.statEnded.textContent = String(endedCount);

    const visible = enriched
      .filter((timer) => showEnded || timer.remainingMs > 0)
      .filter((timer) => !search || searchableText(timer).includes(search))
      .sort((a, b) => compareTimers(a, b, sortMode));

    const signature = JSON.stringify(visible.map((t) => [
      t.id,
      t.system,
      t.object_name,
      t.structure,
      t.title,
      t.owner,
      t.mode,
      t.distance,
      t.end_at,
      t.status.label,
      Math.floor(t.remainingMs / 1000),
      search,
      sortMode,
      showEnded,
      ADMIN_MODE
    ]));
    if (signature === lastRenderedSignature) return;
    lastRenderedSignature = signature;

    if (!visible.length) {
      els.timersBody.innerHTML = `<tr><td colspan="11" class="empty">Нет таймеров.</td></tr>`;
      return;
    }

    els.timersBody.innerHTML = "";
    for (const timer of visible) {
      const row = els.timerRowTemplate.content.firstElementChild.cloneNode(true);
      row.className = timer.status.className;

      if (ADMIN_MODE) {
        setEditableCell(row, "system", timer.system, (value) => saveTimerAdminFields(timer, { system: value }));
      } else {
        setCell(row, "system", timer.system || "—");
      }
      if (ADMIN_MODE) {
        setSelectCell(row, "object_name", STRUCTURE_TYPE_OPTIONS, normalizeStructureType(timer.object_name), (value) => saveTimerAdminFields(timer, { object_name: value }));
      } else {
        setCell(row, "object_name", normalizeStructureType(timer.object_name) || "—");
      }
      if (ADMIN_MODE) {
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
      if (ADMIN_MODE) {
        setSelectCell(row, "timer_kind", TIMER_KIND_OPTIONS, normalizeTimerKind(timer.distance), (value) => saveTimerAdminFields(timer, { distance: value }));
      } else {
        setTimerKindCell(row, "timer_kind", normalizeTimerKind(timer.distance));
      }
      if (ADMIN_MODE) {
        setEditableCell(row, "end_at", formatUtc(timer.end_at), (value) => saveTimerAdminFields(timer, { end_at: value }), "2026.05.22 13:08:10");
      } else {
        setCell(row, "end_at", formatUtc(timer.end_at));
      }
      setCell(row, "remaining", formatRemaining(timer.remainingMs));
      setCell(row, "status", timer.status.label);

      const actionsCell = row.querySelector('[data-field="actions"]');
      if (ADMIN_MODE) {
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

  function setCell(row, field, value) {
    const cell = row.querySelector(`[data-field="${field}"]`);
    if (cell) cell.textContent = value;
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
    select.className = `table-control table-select ${timerKindClass(value)}`;
    for (const [optionValue, label] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = options.some(([optionValue]) => optionValue === value) ? value : "";
    select.addEventListener("change", async () => {
      select.classList.remove("is-attack-kind", "is-defense-kind");
      const nextClass = timerKindClass(select.value);
      if (nextClass) select.classList.add(nextClass);
      select.disabled = true;
      await onChange(select.value);
      select.disabled = false;
    });
    cell.textContent = "";
    cell.appendChild(select);
  }

  async function saveTimerAdminFields(timer, changes) {
    if (!ADMIN_MODE) return;
    const nextEndAt = Object.prototype.hasOwnProperty.call(changes, "end_at") ? parseUtcInput(changes.end_at) : timer.end_at;
    if (!nextEndAt) {
      setStatus("Дата должна быть в формате 2026.05.22 13:08:10.", true);
      await loadTimers();
      return;
    }

    const updated = {
      ...timer,
      title: Object.prototype.hasOwnProperty.call(changes, "title") ? cleanText(changes.title) : timer.title,
      system: Object.prototype.hasOwnProperty.call(changes, "system") ? cleanText(changes.system) : timer.system,
      object_name: Object.prototype.hasOwnProperty.call(changes, "object_name") ? changes.object_name : normalizeStructureType(timer.object_name),
      structure: Object.prototype.hasOwnProperty.call(changes, "structure") ? cleanText(changes.structure) : timer.structure,
      owner: Object.prototype.hasOwnProperty.call(changes, "owner") ? cleanText(changes.owner) : timer.owner,
      distance: Object.prototype.hasOwnProperty.call(changes, "distance") ? changes.distance : normalizeTimerKind(timer.distance),
      mode: Object.prototype.hasOwnProperty.call(changes, "mode") ? cleanText(changes.mode) : timer.mode,
      end_at: nextEndAt
    };

    try {
      if (db) {
        const adminKey = els.adminKey.value.trim();
        if (!adminKey) {
          setStatus("Для изменения таймера нужен админ-ключ.", true);
          await loadTimers();
          return;
        }

        const { error } = await db.rpc("update_timer_admin_fields", {
          p_board_id: BOARD_ID,
          p_admin_key: adminKey,
          p_id: timer.id,
          p_title: updated.title || "",
          p_system: updated.system || "",
          p_object_name: normalizeStructureType(updated.object_name),
          p_structure: updated.structure || "",
          p_owner: updated.owner || "",
          p_timer_kind: normalizeTimerKind(updated.distance),
          p_mode: updated.mode || "",
          p_end_at: updated.end_at
        });
        if (error) throw error;
      } else {
        const local = readLocalTimers().map((item) => item.id === timer.id ? {
          ...item,
          title: updated.title || "",
          system: updated.system || "",
          object_name: normalizeStructureType(updated.object_name),
          structure: updated.structure || "",
          owner: updated.owner || "",
          distance: normalizeTimerKind(updated.distance),
          mode: updated.mode || "",
          end_at: updated.end_at
        } : item);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
      }

      setStatus("Таймер обновлён.", false);
      lastRenderedSignature = "";
      await loadTimers();
    } catch (err) {
      setStatus(`Ошибка обновления: ${friendlyDbError(err)}`, true);
      await loadTimers();
    }
  }

  function normalizeTimerKind(value) {
    const text = cleanText(value);
    if (/^атака$/i.test(text)) return "Атака";
    if (/^оборона$/i.test(text)) return "Оборона";
    return "";
  }

  function timerKindClass(value) {
    const kind = normalizeTimerKind(value);
    if (kind === "Атака") return "is-attack-kind";
    if (kind === "Оборона") return "is-defense-kind";
    return "";
  }

  function compareTimers(a, b, sortMode) {
    if (sortMode === "title") {
      return compareText(a.title || a.structure || a.system, b.title || b.structure || b.system) || compareTime(a, b);
    }
    if (sortMode === "system") {
      return compareText(a.system, b.system) || compareTime(a, b);
    }
    return compareTime(a, b);
  }

  function compareTime(a, b) {
    return new Date(a.end_at).getTime() - new Date(b.end_at).getTime();
  }

  function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), "ru", { numeric: true, sensitivity: "base" });
  }

  function normalizeStructureType(value) {
    const text = cleanText(value);
    const option = STRUCTURE_TYPE_OPTIONS.find(([optionValue]) => optionValue && optionValue.toLowerCase() === text.toLowerCase());
    return option ? option[0] : "";
  }

  function tick() {
    renderTimers();
  }

  function getStatus(ms) {
    if (ms <= 0) return { label: "Завершён", className: "is-ended" };
    if (ms <= 4 * 3600 * 1000) return { label: "Скоро", className: "is-soon" };
    return { label: "Активен", className: "is-active" };
  }

  function formatRemaining(ms) {
    if (ms <= 0) return "00:00:00";
    const total = Math.floor(ms / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return days > 0 ? `${days} д ${clock}` : clock;
  }

  function formatUtc(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return [
      d.getUTCFullYear(),
      pad(d.getUTCMonth() + 1),
      pad(d.getUTCDate())
    ].join(".") + " " + [
      pad(d.getUTCHours()),
      pad(d.getUTCMinutes()),
      pad(d.getUTCSeconds())
    ].join(":");
  }

  function parseUtcInput(value) {
    const match = String(value || "").trim().match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return "";

    const [, year, month, day, hour, minute, second = "0"] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    if (Number.isNaN(date.getTime())) return "";

    return date.toISOString();
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function searchableText(timer) {
    return [timer.system, normalizeStructureType(timer.object_name), timer.structure, timer.title, timer.owner, timer.mode, normalizeTimerKind(timer.distance), timer.raw_text]
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
    const rows = [["system", "object_type", "structure", "title", "owner", "mode", "timer_kind", "end_at_utc", "remaining", "status"]];
    const now = Date.now();
    timers
      .slice()
      .sort((a, b) => new Date(a.end_at).getTime() - new Date(b.end_at).getTime())
      .forEach((timer) => {
        const remainingMs = new Date(timer.end_at).getTime() - now;
        rows.push([
          timer.system,
          normalizeStructureType(timer.object_name),
          timer.structure,
          timer.title,
          timer.owner,
          timer.mode,
          normalizeTimerKind(timer.distance),
          formatUtc(timer.end_at),
          formatRemaining(remainingMs),
          getStatus(remainingMs).label
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
    if (/wrong admin key|28000|invalid/i.test(message)) return "неверный админ-ключ";
    if (/update_timer_admin_fields/i.test(message)) return "в Supabase нужно добавить функцию update_timer_admin_fields";
    if (/function .* does not exist|schema cache|add_timer/i.test(message)) return "SQL-схема Supabase не установлена или не обновлена";
    return message;
  }

  function cryptoRandomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
