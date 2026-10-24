-- EVE Timerboard: полная схема Supabase.
-- Скрипт можно запускать повторно: существующие таймеры не удаляются.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.timerboard_settings (
  board_id text primary key,
  admin_key_hash text not null,
  view_key_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.timerboard_settings
add column if not exists view_key_hash text;

create table if not exists public.timers (
  id uuid primary key default gen_random_uuid(),
  board_id text not null default 'main',
  raw_text text not null default '',
  title text not null default '',
  system text not null default '',
  object_name text not null default '',
  structure text not null default '',
  owner text not null default '',
  distance text not null default '',
  mode text not null default '',
  end_at timestamptz not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'timers_distance_values_chk'
      and conrelid = 'public.timers'::regclass
  ) then
    alter table public.timers
      add constraint timers_distance_values_chk
      check (distance in ('', 'Атака', 'Оборона')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'timers_note_values_chk'
      and conrelid = 'public.timers'::regclass
  ) then
    alter table public.timers
      add constraint timers_note_values_chk
      check (note in ('', 'Защищена', 'Уничтожена')) not valid;
  end if;
end;
$$;

create table if not exists public.fleet_profiles (
  id uuid primary key default gen_random_uuid(),
  board_id text not null default 'main',
  name text not null,
  color text not null default '#27a7d8',
  current_system text not null default '',
  seconds_per_jump integer not null default 60,
  service_minutes integer not null default 10,
  key_hash text not null,
  key_hint text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, name),
  check (seconds_per_jump between 5 and 3600),
  check (service_minutes between 0 and 240)
);

create table if not exists public.fleet_assignments (
  id uuid primary key default gen_random_uuid(),
  board_id text not null default 'main',
  fleet_id uuid not null references public.fleet_profiles(id) on delete cascade,
  timer_id uuid not null references public.timers(id) on delete cascade,
  route_order integer not null,
  jump_count integer not null default 0,
  eta_at timestamptz not null,
  route_nodes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, timer_id),
  unique (fleet_id, timer_id),
  check (route_order > 0),
  check (jump_count >= 0),
  check (jsonb_typeof(route_nodes) = 'array')
);

create table if not exists public.timer_result_events (
  id uuid primary key default gen_random_uuid(),
  board_id text not null default 'main',
  timer_id uuid not null references public.timers(id) on delete cascade,
  actor_type text not null,
  fleet_id uuid references public.fleet_profiles(id) on delete set null,
  previous_result text not null default '',
  new_result text not null default '',
  created_at timestamptz not null default now(),
  check (actor_type in ('admin', 'fleet')),
  check (previous_result in ('', 'Защищена', 'Уничтожена')),
  check (new_result in ('', 'Защищена', 'Уничтожена'))
);

create index if not exists timers_board_end_idx
on public.timers (board_id, end_at);

create index if not exists timers_board_system_idx
on public.timers (board_id, system);

create index if not exists fleet_profiles_board_idx
on public.fleet_profiles (board_id, active, name);

create index if not exists fleet_assignments_board_fleet_idx
on public.fleet_assignments (board_id, fleet_id, route_order);

