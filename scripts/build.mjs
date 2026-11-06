// Cloudflare Pages Git build. Only public values are placed in the site.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { configError } from '../public/config-validation.js';

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
if (!url || !key) {
  console.error('Cannot build: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) in Cloudflare Pages build environment settings.');
  process.exit(1);
}
const error = configError(url, key);
if (error) {
  console.error('Cannot build: ' + error);
  process.exit(1);
}

const out = new URL('../dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(new URL('../public/', import.meta.url), out, { recursive: true });
await writeFile(new URL('supabase-config.js', out),
  `// Public project configuration generated at build time.\nexport const supabaseUrl = ${JSON.stringify(url)};\nexport const supabasePublishableKey = ${JSON.stringify(key)};\nexport const googleSignInEnabled = ${process.env.ENABLE_GOOGLE_SIGN_IN === 'true'};\n`);
console.log('Cloudflare site prepared in dist/.');
