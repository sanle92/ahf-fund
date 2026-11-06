// Real bundled Supabase JS client + simulated Auth/PostgREST HTTP endpoints +
// the actual SQL in PostgreSQL (PGlite). No cloud credentials or network used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '../public/vendor/supabase.js';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = id => `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.test-signature`;
const adminToken = tokenFor(ADMIN);
const otherToken = tokenFor(OTHER);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers:{'content-type':'application/json'} });
const waitFor = async (condition) => {
  for (let i=0; i<100; i++) { if (condition()) return; await new Promise(r=>setTimeout(r,10)); }
  throw new Error('The dashboard did not reach the expected state.');
};

function fakeDocument() {
  const values = new Map();
  return { getElementById(id) {
    if (!values.has(id)) values.set(id, { value:'', textContent:'', style:{},
      hidden:['form','login-form','google','logout','reload','setup-help','user-id-panel','contact-link'].includes(id),
      disabled:id==='save', handlers:{}, addEventListener(name, fn) {this.handlers[name]=fn;} });
    return values.get(id);
  }};
}

test('actual SDK signs in, saves through RLS, and renders the public total', async () => {
  const db = await PGlite.create();
  let client;
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${ADMIN}'), ('${OTHER}');
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    const sql = await readFile(new URL('../supabase_setup.sql', import.meta.url), 'utf8');
    await db.exec(sql.replace('REPLACE_WITH_ADMIN_USER_UUID',ADMIN));

    const fakeFetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = (init.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase();
      const headers = new Headers(init.headers || (typeof input === 'string' ? {} : input.headers));
      if (url.pathname === '/auth/v1/token' && method === 'POST') {
        const body = JSON.parse(init.body);
        const id = body.email === 'admin@example.com' ? ADMIN : OTHER;
        if (body.password !== 'correct-test-password') return json({code:'invalid_credentials',msg:'Invalid login credentials'},400);
        return json({access_token:id===ADMIN?adminToken:otherToken, token_type:'bearer', expires_in:3600,
          refresh_token:'test-refresh-token',user:{id,email:body.email,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}});
      }
      if (url.pathname === '/auth/v1/logout') return new Response(null,{status:204});
      if (method === 'GET' && ['/rest/v1/ahf_fundraising_site_content','/rest/v1/ahf_fundraising_donors'].includes(url.pathname)) return json([]);
      const bearer = (headers.get('authorization') || '').replace(/^Bearer\s+/i,'');
      const uid = bearer === adminToken ? ADMIN : bearer === otherToken ? OTHER : '';
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
      await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
      if (url.pathname === '/rest/v1/rpc/ahf_fundraising_can_edit' && method === 'POST') {
        const result=await db.query('select public.ahf_fundraising_can_edit() as allowed');
        return json(result.rows[0].allowed);
      }
      if (url.pathname === '/rest/v1/ahf_fundraising_progress' && method === 'GET') {
        const result=await db.query('select cash_cents,pledge_cents,inkind_cents,note,contact,revision,updated_at from public.ahf_fundraising_progress where id=1');
        return json(result.rows.map(row=>({...row,revision:Number(row.revision),cash_cents:row.cash_cents==null?null:Number(row.cash_cents),pledge_cents:row.pledge_cents==null?null:Number(row.pledge_cents),inkind_cents:row.inkind_cents==null?null:Number(row.inkind_cents)})));
      }
      if (url.pathname === '/rest/v1/ahf_fundraising_progress' && method === 'PATCH') {
        const data=JSON.parse(init.body);
        const revision=Number((url.searchParams.get('revision') || '').replace(/^eq\./,''));
        try {
          const result=await db.query('update public.ahf_fundraising_progress set cash_cents=$1,pledge_cents=$2,inkind_cents=$3,note=$4,contact=$5 where id=1 and revision=$6 returning cash_cents,pledge_cents,inkind_cents,note,contact,revision,updated_at',
            [data.cash_cents,data.pledge_cents,data.inkind_cents,data.note,data.contact,revision]);
          return json(result.rows.map(row=>({...row,revision:Number(row.revision),cash_cents:row.cash_cents==null?null:Number(row.cash_cents),pledge_cents:row.pledge_cents==null?null:Number(row.pledge_cents),inkind_cents:row.inkind_cents==null?null:Number(row.inkind_cents)})));
        } catch (err) { return json({code:err.code || '42501',message:'Database rejected request'},403); }
      }
      throw new Error(`Unexpected simulated request: ${method} ${url.pathname}`);
    };

    client=createClient('https://example.supabase.co','sb_publishable_test',{global:{fetch:fakeFetch},auth:{persistSession:false,autoRefreshToken:false}});
    const document=fakeDocument();
    const adminSource=(await readFile(new URL('../public/holyghost.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/gm, '');
    runInNewContext(adminSource,{document,configured:true,configurationError:'',supabase:client,googleSignInEnabled:false,createExtras:()=>({open(){},close(){}}),setTimeout,window:{location:{origin:'https://example.pages.dev'}}});
    const e=id=>document.getElementById(id);
    await waitFor(()=>!e('login-form').hidden);
    e('email').value='admin@example.com';e('password').value='correct-test-password';
    await e('login-form').handlers.submit({preventDefault(){}});
    await waitFor(()=>!e('form').hidden);
    e('cash').value='123.45';e('pledges').value='20';e('contact').value='hello@example.com';
    await e('form').handlers.submit({preventDefault(){}});
    assert.match(e('message').textContent,/Saved/);

    // An ordinary signed-out reader uses the actual client and the same SQL.
    const publicClient=createClient('https://example.supabase.co','sb_publishable_test',{global:{fetch:fakeFetch},auth:{persistSession:false,autoRefreshToken:false}});
    const publicDocument=fakeDocument();
    const publicSource=(await readFile(new URL('../public/public.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/,'');
    await runInNewContext(`(async()=>{${publicSource}\n})()`,{document:publicDocument,configured:true,supabase:publicClient});
    assert.equal(publicDocument.getElementById('raised').textContent,'$123.45');
    assert.equal(publicDocument.getElementById('remaining').textContent,'$4,876.55');
    assert.equal(publicDocument.getElementById('pledges').textContent,'$20.00');
    await publicClient.auth.dispose();

    // The genuine SDK sees zero updated rows for a different signed-in UID.
    await client.auth.signOut();
    const {error:loginError}=await client.auth.signInWithPassword({email:'other@example.com',password:'correct-test-password'});
    assert.equal(loginError,null);
    const denied=await client.from('ahf_fundraising_progress').update({cash_cents:99999}).eq('id',1).eq('revision',1).select('cash_cents');
    assert.equal(denied.error,null);
    assert.deepEqual(denied.data,[]);
  } finally {
    if (client) await client.auth.dispose();
    await db.close();
  }
});
