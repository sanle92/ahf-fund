-- Aminia Hope fundraising page: one-time setup for a new, empty AHF table.
-- FIRST: replace the placeholder in the can_edit function with the actual
-- user ID from Supabase Authentication > Users. Do not enter an email address.
-- Run this complete file once in the Supabase SQL Editor. The transaction
-- rolls back if a named object already exists or the UUID is invalid.

begin;

create table public.ahf_fundraising_progress (
  id smallint primary key default 1 check (id = 1),
  cash_cents bigint check (cash_cents between 0 and 100000000000),
  pledge_cents bigint check (pledge_cents between 0 and 100000000000),
  inkind_cents bigint check (inkind_cents between 0 and 100000000000),
  note text not null default '' check (char_length(note) <= 400),
  contact text not null default '' check (char_length(contact) <= 150),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz
);

alter table public.ahf_fundraising_progress enable row level security;
revoke all on table public.ahf_fundraising_progress from public, anon, authenticated;
grant select on table public.ahf_fundraising_progress to anon, authenticated;
grant update (cash_cents, pledge_cents, inkind_cents, note, contact)
  on public.ahf_fundraising_progress to authenticated;

-- The UUID is a public identifier, not a password. The database, not the
-- browser, decides which account can write.
create function public.ahf_fundraising_can_edit()
returns boolean
language sql stable
set search_path = ''
as $$
  select (select auth.uid()) = 'REPLACE_WITH_ADMIN_USER_UUID'::uuid;
$$;
revoke all on function public.ahf_fundraising_can_edit() from public, anon;
grant execute on function public.ahf_fundraising_can_edit() to authenticated;

create policy ahf_progress_public_read
  on public.ahf_fundraising_progress for select to anon, authenticated
  using (id = 1);

create policy ahf_progress_admin_update
  on public.ahf_fundraising_progress for update to authenticated
  using (id = 1 and (select public.ahf_fundraising_can_edit()))
  with check (id = 1 and (select public.ahf_fundraising_can_edit()));

create function public.ahf_fundraising_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.ahf_fundraising_touch() from public, anon, authenticated;

create trigger ahf_progress_set_updated
  before update on public.ahf_fundraising_progress
  for each row execute function public.ahf_fundraising_touch();

-- Null means "not yet reported"; this does not invent a donation total.
insert into public.ahf_fundraising_progress (id) values (1);
commit;
