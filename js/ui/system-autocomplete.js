export function createSystemAutocomplete({ catalog, escapeHtml, formatSecurity }) {
  let activeInput = null;
  let items = [];
  let selectedIndex = -1;

  function bind(input) {
    if (!input || input.dataset.systemAutocompleteBound === "1") return;
    input.dataset.systemAutocompleteBound = "1";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.addEventListener("input", () => {
      input.classList.remove("is-invalid");
      show(input);
    });
    input.addEventListener("focus", () => show(input));
    input.addEventListener("keydown", handleKeydown);
    input.addEventListener("blur", () => globalThis.setTimeout(() => {
      if (activeInput === input) hide();
    }, 120));
  }

  function getList() {
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
      choose(Number(option.dataset.suggestionIndex));
    });
    document.body.appendChild(list);
    globalThis.addEventListener("resize", position);
    globalThis.addEventListener("scroll", position, true);
    return list;
  }

  async function show(input) {
    activeInput = input;
    const term = normalizeName(input.value);
    if (!term) {
      hide();
      return;
    }
    try {
      await catalog.load();
    } catch (_error) {
      hide();
      return;
    }
    if (activeInput !== input) return;
    items = catalog.suggestions(term, 10);
    selectedIndex = -1;
    const list = getList();
    if (!items.length) {
      list.innerHTML = '<div class="system-suggestion-empty">Система не найдена</div>';
    } else {
      list.innerHTML = items.map((system, index) => `
        <button type="button" role="option" data-suggestion-index="${index}">
          <strong>${escapeHtml(system.name)}</strong>
          <span>${formatSecurity(system.security)}</span>
        </button>
      `).join("");
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    position();
  }

  function handleKeydown(event) {
    if (activeInput !== event.currentTarget || !items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
      renderSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - 1);
      renderSelection();
    } else if (event.key === "Enter" && selectedIndex >= 0) {
      event.preventDefault();
      choose(selectedIndex);
    } else if (event.key === "Escape") {
      hide();
    }
  }

  function renderSelection() {
    getList().querySelectorAll("button[data-suggestion-index]").forEach((option, index) => {
      option.classList.toggle("is-active", index === selectedIndex);
    });
  }

  function choose(index) {
    const input = activeInput;
    const system = items[index];
    if (!input || !system) return;
    input.value = system.name;
    input.classList.remove("is-invalid");
    hide();
    input.focus();
  }

  function position() {
    const list = document.getElementById("systemSuggestionList");
    if (!activeInput || !list || list.hidden) return;
    const rect = activeInput.getBoundingClientRect();
    list.style.left = `${Math.max(8, rect.left)}px`;
    list.style.top = `${rect.bottom + 4}px`;
    list.style.width = `${Math.max(220, rect.width)}px`;
  }

  function hide() {
    const list = document.getElementById("systemSuggestionList");
    if (activeInput) activeInput.setAttribute("aria-expanded", "false");
    if (list) list.hidden = true;
    activeInput = null;
    items = [];
    selectedIndex = -1;
  }

  return Object.freeze({ bind, hide });
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}
