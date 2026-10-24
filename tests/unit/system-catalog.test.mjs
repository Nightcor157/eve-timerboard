import assert from "node:assert/strict";
import test from "node:test";
import { createSystemCatalogService } from "../../js/services/system-catalog.js";

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => payload };
}

test("loads, indexes and routes through the local system graph", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === "/systems") return jsonResponse({ systems: [
      { id: 1, name: "Alpha", x: 0, y: 0, regionId: 10, neighbors: [2] },
      { id: 2, name: "Beta", x: 1, y: 0, regionId: 10, neighbors: [1, 3] },
      { id: 3, name: "Gamma", x: 2, y: 0, regionId: 11, neighbors: [2] }
    ] });
    if (url === "/regions") return jsonResponse({ regions: [
      { id: 10, name: "North" }, { id: 11, name: "South" }
    ] });
    throw new Error(`Unexpected request: ${url}`);
  };
  const catalog = createSystemCatalogService({
    systemCatalogUrl: "/systems",
    regionCatalogUrl: "/regions",
    fetchImpl
  });

  await catalog.load();
  assert.equal(catalog.findByName(" alpha ").id, 1);
  assert.equal(catalog.regionById.get(10), "North");
  assert.deepEqual(catalog.suggestions("ga").map((item) => item.name), ["Gamma"]);
  assert.deepEqual(await catalog.getRoute(1, 3), [1, 2, 3]);
  assert.equal(requests.length, 2, "local route must not call ESI");
});

test("resolves missing names through ESI while retaining local names", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url === "/systems") return jsonResponse({ systems: [
      { id: 1, name: "Alpha", x: 0, y: 0, regionId: 10, neighbors: [] }
    ] });
    if (url === "/regions") return jsonResponse({ regions: [] });
    assert.equal(options.method, "POST");
    return jsonResponse({ systems: [{ id: 9, name: "Remote" }] });
  };
  const catalog = createSystemCatalogService({
    systemCatalogUrl: "/systems",
    regionCatalogUrl: "/regions",
    esiBase: "https://esi.test",
    fetchImpl
  });

  const names = await catalog.resolveSystemNames(["Alpha", "Remote"]);
  assert.equal(names.get("alpha").id, 1);
  assert.equal(names.get("remote").id, 9);
});
