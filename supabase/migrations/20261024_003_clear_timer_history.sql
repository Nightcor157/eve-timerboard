-- Existing database upgrade: protected cleanup of completed timer history.
-- Applying this migration does not delete rows. Deletion happens only when the
-- main administrator explicitly calls clear_timer_history with a valid key.

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

revoke all on function public.clear_timer_history(text, text)
from public, anon, authenticated;
grant execute on function public.clear_timer_history(text, text)
to anon, authenticated;
