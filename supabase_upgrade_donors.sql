-- UPGRADE AN EXISTING AHF FUNDRAISING SITE. Run the entire file in the same
-- Supabase project as the existing site. It adds vision, mission, phone and
-- donor acknowledgements while retaining existing totals and donor records.
-- For a fresh project run supabase_setup.sql instead of this file.
begin;

do $prerequisites$
begin
  if to_regclass('public.ahf_fundraising_progress') is null
    or to_regprocedure('public.ahf_fundraising_can_edit()') is null
    or to_regprocedure('public.ahf_fundraising_touch()') is null then
    raise exception 'AHF upgrade: run the previous AHF Supabase setup first, or use the complete new setup file.';
  end if;
end
$prerequisites$;

create table if not exists public.ahf_fundraising_site_content (
  id smallint primary key default 1 check (id=1),
  vision text not null default 'A brighter future for every child and family, where people can live with dignity and have opportunities to build a better future.' check (char_length(btrim(vision)) between 1 and 500),
  mission text not null default 'To support children, families and communities through education, child protection, family support, health awareness and skills development, while working with partners and using resources responsibly.' check (char_length(btrim(mission)) between 1 and 800),
  phone text not null default '' check (char_length(phone) <= 40),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz
);

create table if not exists public.ahf_fundraising_donors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  comment text not null default '' check (char_length(comment) <= 300),
  published boolean not null default false,
  consent_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz,
  constraint ahf_donor_consent_required check (not published or consent_confirmed)
);

-- Refuse to change a different application or custom policies/triggers. These
-- checks occur inside a transaction, so a failure does not modify old data.
do $verify$
declare
  content_id oid := 'public.ahf_fundraising_site_content'::regclass;
  donors_id oid := 'public.ahf_fundraising_donors'::regclass;
  cols text[];
  types text[];
begin
  select array_agg(attname::text order by attnum) into cols from pg_catalog.pg_attribute
    where attrelid=content_id and attnum>0 and not attisdropped;
  if cols <> array['id','vision','mission','phone','revision','updated_at']::text[] then
    raise exception 'AHF upgrade: existing site content has unexpected columns; review it first.';
  end if;
  select array_agg(format_type(atttypid,atttypmod) order by attnum) into types from pg_catalog.pg_attribute
    where attrelid=content_id and attnum>0 and not attisdropped;
  if types <> array['smallint','text','text','text','bigint','timestamp with time zone']::text[] then
    raise exception 'AHF upgrade: existing site content has unexpected column types; review it first.';
  end if;
  select array_agg(attname::text order by attnum) into cols from pg_catalog.pg_attribute
    where attrelid=donors_id and attnum>0 and not attisdropped;
  if cols <> array['id','display_name','amount_cents','comment','published','consent_confirmed','created_at','revision','updated_at']::text[] then
    raise exception 'AHF upgrade: existing donor table has unexpected columns; review it first.';
  end if;
  select array_agg(format_type(atttypid,atttypmod) order by attnum) into types from pg_catalog.pg_attribute
    where attrelid=donors_id and attnum>0 and not attisdropped;
  if types <> array['uuid','text','bigint','text','boolean','boolean','timestamp with time zone','bigint','timestamp with time zone']::text[] then
    raise exception 'AHF upgrade: existing donor table has unexpected column types; review it first.';
  end if;
  if exists(select 1 from pg_catalog.pg_policies where schemaname='public' and
    ((tablename='ahf_fundraising_site_content' and policyname not in ('ahf_content_read','ahf_content_update')) or
     (tablename='ahf_fundraising_donors' and policyname not in ('ahf_donors_public_read','ahf_donors_admin_read','ahf_donors_insert','ahf_donors_update','ahf_donors_delete')))) then
    raise exception 'AHF upgrade: an additional policy exists on an AHF table; review it first.';
  end if;
  if exists(select 1 from pg_catalog.pg_trigger where not tgisinternal and
    ((tgrelid=content_id and tgname <> 'ahf_site_content_touch') or (tgrelid=donors_id and tgname <> 'ahf_donors_touch'))) then
    raise exception 'AHF upgrade: an additional trigger exists on an AHF table; review it first.';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=content_id and contype='p' and conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=content_id and attname='id')]::smallint[])
    or not exists(select 1 from pg_catalog.pg_constraint where conrelid=donors_id and contype='p' and conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=donors_id and attname='id')]::smallint[]) then
    raise exception 'AHF upgrade: an AHF table has an unexpected primary key.';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=donors_id and conname='ahf_donor_consent_required') then
    alter table public.ahf_fundraising_donors add constraint ahf_donor_consent_required check (not published or consent_confirmed);
  end if;
end
$verify$;

alter table public.ahf_fundraising_site_content
  alter column vision set not null, alter column mission set not null,
  alter column phone set not null, alter column phone set default '',
  alter column revision set not null, alter column revision set default 0;
