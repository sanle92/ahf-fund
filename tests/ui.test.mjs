import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { configError } from '../public/config-validation.js';

const adminCode = (await readFile(new URL('../public/holyghost.js', import.meta.url), 'utf8')).replace(/^import .*?;\s*/gm, '');
const publicCode = (await readFile(new URL('../public/public.js', import.meta.url), 'utf8')).replace(/^import .*?;\s*/, '');
const nextTick = () => new Promise(resolve => setTimeout(resolve, 5));

function fakeDocument() {
  const elements = new Map();
  return {
    elements,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        value: '', hidden: ['login-form', 'google', 'logout', 'form', 'contact-link', 'reload', 'setup-help', 'user-id-panel'].includes(id),
        disabled: id === 'save', textContent: '', style: {}, handlers: {},
        addEventListener(name, fn) { this.handlers[name] = fn; }
      });
      return elements.get(id);
    }
  };
}

function fakeSupabase({ allowed = true, data } = {}) {
  let onAuth;
  const state = { allowed, data: data || { cash_cents: null, pledge_cents: null, inkind_cents: null, note: '', contact: '', revision: 0, updated_at: null } };
  const client = {
    auth: {
      onAuthStateChange(fn) { onAuth = fn; fn('INITIAL_SESSION', null); },
      async signInWithPassword() {
        onAuth('SIGNED_IN', { user: { id: 'admin-id', email: 'admin@example.com' } });
        return { error: null };
      },
      async signOut() { onAuth('SIGNED_OUT', null); return { error: null }; }
    },
    emit(event, session) { onAuth(event, session); },
    async rpc() { return { data: state.allowed, error: null }; },
    from() {
      let patch = null;
      const filters = {};
      async function result(single = false) {
        if (patch) {
          if (!state.allowed || filters.revision !== state.data.revision) return { data: single ? null : [], error: null };
          state.data = { ...state.data, ...patch, revision: state.data.revision + 1, updated_at: '2026-11-01T12:00:00Z' };
        }
        return { data: single ? { ...state.data } : [{ ...state.data }], error: null };
      }
      return {
        select() { return this; },
        update(value) { patch = value; return this; },
        eq(key, value) { filters[key] = value; return this; },
        maybeSingle() { return result(true); },
        then(resolve, reject) { return result().then(resolve, reject); }
      };
    }
  };
  return { client, state };
}

async function launchAdmin(options) {
  const document = fakeDocument();
  const supabase = fakeSupabase(options);
  runInNewContext(adminCode, { document, configured: true, supabase: supabase.client, googleSignInEnabled: false, createExtras:()=>({open(){},close(){}}), setTimeout, window: { location: { origin: 'https://example.pages.dev' } } });
  await nextTick();
  return { document, ...supabase };
}

test('public page shows cash remaining and separates pledges and in-kind support', async () => {
  const document = fakeDocument();
  const { client } = fakeSupabase({ data: { cash_cents: 125000, pledge_cents: 30000, inkind_cents: 10000, note: 'Thanks', contact: 'hello@example.com', updated_at: '2026-11-01T12:00:00Z' } });
  await runInNewContext(`(async () => { ${publicCode}\n })()`, { document, configured: true, supabase: client });
  assert.equal(document.getElementById('raised').textContent, '$1,250.00');
  assert.equal(document.getElementById('remaining').textContent, '$3,750.00');
  assert.equal(document.getElementById('pledges').textContent, '$300.00');
  assert.equal(document.getElementById('inkind').textContent, '$100.00');
  assert.equal(document.getElementById('percent').textContent, '25.0% of goal');
  assert.equal(document.getElementById('contact-link').href, 'mailto:hello@example.com');
});

test('approved administrator can sign in, update and save on the dashboard', async () => {
  const { document, state } = await launchAdmin({ allowed: true });
  const get = id => document.getElementById(id);
  get('email').value = 'admin@example.com';
  get('password').value = 'example-only';
  await get('login-form').handlers.submit({ preventDefault() {} });
  await nextTick();
  assert.equal(get('form').hidden, false);
  assert.equal(get('logout').hidden, false);
  get('cash').value = '100.50';
  get('pledges').value = '25';
  get('note').value = 'A verified update';
  await get('form').handlers.submit({ preventDefault() {} });
  assert.equal(state.data.cash_cents, 10050);
  assert.equal(state.data.pledge_cents, 2500);
  assert.equal(state.data.note, 'A verified update');
  assert.match(get('message').textContent, /Saved/);
});

test('a changed revision stops a stale dashboard from overwriting newer figures', async () => {
  const { document, state } = await launchAdmin({ allowed: true });
  const get = id => document.getElementById(id);
  await get('login-form').handlers.submit({ preventDefault() {} });
  await nextTick();
  state.data.revision += 1;
  state.data.cash_cents = 45000;
  get('cash').value = '10';
  await get('form').handlers.submit({ preventDefault() {} });
  assert.equal(state.data.cash_cents, 45000);
  assert.equal(get('save').disabled, true);
  assert.match(get('message').textContent, /Not saved/);
  assert.equal(get('reload').hidden, false);
  get('reload').handlers.click();
  await nextTick();
  assert.equal(get('cash').value, '450.00');
  assert.equal(get('save').disabled, false);
});

test('a different account is shown an access message and no editor', async () => {
  const { document } = await launchAdmin({ allowed: false });
  const get = id => document.getElementById(id);
  await get('login-form').handlers.submit({ preventDefault() {} });
  await nextTick();
  assert.equal(get('form').hidden, true);
  assert.match(get('auth-status').textContent, /not authorized/);
  assert.equal(get('logout').hidden, false);
  assert.equal(get('user-id').textContent, 'admin-id');
});

test('validates public publishable and legacy anon keys and rejects elevated keys', () => {
  const jwt = role => `test.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`;
  assert.equal(configError('https://example.supabase.co', 'sb_publishable_public-example'), '');
  assert.equal(configError('https://example.supabase.co', jwt('anon')), '');
  assert.match(configError('https://example.supabase.co', 'sb_secret_do-not-use'), /secret key/);
  assert.match(configError('https://example.supabase.co', jwt('service_role')), /service_role/);
  assert.match(configError('invalid', 'sb_publishable_test'), /URL is invalid/);
});

test('repeat sign-in events do not erase unsaved dashboard edits', async () => {
  const { document, client } = await launchAdmin({ allowed: true });
  const get = id => document.getElementById(id);
  await get('login-form').handlers.submit({ preventDefault() {} });
  await nextTick();
  get('cash').value = '99.95';
  client.emit('SIGNED_IN', { user: { id: 'admin-id', email: 'admin@example.com' } });
  await nextTick();
  assert.equal(get('cash').value, '99.95');
});
