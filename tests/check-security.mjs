import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { projectRoot } from "./helpers/server.mjs";

const html = await readFile(resolve(projectRoot, "index.html"), "utf8");
assert.match(html, /Content-Security-Policy/i);
assert.match(html, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/i);
assert.match(html, /connect-src 'self' https:\/\/\*\.supabase\.co https:\/\/esi\.evetech\.net/i);
assert.match(html, /@supabase\/supabase-js@2\.118\.0/);
assert.doesNotMatch(html, /@supabase\/supabase-js@2(?:["/])/);

const migrationDirectory = resolve(projectRoot, "supabase/migrations");
const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
assert.deepEqual(migrationFiles, [
  "20261024_001_atomic_timer_writes.sql",
  "20261024_002_security_hardening.sql"
]);
for (const file of migrationFiles) {
  const sql = await readFile(resolve(migrationDirectory, file), "utf8");
  assert.doesNotMatch(sql, /\b(?:drop\s+table|truncate|delete\s+from\s+public\.timers)\b/i, `${file} contains destructive SQL`);
}

console.log("PASS pinned browser dependency, CSP and migration safety");
