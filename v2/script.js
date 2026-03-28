// ==========================================
//   GUIDED GROWTH V2 — SCRIPT
// ==========================================

// ---- Scrolled nav ----
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 24);
}, { passive: true });

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
function showToast() {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4500);
}

// ---- Form handling ----
// Locally: intercept and show toast for UX preview
// Live: native POST handles submission + redirect to success.html
const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

document.querySelectorAll('form').forEach(form => {
  if (!isLocal) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.textContent = 'Joining…';
    btn.disabled = true;
    await new Promise(r => setTimeout(r, 700));
    form.reset();
    btn.textContent = original;
    btn.disabled = false;
    showToast();
  });
});
