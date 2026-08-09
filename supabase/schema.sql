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

create index if not exists timers_board_end_idx
on public.timers (board_id, end_at);

create index if not exists timers_board_system_idx
on public.timers (board_id, system);

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

alter table public.timerboard_settings enable row level security;
alter table public.timers enable row level security;

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

  if p_admin_key is null or length(p_admin_key) < 6 then
    raise exception 'admin key must be at least 6 characters';
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

  if p_view_key is null or length(p_view_key) < 6 then
    raise exception 'view key must be at least 6 characters';
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
begin
  perform public.assert_timerboard_admin(trim(p_board_id), p_admin_key);

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

grant usage on schema public to anon, authenticated;
revoke all on table public.timerboard_settings from anon, authenticated;
revoke select, insert, update, delete on table public.timers from anon, authenticated;

revoke all on function public.setup_timerboard(text, text)
from public, anon, authenticated;
revoke all on function public.assert_timerboard_admin(text, text)
from public, anon, authenticated;
revoke all on function public.assert_timerboard_viewer(text, text)
from public, anon, authenticated;

grant execute on function public.get_timers(text, text)
to anon, authenticated;
grant execute on function public.set_timerboard_view_key(text, text, text)
to anon, authenticated;
grant execute on function public.add_timer(
  text, text, text, text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;
grant execute on function public.update_timer_admin_fields(
  text, text, uuid, text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;
grant execute on function public.delete_timer(text, text, uuid)
to anon, authenticated;

-- После успешного выполнения схемы запусти отдельно, заменив ключ:
-- select public.setup_timerboard('main', 'CHANGE_ME_ADMIN_KEY');