alter table public.ahf_fundraising_donors
  alter column display_name set not null, alter column amount_cents set not null,
  alter column comment set not null, alter column comment set default '',
  alter column published set not null, alter column published set default false,
  alter column consent_confirmed set not null, alter column consent_confirmed set default false,
  alter column created_at set not null, alter column created_at set default now(),
  alter column revision set not null, alter column revision set default 0;

do $validation$
declare spec record;
begin
  for spec in select * from (values
    ('ahf_fundraising_site_content','ahf_content_vision_valid','char_length(btrim(vision)) between 1 and 500'),
    ('ahf_fundraising_site_content','ahf_content_mission_valid','char_length(btrim(mission)) between 1 and 800'),
    ('ahf_fundraising_site_content','ahf_content_phone_valid','char_length(phone) <= 40'),
    ('ahf_fundraising_site_content','ahf_content_id_valid','id = 1'),
    ('ahf_fundraising_site_content','ahf_content_revision_valid','revision >= 0'),
    ('ahf_fundraising_donors','ahf_donor_name_valid','char_length(btrim(display_name)) between 1 and 100'),
    ('ahf_fundraising_donors','ahf_donor_amount_valid','amount_cents between 1 and 100000000000'),
    ('ahf_fundraising_donors','ahf_donor_comment_valid','char_length(comment) <= 300'),
    ('ahf_fundraising_donors','ahf_donor_revision_valid','revision >= 0')
  ) as rules(table_name,constraint_name,expression)
  loop
    if not exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.'||spec.table_name) and conname=spec.constraint_name) then
      execute format('alter table public.%I add constraint %I check (%s)', spec.table_name,spec.constraint_name,spec.expression);
    end if;
  end loop;
end
$validation$;

alter table public.ahf_fundraising_site_content enable row level security;
alter table public.ahf_fundraising_donors enable row level security;
revoke all on table public.ahf_fundraising_site_content from public, anon, authenticated;
revoke all on table public.ahf_fundraising_donors from public, anon, authenticated;
grant select on table public.ahf_fundraising_site_content to anon, authenticated;
grant update (vision,mission,phone) on public.ahf_fundraising_site_content to authenticated;
grant select (id,display_name,amount_cents,comment,published,consent_confirmed,created_at)
  on public.ahf_fundraising_donors to anon;
grant select on table public.ahf_fundraising_donors to authenticated;
grant insert (display_name,amount_cents,comment,published,consent_confirmed)
  on public.ahf_fundraising_donors to authenticated;
grant update (display_name,amount_cents,comment,published,consent_confirmed)
  on public.ahf_fundraising_donors to authenticated;
grant delete on table public.ahf_fundraising_donors to authenticated;

drop policy if exists ahf_content_read on public.ahf_fundraising_site_content;
create policy ahf_content_read on public.ahf_fundraising_site_content for select to anon,authenticated using (id=1);
drop policy if exists ahf_content_update on public.ahf_fundraising_site_content;
create policy ahf_content_update on public.ahf_fundraising_site_content for update to authenticated
  using (id=1 and (select public.ahf_fundraising_can_edit()))
  with check (id=1 and (select public.ahf_fundraising_can_edit()));

drop policy if exists ahf_donors_public_read on public.ahf_fundraising_donors;
create policy ahf_donors_public_read on public.ahf_fundraising_donors for select to anon,authenticated
  using (published and consent_confirmed);
drop policy if exists ahf_donors_admin_read on public.ahf_fundraising_donors;
create policy ahf_donors_admin_read on public.ahf_fundraising_donors for select to authenticated
  using ((select public.ahf_fundraising_can_edit()));
drop policy if exists ahf_donors_insert on public.ahf_fundraising_donors;
create policy ahf_donors_insert on public.ahf_fundraising_donors for insert to authenticated
  with check ((select public.ahf_fundraising_can_edit()));
drop policy if exists ahf_donors_update on public.ahf_fundraising_donors;
create policy ahf_donors_update on public.ahf_fundraising_donors for update to authenticated
  using ((select public.ahf_fundraising_can_edit())) with check ((select public.ahf_fundraising_can_edit()));
drop policy if exists ahf_donors_delete on public.ahf_fundraising_donors;
create policy ahf_donors_delete on public.ahf_fundraising_donors for delete to authenticated
  using ((select public.ahf_fundraising_can_edit()));

drop trigger if exists ahf_site_content_touch on public.ahf_fundraising_site_content;
create trigger ahf_site_content_touch before update on public.ahf_fundraising_site_content
  for each row execute function public.ahf_fundraising_touch();
drop trigger if exists ahf_donors_touch on public.ahf_fundraising_donors;
create trigger ahf_donors_touch before update on public.ahf_fundraising_donors
  for each row execute function public.ahf_fundraising_touch();

insert into public.ahf_fundraising_site_content (id) values (1) on conflict (id) do nothing;
commit;
