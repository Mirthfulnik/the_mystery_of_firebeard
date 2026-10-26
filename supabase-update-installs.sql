-- Обновление: счётчик установок на ПК.
-- Выполните целиком в Supabase → SQL Editor → New query → Run (один раз).

alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in ('view', 'share', 'install'));

-- Сводка по играм: только итоговые числа, без доступа к самим записям.
drop view if exists public.game_stats;
drop function if exists public.game_stats(text[]);
create or replace function public.game_stats(p_ids text[])
returns table (game_id text, views bigint, shares bigint, installs bigint, rating numeric, votes bigint, comments bigint)
language sql stable security definer set search_path = public as $$
  select g.id,
    (select count(distinct visitor) from events e where e.game_id = g.id and e.kind = 'view'),
    (select count(*) from events e where e.game_id = g.id and e.kind = 'share'),
    (select count(distinct visitor) from events e where e.game_id = g.id and e.kind = 'install'),
    (select round(avg(stars)::numeric, 1) from ratings r where r.game_id = g.id),
    (select count(*) from ratings r where r.game_id = g.id),
    (select count(*) from comments c where c.game_id = g.id and not c.hidden)
  from unnest(p_ids[1:50]) as g(id);
$$;

-- Просмотр, репост или установка на ПК. Повтор от того же посетителя в течение часа не считается.
create or replace function public.track(p_game text, p_kind text, p_visitor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('view', 'share', 'install') or length(p_visitor) < 8 or length(p_game) > 40 then return; end if;
  if exists (select 1 from events where game_id = p_game and kind = p_kind and visitor = p_visitor
             and created_at > now() - interval '1 hour') then return; end if;
  insert into events (game_id, kind, visitor) values (p_game, p_kind, p_visitor);
end $$;

revoke all on function public.game_stats(text[]) from public;
grant execute on function public.game_stats(text[]) to anon;

notify pgrst, 'reload schema';
