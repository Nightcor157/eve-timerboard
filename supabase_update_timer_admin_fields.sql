drop function if exists public.update_timer_admin_fields(text, text, uuid, text, text);
drop function if exists public.update_timer_admin_fields(text, text, uuid, text, text, text, text, text, text, text, timestamptz);
drop function if exists public.update_timer_admin_fields(text, text, uuid, text, text, text, text, text, text, text, timestamptz, text);

create or replace function public.update_timer_admin_fields(
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
  perform public.assert_timerboard_admin(p_board_id, p_admin_key);

  update public.timers
  set title = coalesce(p_title, ''),
      system = coalesce(p_system, ''),
      object_name = case
        when coalesce(p_object_name, '') in (
          'Astrahus', 'Fortizar', 'Keepstar',
          'Raitaru', 'Azbel', 'Sotiyo',
          'Athanor', 'Tatara',
          'Metenox Moon Drill',
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
  where board_id = p_board_id and id = p_id
  returning * into v_timer;

  if v_timer.id is null then
    raise exception 'timer not found';
  end if;

  return v_timer;
end;
$$;

grant execute on function public.update_timer_admin_fields(
  text, text, uuid, text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;
