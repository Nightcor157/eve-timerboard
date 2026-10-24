import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { projectRoot } from "./helpers/server.mjs";

const html = await readFile(resolve(projectRoot, "index.html"), "utf8");
assert.match(html, /Content-Security-Policy/i);
assert.match(html, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/i);
assert.match(html, /connect-src 'self' https:\/\/\*\.supabase\.co https:\/\/esi\.evetech\.net/i);
assert.match(html, /@supabase\/supabase-js@2\.118\.0/);
assert.doesNotMatch(html, /@supabase\/supabase-js@2(?:["/])/);
assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+"/);
assert.match(html, /crossorigin="anonymous"/);

const app = await readFile(resolve(projectRoot, "js/app.js"), "utf8");
const routes = await readFile(resolve(projectRoot, "js/routes.js"), "utf8");
assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\(ADMIN_KEY_STORAGE/);
assert.doesNotMatch(routes, /localStorage\.(?:getItem|setItem)\(FLEET_KEY_PREFIX/);
assert.match(app, /sessionStorage\.setItem\(ADMIN_KEY_STORAGE/);
assert.match(routes, /sessionStorage\.setItem\(FLEET_KEY_PREFIX/);

const sql = await readFile(resolve(projectRoot, "supabase/schema.sql"), "utf8");
assert.doesNotMatch(sql, /\b(?:drop\s+table|truncate)\b/i, "schema.sql contains destructive setup SQL");
assert.match(sql, /create or replace function public\.clear_timer_history[\s\S]*perform public\.assert_timerboard_admin[\s\S]*delete from public\.timers/i);

console.log("PASS pinned browser dependency, CSP and unified schema safety");
