-- Existing database upgrade: key policy, value checks and function privileges.
-- Existing key hashes and historical timer rows are preserved.

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

-- Security-definer helpers and RPCs must never inherit broad PUBLIC execute.
-- Existing explicit grants to anon/authenticated remain in place.
revoke execute on all functions in schema public from public;
