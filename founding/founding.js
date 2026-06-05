// ==========================================================
//   GUIDED GROWTH — FOUNDING USERS intake
//   Multi-step questionnaire -> Supabase founding_signups.
//   Mirrors the main site's anon-INSERT pattern.
// ==========================================================

const PUBLIC = window.GG_PUBLIC || {};
const SUPABASE_READY =
  PUBLIC.supabaseUrl &&
  PUBLIC.supabaseAnonKey &&
  !PUBLIC.supabaseUrl.startsWith('REPLACE_') &&
  !PUBLIC.supabaseAnonKey.startsWith('REPLACE_');

const sbHeaders = () => ({
  'apikey':        PUBLIC.supabaseAnonKey,
  'Authorization': `Bearer ${PUBLIC.supabaseAnonKey}`,
  'Content-Type':  'application/json'
});

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// ---- Toast ----
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast__msg').textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4500);
}

// ==========================================================
//   State
// ==========================================================
const state = {
  first_name: '',
  email: '',
  heard_from: '',
  referred_by_name: '',
  heard_from_other: '',
  track_level: '',
  apps_used: [],
  apps_other: '',
  pays_for_apps: '',
  age: '',
  gender: '',
  baseline_score: 5,
  baseline_skipped: false,
  two_week_commit: false
};

const form     = document.getElementById('founding-form');
const steps    = Array.from(form.querySelectorAll('.fstep'));
const bar      = document.getElementById('progress-bar');
const btnBack  = document.getElementById('btn-back');
const btnNext  = document.getElementById('btn-next');
const btnSubmit= document.getElementById('btn-submit');
let current = 0;

// Steps that must have an answer before Continue.
function isValidAge(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 13 && n <= 120;
}

const REQUIRED = {
  0: () => state.first_name.trim() && isValidEmail(state.email.trim()),
  1: () => !!state.heard_from
        && (state.heard_from !== 'friend' || !!state.referred_by_name.trim())
        && (state.heard_from !== 'other'  || !!state.heard_from_other.trim()),
  2: () => !!state.track_level,
  5: () => isValidAge(state.age),
  7: () => state.two_week_commit
};
const REQUIRED_MSG = {
  0: 'Please add your name and a valid email.',
  1: () => state.heard_from === 'friend' ? 'Add your friend’s name so we can thank them.'
        : state.heard_from === 'other'  ? 'Tell us where you heard about us.'
        : 'Pick one so we know where you came from.',
  2: 'Pick one so we can start you in the right place.',
  5: 'Please enter your age.',
  7: 'Check the box to claim your founding spot.'
};

// ==========================================================
//   Step navigation
// ==========================================================
function render() {
  steps.forEach((s, i) => s.classList.toggle('is-active', i === current));
  bar.style.width = `${((current + 1) / steps.length) * 100}%`;
  btnBack.hidden = current === 0;
  const last = current === steps.length - 1;
  btnNext.hidden = last;
  btnSubmit.hidden = !last;
  clearError(current);
}

function clearError(i) {
  const el = steps[i].querySelector('[data-error]');
  if (el) { el.hidden = true; el.textContent = ''; }
}
function setError(i, msg) {
  const el = steps[i].querySelector('[data-error]');
  if (el) { el.hidden = false; el.textContent = msg; }
}

function msgFor(i) {
  const m = REQUIRED_MSG[i];
  return typeof m === 'function' ? m() : m;
}

function validateStep(i) {
  const check = REQUIRED[i];
  if (check && !check()) { setError(i, msgFor(i)); return false; }
  clearError(i);
  return true;
}

btnNext.addEventListener('click', () => {
  // pull free-text values just before validating step 0
  if (current === 0) {
    state.first_name = document.getElementById('f-name').value;
    state.email = document.getElementById('f-email').value;
  }
  if (!validateStep(current)) return;
  if (current < steps.length - 1) { current++; render(); scrollCard(); }
});

btnBack.addEventListener('click', () => {
  if (current > 0) { current--; render(); scrollCard(); }
});

