const DEFAULT_ESI_BASE = "https://esi.evetech.net";
const DEFAULT_COMPATIBILITY_DATE = "2025-09-30";

export function createSystemCatalogService({
  systemCatalogUrl,
  regionCatalogUrl,
  esiBase = DEFAULT_ESI_BASE,
  compatibilityDate = DEFAULT_COMPATIBILITY_DATE,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") throw new Error("Для каталога систем нужен fetch.");

  let systems = [];
  let loadPromise = null;
  const systemById = new Map();
  const systemByName = new Map();
  const systemsByRegion = new Map();
  const regionById = new Map();
  const routeCache = new Map();
  const nameCache = new Map();
  const idNameCache = new Map();

  async function load() {
    if (systems.length) return systems;
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      fetchImpl(systemCatalogUrl).then((response) => {
        if (!response.ok) throw new Error(`Каталог систем не загрузился: HTTP ${response.status}`);
        return response.json();
      }),
      fetchImpl(regionCatalogUrl)
        .then((response) => response.ok ? response.json() : { regions: [] })
        .catch(() => ({ regions: [] }))
    ]).then(([payload, regionPayload]) => {
      const sourceSystems = Array.isArray(payload.systems) ? payload.systems : [];
      if (!sourceSystems.length) throw new Error("Каталог систем пуст.");
      const regions = Array.isArray(regionPayload.regions) ? regionPayload.regions : [];
      regions.forEach((region) => {
        const id = Number(region.id);
        if (id && region.name) regionById.set(id, String(region.name));
      });
      systems = sourceSystems.map(normalizeSystem);
      for (const system of systems) {
        systemById.set(system.id, system);
        systemByName.set(normalizeName(system.name), system);
        if (!systemsByRegion.has(system.regionId)) systemsByRegion.set(system.regionId, []);
        systemsByRegion.get(system.regionId).push(system);
        nameCache.set(normalizeName(system.name), { id: system.id, name: system.name });
        idNameCache.set(system.id, system.name);
      }
      return systems;
    }).catch((error) => {
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  function findByName(name) {
    return systemByName.get(normalizeName(name)) || null;
  }

  function suggestions(value, limit = 10) {
    const term = normalizeName(value);
    if (!term) return [];
    const prefix = [];
    const contains = [];
    for (const system of systems) {
      const name = normalizeName(system.name);
      if (name.startsWith(term)) prefix.push(system);
      else if (name.includes(term)) contains.push(system);
    }
    return prefix.concat(contains).slice(0, limit);
  }

  async function resolveSystemNames(names) {
    await load().catch(() => {});
    const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
    const missing = uniqueNames.filter((name) => !nameCache.has(normalizeName(name)));
    if (missing.length) {
      const data = await fetchJson(`${esiBase}/latest/universe/ids/?datasource=tranquility&language=en`, {
        method: "POST",
        body: JSON.stringify(missing)
      });
      for (const system of data.systems || []) {
        const normalized = { id: Number(system.id), name: system.name };
        nameCache.set(normalizeName(system.name), normalized);
        idNameCache.set(normalized.id, normalized.name);
      }
    }
    return nameCache;
  }

  async function resolveIdsToNames(ids) {
    const uniqueIds = [...new Set(ids.map(Number).filter(Number.isFinite))];
    const missing = uniqueIds.filter((id) => !idNameCache.has(id));
    for (let index = 0; index < missing.length; index += 1000) {
      const chunk = missing.slice(index, index + 1000);
      const data = await fetchJson(`${esiBase}/latest/universe/names/?datasource=tranquility`, {
        method: "POST",
        body: JSON.stringify(chunk)
      });
      for (const item of data || []) {
        if (item.category === "solar_system") idNameCache.set(Number(item.id), item.name);
      }
    }
    return idNameCache;
  }

  async function getRoute(originId, destinationId) {
    const origin = Number(originId);
    const destination = Number(destinationId);
    if (origin === destination) return [origin];
    const cacheKey = `${origin}:${destination}`;
    if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);

    await load().catch(() => {});
    const catalogRoute = findCatalogRoute(origin, destination);
    if (catalogRoute) {
      routeCache.set(cacheKey, catalogRoute);
      return catalogRoute;
    }

    let route;
    try {
      route = await fetchJson(`${esiBase}/route/${origin}/${destination}`, {
        method: "POST",
        body: JSON.stringify({ preference: "Shorter", security_penalty: 50 })
      });
      if (route && Array.isArray(route.route)) route = route.route;
    } catch (error) {
      if (!/404|405|compatibility/i.test(String(error && error.message))) throw error;
      route = await fetchJson(
        `${esiBase}/latest/route/${origin}/${destination}/?datasource=tranquility&flag=shortest`,
        { method: "GET" }
      );
    }
    if (!Array.isArray(route) || !route.length) throw new Error("ESI вернул пустой маршрут.");
    const normalized = route.map(Number);
    routeCache.set(cacheKey, normalized);
    return normalized;
  }

  function findCatalogRoute(origin, destination) {
    if (!systemById.has(origin) || !systemById.has(destination)) return null;
    const queue = [origin];
    const previous = new Map([[origin, null]]);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const system = systemById.get(current);
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

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Compatibility-Date": compatibilityDate,
          ...(options.headers || {})
        }
      });
      if (!response.ok) {
        let details = "";
        try { details = JSON.stringify(await response.json()); } catch (_error) { details = response.statusText; }
        throw new Error(`ESI ${response.status}: ${details}`);
      }
      return response.json();
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("ESI не ответил за 25 секунд.");
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  return {
    load,
    findByName,
    suggestions,
    resolveSystemNames,
    resolveIdsToNames,
    getRoute,
    findCatalogRoute,
    get systems() { return systems; },
    systemById,
    systemByName,
    systemsByRegion,
    regionById
  };
}

function normalizeSystem(system) {
  return {
    ...system,
    id: Number(system.id),
    x: Number(system.x),
    y: Number(system.y),
    security: Number(system.security || 0),
    regionId: Number(system.regionId || 0),
    neighbors: Array.isArray(system.neighbors) ? system.neighbors.map(Number) : []
  };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}
