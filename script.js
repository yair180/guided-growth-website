// ==========================================
//   GUIDED GROWTH — MAIN SCRIPT
// ==========================================

// ---- Scrolled nav ----
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 24);
}, { passive: true });

// ---- Mobile nav toggle ----
const navToggle = document.getElementById('nav-toggle');
const navLinks  = document.getElementById('nav-links');

function setNavOpen(open) {
  nav.classList.toggle('is-open', open);
  navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

navToggle?.addEventListener('click', () => {
  setNavOpen(!nav.classList.contains('is-open'));
});

navLinks?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => setNavOpen(false));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && nav.classList.contains('is-open')) setNavOpen(false);
});

// ---- Scroll reveal ----
const revealEls = document.querySelectorAll('.reveal');

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -48px 0px' });
  revealEls.forEach(el => observer.observe(el));
} else {
  revealEls.forEach(el => el.classList.add('visible'));
}

// ---- Toast ----
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (msg) toast.querySelector('.toast__msg').textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4500);
}

// ---- Waitlist signup ----
// Posts directly to Supabase PostgREST with the public anon key.
// Row Level Security on `waitlist_signups` allows INSERT only.
const PUBLIC = window.GG_PUBLIC || {};
const SUPABASE_READY =
  PUBLIC.supabaseUrl &&
  PUBLIC.supabaseAnonKey &&
  !PUBLIC.supabaseUrl.startsWith('REPLACE_') &&
  !PUBLIC.supabaseAnonKey.startsWith('REPLACE_');

async function submitWaitlist(email, source) {
  if (!SUPABASE_READY) {
    // Local preview without creds: simulate success so the UX is testable.
    await new Promise(r => setTimeout(r, 600));
    return { ok: true, simulated: true };
  }

  const res = await fetch(`${PUBLIC.supabaseUrl}/rest/v1/waitlist_signups`, {
    method: 'POST',
    headers: {
      'apikey':        PUBLIC.supabaseAnonKey,
      'Authorization': `Bearer ${PUBLIC.supabaseAnonKey}`,
      'Content-Type':  'application/json',
      // Don't use PostgREST upsert — anon role only has INSERT (no UPDATE),
      // so we handle the unique-violation conflict client-side below.
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      source,
      referrer:   document.referrer || null,
      user_agent: navigator.userAgent.slice(0, 500)
    })
  });

  if (res.ok) return { ok: true };

  // 409 = unique constraint violation = email already signed up. UX-wise
  // that's still success; the user is on the list, just earlier.
  if (res.status === 409) return { ok: true, duplicate: true };

  let detail = '';
  try { detail = (await res.json()).message || ''; } catch (_) {}
  return { ok: false, status: res.status, detail };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

['hero-form', 'waitlist-form'].forEach(id => {
  const form = document.getElementById(id);
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input[name="email"]');
    const btn   = form.querySelector('button[type="submit"]');
    const email = input.value.trim();

    if (!isValidEmail(email)) {
      input.focus();
      input.setAttribute('aria-invalid', 'true');
      showToast('Please enter a valid email.');
      return;
    }
    input.removeAttribute('aria-invalid');

    const original = btn.textContent;
    btn.textContent = 'Joining…';
    btn.disabled = true;

    const result = await submitWaitlist(email, form.dataset.source || id);

    btn.textContent = original;
    btn.disabled = false;

    if (result.ok) {
      form.reset();
      showToast(result.simulated
        ? "Preview mode — signup not stored (add Supabase keys to send)."
        : "You're on the list! We'll be in touch.");
    } else {
      showToast("Something went wrong. Try again in a moment.");
      // Surface details to the console for debugging without scaring users.
      console.error('[waitlist] submit failed', result);
    }
  });
});
