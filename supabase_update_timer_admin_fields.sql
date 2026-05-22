create or replace function public.update_timer_admin_fields(
  p_board_id text,
  p_admin_key text,
  p_id uuid,
  p_object_name text,
  p_timer_kind text
)
returns public.timers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_timer public.timers;
begin
  perform public.assert_timerboard_admin(p_board_id, p_admin_key);

  update public.timers
  set object_name = case
        when coalesce(p_object_name, '') in (
          'Astrahus', 'Fortizar', 'Keepstar',
          'Raitaru', 'Azbel', 'Sotiyo',
          'Athanor', 'Tatara',
          'Metenox Moon Drill',
          'Customs Office', 'IHub', 'TCU', 'POS'
        ) then p_object_name
        else ''
      end,
      distance = case
        when coalesce(p_timer_kind, '') in ('Атака', 'Оборона') then p_timer_kind
        else ''
      end
  where board_id = p_board_id and id = p_id
  returning * into v_timer;

  if v_timer.id is null then
    raise exception 'timer not found';
  end if;

  return v_timer;
end;
$$;

grant execute on function public.update_timer_admin_fields(text, text, uuid, text, text) to anon, authenticated;
