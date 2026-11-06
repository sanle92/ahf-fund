import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db;
let setup;

async function asRole(role, uid = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec(`set role ${role}`);
}

before(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users (id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  setup = await readFile(new URL('../supabase_setup.sql', import.meta.url), 'utf8');
  await db.exec(setup.replaceAll('REPLACE_WITH_ADMIN_USER_UUID', ADMIN));
});

after(async () => { if (db) await db.close(); });

test('public visitors can read unreported values but cannot write, insert or delete', async () => {
  await asRole('anon');
  const read = await db.query('select cash_cents, pledge_cents, inkind_cents, updated_at from public.ahf_fundraising_progress');
  assert.equal(read.rows.length, 1);
  assert.equal(read.rows[0].cash_cents, null);
  assert.equal(read.rows[0].updated_at, null);
  await assert.rejects(db.query('update public.ahf_fundraising_progress set cash_cents = 100'));
  await assert.rejects(db.query('insert into public.ahf_fundraising_progress (id) values (1)'));
  await assert.rejects(db.query('delete from public.ahf_fundraising_progress'));
});

test('a different signed-in user cannot update the record', async () => {
  await asRole('authenticated', OTHER);
  const access = await db.query('select public.ahf_fundraising_can_edit() as allowed');
  assert.equal(access.rows[0].allowed, false);
  const result = await db.query('update public.ahf_fundraising_progress set cash_cents = 100 returning id');
  assert.equal(result.rows.length, 0);
  const after = await db.query('select cash_cents from public.ahf_fundraising_progress');
  assert.equal(after.rows[0].cash_cents, null);
});

test('the approved user can update and the database sets revision and timestamp', async () => {
  await asRole('authenticated', ADMIN);
  const access = await db.query('select public.ahf_fundraising_can_edit() as allowed');
  assert.equal(access.rows[0].allowed, true);
  const updated = await db.query("update public.ahf_fundraising_progress set cash_cents=12000, note='First update' where id=1 and revision=0 returning cash_cents,revision,updated_at");
  assert.equal(updated.rows.length, 1);
  assert.equal(Number(updated.rows[0].cash_cents), 12000);
  assert.equal(Number(updated.rows[0].revision), 1);
  assert.ok(updated.rows[0].updated_at);
});

test('database constraints and restricted columns prevent invalid or direct metadata changes', async () => {
  await asRole('authenticated', ADMIN);
  await assert.rejects(db.query('update public.ahf_fundraising_progress set cash_cents=-1'));
  await assert.rejects(db.query('update public.ahf_fundraising_progress set pledge_cents=100000000001'));
  await assert.rejects(db.query("update public.ahf_fundraising_progress set note=repeat('x',401)"));
  await assert.rejects(db.query('update public.ahf_fundraising_progress set revision=999'));
  await assert.rejects(db.query('update public.ahf_fundraising_progress set updated_at=now()'));
  await assert.rejects(db.query('delete from public.ahf_fundraising_progress'));
});

test('a stale edit matches no rows after another edit', async () => {
  await asRole('authenticated', ADMIN);
  const first = await db.query('update public.ahf_fundraising_progress set cash_cents=25000 where id=1 and revision=1 returning revision');
  assert.equal(first.rows.length, 1);
  assert.equal(Number(first.rows[0].revision), 2);
  const stale = await db.query('update public.ahf_fundraising_progress set cash_cents=500 where id=1 and revision=1 returning revision');
  assert.equal(stale.rows.length, 0);
  const current = await db.query('select cash_cents from public.ahf_fundraising_progress');
  assert.equal(Number(current.rows[0].cash_cents), 25000);
});

test('re-running setup preserves existing figures and revision', async () => {
  await db.exec('reset role');
  await db.exec(setup.replaceAll('REPLACE_WITH_ADMIN_USER_UUID', ADMIN));
  const current = await db.query('select cash_cents, revision from public.ahf_fundraising_progress');
  assert.equal(Number(current.rows[0].cash_cents), 25000);
  assert.equal(Number(current.rows[0].revision), 2);
});

test('an unfilled administrator UUID stops the setup without leaving a table', async () => {
  const fresh = await PGlite.create();
  try {
    await fresh.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    await assert.rejects(fresh.exec(setup));
    await fresh.exec('rollback');
    const result = await fresh.query("select to_regclass('public.ahf_fundraising_progress') as table_name");
    assert.equal(result.rows[0].table_name, null);
  } finally {
    await fresh.close();
  }
});

test('repair refuses to remove unknown policies and preserves the existing row', async () => {
  await db.exec('reset role');
  await db.exec('create policy another_application_policy on public.ahf_fundraising_progress for select to authenticated using (false)');
  await assert.rejects(db.exec(setup.replaceAll('REPLACE_WITH_ADMIN_USER_UUID', ADMIN)), /additional policy/);
  await db.exec('rollback');
  const current = await db.query('select cash_cents, revision from public.ahf_fundraising_progress');
  assert.equal(Number(current.rows[0].cash_cents), 25000);
  assert.equal(Number(current.rows[0].revision), 2);
  const policies = await db.query("select policyname from pg_policies where schemaname='public' and tablename='ahf_fundraising_progress'");
  assert.ok(policies.rows.some(row=>row.policyname==='another_application_policy'));
  await db.exec('drop policy another_application_policy on public.ahf_fundraising_progress');
});

test('new setup upgrades the previous SQL without erasing entered amounts', async () => {
  const old = await PGlite.create();
  try {
    await old.exec(`
      create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${ADMIN}');
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    const previous = await readFile(new URL('./fixtures/previous_setup.sql', import.meta.url),'utf8');
    await old.exec(previous.replaceAll('REPLACE_WITH_ADMIN_USER_UUID', ADMIN));
    await old.exec("update public.ahf_fundraising_progress set cash_cents=87321,note='Existing update'");
    await old.exec(setup.replaceAll('REPLACE_WITH_ADMIN_USER_UUID', ADMIN));
    const after = await old.query('select cash_cents,note,revision from public.ahf_fundraising_progress');
    assert.equal(Number(after.rows[0].cash_cents),87321);
    assert.equal(after.rows[0].note,'Existing update');
    assert.equal(Number(after.rows[0].revision),1);
  } finally { await old.close(); }
});

test('a valid-looking UID that is not an application user fails without changing figures', async () => {
  await db.exec('reset role');
  const missing='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await assert.rejects(db.exec(setup.replaceAll('REPLACE_WITH_ADMIN_USER_UUID', missing)), /not an existing Supabase Authentication user/);
  await db.exec('rollback');
  const result=await db.query('select cash_cents,revision from public.ahf_fundraising_progress');
  assert.equal(Number(result.rows[0].cash_cents),25000);
  assert.equal(Number(result.rows[0].revision),2);
});
