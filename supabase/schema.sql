-- Mixtape – databasschema för Supabase.
-- Kör hela filen i Supabase → SQL Editor. Ändra e-posten längst ner först!

-- ---------- Tabeller ----------

create table public.members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  display_name text not null,
  is_admin boolean not null default false,
  rotation_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  -- Måndagen i vecka 1 av rotationen.
  start_week date not null default (date_trunc('week', now() at time zone 'Europe/Stockholm'))::date
    check (extract(isodow from start_week) = 1),
  -- Förskjutning så att veckans person behåller sin tur när rotationen ändras.
  rotation_offset int not null default 0
);
insert into public.settings default values;

create table public.mixtapes (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1),
  member_id uuid references public.members(id) on delete set null,
  curator_name text not null,
  spotify_url text not null check (spotify_url ~ '^https://open\.spotify\.com/'),
  title text,
  cover_url text,
  created_at timestamptz not null default now()
);

-- ---------- Hjälpfunktioner ----------

create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where email = lower(auth.jwt() ->> 'email')
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where email = lower(auth.jwt() ->> 'email'))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where email = lower(auth.jwt() ->> 'email') and is_admin)
$$;

create or replace function public.current_week() returns date
language sql stable as $$
  select (date_trunc('week', now() at time zone 'Europe/Stockholm'))::date
$$;

-- Vems tur en given vecka är. Samma logik som curatorFor() i app.js.
create or replace function public.curator_for_week(w date) returns uuid
language sql stable security definer set search_path = public as $$
  with r as (
    select id,
           (row_number() over (order by rotation_order, created_at) - 1)::int as idx,
           (count(*) over ())::int as n
    from members
  ), s as (select start_week, rotation_offset from settings where id = 1)
  select r.id from r, s
  where r.idx = (((((w - s.start_week) / 7) + s.rotation_offset) % r.n) + r.n) % r.n
$$;

-- Fyller i curator_name från members så att gamla mixtapes behåller namnet även om personen tas bort.
create or replace function public.set_curator_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.member_id is not null then
    select display_name into new.curator_name from members where id = new.member_id;
  end if;
  return new;
end $$;

create trigger mixtapes_curator_name
  before insert or update on public.mixtapes
  for each row execute function public.set_curator_name();

-- ---------- Row Level Security ----------

alter table public.members enable row level security;
alter table public.settings enable row level security;
alter table public.mixtapes enable row level security;

create policy "members: läs" on public.members for select to authenticated using (is_member());
create policy "members: admin skapar" on public.members for insert to authenticated with check (is_admin());
create policy "members: admin ändrar" on public.members for update to authenticated using (is_admin()) with check (is_admin());
create policy "members: admin tar bort" on public.members for delete to authenticated using (is_admin());

create policy "settings: läs" on public.settings for select to authenticated using (is_member());
create policy "settings: admin ändrar" on public.settings for update to authenticated using (is_admin()) with check (is_admin());

create policy "mixtapes: läs" on public.mixtapes for select to authenticated using (is_member());
create policy "mixtapes: den vars tur det är (eller admin) lägger till" on public.mixtapes
  for insert to authenticated with check (
    is_admin() or (
      member_id = my_member_id()
      and week_start = current_week()
      and curator_for_week(week_start) = my_member_id()
    )
  );
create policy "mixtapes: den vars tur det är (eller admin) byter länk" on public.mixtapes
  for update to authenticated
  using (is_admin() or (member_id = my_member_id() and week_start = current_week()))
  with check (
    is_admin() or (
      member_id = my_member_id()
      and week_start = current_week()
      and curator_for_week(week_start) = my_member_id()
    )
  );
create policy "mixtapes: admin tar bort" on public.mixtapes for delete to authenticated using (is_admin());

-- ---------- Första admin ----------
-- Byt till din egen e-post och ditt namn innan du kör!
insert into public.members (email, display_name, is_admin, rotation_order)
values ('din@email.se', 'Magnus', true, 10);