create index if not exists timer_result_events_board_timer_idx
on public.timer_result_events (board_id, timer_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists timers_set_updated_at on public.timers;
create trigger timers_set_updated_at
before update on public.timers
for each row execute function public.set_updated_at();

drop trigger if exists timerboard_settings_set_updated_at on public.timerboard_settings;
create trigger timerboard_settings_set_updated_at
before update on public.timerboard_settings
for each row execute function public.set_updated_at();

drop trigger if exists fleet_profiles_set_updated_at on public.fleet_profiles;
create trigger fleet_profiles_set_updated_at
before update on public.fleet_profiles
for each row execute function public.set_updated_at();

drop trigger if exists fleet_assignments_set_updated_at on public.fleet_assignments;
create trigger fleet_assignments_set_updated_at
before update on public.fleet_assignments
for each row execute function public.set_updated_at();

alter table public.timerboard_settings enable row level security;
alter table public.timers enable row level security;
alter table public.fleet_profiles enable row level security;
alter table public.fleet_assignments enable row level security;
alter table public.timer_result_events enable row level security;

-- Удаляется только старая политика открытого чтения, данные не затрагиваются.
drop policy if exists "timers_public_read" on public.timers;

create or replace function public.setup_timerboard(
  p_board_id text,
  p_admin_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_board_id is null or length(trim(p_board_id)) = 0 then
    raise exception 'board_id is required';
  end if;

  if p_admin_key is null or length(p_admin_key) < 12 then
    raise exception 'admin key must be at least 12 characters';
  end if;

  insert into public.timerboard_settings (board_id, admin_key_hash)
  values (trim(p_board_id), crypt(p_admin_key, gen_salt('bf')))
  on conflict (board_id) do update
    set admin_key_hash = crypt(p_admin_key, gen_salt('bf')),
        updated_at = now();
end;
$$;

create or replace function public.assert_timerboard_admin(
  p_board_id text,
  p_admin_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select admin_key_hash into v_hash
  from public.timerboard_settings
  where board_id = trim(p_board_id);

  if v_hash is null then
    raise exception 'timerboard is not configured';
  end if;

  if p_admin_key is null
     or length(p_admin_key) = 0
     or crypt(p_admin_key, v_hash) <> v_hash then
    raise exception 'wrong admin key' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.set_timerboard_view_key(
  p_board_id text,
  p_admin_key text,
  p_view_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  if p_view_key is null or length(p_view_key) < 12 then
    raise exception 'view key must be at least 12 characters';
  end if;

  update public.timerboard_settings
  set view_key_hash = crypt(p_view_key, gen_salt('bf')),
      updated_at = now()
  where board_id = trim(p_board_id);

  if not found then
    raise exception 'timerboard is not configured';
  end if;
end;
$$;

create or replace function public.assert_timerboard_viewer(
  p_board_id text,
  p_view_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin_hash text;
  v_view_hash text;
begin
  select admin_key_hash, view_key_hash into v_admin_hash, v_view_hash
  from public.timerboard_settings
  where board_id = trim(p_board_id);

  if v_admin_hash is null then
    raise exception 'timerboard is not configured';
  end if;

  if p_view_key is not null
     and length(p_view_key) > 0
     and crypt(p_view_key, v_admin_hash) = v_admin_hash then
    return;
  end if;

  if v_view_hash is null then
    raise exception 'view key is not configured' using errcode = '28000';
  end if;

  if p_view_key is null
     or length(p_view_key) = 0
     or crypt(p_view_key, v_view_hash) <> v_view_hash then
    raise exception 'wrong view key' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.get_timers(
  p_board_id text,
  p_view_key text
)
returns setof public.timers
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_viewer(trim(p_board_id), p_view_key);

  return query
  select t.*
  from public.timers as t
  where t.board_id = trim(p_board_id)
  order by t.end_at asc;
end;
$$;

create or replace function public.add_timer(
  p_board_id text,
  p_admin_key text,
  p_raw_text text,
  p_title text,
  p_system text,
  p_object_name text,
  p_structure text,
  p_owner text,
  p_distance text,
  p_mode text,
  p_end_at timestamptz,
  p_note text default ''
)
returns public.timers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_timer public.timers;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  insert into public.timers (
    board_id, raw_text, title, system, object_name, structure,
    owner, distance, mode, end_at, note
  ) values (
    trim(p_board_id), coalesce(p_raw_text, ''), coalesce(p_title, ''),
    coalesce(p_system, ''), coalesce(p_object_name, ''),
    coalesce(p_structure, ''), coalesce(p_owner, ''),
    coalesce(p_distance, ''), coalesce(p_mode, ''), p_end_at,
    coalesce(p_note, '')
  )
  returning * into v_timer;

  return v_timer;
end;
$$;

create or replace function public.add_timers(
  p_board_id text,
  p_admin_key text,
  p_timers jsonb
)
returns setof public.timers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item jsonb;
  v_index integer := 0;
  v_end_at timestamptz;
  v_object_name text;
  v_timer_kind text;
  v_note text;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  if p_timers is null or jsonb_typeof(p_timers) <> 'array' then
    raise exception 'timers payload must be a JSON array';
  end if;

  if jsonb_array_length(p_timers) = 0 then
    raise exception 'timers payload must not be empty';
  end if;

  if jsonb_array_length(p_timers) > 100 then
    raise exception 'timers batch is limited to 100 items';
  end if;

  for v_item in select value from jsonb_array_elements(p_timers)
  loop
    v_index := v_index + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'timer item % must be a JSON object', v_index;
    end if;

    begin
      v_end_at := nullif(trim(v_item ->> 'end_at'), '')::timestamptz;
    exception when others then
      raise exception 'invalid timer end_at at item %', v_index;
    end;
    if v_end_at is null then
      raise exception 'timer end_at is required at item %', v_index;
    end if;

    v_object_name := coalesce(v_item ->> 'object_name', '');
    if v_object_name not in (
      '', 'Astrahus', 'Fortizar', 'Keepstar',
      'Raitaru', 'Azbel', 'Sotiyo',
      'Athanor', 'Tatara', 'Metenox Moon Drill',
      'Customs Office', 'IHub', 'TCU', 'POS'
    ) then
      raise exception 'invalid structure type at item %', v_index;
    end if;

    v_timer_kind := coalesce(v_item ->> 'distance', '');
    if v_timer_kind not in ('', 'Атака', 'Оборона') then
      raise exception 'invalid timer kind at item %', v_index;
    end if;

    v_note := coalesce(v_item ->> 'note', '');
    if v_note not in ('', 'Защищена', 'Уничтожена') then
      raise exception 'invalid timer result at item %', v_index;
    end if;
  end loop;

  return query
  insert into public.timers (
    board_id, raw_text, title, system, object_name, structure,
    owner, distance, mode, end_at, note
  )
  select
    trim(p_board_id), coalesce(item ->> 'raw_text', ''),
    coalesce(item ->> 'title', ''), coalesce(item ->> 'system', ''),
    coalesce(item ->> 'object_name', ''), coalesce(item ->> 'structure', ''),
    coalesce(item ->> 'owner', ''), coalesce(item ->> 'distance', ''),
    coalesce(item ->> 'mode', ''), (item ->> 'end_at')::timestamptz,
    coalesce(item ->> 'note', '')
  from jsonb_array_elements(p_timers) as payload(item)
  returning *;
end;
$$;

create or replace function public.patch_timer_admin_fields(
  p_board_id text,
  p_admin_key text,
  p_id uuid,
  p_changes jsonb,
  p_expected_updated_at timestamptz
)
returns public.timers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current public.timers;
  v_timer public.timers;
  v_key text;
  v_end_at timestamptz;
  v_object_name text;
  v_timer_kind text;
  v_note text;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'timer changes must be a JSON object';
  end if;
  if p_changes = '{}'::jsonb then
    raise exception 'timer changes must not be empty';
  end if;

  for v_key in select jsonb_object_keys(p_changes)
  loop
    if v_key not in (
      'title', 'system', 'object_name', 'structure', 'owner',
      'distance', 'mode', 'end_at', 'note'
    ) then
      raise exception 'unsupported timer field: %', v_key;
    end if;
  end loop;

  select t.* into v_current
  from public.timers as t
  where t.board_id = trim(p_board_id) and t.id = p_id;
  if not found then
    raise exception 'timer not found';
  end if;

  if p_changes ? 'object_name' then
    v_object_name := coalesce(p_changes ->> 'object_name', '');
    if v_object_name not in (
      '', 'Astrahus', 'Fortizar', 'Keepstar',
      'Raitaru', 'Azbel', 'Sotiyo',
      'Athanor', 'Tatara', 'Metenox Moon Drill',
      'Customs Office', 'IHub', 'TCU', 'POS'
    ) then
      raise exception 'invalid structure type';
    end if;
  end if;

  if p_changes ? 'distance' then
    v_timer_kind := coalesce(p_changes ->> 'distance', '');
    if v_timer_kind not in ('', 'Атака', 'Оборона') then
      raise exception 'invalid timer kind';
    end if;
  end if;

  if p_changes ? 'note' then
    v_note := coalesce(p_changes ->> 'note', '');
    if v_note not in ('', 'Защищена', 'Уничтожена') then
      raise exception 'invalid timer result';
    end if;
  end if;

  if p_changes ? 'end_at' then
    begin
      v_end_at := nullif(trim(p_changes ->> 'end_at'), '')::timestamptz;
    exception when others then
      raise exception 'invalid timer end_at';
    end;
    if v_end_at is null then
      raise exception 'timer end_at is required';
    end if;
  end if;

  update public.timers as t
  set title = case when p_changes ? 'title' then coalesce(p_changes ->> 'title', '') else t.title end,
      system = case when p_changes ? 'system' then coalesce(p_changes ->> 'system', '') else t.system end,
      object_name = case when p_changes ? 'object_name' then v_object_name else t.object_name end,
      structure = case when p_changes ? 'structure' then coalesce(p_changes ->> 'structure', '') else t.structure end,
      owner = case when p_changes ? 'owner' then coalesce(p_changes ->> 'owner', '') else t.owner end,
      distance = case when p_changes ? 'distance' then v_timer_kind else t.distance end,
      mode = case when p_changes ? 'mode' then coalesce(p_changes ->> 'mode', '') else t.mode end,
      end_at = case when p_changes ? 'end_at' then v_end_at else t.end_at end,
      note = case when p_changes ? 'note' then v_note else t.note end
  where t.board_id = trim(p_board_id)
    and t.id = p_id
    and t.updated_at = p_expected_updated_at
  returning t.* into v_timer;

  if v_timer.id is null then
    raise exception 'timer update conflict' using errcode = '40001';
  end if;

  if coalesce(v_current.note, '') is distinct from v_timer.note then
    insert into public.timer_result_events (
      board_id, timer_id, actor_type, previous_result, new_result
    ) values (
      trim(p_board_id), p_id, 'admin',
      coalesce(v_current.note, ''), v_timer.note
    );
  end if;

  return v_timer;
end;
$$;

-- Удаляем старые варианты функции, чтобы PostgREST не путал сигнатуры.
drop function if exists public.update_timer_admin_fields(text, text, uuid, text, text);
drop function if exists public.update_timer_admin_fields(
  text, text, uuid, text, text, text, text, text, text, text, timestamptz
);
drop function if exists public.update_timer_admin_fields(
  text, text, uuid, text, text, text, text, text, text, text, timestamptz, text
);

create function public.update_timer_admin_fields(
  p_board_id text,
  p_admin_key text,
  p_id uuid,
  p_title text,
  p_system text,
  p_object_name text,
  p_structure text,
  p_owner text,
  p_timer_kind text,
  p_mode text,
  p_end_at timestamptz,
  p_note text
)
returns public.timers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_timer public.timers;
  v_previous_note text;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  select t.note into v_previous_note
  from public.timers as t
  where t.board_id = trim(p_board_id) and t.id = p_id;

  update public.timers
  set title = coalesce(p_title, ''),
      system = coalesce(p_system, ''),
      object_name = case
        when coalesce(p_object_name, '') in (
          'Astrahus', 'Fortizar', 'Keepstar',
          'Raitaru', 'Azbel', 'Sotiyo',
          'Athanor', 'Tatara', 'Metenox Moon Drill',
          'Customs Office', 'IHub', 'TCU', 'POS'
        ) then p_object_name
        else ''
      end,
      structure = coalesce(p_structure, ''),
      owner = coalesce(p_owner, ''),
      distance = case
        when coalesce(p_timer_kind, '') in ('Атака', 'Оборона') then p_timer_kind
        else ''
      end,
      mode = coalesce(p_mode, ''),
      end_at = p_end_at,
      note = case
        when coalesce(p_note, '') in ('Защищена', 'Уничтожена') then p_note
        else ''
      end
  where board_id = trim(p_board_id) and id = p_id
  returning * into v_timer;

  if v_timer.id is null then
    raise exception 'timer not found';
  end if;

  if coalesce(v_previous_note, '') is distinct from v_timer.note then
    insert into public.timer_result_events (
      board_id, timer_id, actor_type, previous_result, new_result
    ) values (
      trim(p_board_id), p_id, 'admin',
      coalesce(v_previous_note, ''), v_timer.note
    );
  end if;

  return v_timer;
end;
$$;

create or replace function public.delete_timer(
  p_board_id text,
  p_admin_key text,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  delete from public.timers
  where board_id = trim(p_board_id) and id = p_id;
end;
$$;

-- Удаляет только завершённую историю. Активные таймеры и текущие окна ремонта
-- остаются на доске. Условия совпадают с фазами в js/app.js.
create or replace function public.clear_timer_history(
  p_board_id text,
  p_admin_key text
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_deleted integer;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  delete from public.timers
  where board_id = trim(p_board_id)
    and (
      note in ('Защищена', 'Уничтожена')
      or end_at + case
        when object_name = 'Customs Office' then interval '2 hours'
        when object_name in ('Metenox Moon Drill', 'IHub', 'TCU', 'POS') then interval '30 minutes'
        else interval '15 minutes'
      end <= now()
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.assert_fleet_access(
  p_board_id text,
  p_fleet_id uuid,
  p_fleet_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select f.key_hash into v_hash
  from public.fleet_profiles as f
  where f.board_id = trim(p_board_id)
    and f.id = p_fleet_id
    and f.active = true;

  if v_hash is null then
    raise exception 'fleet not found or inactive';
  end if;

  if p_fleet_key is null
     or length(p_fleet_key) = 0
     or crypt(p_fleet_key, v_hash) <> v_hash then
    raise exception 'wrong fleet key' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.list_fleets(
  p_board_id text,
  p_view_key text
)
returns table (
  fleet_id uuid,
  fleet_name text,
  fleet_color text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_viewer(trim(p_board_id), p_view_key);

  return query
  select f.id, f.name, f.color
  from public.fleet_profiles as f
  where f.board_id = trim(p_board_id) and f.active = true
  order by f.name;
end;
$$;

create or replace function public.list_fleets_admin(
  p_board_id text,
  p_admin_key text
)
returns table (
  fleet_id uuid,
  fleet_name text,
  fleet_color text,
  current_system text,
  seconds_per_jump integer,
  service_minutes integer,
  key_hint text,
  active boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  return query
  select
    f.id, f.name, f.color, f.current_system, f.seconds_per_jump,
    f.service_minutes, f.key_hint, f.active, f.updated_at
  from public.fleet_profiles as f
  where f.board_id = trim(p_board_id)
  order by f.active desc, f.name;
end;
$$;

create or replace function public.create_fleet(
  p_board_id text,
  p_admin_key text,
  p_name text,
  p_color text,
  p_current_system text,
  p_seconds_per_jump integer,
  p_service_minutes integer
)
returns table (
  fleet_id uuid,
  fleet_name text,
  generated_key text,
  key_hint text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_system text := trim(coalesce(p_current_system, ''));
  v_color text;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  if length(v_name) = 0 or length(v_name) > 60 then
    raise exception 'fleet name is required and must be at most 60 characters';
  end if;
  if length(v_system) = 0 then
    raise exception 'fleet current system is required';
  end if;
  if coalesce(p_seconds_per_jump, 0) not between 5 and 3600 then
    raise exception 'seconds per jump must be between 5 and 3600';
  end if;
  if coalesce(p_service_minutes, -1) not between 0 and 240 then
    raise exception 'service minutes must be between 0 and 240';
  end if;

  v_color := case
    when coalesce(p_color, '') ~ '^#[0-9a-fA-F]{6}$' then p_color
    else '#27a7d8'
  end;
  v_key := upper(encode(gen_random_bytes(12), 'hex'));

  insert into public.fleet_profiles (
    board_id, name, color, current_system, seconds_per_jump,
    service_minutes, key_hash, key_hint
  ) values (
    trim(p_board_id), v_name, v_color, v_system, p_seconds_per_jump,
    p_service_minutes, crypt(v_key, gen_salt('bf')), right(v_key, 4)
  )
  returning id into v_id;

  return query select v_id, v_name, v_key, right(v_key, 4);
end;
$$;

create or replace function public.update_fleet(
  p_board_id text,
  p_admin_key text,
  p_fleet_id uuid,
  p_name text,
  p_color text,
  p_current_system text,
  p_seconds_per_jump integer,
  p_service_minutes integer,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_system text := trim(coalesce(p_current_system, ''));
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  if length(v_name) = 0 or length(v_name) > 60 then
    raise exception 'fleet name is required and must be at most 60 characters';
  end if;
  if length(v_system) = 0 then
    raise exception 'fleet current system is required';
  end if;
  if coalesce(p_seconds_per_jump, 0) not between 5 and 3600 then
    raise exception 'seconds per jump must be between 5 and 3600';
  end if;
  if coalesce(p_service_minutes, -1) not between 0 and 240 then
    raise exception 'service minutes must be between 0 and 240';
  end if;

  update public.fleet_profiles
  set name = v_name,
      color = case
        when coalesce(p_color, '') ~ '^#[0-9a-fA-F]{6}$' then p_color
        else '#27a7d8'
      end,
      current_system = v_system,
      seconds_per_jump = p_seconds_per_jump,
      service_minutes = p_service_minutes,
      active = coalesce(p_active, true)
  where board_id = trim(p_board_id) and id = p_fleet_id;

  if not found then
    raise exception 'fleet not found';
  end if;
end;
$$;

create or replace function public.rotate_fleet_key(
  p_board_id text,
  p_admin_key text,
  p_fleet_id uuid
)
returns table (
  fleet_id uuid,
  generated_key text,
  key_hint text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);
  v_key := upper(encode(gen_random_bytes(12), 'hex'));

  update public.fleet_profiles
  set key_hash = crypt(v_key, gen_salt('bf')),
      key_hint = right(v_key, 4)
  where board_id = trim(p_board_id) and id = p_fleet_id;

  if not found then
    raise exception 'fleet not found';
  end if;

  return query select p_fleet_id, v_key, right(v_key, 4);
end;
$$;

create or replace function public.delete_fleet(
  p_board_id text,
  p_admin_key text,
  p_fleet_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  delete from public.fleet_profiles
  where board_id = trim(p_board_id) and id = p_fleet_id;

  if not found then
    raise exception 'fleet not found';
  end if;
end;
$$;

create or replace function public.replace_fleet_assignments(
  p_board_id text,
  p_admin_key text,
  p_assignments jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item jsonb;
  v_fleet_id uuid;
  v_timer_id uuid;
  v_count integer := 0;
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'assignments must be a JSON array';
  end if;

  delete from public.fleet_assignments
  where board_id = trim(p_board_id);

  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    v_fleet_id := (v_item ->> 'fleet_id')::uuid;
    v_timer_id := (v_item ->> 'timer_id')::uuid;

    if not exists (
      select 1 from public.fleet_profiles as f
      where f.id = v_fleet_id
        and f.board_id = trim(p_board_id)
        and f.active = true
    ) then
      raise exception 'invalid fleet in assignment';
    end if;

    if not exists (
      select 1 from public.timers as t
      where t.id = v_timer_id and t.board_id = trim(p_board_id)
    ) then
      raise exception 'invalid timer in assignment';
    end if;

    insert into public.fleet_assignments (
      board_id, fleet_id, timer_id, route_order, jump_count, eta_at, route_nodes
    ) values (
      trim(p_board_id),
      v_fleet_id,
      v_timer_id,
      (v_item ->> 'route_order')::integer,
      (v_item ->> 'jump_count')::integer,
      (v_item ->> 'eta_at')::timestamptz,
      coalesce(v_item -> 'route_nodes', '[]'::jsonb)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Старую сигнатуру удаляем: маршрут флота теперь требует также ключ просмотра.
drop function if exists public.get_fleet_route(text, uuid, text);

create or replace function public.get_fleet_route(
  p_board_id text,
  p_view_key text,
  p_fleet_id uuid,
  p_fleet_key text
)
returns table (
  fleet_id uuid,
  fleet_name text,
  fleet_color text,
  fleet_current_system text,
  seconds_per_jump integer,
  service_minutes integer,
  assignment_id uuid,
  timer_id uuid,
  route_order integer,
  jump_count integer,
  eta_at timestamptz,
  route_nodes jsonb,
  timer_system text,
  object_name text,
  structure text,
  corporation text,
  alliance text,
  timer_kind text,
  mode text,
  end_at timestamptz,
  result text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_viewer(trim(p_board_id), p_view_key);
  perform public.assert_fleet_access(trim(p_board_id), p_fleet_id, p_fleet_key);

  return query
  select
    f.id, f.name, f.color, f.current_system, f.seconds_per_jump,
    f.service_minutes, a.id, t.id, a.route_order, a.jump_count,
    a.eta_at, a.route_nodes, t.system, t.object_name, t.structure,
    t.title, t.owner, t.distance, t.mode, t.end_at, t.note
  from public.fleet_assignments as a
  join public.fleet_profiles as f on f.id = a.fleet_id
  join public.timers as t on t.id = a.timer_id
  where a.board_id = trim(p_board_id) and a.fleet_id = p_fleet_id
  order by a.route_order;
end;
$$;

create or replace function public.get_all_fleet_routes(
  p_board_id text,
  p_admin_key text
)
returns table (
  fleet_id uuid,
  fleet_name text,
  fleet_color text,
  fleet_current_system text,
  seconds_per_jump integer,
  service_minutes integer,
  assignment_id uuid,
  timer_id uuid,
  route_order integer,
  jump_count integer,
  eta_at timestamptz,
  route_nodes jsonb,
  timer_system text,
  object_name text,
  structure text,
  corporation text,
  alliance text,
  timer_kind text,
  mode text,
  end_at timestamptz,
  result text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

  return query
  select
    f.id, f.name, f.color, f.current_system, f.seconds_per_jump,
    f.service_minutes, a.id, t.id, a.route_order, a.jump_count,
    a.eta_at, a.route_nodes, t.system, t.object_name, t.structure,
    t.title, t.owner, t.distance, t.mode, t.end_at, t.note
  from public.fleet_assignments as a
  join public.fleet_profiles as f on f.id = a.fleet_id
  join public.timers as t on t.id = a.timer_id
  where a.board_id = trim(p_board_id)
  order by f.name, a.route_order;
end;
$$;

-- Старую сигнатуру удаляем: командир должен иметь и доступ к доске, и ключ флота.
drop function if exists public.set_fleet_timer_result(text, text, uuid, uuid, text);

create or replace function public.set_fleet_timer_result(
  p_board_id text,
  p_view_key text,
  p_access_key text,
  p_fleet_id uuid,
  p_timer_id uuid,
  p_result text
)
returns public.timers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_timer public.timers;
  v_previous text;
  v_result text := coalesce(p_result, '');
  v_actor text;
begin
  perform public.assert_timerboard_viewer(trim(p_board_id), p_view_key);

  if v_result not in ('', 'Защищена', 'Уничтожена') then
    raise exception 'invalid timer result';
  end if;

  if p_fleet_id is null then
    perform public.assert_timerboard_admin(trim(p_board_id), p_access_key);
    v_actor := 'admin';
  else
    perform public.assert_fleet_access(trim(p_board_id), p_fleet_id, p_access_key);
    if not exists (
      select 1 from public.fleet_assignments as a
      where a.board_id = trim(p_board_id)
        and a.fleet_id = p_fleet_id
        and a.timer_id = p_timer_id
    ) then
      raise exception 'timer is not assigned to this fleet' using errcode = '42501';
    end if;
    v_actor := 'fleet';
  end if;

  select t.note into v_previous
  from public.timers as t
  where t.board_id = trim(p_board_id) and t.id = p_timer_id;

  if not found then
    raise exception 'timer not found';
  end if;

  update public.timers
  set note = v_result
  where board_id = trim(p_board_id) and id = p_timer_id
  returning * into v_timer;

  if coalesce(v_previous, '') is distinct from v_result then
    insert into public.timer_result_events (
      board_id, timer_id, actor_type, fleet_id, previous_result, new_result
    ) values (
      trim(p_board_id), p_timer_id, v_actor, p_fleet_id,
      coalesce(v_previous, ''), v_result
    );
  end if;

  return v_timer;
end;
$$;

grant usage on schema public to anon, authenticated;
revoke execute on all functions in schema public from public;
revoke all on table public.timerboard_settings from anon, authenticated;
revoke select, insert, update, delete on table public.timers from anon, authenticated;
revoke all on table public.fleet_profiles from anon, authenticated;
revoke all on table public.fleet_assignments from anon, authenticated;
revoke all on table public.timer_result_events from anon, authenticated;

revoke all on function public.setup_timerboard(text, text)
from public, anon, authenticated;
revoke all on function public.assert_timerboard_admin(text, text)
from public, anon, authenticated;
revoke all on function public.assert_timerboard_viewer(text, text)
from public, anon, authenticated;
revoke all on function public.assert_fleet_access(text, uuid, text)
from public, anon, authenticated;
revoke all on function public.clear_timer_history(text, text)
from public, anon, authenticated;
revoke all on function public.add_timers(text, text, jsonb)
from public;
revoke all on function public.patch_timer_admin_fields(
  text, text, uuid, jsonb, timestamptz
) from public;

grant execute on function public.get_timers(text, text)
to anon, authenticated;
grant execute on function public.set_timerboard_view_key(text, text, text)
to anon, authenticated;
grant execute on function public.add_timer(
  text, text, text, text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;
grant execute on function public.add_timers(text, text, jsonb)
to anon, authenticated;
grant execute on function public.patch_timer_admin_fields(
  text, text, uuid, jsonb, timestamptz
) to anon, authenticated;
grant execute on function public.update_timer_admin_fields(
  text, text, uuid, text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;
grant execute on function public.delete_timer(text, text, uuid)
to anon, authenticated;
grant execute on function public.clear_timer_history(text, text)
to anon, authenticated;
grant execute on function public.list_fleets(text, text)
to anon, authenticated;
grant execute on function public.list_fleets_admin(text, text)
to anon, authenticated;
grant execute on function public.create_fleet(
  text, text, text, text, text, integer, integer
) to anon, authenticated;
grant execute on function public.update_fleet(
  text, text, uuid, text, text, text, integer, integer, boolean
) to anon, authenticated;
grant execute on function public.rotate_fleet_key(text, text, uuid)
to anon, authenticated;
grant execute on function public.delete_fleet(text, text, uuid)
to anon, authenticated;
grant execute on function public.replace_fleet_assignments(text, text, jsonb)
to anon, authenticated;
grant execute on function public.get_fleet_route(text, text, uuid, text)
to anon, authenticated;
grant execute on function public.get_all_fleet_routes(text, text)
to anon, authenticated;
grant execute on function public.set_fleet_timer_result(text, text, text, uuid, uuid, text)
to anon, authenticated;

-- После успешного выполнения схемы запусти отдельно, заменив ключ:
-- select public.setup_timerboard('main', 'CHANGE_ME_ADMIN_KEY');
