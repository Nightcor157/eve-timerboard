-- Existing database upgrade: atomic timer batches and optimistic patches.
-- Safe to run repeatedly. No table or row is dropped.

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

revoke all on function public.add_timers(text, text, jsonb) from public;
revoke all on function public.patch_timer_admin_fields(
  text, text, uuid, jsonb, timestamptz
) from public;
grant execute on function public.add_timers(text, text, jsonb) to anon, authenticated;
grant execute on function public.patch_timer_admin_fields(
  text, text, uuid, jsonb, timestamptz
) to anon, authenticated;
