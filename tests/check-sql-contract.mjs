import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { projectRoot } from "./helpers/server.mjs";

const sql = await readFile(resolve(projectRoot, "supabase/schema.sql"), "utf8");

assert.match(sql, /create or replace function public\.add_timers\s*\(/i);
assert.match(sql, /jsonb_typeof\(p_timers\)\s*<>\s*'array'/i);
assert.match(sql, /jsonb_array_length\(p_timers\)\s*>\s*100/i);
assert.match(sql, /create or replace function public\.patch_timer_admin_fields\s*\(/i);
assert.match(sql, /jsonb_object_keys\(p_changes\)/i);
assert.match(sql, /updated_at\s*=\s*p_expected_updated_at/i);
assert.match(sql, /timer update conflict/i);
assert.match(sql, /is distinct from v_timer\.note/i);

assert.match(sql, /create or replace function public\.add_timer\s*\(/i);
assert.match(sql, /create function public\.update_timer_admin_fields\s*\(/i);
assert.match(sql, /create or replace function public\.clear_timer_history\s*\(/i);
assert.match(sql, /clear_timer_history[\s\S]*assert_timerboard_admin[\s\S]*delete from public\.timers/i);
assert.match(sql, /grant execute on function public\.add_timers\s*\(\s*text,\s*text,\s*jsonb\s*\)/is);
assert.match(sql, /grant execute on function public\.patch_timer_admin_fields\s*\(\s*text,\s*text,\s*uuid,\s*jsonb,\s*timestamptz\s*\)/is);
assert.match(sql, /revoke execute on all functions in schema public from public/i);
assert.match(sql, /timers_distance_values_chk[\s\S]*not valid/i);
assert.match(sql, /timers_note_values_chk[\s\S]*not valid/i);
assert.match(sql, /admin key must be at least 12 characters/i);
assert.match(sql, /view key must be at least 12 characters/i);

console.log("PASS Supabase data-safety contracts");