function scrollCard() {
  document.getElementById('claim').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// keep state in sync as the user types
document.getElementById('f-name').addEventListener('input', e => { state.first_name = e.target.value; clearError(0); });
document.getElementById('f-email').addEventListener('input', e => { state.email = e.target.value; clearError(0); });

// ==========================================================
//   Chips (single + multi)
// ==========================================================
form.querySelectorAll('.chips').forEach(group => {
  const field  = group.dataset.field;
  const single = group.hasAttribute('data-single');
  group.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.value;
      if (single) {
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('is-selected'));
        chip.classList.add('is-selected');
        state[field] = val;
        clearError(current);
        // reveal the friend-name field only when "A friend" is chosen
        if (field === 'heard_from') {
          const ref = document.getElementById('f-referred-by');
          const oth = document.getElementById('f-heard-other');
          const isFriend = val === 'friend';
          const isOther  = val === 'other';
          if (ref) { ref.hidden = !isFriend; if (!isFriend) { ref.value = ''; state.referred_by_name = ''; } }
          if (oth) { oth.hidden = !isOther;  if (!isOther)  { oth.value = ''; state.heard_from_other = ''; } }
          if (isFriend && ref) ref.focus();
          if (isOther && oth) oth.focus();
        }
      } else {
        // multi-select (apps_used)
        chip.classList.toggle('is-selected');
        const set = new Set(state[field]);
        // "none" is exclusive
        if (val === 'none' && chip.classList.contains('is-selected')) {
          group.querySelectorAll('.chip').forEach(c => { if (c !== chip) c.classList.remove('is-selected'); });
          set.clear();
        } else if (val !== 'none') {
          const noneChip = group.querySelector('.chip[data-value="none"]');
          if (noneChip) noneChip.classList.remove('is-selected');
          set.delete('none');
        }
        if (chip.classList.contains('is-selected')) set.add(val); else set.delete(val);
        state[field] = Array.from(set);
        // toggle the "other" text field
        const other = document.getElementById('f-apps-other');
        if (other) other.hidden = !state[field].includes('other');
      }
    });
  });
});

document.getElementById('f-apps-other').addEventListener('input', e => { state.apps_other = e.target.value; });
document.getElementById('f-referred-by').addEventListener('input', e => { state.referred_by_name = e.target.value; clearError(1); });
document.getElementById('f-heard-other').addEventListener('input', e => { state.heard_from_other = e.target.value; clearError(1); });
document.getElementById('f-age').addEventListener('input', e => { state.age = e.target.value; clearError(5); });

// ==========================================================
//   Baseline slider
// ==========================================================
const slider = document.getElementById('f-baseline');
const sliderVal = document.getElementById('baseline-value');
slider.addEventListener('input', e => {
  state.baseline_score = parseInt(e.target.value, 10);
  state.baseline_skipped = false;
  sliderVal.textContent = e.target.value;
});
document.getElementById('baseline-skip').addEventListener('click', () => {
  state.baseline_skipped = true;
  if (current < steps.length - 1) { current++; render(); scrollCard(); }
});

// commit checkbox
document.getElementById('f-commit').addEventListener('change', e => {
  state.two_week_commit = e.target.checked;
  clearError(current);
});

// ==========================================================
//   Derived path (beginner vs advanced) — re-derivable from raw
// ==========================================================
function derivePath() {
  const advancedApps = ['notion', 'habit_tracker', 'journaling', 'coaching'];
  const tracks = state.track_level === 'casual' || state.track_level === 'serious';
  const usesAdvancedApp = (state.apps_used || []).some(a => advancedApps.includes(a));
  return (tracks || usesAdvancedApp) ? 'advanced' : 'beginner';
}

// ==========================================================
//   Submit
// ==========================================================
function buildPayload() {
  const apps = [...(state.apps_used || [])];
  return {
    email:            state.email.trim().toLowerCase(),
    first_name:       state.first_name.trim(),
    heard_from:       state.heard_from || null,
    referred_by_name: (state.heard_from === 'friend' && state.referred_by_name.trim()) ? state.referred_by_name.trim() : null,
    heard_from_other: (state.heard_from === 'other' && state.heard_from_other.trim()) ? state.heard_from_other.trim() : null,
    track_level:      state.track_level || null,
    apps_used:        apps.length ? apps : null,
    apps_other:       (apps.includes('other') && state.apps_other.trim()) ? state.apps_other.trim() : null,
    pays_for_apps:    state.pays_for_apps || null,
    age:              isValidAge(state.age) ? parseInt(state.age, 10) : null,
    gender:           state.gender || null,
    baseline_score:  state.baseline_skipped ? null : state.baseline_score,
    derived_path:    derivePath(),
    two_week_commit: state.two_week_commit,
    commit_ts:       state.two_week_commit ? new Date().toISOString() : null,
    referrer:        document.referrer || null,
    user_agent:      navigator.userAgent.slice(0, 500)
  };
}

