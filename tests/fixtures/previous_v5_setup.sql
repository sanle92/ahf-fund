-- AMINIA HOPE FUNDRAISING: setup or repair, for a new or previous AHF table.
-- Before running: create the administrator in Authentication > Users, then
-- replace the single placeholder below with that user's UUID (not an email).
-- Run the ENTIRE file in Supabase SQL Editor. It preserves existing figures.
-- Never put a password, secret key, or service_role key in this file.

begin;

-- This creates the table only on the first run. Existing totals are retained.
create table if not exists public.ahf_fundraising_progress (
  id smallint primary key default 1 check (id = 1),
  cash_cents bigint check (cash_cents between 0 and 100000000000),
  pledge_cents bigint check (pledge_cents between 0 and 100000000000),
  inkind_cents bigint check (inkind_cents between 0 and 100000000000),
  note text not null default '' check (char_length(note) <= 400),
  contact text not null default '' check (char_length(contact) <= 150),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz
);

-- Refuse to replace unrelated/custom database objects. The transaction rolls
-- back if the UID is wrong, the schema is incompatible, or custom policies or
-- triggers need a project owner's review. No fund totals are deleted.
do $setup$
declare
  administrator uuid := 'REPLACE_WITH_ADMIN_USER_UUID'::uuid;
  existing_columns text[];
  object_id oid := 'public.ahf_fundraising_progress'::regclass;
begin
  if not exists (select 1 from auth.users where id = administrator) then
    raise exception 'AHF setup: administrator UID is not an existing Supabase Authentication user.';
  end if;
  select array_agg(attname::text order by attnum) into existing_columns
    from pg_catalog.pg_attribute
    where attrelid = object_id and attnum > 0 and not attisdropped;
  if existing_columns <> array['id','cash_cents','pledge_cents','inkind_cents','note','contact','revision','updated_at']::text[] then
    raise exception 'AHF setup: the existing AHF table has different columns. Review it before upgrading.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = object_id and contype = 'p'
      and conkey = array[(select attnum from pg_catalog.pg_attribute where attrelid=object_id and attname='id')]::smallint[]
  ) then
    raise exception 'AHF setup: the existing AHF table does not have the expected primary key.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='ahf_fundraising_progress'
      and policyname not in ('ahf_progress_public_read','ahf_progress_admin_update')
  ) then
    raise exception 'AHF setup: an additional policy exists. Review it before upgrading.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid=object_id and not tgisinternal and tgname <> 'ahf_progress_set_updated'
  ) then
    raise exception 'AHF setup: an additional trigger exists. Review it before upgrading.';
  end if;

  -- The policy compares the real authenticated UID, never an email supplied
  -- by the browser. The function is recreated so changing administrators is
  -- safe without replacing the table or touching the current figures.
  execute format(
    'create or replace function public.ahf_fundraising_can_edit() returns boolean language sql stable set search_path = '''' as %L',
    format('select (select auth.uid()) = %L::uuid', administrator::text)
  );
end
$setup$;

-- Reapply validation constraints even when repairing a previous table.
do $constraints$
declare
  object_id oid := 'public.ahf_fundraising_progress'::regclass;
begin
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=object_id and conname='ahf_valid_singleton') then
    alter table public.ahf_fundraising_progress add constraint ahf_valid_singleton check (id = 1);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=object_id and conname='ahf_valid_cash') then
    alter table public.ahf_fundraising_progress add constraint ahf_valid_cash check (cash_cents between 0 and 100000000000);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=object_id and conname='ahf_valid_pledge') then
    alter table public.ahf_fundraising_progress add constraint ahf_valid_pledge check (pledge_cents between 0 and 100000000000);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=object_id and conname='ahf_valid_inkind') then
    alter table public.ahf_fundraising_progress add constraint ahf_valid_inkind check (inkind_cents between 0 and 100000000000);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=object_id and conname='ahf_valid_note') then
    alter table public.ahf_fundraising_progress add constraint ahf_valid_note check (char_length(note) <= 400);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=object_id and conname='ahf_valid_contact') then
    alter table public.ahf_fundraising_progress add constraint ahf_valid_contact check (char_length(contact) <= 150);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conrelid=object_id and conname='ahf_valid_revision') then
    alter table public.ahf_fundraising_progress add constraint ahf_valid_revision check (revision >= 0);
  end if;
end
$constraints$;

alter table public.ahf_fundraising_progress
  alter column note set not null, alter column note set default '',
  alter column contact set not null, alter column contact set default '',
  alter column revision set not null, alter column revision set default 0;

alter table public.ahf_fundraising_progress enable row level security;
revoke all on table public.ahf_fundraising_progress from public, anon, authenticated;
grant select on table public.ahf_fundraising_progress to anon, authenticated;
grant update (cash_cents, pledge_cents, inkind_cents, note, contact)
  on public.ahf_fundraising_progress to authenticated;
revoke all on function public.ahf_fundraising_can_edit() from public, anon;
grant execute on function public.ahf_fundraising_can_edit() to authenticated;

drop policy if exists ahf_progress_public_read on public.ahf_fundraising_progress;
create policy ahf_progress_public_read
  on public.ahf_fundraising_progress for select to anon, authenticated using (id = 1);
drop policy if exists ahf_progress_admin_update on public.ahf_fundraising_progress;
create policy ahf_progress_admin_update
  on public.ahf_fundraising_progress for update to authenticated
  using (id = 1 and (select public.ahf_fundraising_can_edit()))
  with check (id = 1 and (select public.ahf_fundraising_can_edit()));

create or replace function public.ahf_fundraising_touch()
returns trigger language plpgsql set search_path = '' as $trigger$
begin
  new.revision := old.revision + 1;
  new.updated_at := statement_timestamp();
  return new;
end
$trigger$;
revoke all on function public.ahf_fundraising_touch() from public, anon, authenticated;
drop trigger if exists ahf_progress_set_updated on public.ahf_fundraising_progress;
create trigger ahf_progress_set_updated before update on public.ahf_fundraising_progress
  for each row execute function public.ahf_fundraising_touch();

-- Null means "not yet reported". On repair, leave the existing row intact.
insert into public.ahf_fundraising_progress (id) values (1) on conflict (id) do nothing;
commit;
