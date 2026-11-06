import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createClient} from '../public/vendor/supabase.js';
const ADMIN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=id=>`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.test`;
const adminToken=token(ADMIN),otherToken=token(OTHER);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const numberize=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,['amount_cents','revision'].includes(k)&&v!==null?Number(v):v]));

test('actual SDK and SQL handle donor drafts, publication, phone and unauthorized users',async()=>{
 const db=await PGlite.create();let admin,other,anon;
 try{
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users(id uuid primary key);insert into auth.users values ('${ADMIN}'),('${OTHER}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const setup=await readFile(new URL('../supabase_setup.sql',import.meta.url),'utf8');await db.exec(setup.replace('REPLACE_WITH_ADMIN_USER_UUID',ADMIN));
  const fetchMock=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url);
    const method=(init.method||(typeof input==='string'?'GET':input.method)||'GET').toUpperCase();
    const headers=new Headers(init.headers||(typeof input==='string'?{}:input.headers));
    if(url.pathname==='/auth/v1/token'&&method==='POST'){
      const body=JSON.parse(init.body);const id=body.email==='admin@example.com'?ADMIN:OTHER;
      return json({access_token:id===ADMIN?adminToken:otherToken,token_type:'bearer',expires_in:3600,refresh_token:'test',user:{id,email:body.email,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}});
    }
    const bearer=(headers.get('authorization')||'').replace(/^Bearer\s+/i,'');const uid=bearer===adminToken?ADMIN:bearer===otherToken?OTHER:'';
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec(`set role ${uid?'authenticated':'anon'}`);
    try{
      if(url.pathname==='/rest/v1/ahf_fundraising_donors'){
        const full='id,display_name,amount_cents,comment,published,consent_confirmed,created_at,revision,updated_at';
        if(method==='GET'){
          const columns=uid?full:'id,display_name,amount_cents,comment,published,consent_confirmed,created_at';
          let query=`select ${columns} from public.ahf_fundraising_donors`;
          if(url.searchParams.get('published')==='eq.true')query+=' where published and consent_confirmed';
          query+=' order by created_at desc,id desc';
          return json((await db.query(query)).rows.map(numberize));
        }
        const body=init.body?JSON.parse(init.body):{};
        if(method==='POST')return json((await db.query(`insert into public.ahf_fundraising_donors (display_name,amount_cents,comment,published,consent_confirmed) values ($1,$2,$3,$4,$5) returning ${full}`,[body.display_name,body.amount_cents,body.comment,body.published,body.consent_confirmed])).rows.map(numberize),201);
        if(method==='PATCH'){
          const id=(url.searchParams.get('id')||'').replace(/^eq\./,'');const rev=Number((url.searchParams.get('revision')||'').replace(/^eq\./,''));
          return json((await db.query(`update public.ahf_fundraising_donors set display_name=$1,amount_cents=$2,comment=$3,published=$4,consent_confirmed=$5 where id=$6 and revision=$7 returning ${full}`,[body.display_name,body.amount_cents,body.comment,body.published,body.consent_confirmed,id,rev])).rows.map(numberize));
        }
      }
      if(url.pathname==='/rest/v1/ahf_fundraising_site_content'){
        if(method==='GET')return json((await db.query('select vision,mission,phone,revision,updated_at from public.ahf_fundraising_site_content where id=1')).rows.map(numberize));
        if(method==='PATCH'){
          const body=JSON.parse(init.body);const rev=Number((url.searchParams.get('revision')||'').replace(/^eq\./,''));
          return json((await db.query('update public.ahf_fundraising_site_content set vision=$1,mission=$2,phone=$3 where id=1 and revision=$4 returning vision,mission,phone,revision,updated_at',[body.vision,body.mission,body.phone,rev])).rows.map(numberize));
        }
      }
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    }catch(error){return json({code:error.code||'UNKNOWN',message:'Test database rejected request'},400)}
  };
  const make=()=>createClient('https://example.supabase.co','sb_publishable_test',{global:{fetch:fetchMock},auth:{persistSession:false,autoRefreshToken:false}});
  admin=make();other=make();anon=make();
  await admin.auth.signInWithPassword({email:'admin@example.com',password:'test'});
  await other.auth.signInWithPassword({email:'other@example.com',password:'test'});
  const row={display_name:'Private draft',amount_cents:1000,comment:'',published:false,consent_confirmed:false};
  const created=await admin.from('ahf_fundraising_donors').insert(row).select('*');
  assert.equal(created.error,null);assert.equal(created.data.length,1);
  const id=created.data[0].id;
  const publicBefore=await anon.from('ahf_fundraising_donors').select('id,display_name,amount_cents,comment,created_at,published,consent_confirmed').eq('published',true).eq('consent_confirmed',true);
  assert.equal(publicBefore.error,null);assert.equal(publicBefore.data.length,0);
  const otherBefore=await other.from('ahf_fundraising_donors').select('*');assert.equal(otherBefore.data.length,0);
  const invalid=await admin.from('ahf_fundraising_donors').update({...row,published:true}).eq('id',id).eq('revision',0).select('*');
  assert.equal(invalid.error.code,'23514');
  const published=await admin.from('ahf_fundraising_donors').update({...row,display_name:'Anonymous',published:true,consent_confirmed:true}).eq('id',id).eq('revision',0).select('*');
  assert.equal(published.error,null);assert.equal(published.data.length,1);assert.equal(published.data[0].revision,1);
  const publicAfter=await anon.from('ahf_fundraising_donors').select('id,display_name,amount_cents,comment,created_at,published,consent_confirmed').eq('published',true).eq('consent_confirmed',true);
  assert.equal(publicAfter.data.length,1);assert.equal(publicAfter.data[0].display_name,'Anonymous');
  const denied=await other.from('ahf_fundraising_donors').update({...row,display_name:'Changed'}).eq('id',id).eq('revision',1).select('*');
  assert.equal(denied.error,null);assert.equal(denied.data.length,0);
  const site=await admin.from('ahf_fundraising_site_content').update({vision:'Vision',mission:'Mission',phone:'+256700000000'}).eq('id',1).eq('revision',0).select('*');
  assert.equal(site.error,null);assert.equal(site.data.length,1);
  const publicSite=await anon.from('ahf_fundraising_site_content').select('vision,mission,phone').eq('id',1).maybeSingle();
  assert.equal(publicSite.data.phone,'+256700000000');
 }finally{for(const c of [admin,other,anon])if(c)await c.auth.dispose();await db.close()}
});
