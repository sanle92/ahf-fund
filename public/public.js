import { configured, supabase } from './supabase-client.js';

const element = id => document.getElementById(id);
const format = cents => cents == null
  ? 'Not yet reported'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
const supporterPageSize = 20;
let supporterOffset = 0;
let supportersLoading = false;
let hasPublicContact = false;

async function loadProgress() {
  try {
    const { data, error } = await supabase.from('ahf_fundraising_progress')
      .select('cash_cents,pledge_cents,inkind_cents,note,contact,updated_at')
      .eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!data) return;
    element('raised').textContent = format(data.cash_cents);
    element('pledges').textContent = format(data.pledge_cents);
    element('inkind').textContent = format(data.inkind_cents);
    if (data.cash_cents != null) {
      element('remaining').textContent = format(Math.max(0, 500000 - data.cash_cents));
      element('percent').textContent = (data.cash_cents / 500000 * 100).toFixed(1) + '% of goal';
      element('bar').style.width = Math.min(100, data.cash_cents / 500000 * 100) + '%';
    }
    if (data.updated_at) {
      element('updated').textContent = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium', timeZone: 'Africa/Kampala'
      }).format(new Date(data.updated_at));
    }
    if (data.note) element('note').textContent = data.note;
    if (data.contact) {
      hasPublicContact = true;
      element('contact').textContent = data.contact;
      element('contact').hidden = false;
      if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(data.contact)) {
        element('contact-link').href = 'mailto:' + data.contact;
        element('contact-link').hidden = false;
      }
    }
  } catch {
    element('note').textContent = 'Progress is temporarily unavailable. Please check back later.';
  }
}

async function loadSiteContent() {
  try {
    const {data,error} = await supabase.from('ahf_fundraising_site_content')
      .select('vision,mission,phone').eq('id',1).maybeSingle();
    if (error) throw error;
    if (!data) return;
    if (data.vision) element('vision-text').textContent = data.vision;
    if (data.mission) element('mission-text').textContent = data.mission;
    const phone = (data.phone || '').trim();
    const digits = phone.replace(/\D/g,'');
    if (/^\+?[0-9().\s-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15) {
      element('phone-link').textContent = phone;
      element('phone-link').href = 'tel:' + (phone.startsWith('+') ? '+' : '') + digits;
      element('phone-block').hidden = false;
      if (!hasPublicContact) element('contact').hidden = true;
    }
  } catch { /* Keep the proposal's default wording and no invented phone number. */ }
}

function supporterCard(donor) {
  const card = document.createElement('article');
  card.className = 'donor-card';
  const top = document.createElement('div');
  top.className = 'donor-top';
  const name = document.createElement('span');
  name.className = 'donor-name';
  name.textContent = donor.display_name;
  const amount = document.createElement('span');
  amount.className = 'donor-amount';
  amount.textContent = format(donor.amount_cents);
  top.append(name,amount);
  card.append(top);
  if (donor.comment) {
    const quote = document.createElement('p');
    quote.className = 'donor-comment';
    quote.textContent = donor.comment;
    card.append(quote);
  }
  return card;
}

async function loadSupporters() {
  if (supportersLoading) return;
  supportersLoading = true;
  element('donor-more').disabled = true;
  try {
    // Explicit filters also keep drafts hidden when an administrator views the
    // public page while signed in; row-level security enforces the same rule.
    const {data,error} = await supabase.from('ahf_fundraising_donors')
      .select('id,display_name,amount_cents,comment,created_at,published,consent_confirmed')
      .eq('published',true).eq('consent_confirmed',true)
      .order('created_at',{ascending:false}).order('id',{ascending:false})
      .range(supporterOffset,supporterOffset + supporterPageSize);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Unexpected donor response');
    const page = data.slice(0,supporterPageSize);
    for (const donor of page) element('donor-list').append(supporterCard(donor));
    supporterOffset += page.length;
    element('donor-status').textContent = supporterOffset ? '' : 'Donor acknowledgements will appear here with their permission.';
    element('donor-more').hidden = data.length <= supporterPageSize;
  } catch {
    element('donor-status').textContent = 'Donor acknowledgements are temporarily unavailable. Please check back later.';
    element('donor-more').hidden = true;
  } finally {
    supportersLoading = false;
    element('donor-more').disabled = false;
  }
}

if (configured) {
  element('donor-more').addEventListener('click',loadSupporters);
  await Promise.allSettled([loadProgress(),loadSiteContent(),loadSupporters()]);
}
