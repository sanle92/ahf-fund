import { createClient } from './vendor/supabase.js';
import { supabaseUrl, supabasePublishableKey, googleSignInEnabled } from './supabase-config.js';
import { configError } from './config-validation.js';

export { googleSignInEnabled };
export const configurationError = configError(supabaseUrl, supabasePublishableKey);
export const configured = !configurationError;

// A publishable or legacy anon key is safe to expose when RLS is configured.
// RLS in supabase_setup.sql enforces authorization; this check is only UX.
export const supabase = configured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    })
  : null;
