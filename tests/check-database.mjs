import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { projectRoot } from "./helpers/server.mjs";

const schema = await readFile(resolve(projectRoot, "supabase/schema.sql"), "utf8");
const migrationDirectory = resolve(projectRoot, "supabase/migrations");
const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
const migrations = await Promise.all(migrationFiles.map((file) => readFile(resolve(migrationDirectory, file), "utf8")));
const db = await PGlite.create({ extensions: { pgcrypto } });

try {
  await db.exec("create role anon; create role authenticated;");
  await db.exec(schema);
  await db.query("select public.setup_timerboard($1, $2)", ["main", "admin-test-key"]);

  const objectNames = ["Metenox Moon Drill", "Athanor", "Customs Office"];
  const validTimers = Array.from({ length: 40 }, (_, index) => timerPayload(
    `System ${index + 1}`,
    objectNames[index % objectNames.length],
    index % 2 ? "Атака" : "Оборона",
    `2030-05-${String((index % 28) + 1).padStart(2, "0")}T13:08:10Z`
  ));
  const added = await db.query(
    "select * from public.add_timers($1, $2, $3::jsonb)",
    ["main", "admin-test-key", JSON.stringify(validTimers)]
  );
  assert.equal(added.rows.length, 40);

  const countBeforeFailure = await timerCount(db);
  await assert.rejects(
    db.query(
      "select * from public.add_timers($1, $2, $3::jsonb)",
      ["main", "admin-test-key", JSON.stringify([
        timerPayload("Jita", "Customs Office", "Оборона", "2030-05-22T15:08:10Z"),
        timerPayload("Hek", "Athanor", "Недопустимо", "2030-05-22T16:08:10Z")
      ])]
    ),
    /invalid timer kind at item 2/i
  );
  assert.equal(await timerCount(db), countBeforeFailure);

  const original = added.rows[0];
  const patched = await db.query(
    "select * from public.patch_timer_admin_fields($1, $2, $3, $4::jsonb, $5::timestamptz)",
    ["main", "admin-test-key", original.id, JSON.stringify({ system: "New Hakatiz" }), original.updated_at]
  );
  assert.equal(patched.rows[0].system, "New Hakatiz");
  assert.equal(patched.rows[0].owner, original.owner);

  await assert.rejects(
    db.query(
      "select * from public.patch_timer_admin_fields($1, $2, $3, $4::jsonb, $5::timestamptz)",
      ["main", "admin-test-key", original.id, JSON.stringify({ owner: "Stale Alliance" }), original.updated_at]
    ),
    /timer update conflict/i
  );

  const withResult = await db.query(
    "select * from public.patch_timer_admin_fields($1, $2, $3, $4::jsonb, $5::timestamptz)",
    ["main", "admin-test-key", original.id, JSON.stringify({ note: "Защищена" }), patched.rows[0].updated_at]
  );
  assert.equal(await resultEventCount(db, original.id), 1);
  const sameResult = await db.query(
    "select * from public.patch_timer_admin_fields($1, $2, $3, $4::jsonb, $5::timestamptz)",
    ["main", "admin-test-key", original.id, JSON.stringify({ note: "Защищена" }), withResult.rows[0].updated_at]
  );
  assert.equal(sameResult.rows[0].note, "Защищена");
  assert.equal(await resultEventCount(db, original.id), 1);

  const legacy = await db.query(`
    select
      to_regprocedure('public.add_timer(text,text,text,text,text,text,text,text,text,text,timestamptz,text)') is not null as add_timer_exists,
      to_regprocedure('public.update_timer_admin_fields(text,text,uuid,text,text,text,text,text,text,text,timestamptz,text)') is not null as update_timer_exists
  `);
  assert.equal(legacy.rows[0].add_timer_exists, true);
  assert.equal(legacy.rows[0].update_timer_exists, true);

  await db.exec(schema);
  assert.equal(await timerCount(db), countBeforeFailure);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const migration of migrations) await db.exec(migration);
  }
  assert.equal(await timerCount(db), countBeforeFailure);

  await assert.rejects(
    db.query("select public.setup_timerboard($1, $2)", ["short-key-board", "too-short"]),
    /at least 12 characters/i
  );
  await assert.rejects(
    db.query("select public.set_timerboard_view_key($1, $2, $3)", ["main", "admin-test-key", "short"]),
    /at least 12 characters/i
  );
  await db.query("select public.set_timerboard_view_key($1, $2, $3)", ["main", "admin-test-key", "view-test-key-12"]);
  await assert.rejects(
    db.query(`
      insert into public.timers (board_id, raw_text, end_at, distance)
      values ('main', 'invalid kind', now(), 'Недопустимо')
    `),
    /timers_distance_values_chk/i
  );
  console.log(`PASS Supabase schema, ${migrations.length} migrations and data safety`);
} finally {
  await db.close();
}

function timerPayload(system, objectName, distance, endAt) {
  return {
    raw_text: `${system} timer`,
    title: "Test Corporation",
    system,
    object_name: objectName,
    structure: `${system} I`,
    owner: "Test Alliance",
    distance,
    mode: "Reinforced",
    end_at: endAt,
    note: ""
  };
}

async function timerCount(database) {
  const result = await database.query("select count(*)::integer as count from public.timers where board_id = 'main'");
  return result.rows[0].count;
}

async function resultEventCount(database, timerId) {
  const result = await database.query(
    "select count(*)::integer as count from public.timer_result_events where timer_id = $1",
    [timerId]
  );
  return result.rows[0].count;
}
