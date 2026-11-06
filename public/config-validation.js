// Only PUBLIC Supabase credentials may be included in a browser app.
// Legacy anon keys are JWTs whose payload explicitly identifies role=anon.
export function configError(url, key) {
  if (typeof url !== 'string' || !url || url.includes('REPLACE_WITH')) {
    return 'Add the Supabase project URL to public/supabase-config.js or the Cloudflare build settings.';
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw Error('invalid');
  } catch {
    return 'The Supabase project URL is invalid. Use the HTTPS project URL, without a path.';
  }
  if (typeof key !== 'string' || !key || key.includes('REPLACE_WITH')) {
    return 'Add the Supabase publishable key (or legacy anon key) to public/supabase-config.js or the Cloudflare build settings.';
  }
  if (key.startsWith('sb_secret_')) return 'A secret key was supplied. Replace it with a publishable key; never place a secret key in a public site.';
  if (key.startsWith('sb_publishable_') && key.length > 'sb_publishable_'.length) return '';
  try {
    const pieces = key.split('.');
    if (pieces.length !== 3) throw Error('invalid');
    const base64 = pieces[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (payload.role === 'anon') return '';
    if (payload.role === 'service_role') return 'A service_role key was supplied. Replace it with a publishable or anon key; never place a service_role key in a public site.';
  } catch { /* Use the generic message below. Never print the key. */ }
  return 'The Supabase key is not a valid publishable or legacy anon key. Check your project API keys.';
}
