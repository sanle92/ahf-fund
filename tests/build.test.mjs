import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('Cloudflare build writes the public site with public environment values', async () => {
  const tmp = await mkdtemp(join(tmpdir(),'ahf-build-'));
  try {
    await cp(new URL('../public/',import.meta.url),join(tmp,'public'),{recursive:true});
    await cp(new URL('../scripts/',import.meta.url),join(tmp,'scripts'),{recursive:true});
    await cp(new URL('../package.json',import.meta.url),join(tmp,'package.json'));
    const env={...process.env,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_ANON_KEY:'',ENABLE_GOOGLE_SIGN_IN:'false'};
    await run(process.execPath,['scripts/build.mjs'],{cwd:tmp,env});
    const config=await readFile(join(tmp,'dist','supabase-config.js'),'utf8');
    assert.match(config,/https:\/\/example\.supabase\.co/);
    assert.match(config,/sb_publishable_test/);
    assert.ok((await readFile(join(tmp,'dist','index.html'),'utf8')).includes('Hope starts'));
    assert.ok((await readFile(join(tmp,'dist','admin','index.html'),'utf8')).includes('Update your progress'));
  } finally { await rm(tmp,{recursive:true,force:true}); }
});

test('Cloudflare build rejects elevated keys and does not print them', async () => {
  const tmp = await mkdtemp(join(tmpdir(),'ahf-build-'));
  try {
    await cp(new URL('../public/',import.meta.url),join(tmp,'public'),{recursive:true});
    await cp(new URL('../scripts/',import.meta.url),join(tmp,'scripts'),{recursive:true});
    await cp(new URL('../package.json',import.meta.url),join(tmp,'package.json'));
    const secret='sb_secret_example_test_value';
    const env={...process.env,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:secret,SUPABASE_ANON_KEY:''};
    await assert.rejects(run(process.execPath,['scripts/build.mjs'],{cwd:tmp,env}),error=>{
      assert.match(error.stderr,/secret key/);
      assert.equal(error.stderr.includes(secret),false);
      return true;
    });
  } finally { await rm(tmp,{recursive:true,force:true}); }
});
