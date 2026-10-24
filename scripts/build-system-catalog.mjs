import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const [systemsPath, stargatesPath, outputPath = "data/solar-systems.json", build = "unknown"] = process.argv.slice(2);

if (!systemsPath || !stargatesPath) {
  console.error("Usage: node scripts/build-system-catalog.mjs <mapSolarSystems.jsonl> <mapStargates.jsonl> [output] [build]");
  process.exit(1);
}

const systems = new Map();

async function readJsonLines(path, onRow) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) onRow(JSON.parse(line));
  }
}

await readJsonLines(systemsPath, (row) => {
  const id = Number(row._key);
  if (id < 30000000 || id > 30999999 || !row.position2D) return;
  systems.set(id, {
    id,
    name: row.name && (row.name.en || row.name.ru) || String(id),
    x: Number(row.position2D.x),
    y: Number(row.position2D.y),
    security: Number(row.securityStatus || 0),
    regionId: Number(row.regionID || 0),
    neighbors: new Set()
  });
});

await readJsonLines(stargatesPath, (row) => {
  const from = Number(row.solarSystemID);
  const to = Number(row.destination && row.destination.solarSystemID);
  if (!systems.has(from) || !systems.has(to)) return;
  systems.get(from).neighbors.add(to);
  systems.get(to).neighbors.add(from);
});

const payload = {
  source: "CCP Games EVE Online Static Data Export",
  sourceUrl: "https://developers.eveonline.com/static-data/",
  build: String(build),
  generatedAt: new Date().toISOString(),
  systems: [...systems.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((system) => ({
      ...system,
      neighbors: [...system.neighbors].sort((a, b) => a - b)
    }))
};

const destination = resolve(outputPath);
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(payload));
console.log(`Wrote ${payload.systems.length} systems to ${destination}`);
