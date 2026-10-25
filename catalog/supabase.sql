-- «Улика»: оценки, просмотры, репосты и комментарии.
-- Выполните целиком в Supabase → SQL Editor → New query → Run.

create table if not exists public.events (
  id bigint generated always as identity primary key,
  game_id text not null,
  kind text not null check (kind in ('view', 'share')),
  visitor text not null,
  created_at timestamptz not null default now()
);
create index if not exists events_game_kind on public.events (game_id, kind);

create table if not exists public.ratings (
  game_id text not null,
  visitor text not null,
  stars smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (game_id, visitor)
);

create table if not exists public.comments (
  id bigint generated always as identity primary key,
  game_id text not null,
  visitor text not null,
  name text not null check (char_length(name) between 1 and 40),
  body text not null check (char_length(body) between 2 and 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_game on public.comments (game_id, created_at desc);

-- Прямой доступ к таблицам закрыт; читать и писать можно только через функции ниже.
alter table public.events enable row level security;
alter table public.ratings enable row level security;
alter table public.comments enable row level security;
drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments for select to anon using (hidden = false);
grant select (id, game_id, name, body, created_at) on public.comments to anon;

-- Сводка по играм: только итоговые числа, без доступа к самим записям.
drop view if exists public.game_stats;
create or replace function public.game_stats(p_ids text[])
returns table (game_id text, views bigint, shares bigint, rating numeric, votes bigint, comments bigint)
language sql stable security definer set search_path = public as $$
  select g.id,
    (select count(distinct visitor) from events e where e.game_id = g.id and e.kind = 'view'),
    (select count(*) from events e where e.game_id = g.id and e.kind = 'share'),
    (select round(avg(stars)::numeric, 1) from ratings r where r.game_id = g.id),
    (select count(*) from ratings r where r.game_id = g.id),
    (select count(*) from comments c where c.game_id = g.id and not c.hidden)
  from unnest(p_ids[1:50]) as g(id);
$$;

-- Просмотр или репост. Повтор от того же посетителя в течение часа не считается.
create or replace function public.track(p_game text, p_kind text, p_visitor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('view', 'share') or length(p_visitor) < 8 or length(p_game) > 40 then return; end if;
  if exists (select 1 from events where game_id = p_game and kind = p_kind and visitor = p_visitor
             and created_at > now() - interval '1 hour') then return; end if;
  insert into events (game_id, kind, visitor) values (p_game, p_kind, p_visitor);
end $$;

-- Оценка от 1 до 5. Повторная оценка заменяет прежнюю.
create or replace function public.rate(p_game text, p_visitor text, p_stars int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_stars < 1 or p_stars > 5 or length(p_visitor) < 8 or length(p_game) > 40 then return; end if;
  insert into ratings (game_id, visitor, stars) values (p_game, p_visitor, p_stars)
  on conflict (game_id, visitor) do update set stars = excluded.stars, updated_at = now();
end $$;

-- Комментарий. Не больше трёх за 10 минут от одного посетителя.
create or replace function public.add_comment(p_game text, p_visitor text, p_name text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_visitor) < 8 or length(p_game) > 40 then return; end if;
  if (select count(*) from comments where visitor = p_visitor and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'too_many';
  end if;
  insert into comments (game_id, visitor, name, body) values (p_game, p_visitor, trim(p_name), trim(p_body));
end $$;

revoke all on function public.game_stats(text[]) from public;
revoke all on function public.track(text, text, text) from public;
revoke all on function public.rate(text, text, int) from public;
revoke all on function public.add_comment(text, text, text, text) from public;
grant execute on function public.game_stats(text[]) to anon;
grant execute on function public.track(text, text, text) to anon;
grant execute on function public.rate(text, text, int) to anon;
grant execute on function public.add_comment(text, text, text, text) to anon;

-- Скрыть комментарий: update public.comments set hidden = true where id = 123;
