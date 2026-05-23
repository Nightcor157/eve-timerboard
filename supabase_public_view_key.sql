alter table public.timerboard_settings
add column if not exists view_key_hash text;

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
  perform public.assert_timerboard_admin(p_board_id, p_admin_key);

  if p_view_key is null or length(p_view_key) < 6 then
    raise exception 'view key must be at least 6 characters';
  end if;

  update public.timerboard_settings
  set view_key_hash = crypt(p_view_key, gen_salt('bf')),
      updated_at = now()
  where board_id = p_board_id;

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
  select admin_key_hash, view_key_hash
    into v_admin_hash, v_view_hash
  from public.timerboard_settings
  where board_id = p_board_id;

  if v_admin_hash is null then
    raise exception 'timerboard is not configured';
  end if;

  if p_view_key is not null and length(p_view_key) > 0 and crypt(p_view_key, v_admin_hash) = v_admin_hash then
    return;
  end if;

  if v_view_hash is null then
    raise exception 'view key is not configured' using errcode = '28000';
  end if;

  if p_view_key is null or length(p_view_key) = 0 or crypt(p_view_key, v_view_hash) <> v_view_hash then
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
  perform public.assert_timerboard_viewer(p_board_id, p_view_key);

  return query
  select *
  from public.timers
  where board_id = p_board_id
  order by end_at asc;
end;
$$;

drop policy if exists "timers_public_read" on public.timers;
revoke select on table public.timers from anon, authenticated;

revoke all on function public.assert_timerboard_viewer(text, text) from public, anon, authenticated;
grant execute on function public.get_timers(text, text) to anon, authenticated;
grant execute on function public.set_timerboard_view_key(text, text, text) to anon, authenticated;
