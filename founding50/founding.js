// ==========================================================
//   GUIDED GROWTH - FOUNDING USERS intake
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
  last_name: '',
  email: '',
  platform: '',        // ios | android - drives which invite (TestFlight vs Google Play)
  heard_from: '',
  referred_by_name: '',
  heard_from_other: '',
  track_level: '',
  apps_matrix: {},   // { appKey: { used: bool, paid: bool } }
  apps_none: false,  // explicit "I haven't used any of these"
  apps_other: '',
  habit: '',           // Laurel Q1: the habit/pattern to change
  habit_duration: '',  // Laurel Q2: how long it has affected them
  habit_cost: '',      // Laurel Q3: emotional/physical/financial/relational cost
  age: '',
  gender: '',
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
  0: () => state.first_name.trim() && state.last_name.trim() && isValidEmail(state.email.trim()) && !!state.platform,
  1: () => !!state.heard_from
        && (state.heard_from !== 'friend' || !!state.referred_by_name.trim())
        && (state.heard_from !== 'other'  || !!state.heard_from_other.trim()),
  2: () => !!state.track_level,
  3: () => state.apps_none || Object.values(state.apps_matrix).some(v => v.used || v.paid),
  4: () => isValidAge(state.age) && !!state.gender,
  5: () => !!state.habit.trim() && !!state.habit_duration && !!state.habit_cost.trim(),
  6: () => state.two_week_commit
};
const REQUIRED_MSG = {
  0: () => !state.platform
        ? 'Please choose iPhone or Android so we send the right invite.'
        : 'Please add your first and last name and a valid email.',
  1: () => state.heard_from === 'friend' ? "Add your friend's name so we can thank them."
        : state.heard_from === 'other'  ? 'Tell us where you heard about us.'
        : 'Pick one so we know where you came from.',
  2: 'Pick one so we can start you in the right place.',
  3: 'Tap at least one app, or "I haven\'t used any of these" at the bottom.',
  4: 'Please add your age and gender.',
  5: 'Please answer all four so your coach can actually help.',
  6: 'Check the box to claim your founding spot.'
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
    state.last_name = document.getElementById('f-last').value;
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
document.getElementById('f-last').addEventListener('input', e => { state.last_name = e.target.value; clearError(0); });
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
        if (field === 'platform') updateEmailGuidance(val);
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

// Picking iPhone/Android rewrites the email guidance so it is unmistakable
// which account email to use (the invite is delivered through that store).
function updateEmailGuidance(platform) {
  const email = document.getElementById('f-email');
  const note  = document.getElementById('emailnote-text');
  if (email) email.classList.add('input--guide');   // turns the in-box guidance red
  if (platform === 'ios') {
    if (email) email.placeholder = 'Your Apple ID email';
    if (note) note.innerHTML = 'Your invite is delivered through <strong>TestFlight</strong>, so any other email will not reach you.';
  } else if (platform === 'android') {
    if (email) email.placeholder = 'Your Google account email';
    if (note) note.innerHTML = 'Your invite is delivered through <strong>Google Play</strong>, so any other email will not reach you.';
  }
}

document.getElementById('f-apps-other').addEventListener('input', e => { state.apps_other = e.target.value; });
document.getElementById('f-referred-by').addEventListener('input', e => { state.referred_by_name = e.target.value; clearError(1); });
document.getElementById('f-heard-other').addEventListener('input', e => { state.heard_from_other = e.target.value; clearError(1); });
document.getElementById('f-age').addEventListener('input', e => { state.age = e.target.value; clearError(4); });
document.getElementById('f-habit').addEventListener('input', e => { state.habit = e.target.value; clearError(5); });
document.getElementById('f-cost').addEventListener('input', e => { state.habit_cost = e.target.value; clearError(5); });

// commit checkbox
document.getElementById('f-commit').addEventListener('change', e => {
  state.two_week_commit = e.target.checked;
  clearError(current);
});

// ==========================================================
//   Competitor matrix (used / paid per app) - the research page
//   Edit COMPETITORS freely: add/remove categories or apps.
//   `tier: 'advanced'` apps push the user toward the advanced program.
//   Logos load from Clearbit by domain, with a favicon fallback.
// ==========================================================
// The 10 human/marketing categories (the 15 technical research categories
// collapsed for the investor story), each with the top apps from the
// canonical scan. tier 'advanced' apps push the user toward the advanced program.
const COMPETITORS = [
  { cat: 'Habits', tier: 'advanced', apps: [
    { key: 'habitica',  name: 'Habitica',           domain: 'habitica.com' },
    { key: 'streaks',   name: 'Streaks',            domain: 'streaksapp.com' },
    { key: 'habitify',  name: 'Habitify',           domain: 'habitify.com' },
    { key: 'atoms',     name: 'Atoms (James Clear)', domain: 'jamesclear.com' },
    { key: 'routinery', name: 'Routinery',          domain: 'routinery.app' },
  ]},
  { cat: 'Journaling & reflection', tier: 'advanced', apps: [
    { key: 'day_one',       name: 'Day One',       domain: 'dayoneapp.com' },
    { key: 'daylio',        name: 'Daylio',        domain: 'daylio.net' },
    { key: 'reflectly',     name: 'Reflectly',     domain: 'reflectly.app' },
    { key: 'journey',       name: 'Journey',       domain: 'journey.cloud' },
    { key: 'apple_journal', name: 'Apple Journal', domain: 'apple.com' },
    { key: 'notion',        name: 'Notion',        domain: 'notion.so' },
  ]},
  { cat: 'Self-tracking & insights', tier: 'advanced', apps: [
    { key: 'rescuetime', name: 'RescueTime', domain: 'rescuetime.com' },
    { key: 'rize',       name: 'Rize',       domain: 'rize.io' },
    { key: 'stayfree',   name: 'StayFree',   domain: 'stayfreeapps.com' },
  ]},
  { cat: 'Screen time & digital wellbeing', tier: 'light', apps: [
    { key: 'one_sec',    name: 'One Sec',    domain: 'one-sec.app' },
    { key: 'opal',       name: 'Opal',       domain: 'opal.so' },
    { key: 'freedom',    name: 'Freedom',    domain: 'freedom.to' },
    { key: 'clearspace', name: 'Clearspace', domain: 'getclearspace.com' },
    { key: 'jomo',       name: 'Jomo',       domain: 'jomo.so' },
  ]},
  { cat: 'Focus & deep work', tier: 'advanced', apps: [
    { key: 'forest',  name: 'Forest',  domain: 'forestapp.cc' },
    { key: 'serene',  name: 'Serene',  domain: 'sereneapp.com' },
    { key: 'elevate', name: 'Elevate', domain: 'elevateapp.com' },
  ]},
  { cat: 'Sleep & recovery', tier: 'light', apps: [
    { key: 'sleep_cycle', name: 'Sleep Cycle', domain: 'sleepcycle.com' },
    { key: 'rise',        name: 'RISE',        domain: 'risescience.com' },
    { key: 'oura',        name: 'Oura',        domain: 'ouraring.com' },
    { key: 'whoop',       name: 'WHOOP',       domain: 'whoop.com' },
    { key: 'breathwrk',   name: 'Breathwrk',   domain: 'breathwrk.com' },
  ]},
  // Adjacent (not in the formal scan, but relevant): meditation & mindfulness
  { cat: 'Meditation & mindfulness', tier: 'light', apps: [
    { key: 'calm',          name: 'Calm',                   domain: 'calm.com' },
    { key: 'headspace',     name: 'Headspace',              domain: 'headspace.com' },
    { key: 'waking_up',     name: 'Waking Up (Sam Harris)', domain: 'wakingup.com' },
    { key: 'insight_timer', name: 'Insight Timer',          domain: 'insighttimer.com' },
    { key: 'ten_percent',   name: 'Ten Percent Happier',    domain: 'tenpercent.com' },
    { key: 'balance',       name: 'Balance',                domain: 'balanceapp.com' },
  ]},
  // Adjacent: AI coaching & journaling - the truest modern competitor to GG
  { cat: 'AI coaching & journaling', tier: 'advanced', apps: [
    { key: 'rosebud',  name: 'Rosebud',  domain: 'rosebud.app' },
    { key: 'wysa',     name: 'Wysa',     domain: 'wysa.com' },
    { key: 'stoic',    name: 'Stoic',    domain: 'getstoic.com' },
    { key: 'pi',       name: 'Pi',       domain: 'pi.ai' },
    { key: 'replika',  name: 'Replika',  domain: 'replika.com' },
    { key: 'mindsera', name: 'Mindsera', domain: 'mindsera.com' },
  ]},
  // Adjacent: coaching & personal growth - the "real coach behind it" positioning
  { cat: 'Coaching & personal growth', tier: 'advanced', apps: [
    { key: 'fabulous',   name: 'Fabulous',   domain: 'thefabulous.co' },
    { key: 'betterup',   name: 'BetterUp',   domain: 'betterup.com' },
    { key: 'noom',       name: 'Noom',       domain: 'noom.com' },
    { key: 'mindvalley', name: 'Mindvalley', domain: 'mindvalley.com' },
    { key: 'centr',      name: 'Centr',      domain: 'centr.com' },
  ]},
  // Adjacent: therapy & mental health - the human alternative people pay for
  { cat: 'Therapy & mental health', tier: 'light', apps: [
    { key: 'betterhelp', name: 'BetterHelp', domain: 'betterhelp.com' },
    { key: 'talkspace',  name: 'Talkspace',  domain: 'talkspace.com' },
    { key: 'cerebral',   name: 'Cerebral',   domain: 'cerebral.com' },
  ]},
  // Adjacent: mood & emotional wellbeing - lightweight daily check-in apps
  { cat: 'Mood & emotional wellbeing', tier: 'light', apps: [
    { key: 'finch',       name: 'Finch',       domain: 'finchcare.com' },
    { key: 'how_we_feel', name: 'How We Feel', domain: 'howwefeel.org' },
    { key: 'moodfit',     name: 'Moodfit',     domain: 'getmoodfit.com' },
    { key: 'bearable',    name: 'Bearable',    domain: 'bearable.app' },
  ]},
  { cat: 'Nutrition', tier: 'light', apps: [
    { key: 'myfitnesspal', name: 'MyFitnessPal', domain: 'myfitnesspal.com' },
    { key: 'cal_ai',       name: 'Cal AI',       domain: 'calai.app' },
    { key: 'snapcalorie',  name: 'SnapCalorie',  domain: 'snapcalorie.com' },
    { key: 'foodvisor',    name: 'Foodvisor',    domain: 'foodvisor.io' },
    { key: 'bitesnap',     name: 'BiteSnap',     domain: 'getbitesnap.com' },
  ]},
  { cat: 'Fitness & movement', tier: 'light', apps: [
    { key: 'strava',        name: 'Strava',             domain: 'strava.com' },
    { key: 'peloton',       name: 'Peloton',            domain: 'onepeloton.com' },
    { key: 'nike_training', name: 'Nike Training Club', domain: 'nike.com' },
    { key: 'fitbod',        name: 'Fitbod',             domain: 'fitbod.me' },
    { key: 'betterme',      name: 'BetterMe',           domain: 'betterme.world' },
  ]},
  { cat: 'Accountability', tier: 'advanced', apps: [
    { key: 'focusmate',  name: 'Focusmate',  domain: 'focusmate.com' },
    { key: 'stickk',     name: 'StickK',     domain: 'stickk.com' },
    { key: 'beeminder',  name: 'Beeminder',  domain: 'beeminder.com' },
    { key: 'habitshare', name: 'HabitShare', domain: 'habitshareapp.com' },
    { key: 'heiaheia',   name: 'HeiaHeia',   domain: 'heiaheia.com' },
  ]},
  { cat: 'Wearables & biometrics', tier: 'light', apps: [
    { key: 'apple_health',   name: 'Apple Health',   domain: 'apple.com' },
    { key: 'fitbit',         name: 'Fitbit',         domain: 'fitbit.com' },
    { key: 'garmin',         name: 'Garmin',         domain: 'garmin.com' },
    { key: 'samsung_health', name: 'Samsung Health', domain: 'samsung.com' },
    { key: 'google_fit',     name: 'Google Fit',     domain: 'google.com' },
  ]},
];

const APP_TIER = {};
COMPETITORS.forEach(c => c.apps.forEach(a => { APP_TIER[a.key] = c.tier; }));

// Clearbit's free logo API (logo.clearbit.com) was deprecated and no longer
// resolves, so every logo was silently falling back to a tiny blurry favicon.
// DuckDuckGo's icon service returns crisp apple-touch-icons and is reliable.
function logoUrl(domain) { return `https://icons.duckduckgo.com/ip3/${domain}.ico`; }

function renderCompetitorGrid() {
  const grid = document.getElementById('competitor-grid');
  if (!grid) return;
  COMPETITORS.forEach(c => {
    const sec = document.createElement('div');
    sec.className = 'cgrid__cat';
    const h = document.createElement('div');
    h.className = 'cgrid__cat-label';
    h.textContent = c.cat;
    sec.appendChild(h);
    c.apps.forEach(a => {
      const row = document.createElement('div');
      row.className = 'capp';
      row.innerHTML =
        `<img class="capp__logo" src="${logoUrl(a.domain)}" alt="" loading="lazy" ` +
        `onerror="this.onerror=null;this.src='https://www.google.com/s2/favicons?domain=${a.domain}&sz=128';this.classList.add('capp__logo--fallback')" />` +
        `<span class="capp__name">${a.name}</span>` +
        `<span class="capp__toggles">` +
        `<button type="button" class="ctog" data-app="${a.key}" data-kind="used">Used</button>` +
        `<button type="button" class="ctog" data-app="${a.key}" data-kind="paid">Paid</button>` +
        `</span>`;
      sec.appendChild(row);
    });
    grid.appendChild(sec);
  });

  grid.addEventListener('click', e => {
    const btn = e.target.closest('.ctog');
    if (!btn) return;
    const key = btn.dataset.app, kind = btn.dataset.kind;
    const rec = state.apps_matrix[key] || { used: false, paid: false };
    rec[kind] = !rec[kind];
    if (kind === 'paid' && rec.paid) rec.used = true;   // paid implies used
    if (kind === 'used' && !rec.used) rec.paid = false; // un-used clears paid
    state.apps_matrix[key] = rec;
    grid.querySelectorAll(`.ctog[data-app="${key}"]`).forEach(b => {
      b.classList.toggle('is-on', !!rec[b.dataset.kind]);
    });
    // any selection cancels the "I haven't used any of these" answer
    if (rec.used || rec.paid) {
      state.apps_none = false;
      const none = document.getElementById('apps-none');
      if (none) none.classList.remove('is-selected');
    }
    clearError(3);
  });

  // "I haven't used any of these" - a valid answer that clears every toggle
  const noneBtn = document.getElementById('apps-none');
  if (noneBtn) {
    noneBtn.addEventListener('click', () => {
      const on = !noneBtn.classList.contains('is-selected');
      noneBtn.classList.toggle('is-selected', on);
      state.apps_none = on;
      if (on) {
        state.apps_matrix = {};
        grid.querySelectorAll('.ctog.is-on').forEach(b => b.classList.remove('is-on'));
      }
      clearError(3);
    });
  }
}

// ==========================================================
//   Derived path (beginner vs advanced) - re-derivable from raw
// ==========================================================
function derivePath() {
  const tracks = state.track_level === 'experienced';
  const usesAdvancedApp = Object.entries(state.apps_matrix)
    .some(([k, v]) => v.used && APP_TIER[k] === 'advanced');
  return (tracks || usesAdvancedApp) ? 'advanced' : 'beginner';
}

// ==========================================================
//   Submit
// ==========================================================
function buildPayload() {
  const matrix = state.apps_matrix || {};
  const usedKeys  = Object.entries(matrix).filter(([, v]) => v.used).map(([k]) => k);
  const paidCount = Object.values(matrix).filter(v => v.paid).length;
  return {
    email:            state.email.trim().toLowerCase(),
    first_name:       state.first_name.trim(),
    last_name:        state.last_name.trim(),
    platform:         state.platform || null,   // ios | android
    heard_from:       state.heard_from || null,
    referred_by_name: (state.heard_from === 'friend' && state.referred_by_name.trim()) ? state.referred_by_name.trim() : null,
    heard_from_other: (state.heard_from === 'other' && state.heard_from_other.trim()) ? state.heard_from_other.trim() : null,
    track_level:      state.track_level || null,
    apps_used:        usedKeys.length ? usedKeys : null,                 // flat list of used apps (easy querying)
    apps_other:       state.apps_other.trim() || null,
    pays_for_apps:    paidCount === 0 ? 'none' : paidCount === 1 ? 'one' : 'several',
    age:              isValidAge(state.age) ? parseInt(state.age, 10) : null,
    gender:           state.gender || null,
    baseline_score:  null,
    derived_path:    derivePath(),
    two_week_commit: state.two_week_commit,
    commit_ts:       state.two_week_commit ? new Date().toISOString() : null,
    research:        {
      apps_matrix: matrix,                                              // full per-app used+paid
      apps_none:   state.apps_none,                                     // explicitly said "none of these"
      laurel: {                                                         // Laurel's habit-cost-investment research
        habit:    state.habit.trim() || null,
        duration: state.habit_duration || null,
        cost:     state.habit_cost.trim() || null
      }
    },
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
  state.last_name = document.getElementById('f-last').value;
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
  if (!nav) return;
  // Count DOWN from the founding cap to the real remaining, so people SEE
  // that spots are being taken (50 -> 49 -> 48 ...).
  const from = Math.max(50, remaining);
  nav.innerHTML =
    '<span class="fnd-badge__dot" aria-hidden="true"></span>' +
    `<span class="fnd-badge__num">${from}</span>spots left`;
  nav.hidden = false;
  animateSpots(nav.querySelector('.fnd-badge__num'), from, remaining);
}

function animateSpots(numEl, from, to) {
  if (!numEl) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || from === to) { numEl.textContent = to; return; }
  const duration = 1100;
  const ease = t => 1 - Math.pow(1 - t, 3);   // easeOutCubic - slows near the end
  const start = performance.now();
  let last = from;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const val = Math.round(from + (to - from) * ease(t));
    if (val !== last) {
      last = val;
      numEl.textContent = val;
      numEl.classList.remove('is-tick');
      void numEl.offsetWidth;   // restart the tick animation
      numEl.classList.add('is-tick');
    }
    if (t < 1) requestAnimationFrame(frame);
    else numEl.textContent = to;
  }
  requestAnimationFrame(frame);
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
renderCompetitorGrid();
render();
loadSpots();