async function submitFounding(payload) {
  if (!SUPABASE_READY) { await new Promise(r => setTimeout(r, 600)); return { ok: true, simulated: true }; }

  const res = await fetch(`${PUBLIC.supabaseUrl}/rest/v1/founding_signups`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(payload)
  });

  if (res.ok) return { ok: true };
  if (res.status === 409) return { ok: true, duplicate: true };

  let detail = '';
  try { detail = (await res.json()).message || ''; } catch (_) {}
  if (/FOUNDING_FULL/i.test(detail)) return { ok: false, full: true };
  return { ok: false, status: res.status, detail };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  state.first_name = document.getElementById('f-name').value;
  state.email = document.getElementById('f-email').value;

  // validate every required step before sending
  for (const i of Object.keys(REQUIRED).map(Number)) {
    if (!REQUIRED[i]()) { current = i; render(); setError(i, msgFor(i)); scrollCard(); return; }
  }

  btnSubmit.textContent = 'Claiming…';
  btnSubmit.disabled = true;
  const result = await submitFounding(buildPayload());
  btnSubmit.textContent = 'Claim my founding spot';
  btnSubmit.disabled = false;

  if (result.ok) {
    form.hidden = true;
    const success = document.getElementById('success');
    if (result.duplicate) {
      success.querySelector('.fnd-success__msg').textContent =
        'You already claimed a founding spot with this email. Watch your inbox for your invite.';
    }
    success.hidden = false;
    scrollCard();
  } else if (result.full) {
    showFull();
  } else {
    showToast('Something went wrong. Try again in a moment.');
    console.error('[founding] submit failed', result);
  }
});

// ==========================================================
//   Spots counter + cap handling
// ==========================================================
function showFull() {
  form.hidden = true;
  document.getElementById('success').hidden = true;
  document.getElementById('full').hidden = false;
}

async function loadSpots() {
  if (!SUPABASE_READY) { paintSpots(37); return; }   // preview number
  try {
    const res = await fetch(`${PUBLIC.supabaseUrl}/rest/v1/rpc/founding_spots_remaining`, {
      method: 'POST', headers: sbHeaders(), body: '{}'
    });
    if (!res.ok) return;
    const remaining = await res.json();   // scalar int
    paintSpots(Number(remaining));
    if (Number(remaining) <= 0) showFull();
  } catch (_) { /* leave default copy */ }
}

function paintSpots(remaining) {
  if (Number.isNaN(remaining)) return;
  const nav = document.getElementById('spots-nav');
  const eyebrow = document.getElementById('spots-eyebrow');
  const label = `${remaining} of 50 spots left`;
  nav.textContent = label; nav.hidden = false;
  eyebrow.textContent = `Founding Users · ${label}`;
}

// ---- Overflow waitlist (cap reached) ----
const overflow = document.getElementById('overflow-form');
overflow?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = overflow.querySelector('input[name="email"]');
  const btn = overflow.querySelector('button[type="submit"]');
  const email = input.value.trim();
  const err = document.getElementById('overflow-error');
  if (!isValidEmail(email)) { err.hidden = false; err.textContent = 'Please enter a valid email.'; return; }
  err.hidden = true;
  btn.textContent = 'Joining…'; btn.disabled = true;

  let ok = true;
  if (SUPABASE_READY) {
    try {
      const res = await fetch(`${PUBLIC.supabaseUrl}/rest/v1/waitlist_signups`, {
        method: 'POST', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ email: email.toLowerCase(), source: 'founding-overflow', referrer: document.referrer || null, user_agent: navigator.userAgent.slice(0, 500) })
      });
      ok = res.ok || res.status === 409;
    } catch (_) { ok = false; }
  }
  btn.textContent = 'Join the waitlist'; btn.disabled = false;
  if (ok) { overflow.reset(); showToast("You're on the waitlist. We'll be in touch."); }
  else showToast('Something went wrong. Try again in a moment.');
});

// ---- init ----
render();
loadSpots();
