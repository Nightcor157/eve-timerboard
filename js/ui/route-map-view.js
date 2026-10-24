export function createRouteMapView({
  container,
  resizeHandle,
  zoomOutButton,
  zoomResetButton,
  zoomInButton,
  catalog,
  storageKey,
  escapeHtml,
  safeColor,
  formatSecurity,
  securityColor,
  minZoom = 1,
  maxZoom = 16,
  regionSystemLimit = 900
}) {
  const state = {
    mode: "general",
    zoom: minZoom,
    viewX: 0,
    viewY: 0,
    signature: "",
    drag: null,
    resize: null,
    lastRoutes: null,
    views: {
      general: { signature: "", zoom: minZoom, viewX: 0, viewY: 0 },
      fleet: { signature: "", zoom: minZoom, viewX: 0, viewY: 0 }
    }
  };

  function bind() {
    restoreHeight();
    zoomOutButton.addEventListener("click", () => changeZoom(-0.5));
    zoomResetButton.addEventListener("click", resetZoom);
    zoomInButton.addEventListener("click", () => changeZoom(0.5));
    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("pointerdown", startPan);
    container.addEventListener("pointermove", movePan);
    container.addEventListener("pointerup", stopPan);
    container.addEventListener("pointercancel", stopPan);
    resizeHandle.addEventListener("pointerdown", startResize);
    resizeHandle.addEventListener("pointermove", moveResize);
    resizeHandle.addEventListener("pointerup", stopResize);
    resizeHandle.addEventListener("pointercancel", stopResize);
    resizeHandle.addEventListener("keydown", handleResizeKeydown);
    globalThis.addEventListener("resize", () => {
      if (container.querySelector(".route-map-stage svg")) applyZoom();
    }, { passive: true });
  }

  function setMode(mode) {
    if (state.views[state.mode].signature === state.signature) saveViewport();
    state.mode = mode === "fleet" ? "fleet" : "general";
  }

  function render(routes, emptyMessage = "Активных участков маршрута не осталось.") {
    const validRoutes = routes.filter((route) => Array.isArray(route.nodes) && route.nodes.length);
    if (!validRoutes.length) {
      renderEmpty(emptyMessage);
      return;
    }
    if (state.views[state.mode].signature === state.signature) saveViewport();
    state.lastRoutes = validRoutes;
    state.signature = createSignature(validRoutes);
    const saved = state.views[state.mode];
    const viewport = saved.signature === state.signature
      ? { ...saved }
      : { signature: state.signature, zoom: minZoom, viewX: 0, viewY: 0 };
    if (catalog.systemById.size) {
      renderSpatial(validRoutes, viewport);
      return;
    }
    renderLinear(validRoutes, viewport);
    catalog.load().then(() => {
      if (state.lastRoutes === validRoutes) renderSpatial(validRoutes, viewport);
    }).catch(() => {});
  }

  function clear(message) {
    state.lastRoutes = null;
    state.signature = "";
    state.zoom = minZoom;
    state.drag = null;
    container.classList.remove("has-map", "is-panning", "is-zoomed");
    container.innerHTML = `<div class="route-map-empty">${escapeHtml(message)}</div>`;
    applyZoom();
  }

  function renderEmpty(message) {
    if (state.views[state.mode].signature === state.signature) saveViewport();
    clear(message);
  }

  function createSignature(routes) {
    return routes.map((route) => {
      const targets = route.targetIds ? [...route.targetIds].map(Number).sort((a, b) => a - b) : [];
      const segments = getSegments(route)
        .map((segment) => segment.map((node) => Number(node.id)).join(","))
        .join(";");
      return `${route.name || "route"}:${segments}:${targets.join(",")}`;
    }).join("|");
  }

  function getSegments(route) {
    if (Array.isArray(route.segments)) {
      return route.segments.filter((segment) => Array.isArray(segment) && segment.length);
    }
    return Array.isArray(route.nodes) && route.nodes.length ? [route.nodes] : [];
  }

  function renderSpatial(routes, viewport) {
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
        if (!catalog.systemById.has(id)) return;
        routeIds.add(id);
        if (!routeNodeInfo.has(id)) {
          routeNodeInfo.set(id, { id, name: node.name, color, isStart: false, isTarget: false, step: index });
        }
        const info = routeNodeInfo.get(id);
        const isTarget = Boolean(route.targetIds && route.targetIds.has(id));
        info.isStart ||= index === 0;
        info.isTarget ||= isTarget;
        if (index === 0) startIds.add(id);
        if (isTarget) {
          targetIds.add(id);
          info.color = color;
        }
        info.step = Math.min(info.step, index);
      });
    });

    const { visibleIds, includedRegions } = collectRegionalSystems(routeIds, startIds, targetIds);
    const visibleSystems = [...visibleIds].map((id) => catalog.systemById.get(id)).filter(Boolean);
    if (!visibleSystems.length) {
      renderLinear(routes, viewport);
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
    const offsetX = (width - rangeX * scale) / 2;
    const offsetY = (height - rangeY * scale) / 2;
    const positions = new Map(visibleSystems.map((system) => [system.id, {
      x: offsetX + (system.x - minX) * scale,
      y: offsetY + (maxY - system.y) * scale
    }]));

    const contextEdges = [];
    const seenEdges = new Set();
    for (const system of visibleSystems) {
      for (const neighborId of system.neighbors) {
        if (!visibleIds.has(neighborId)) continue;
        const key = system.id < neighborId ? `${system.id}:${neighborId}` : `${neighborId}:${system.id}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        const from = positions.get(system.id);
        const to = positions.get(neighborId);
        const neighbor = catalog.systemById.get(neighborId);
        const edgeClass = neighbor && neighbor.regionId !== system.regionId ? "is-region-link" : "";
        if (from && to) contextEdges.push(`<line class="${edgeClass}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`);
      }
    }

    const routeEdges = [];
    routes.forEach((route) => {
      const color = safeColor(route.color);
      getSegments(route).forEach((segment) => {
        for (let index = 1; index < segment.length; index += 1) {
          const fromId = Number(segment[index - 1].id);
          const toId = Number(segment[index].id);
          const from = positions.get(fromId);
          const to = positions.get(toId);
          if (from && to) routeEdges.push(`<line class="route-edge" data-from-id="${fromId}" data-to-id="${toId}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}"></line>`);
        }
      });
    });

    const contextNodes = visibleSystems.filter((system) => !routeIds.has(system.id)).map((system) => {
      const point = positions.get(system.id);
      return `<g class="map-context-node" data-region-id="${system.regionId}" transform="translate(${point.x} ${point.y})">
        <circle r="3.5" fill="${securityColor(system.security)}"></circle>
        <title>${escapeHtml(system.name)} (${formatSecurity(system.security)})</title>
      </g>`;
    });

    const labeledRegionIds = new Set(includedRegions);
    routeIds.forEach((id) => {
      const regionId = catalog.systemById.get(id)?.regionId;
      if (regionId) labeledRegionIds.add(regionId);
    });
    const regionPoints = new Map();
    visibleSystems.forEach((system) => {
      if (!system.regionId || !labeledRegionIds.has(system.regionId)) return;
      if (!regionPoints.has(system.regionId)) regionPoints.set(system.regionId, []);
      regionPoints.get(system.regionId).push(positions.get(system.id));
    });
    const regionLabels = [...regionPoints.entries()].map(([regionId, points]) => {
      const name = catalog.regionById.get(regionId);
      if (!name || !points.length) return "";
      const x = (Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.x))) / 2;
      const y = (Math.min(...points.map((point) => point.y)) + Math.max(...points.map((point) => point.y))) / 2;
      return `<text class="map-region-label" data-region-id="${regionId}" x="${x}" y="${y}">${escapeHtml(name)}</text>`;
    });

    const labelEvery = Math.max(1, Math.ceil(routeNodeInfo.size / 10));
    const routeNodes = [...routeNodeInfo.values()].map((info) => {
      const point = positions.get(info.id);
      const system = catalog.systemById.get(info.id);
      if (!point || !system) return "";
      const showLabel = info.isStart || info.isTarget || routeNodeInfo.size <= 8 || info.step % labelEvery === 0;
      const classes = ["map-route-node"];
      if (info.isStart) classes.push("is-start");
      if (info.isTarget) classes.push("is-target");
      const meta = info.isStart && info.isTarget ? "старт / таймер" : info.isStart ? "старт" : info.isTarget ? "таймер" : "";
      const anchor = point.x > width - 150 ? "end" : point.x < 150 ? "start" : "middle";
      const labelX = anchor === "end" ? -10 : anchor === "start" ? 10 : 0;
      return `<g class="${classes.join(" ")}" style="--route-color:${info.color}" transform="translate(${point.x} ${point.y})">
        ${info.isTarget ? '<circle class="route-target-ring" r="15"></circle>' : ""}
        <circle class="route-core" r="${info.isTarget ? 8 : info.isStart ? 7 : 5}"></circle>
        <text class="route-system-label ${showLabel ? "" : "is-detail-label"}" x="${labelX}" y="-12" text-anchor="${anchor}">${escapeHtml(system.name)}</text>
        ${meta ? `<text class="route-node-meta" x="${labelX}" y="22" text-anchor="${anchor}">${meta}</text>` : ""}
        <title>${escapeHtml(system.name)} (${formatSecurity(system.security)})${meta ? `, ${meta}` : ""}</title>
      </g>`;
    });

    state.zoom = normalizeZoom(viewport && viewport.zoom);
    container.classList.add("has-map");
    container.innerHTML = `<div class="route-map-stage" data-region-count="${includedRegions.size}" data-system-count="${visibleSystems.length}">
      <svg viewBox="0 0 ${width} ${height}" data-base-view-box="0 0 ${width} ${height}" role="img" aria-label="Карта маршрутов по координатам EVE" preserveAspectRatio="xMidYMid meet">
        <g class="map-context-edges">${contextEdges.join("")}</g>
        <g class="map-region-labels" aria-hidden="true">${regionLabels.join("")}</g>
        <g class="map-context-nodes">${contextNodes.join("")}</g>
        <g class="map-route-edges">${routeEdges.join("")}</g>
        <g class="map-route-nodes">${routeNodes.join("")}</g>
      </svg>
    </div>`;
    restoreViewport(viewport);
  }

  function collectRegionalSystems(routeIds, startIds, targetIds) {
    const visibleIds = new Set(routeIds);
    const scores = new Map();
    const score = (id, value) => {
      const system = catalog.systemById.get(id);
      if (system?.regionId) scores.set(system.regionId, (scores.get(system.regionId) || 0) + value);
    };
    routeIds.forEach((id) => score(id, 1));
    startIds.forEach((id) => score(id, 1000));
    targetIds.forEach((id) => score(id, 2000));
    const includedRegions = new Set();
    const priorityRegions = new Set();
    [...startIds, ...targetIds].forEach((id) => {
      const regionId = catalog.systemById.get(id)?.regionId;
      if (regionId) priorityRegions.add(regionId);
    });
    let count = 0;
    for (const [regionId] of [...scores.entries()].sort((a, b) => b[1] - a[1])) {
      const systems = catalog.systemsByRegion.get(regionId) || [];
      if (!systems.length) continue;
      if (!priorityRegions.has(regionId) && count + systems.length > regionSystemLimit) continue;
      includedRegions.add(regionId);
      count += systems.length;
      systems.forEach((system) => visibleIds.add(system.id));
    }
    let frontier = [...routeIds];
    for (let depth = 0; depth < 2; depth += 1) {
      const next = [];
      for (const id of frontier) {
        const system = catalog.systemById.get(id);
        if (!system) continue;
        for (const neighborId of system.neighbors) {
          if (!catalog.systemById.has(neighborId) || visibleIds.has(neighborId)) continue;
          visibleIds.add(neighborId);
          next.push(neighborId);
        }
      }
      frontier = next;
    }
    return { visibleIds, includedRegions };
  }

  function renderLinear(routes, viewport) {
    const compact = globalThis.matchMedia("(max-width: 560px)").matches;
    const maxNodeCount = Math.max(...routes.map((route) => route.nodes.length));
    const width = compact ? 360 : 1200;
    const laneHeight = Math.max(135, Math.floor(680 / routes.length));
    const height = compact ? Math.max(520, maxNodeCount * 92 + 80) : Math.max(520, laneHeight * routes.length + 80);
    const edges = [];
    const nodes = [];
    routes.forEach((route, laneIndex) => {
      const color = safeColor(route.color);
      const y = 70 + laneIndex * laneHeight + laneHeight / 2;
      const positions = route.nodes.map((node, index) => ({
        ...node,
        x: compact ? width * (laneIndex + 1) / (routes.length + 1) : route.nodes.length === 1 ? width / 2 : 80 + (width - 160) * index / (route.nodes.length - 1),
        y: compact ? 60 + (height - 120) * (route.nodes.length === 1 ? 0.5 : index / (route.nodes.length - 1)) : y + (index % 2 === 0 ? -12 : 12)
      }));
      const byId = new Map(positions.map((node) => [Number(node.id), node]));
      getSegments(route).forEach((segment) => {
        for (let index = 1; index < segment.length; index += 1) {
          const fromId = Number(segment[index - 1].id);
          const toId = Number(segment[index].id);
          const from = byId.get(fromId);
          const to = byId.get(toId);
          if (from && to) edges.push(`<path class="route-edge" data-from-id="${fromId}" data-to-id="${toId}" d="M ${from.x} ${from.y} L ${to.x} ${to.y}" stroke="${color}" />`);
        }
      });
      positions.forEach((node, index) => {
        const isTarget = route.targetIds && route.targetIds.has(Number(node.id));
        const labelX = compact ? (node.x > width / 2 ? -13 : 13) : 0;
        const anchor = compact ? (node.x > width / 2 ? "end" : "start") : "middle";
        nodes.push(`<g class="route-node ${isTarget ? "is-target" : ""}" style="--route-color:${color}" transform="translate(${node.x} ${node.y})">
          <circle r="${isTarget ? 9 : 6}" stroke="${color}"></circle>
          <text x="${labelX}" y="${compact ? -4 : -15}" text-anchor="${anchor}">${escapeHtml(node.name)}</text>
          <text class="route-node-meta" x="${labelX}" y="${compact ? 13 : 25}" text-anchor="${anchor}">${index === 0 ? "старт" : isTarget ? "таймер" : `${index}`}</text>
        </g>`);
      });
    });
    state.zoom = normalizeZoom(viewport && viewport.zoom);
    container.classList.add("has-map");
    container.innerHTML = `<div class="route-map-stage"><svg viewBox="0 0 ${width} ${height}" data-base-view-box="0 0 ${width} ${height}" role="img" aria-label="Схема маршрутов флотов" preserveAspectRatio="xMidYMid meet">${edges.join("")}${nodes.join("")}</svg></div>`;
    restoreViewport(viewport);
  }

  function changeZoom(delta) { setZoom(state.zoom + delta); }
  function handleWheel(event) {
    if (!container.querySelector(".route-map-stage") || !event.deltaY) return;
    event.preventDefault();
    setZoom(state.zoom * (event.deltaY < 0 ? 1.18 : 1 / 1.18), event.clientX, event.clientY);
  }
  function setZoom(value, clientX, clientY) {
    const svg = container.querySelector(".route-map-stage svg");
    if (!svg) return;
    const nextZoom = normalizeZoom(value);
    if (nextZoom === state.zoom) return;
    const rect = container.getBoundingClientRect();
    const ratioX = Number.isFinite(clientX) ? Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))) : 0.5;
    const ratioY = Number.isFinite(clientY) ? Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))) : 0.5;
    const current = visibleViewport(svg, state.zoom);
    const next = visibleViewport(svg, nextZoom);
    state.zoom = nextZoom;
    state.viewX = current.x + current.width * ratioX - next.width * ratioX;
    state.viewY = current.y + current.height * ratioY - next.height * ratioY;
    applyZoom();
    saveViewport();
  }
  function normalizeZoom(value) {
    const zoom = Number(value);
    return Number.isFinite(zoom) ? Math.max(minZoom, Math.min(maxZoom, Math.round(zoom * 100) / 100)) : minZoom;
  }
  function startPan(event) {
    if (event.button !== 0 || !container.querySelector(".route-map-stage")) return;
    if (event.pointerType === "touch" && state.zoom <= minZoom) return;
    state.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: state.viewX, viewY: state.viewY, viewport: visibleViewport(container.querySelector("svg"), state.zoom) };
    container.classList.add("is-panning");
    container.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function movePan(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    state.viewX = state.drag.viewX - (event.clientX - state.drag.x) * state.drag.viewport.width / Math.max(1, container.clientWidth);
    state.viewY = state.drag.viewY - (event.clientY - state.drag.y) * state.drag.viewport.height / Math.max(1, container.clientHeight);
    applyViewBox();
    event.preventDefault();
  }
  function stopPan(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    state.drag = null;
    container.classList.remove("is-panning");
    saveViewport();
  }
  function restoreHeight() {
    const height = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(height) && height > 0) container.style.height = `${clampHeight(height)}px`;
  }
  function startResize(event) {
    if (event.button !== 0) return;
    state.resize = { pointerId: event.pointerId, y: event.clientY, height: container.getBoundingClientRect().height };
    resizeHandle.classList.add("is-resizing");
    resizeHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveResize(event) {
    if (!state.resize || state.resize.pointerId !== event.pointerId) return;
    container.style.height = `${clampHeight(state.resize.height + event.clientY - state.resize.y)}px`;
    applyZoom();
    event.preventDefault();
  }
  function stopResize(event) {
    if (!state.resize || state.resize.pointerId !== event.pointerId) return;
    if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
    state.resize = null;
    resizeHandle.classList.remove("is-resizing");
    localStorage.setItem(storageKey, String(Math.round(container.getBoundingClientRect().height)));
  }
  function handleResizeKeydown(event) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const height = clampHeight(container.getBoundingClientRect().height + (event.key === "ArrowDown" ? 1 : -1) * (event.shiftKey ? 100 : 40));
    container.style.height = `${height}px`;
    applyZoom();
    localStorage.setItem(storageKey, String(height));
    event.preventDefault();
  }
  function clampHeight(value) { return Math.max(320, Math.min(1200, Math.round(Number(value) || 0))); }
  function resetZoom() {
    state.zoom = minZoom;
    state.viewX = 0;
    state.viewY = 0;
    applyZoom();
    saveViewport();
  }
  function applyZoom() {
    const stage = container.querySelector(".route-map-stage");
    if (stage) {
      stage.style.width = "100%";
      stage.style.height = "100%";
      stage.dataset.zoom = String(state.zoom);
    }
    const svg = stage?.querySelector("svg");
    if (svg) {
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.removeProperty("transform");
      svg.style.removeProperty("transform-origin");
    }
    const base = baseViewport(svg);
    const fitScale = base?.baseWidth && base?.baseHeight
      ? Math.max(0.05, Math.min((container.clientWidth || base.baseWidth) / base.baseWidth, (container.clientHeight || base.baseHeight) / base.baseHeight))
      : 1;
    const progress = (state.zoom - minZoom) / (maxZoom - minZoom);
    const compensation = 1 + Math.max(0, 1 / fitScale - 1) * progress;
    const labelGrowth = 1 + Math.min(0.36, Math.max(0, state.zoom - 1) * 0.12);
    const markerGrowth = 1 + Math.min(0.75, Math.max(0, state.zoom - 1) * 0.12);
    const markerScale = markerGrowth * compensation / state.zoom;
    container.style.setProperty("--route-label-font-size", `${13 * labelGrowth * compensation / state.zoom}px`);
    container.style.setProperty("--route-meta-font-size", `${11 * labelGrowth * compensation / state.zoom}px`);
    container.style.setProperty("--route-label-stroke-width", `${4 * compensation / state.zoom}px`);
    container.style.setProperty("--region-label-font-size", `${28 * compensation / state.zoom}px`);
    container.style.setProperty("--region-label-stroke-width", `${5 * compensation / state.zoom}px`);
    container.style.setProperty("--route-marker-scale", String(markerScale));
    container.style.setProperty("--route-edge-stroke-width", `${4 * markerScale}px`);
    container.style.setProperty("--context-edge-stroke-width", `${1.05 * markerScale}px`);
    container.style.setProperty("--region-edge-dasharray", `${4 * markerScale}px ${4 * markerScale}px`);
    container.style.setProperty("--route-label-translate-y", `${12 * (1 - markerScale)}px`);
    container.style.setProperty("--route-emphasis-label-translate-y", `${12 - 20 * markerScale}px`);
    container.style.setProperty("--route-meta-translate-y", `${22 * (markerScale - 1)}px`);
    container.classList.toggle("is-zoomed", state.zoom >= 1.5);
    zoomOutButton.disabled = state.zoom <= minZoom;
    zoomInButton.disabled = state.zoom >= maxZoom;
    applyViewBox();
  }
  function baseViewport(svg) {
    if (!svg) return null;
    const values = String(svg.dataset.baseViewBox || "").trim().split(/\s+/).map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
    const [baseX, baseY, baseWidth, baseHeight] = values;
    const aspect = Math.max(0.01, (container.clientWidth || baseWidth) / Math.max(1, container.clientHeight || baseHeight));
    const baseAspect = baseWidth / Math.max(1, baseHeight);
    let width = baseWidth;
    let height = baseHeight;
    if (aspect > baseAspect) width = baseHeight * aspect;
    else height = baseWidth / aspect;
    return { x: baseX - (width - baseWidth) / 2, y: baseY - (height - baseHeight) / 2, width, height, baseWidth, baseHeight };
  }
  function visibleViewport(svg, zoom = state.zoom) {
    const base = baseViewport(svg) || { x: 0, y: 0, width: 1, height: 1 };
    const normalized = normalizeZoom(zoom);
    const width = base.width / normalized;
    const height = base.height / normalized;
    return {
      x: Math.max(base.x, Math.min(base.x + base.width - width, Number(state.viewX) || 0)),
      y: Math.max(base.y, Math.min(base.y + base.height - height, Number(state.viewY) || 0)),
      width,
      height
    };
  }
  function applyViewBox() {
    const svg = container.querySelector(".route-map-stage svg");
    if (!svg) return;
    const viewport = visibleViewport(svg, state.zoom);
    state.viewX = viewport.x;
    state.viewY = viewport.y;
    svg.setAttribute("viewBox", `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
  }
  function saveViewport() {
    if (!state.signature || !container.querySelector(".route-map-stage")) return;
    state.views[state.mode] = { signature: state.signature, zoom: state.zoom, viewX: state.viewX, viewY: state.viewY };
  }
  function restoreViewport(viewport = {}) {
    state.zoom = normalizeZoom(viewport.zoom);
    state.viewX = Number(viewport.viewX) || 0;
    state.viewY = Number(viewport.viewY) || 0;
    state.views[state.mode] = { signature: state.signature, zoom: state.zoom, viewX: state.viewX, viewY: state.viewY };
    applyZoom();
    saveViewport();
  }

  return Object.freeze({ bind, setMode, render, clear, applyZoom });
}
