import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ADMIN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db,upgrade,draftId,publishedId;
async function as(role,uid='') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await db.exec(`set role ${role}`);
}
before(async()=>{
  db=await PGlite.create();
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  const previous=await readFile(new URL('./fixtures/previous_setup.sql',import.meta.url),'utf8');
  await db.exec(previous.replaceAll('REPLACE_WITH_ADMIN_USER_UUID',ADMIN));
  await db.exec('update public.ahf_fundraising_progress set cash_cents=25000');
  upgrade=await readFile(new URL('../supabase_upgrade_donors.sql',import.meta.url),'utf8');
  await db.exec(upgrade);
});
after(async()=>{if(db) await db.close()});

test('upgrade retains previous fundraising total and supplies editable vision and mission',async()=>{
  await as('anon');
  assert.equal(Number((await db.query('select cash_cents from public.ahf_fundraising_progress')).rows[0].cash_cents),25000);
  const content=(await db.query('select vision,mission,phone from public.ahf_fundraising_site_content')).rows[0];
  assert.match(content.vision,/brighter future/);assert.match(content.mission,/education/);assert.equal(content.phone,'');
  await assert.rejects(db.query("update public.ahf_fundraising_site_content set phone='+256123456789'"));
  await as('authenticated',OTHER);
  assert.equal((await db.query("update public.ahf_fundraising_site_content set phone='+256123456789' returning id")).rows.length,0);
  await as('authenticated',ADMIN);
  const changed=await db.query("update public.ahf_fundraising_site_content set phone='+256123456789' where revision=0 returning revision");
  assert.equal(Number(changed.rows[0].revision),1);
});

test('only authorized admin can add donor acknowledgements',async()=>{
  await as('anon');
  await assert.rejects(db.query("insert into public.ahf_fundraising_donors (display_name,amount_cents) values ('Visitor',100)"));
  await as('authenticated',OTHER);
  await assert.rejects(db.query("insert into public.ahf_fundraising_donors (display_name,amount_cents) values ('Other',100)"));
  await as('authenticated',ADMIN);
  const draft=await db.query("insert into public.ahf_fundraising_donors (display_name,amount_cents,comment,published,consent_confirmed) values ('Private donor',5000,'Draft',false,false) returning id");
  draftId=draft.rows[0].id;
  const shown=await db.query("insert into public.ahf_fundraising_donors (display_name,amount_cents,comment,published,consent_confirmed) values ('Public donor',12345,'Thank you',true,true) returning id");
  publishedId=shown.rows[0].id;
});

test('public and non-admin users see only published records with confirmed permission',async()=>{
  await as('anon');
  const rows=await db.query('select id,display_name,amount_cents,comment,published,consent_confirmed,created_at from public.ahf_fundraising_donors order by id');
  assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].id,publishedId);
  await assert.rejects(db.query('select revision from public.ahf_fundraising_donors'));
  await assert.rejects(db.query("update public.ahf_fundraising_donors set comment='Tamper'"));
  await as('authenticated',OTHER);
  const other=await db.query('select id from public.ahf_fundraising_donors');
  assert.deepEqual(other.rows.map(r=>r.id),[publishedId]);
  assert.equal((await db.query("update public.ahf_fundraising_donors set comment='Tamper' returning id")).rows.length,0);
  assert.equal((await db.query('delete from public.ahf_fundraising_donors returning id')).rows.length,0);
  await as('authenticated',ADMIN);
  assert.equal((await db.query('select id from public.ahf_fundraising_donors')).rows.length,2);
});

test('database rejects publication without consent, invalid amounts, and stale edits',async()=>{
  await as('authenticated',ADMIN);
  await assert.rejects(db.query('update public.ahf_fundraising_donors set published=true,consent_confirmed=false where id=$1',[draftId]));
  await assert.rejects(db.query("insert into public.ahf_fundraising_donors (display_name,amount_cents) values ('A',0)"));
  const first=await db.query("update public.ahf_fundraising_donors set comment='Changed' where id=$1 and revision=0 returning revision",[publishedId]);
  assert.equal(Number(first.rows[0].revision),1);
  assert.equal((await db.query("update public.ahf_fundraising_donors set comment='Stale' where id=$1 and revision=0 returning id",[publishedId])).rows.length,0);
});

test('rerunning upgrade preserves data and does not turn drafts public',async()=>{
  await db.exec('reset role');await db.exec(upgrade);
  assert.equal(Number((await db.query('select cash_cents from public.ahf_fundraising_progress')).rows[0].cash_cents),25000);
  assert.equal((await db.query('select id from public.ahf_fundraising_donors')).rows.length,2);
  await as('anon');
  const visible=await db.query('select id from public.ahf_fundraising_donors');
  assert.deepEqual(visible.rows.map(r=>r.id),[publishedId]);
});

test('upgrade works on the exact previous release without changing its fundraising figures',async()=>{
  const prior=await PGlite.create();
  try{
    await prior.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
      create table auth.users(id uuid primary key);insert into auth.users values ('${ADMIN}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    const v5=await readFile(new URL('./fixtures/previous_v5_setup.sql',import.meta.url),'utf8');
    await prior.exec(v5.replace('REPLACE_WITH_ADMIN_USER_UUID',ADMIN));
    await prior.exec('update public.ahf_fundraising_progress set cash_cents=123456,pledge_cents=7890');
    await prior.exec(upgrade);
    const totals=(await prior.query('select cash_cents,pledge_cents,revision from public.ahf_fundraising_progress')).rows[0];
    assert.equal(Number(totals.cash_cents),123456);assert.equal(Number(totals.pledge_cents),7890);assert.equal(Number(totals.revision),1);
    assert.equal((await prior.query('select id from public.ahf_fundraising_site_content')).rows.length,1);
  }finally{await prior.close()}
});
