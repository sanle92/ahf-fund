import { configured, configurationError, supabase, googleSignInEnabled } from './supabase-client.js';
import { createExtras } from './holyghost-extras.js';

const element = id => document.getElementById(id);
const message = text => { element('message').textContent = text; };
const amount = cents => cents == null ? '' : (cents / 100).toFixed(2);
const columns = 'cash_cents,pledge_cents,inkind_cents,note,contact,revision,updated_at';
let ready = false;
let expectedRevision = null;
let sessionGeneration = 0;
let currentSession = null;
const extras = configured ? createExtras(supabase, toCents) : null;

function toCents(value) {
  if (value === '') return null;
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(value)) throw new Error('Enter a non-negative amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(result) || result > 100000000000) throw new Error('Amount is too large.');
  return result;
}

function databaseProblem(error) {
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)) {
    return 'The fundraising database setup was not found. Run the complete SQL setup in this Supabase project, then try again.';
  }
  if (error?.code === '42501') return 'The database denied access. Check the SQL setup and the administrator user ID.';
  return 'Could not check access or load the figures. Check your internet connection and Supabase project settings, then try again.';
}

function signInProblem(error) {
  if (error?.code === 'email_not_confirmed') return 'This email has not been confirmed in Supabase Authentication. Confirm it before signing in.';
  if (error?.code === 'invalid_credentials') return 'The email or password is incorrect. Use the application user created under Supabase Authentication > Users.';
  if (error?.code === 'over_request_rate_limit') return 'Too many sign-in attempts. Wait a few minutes and try again.';
  return 'Sign-in failed. Check your application-user email and password, Supabase URL and public key, and internet connection.';
}

async function renderSession(session, generation) {
  if (generation !== sessionGeneration) return;
  extras?.close();
  currentSession = session;
  ready = false;
  expectedRevision = null;
  element('save').disabled = true;
  element('reload').hidden = true;
  element('form').hidden = true;
  element('login-form').hidden = !!session;
  element('google').hidden = !!session || !googleSignInEnabled;
  element('logout').hidden = !session;
  element('user-id-panel').hidden = !session;
  element('user-id').textContent = session?.user?.id || '';
  if (!session) {
    element('password').value = '';
    element('auth-status').textContent = 'Sign in with your authorized administrator account.';
    return;
  }

  element('auth-status').textContent = 'Checking administrator access…';
  try {
    const access = await supabase.rpc('ahf_fundraising_can_edit');
    if (generation !== sessionGeneration) return;
    if (access.error) throw access.error;
    if (access.data !== true) {
      element('auth-status').textContent = 'Signed in, but this account is not authorized. Check the user ID below and run the setup SQL with the correct administrator ID.';
      return;
    }
    const progress = await supabase.from('ahf_fundraising_progress').select(columns).eq('id', 1).maybeSingle();
    if (generation !== sessionGeneration) return;
    if (progress.error || !progress.data) throw progress.error || { code: 'PGRST205' };
    const data = progress.data;
    expectedRevision = data.revision;
    element('cash').value = amount(data.cash_cents);
    element('pledges').value = amount(data.pledge_cents);
    element('inkind').value = amount(data.inkind_cents);
    element('note').value = data.note || '';
    element('contact').value = data.contact || '';
    element('auth-status').textContent = 'Signed in as ' + (session.user.email || 'administrator');
    element('form').hidden = false;
    element('save').disabled = false;
    ready = true;
    message('Ready to update.');
    extras?.open();
  } catch (error) {
    if (generation !== sessionGeneration) return;
    element('auth-status').textContent = databaseProblem(error);
  }
}

if (!configured) {
  element('auth-status').textContent = configurationError || 'Supabase is not configured.';
  element('setup-help').hidden = false;
} else {
  // Supabase calls are deferred outside onAuthStateChange to avoid a deadlock.
  supabase.auth.onAuthStateChange((event, session) => {
    if (['TOKEN_REFRESHED', 'SIGNED_IN'].includes(event) && ready && session?.user?.id === currentSession?.user?.id) {
      currentSession = session;
      return; // Do not discard unsaved form values on token refresh or focus.
    }
    const generation = ++sessionGeneration;
    setTimeout(() => { void renderSession(session, generation); }, 0);
  });

  element('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    element('login').disabled = true;
    element('auth-status').textContent = 'Signing in…';
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: element('email').value.trim(), password: element('password').value
      });
      if (error) throw error;
      element('password').value = '';
    } catch (error) {
      element('auth-status').textContent = signInProblem(error);
    } finally {
      element('login').disabled = false;
    }
  });

  element('google').addEventListener('click', async () => {
    element('google').disabled = true;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: window.location.origin + '/holyghost/' }
      });
      if (error) throw error;
    } catch {
      element('auth-status').textContent = 'Google sign-in failed. Check the Google provider and redirect URL settings.';
      element('google').disabled = false;
    }
  });

  element('logout').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) element('auth-status').textContent = 'Sign-out failed. Check your connection and try again.';
  });

  element('reload').addEventListener('click', () => {
    if (currentSession) {
      const generation = ++sessionGeneration;
      void renderSession(currentSession, generation);
    }
  });

  element('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!ready) return;
    const generation = sessionGeneration;
    element('save').disabled = true;
    try {
      const update = {
        cash_cents: toCents(element('cash').value),
        pledge_cents: toCents(element('pledges').value),
        inkind_cents: toCents(element('inkind').value),
        note: element('note').value.trim(),
        contact: element('contact').value.trim()
      };
      // An array response reliably distinguishes zero rows from one row on
      // update, including different PostgREST and supabase-js versions.
      const { data, error } = await supabase.from('ahf_fundraising_progress').update(update)
        .eq('id', 1).eq('revision', expectedRevision).select(columns);
      if (generation !== sessionGeneration) return;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Unexpected save response.');
      if (data.length !== 1) {
        ready = false;
        element('reload').hidden = false;
        message('Not saved: the figures or your access may have changed. Reload the latest figures before trying again.');
        return;
      }
      expectedRevision = data[0].revision;
      element('reload').hidden = true;
      message('Saved. Your public page has been updated.');
    } catch (error) {
      if (generation !== sessionGeneration) return;
      if (error?.message?.startsWith('Enter a non-negative') || error?.message === 'Amount is too large.') {
        message(error.message);
      } else {
        ready = false;
        element('reload').hidden = false;
        message('Save could not be confirmed. Reload the latest figures and check them before trying again.');
      }
    } finally {
      if (generation === sessionGeneration) element('save').disabled = !ready;
    }
  });
}
