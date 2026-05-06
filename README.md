# Guided Growth — Marketing Website

Landing page with waitlist for [Guided Growth](https://guidedgrowthos.com).

**Stack:** Pure HTML + CSS + vanilla JS. No build step. No dependencies. Deploys anywhere.

---

## Local Development

Open `index.html` directly in your browser — no server needed.

For a local server (recommended when testing form submissions):

```bash
npx serve .
# or
python3 -m http.server 8080
```

---

## Waitlist Setup (Formspree)

The forms submit to Formspree (free tier is plenty for a waitlist).

1. Go to [formspree.io](https://formspree.io) and create a free account
2. Create a new form → copy your **Form ID** (e.g. `xpzgkwrd`)
3. Open `script.js` and replace `YOUR_FORM_ID`:

```js
const res = await fetch('https://formspree.io/f/xpzgkwrd', {  // ← your ID here
```

4. Submissions appear in your Formspree dashboard and get emailed to you instantly

**Note:** Until Formspree is wired up, the form still shows the success toast — so the UX is fully visible during development.

---

## Deploy to Cloudflare Pages

1. Push this folder to a new GitHub repository
2. Go to [Cloudflare Pages](https://pages.cloudflare.com/) → **Create a project** → **Connect to Git**
3. Select your repo
4. Set build settings:
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/`
5. Click **Save and Deploy**

Your site goes live at `your-project.pages.dev` in ~30 seconds.

### Custom Domain

1. In Cloudflare Pages → your project → **Custom domains** → **Set up a custom domain**
2. Enter your domain (e.g. `guidedgrowthos.com`)
3. Follow the DNS instructions — if your domain is already on Cloudflare, it's automatic

---

## File Structure

```
guided-growth-website/
├── index.html    ← All content lives here
├── styles.css    ← Design system + layout + animations
├── script.js     ← Nav scroll, reveal animations, form handling
└── README.md     ← This file
```

---

## Editing Content

Everything is in `index.html`. Find sections by their HTML comments:

| Section | Comment |
|---|---|
| Nav | `<!-- NAV -->` |
| Hero | `<!-- HERO -->` |
| Problem | `<!-- PROBLEM -->` |
| How It Works | `<!-- HOW IT WORKS -->` |
| Features | `<!-- FEATURES -->` |
| Who It's For | `<!-- WHO IT'S FOR -->` |
| Waitlist | `<!-- WAITLIST -->` |
| Footer | `<!-- FOOTER -->` |

### Changing colors or fonts

All design tokens are CSS variables at the top of `styles.css` inside `:root {}`:

```css
:root {
  --accent: #22c55e;     /* green — change this to rebrand */
  --bg: #080808;         /* page background */
  --text: #efefef;       /* primary text */
  ...
}
```
