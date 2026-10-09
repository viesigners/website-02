#!/usr/bin/env node
/* ============================================================================
   Viesigners static site generator (zero dependencies, Node 18+)
   - Reads translations from src/content/{fr,en}/*.json
   - Renders one complete, crawlable HTML file per language per page
   - Emits SEO + GEO plumbing: hreflang, canonical, JSON-LD graph, sitemap,
     robots (AI crawlers allowed), llms.txt, llms-full.txt, per-page Markdown.
   Usage:  node build.mjs            -> build into dist/
           node build.mjs --serve    -> build, serve dist/ on :4173 and rebuild on change
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CFG = JSON.parse(fs.readFileSync(path.join(SRC, 'config.json'), 'utf8'));
const LANGS = ['fr', 'en'];
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const ORIGIN = (process.env.SITE_ORIGIN || CFG.origin).replace(/\/$/, '');
/* Sub-folder hosting (e.g. GitHub Pages project site at /website-02). Empty for a domain root. */
const BASE = (process.env.SITE_BASE || CFG.basePath || '').replace(/\/$/, '');
/* Staging builds (SITE_NOINDEX=1) tell search engines and AI crawlers to stay away. */
const NOINDEX = process.env.SITE_NOINDEX === '1';

/* ----------------------------- helpers ------------------------------------ */
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });
const write = (p, c) => { mkdir(path.dirname(p)); fs.writeFileSync(p, c); };
const copyDir = (a, b) => { mkdir(b); for (const f of fs.readdirSync(a, { withFileTypes: true })) { const s = path.join(a, f.name), d = path.join(b, f.name); f.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } };
const hash = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);

function imgSize(rel) {
  const p = path.join(SRC, 'assets/img', rel);
  const b = fs.readFileSync(p);
  if (rel.endsWith('.png')) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (rel.endsWith('.jpg') || rel.endsWith('.jpeg')) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  const m = fs.readFileSync(p, 'utf8').match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
  return m ? [Math.round(m[1]), Math.round(m[2])] : [200, 60];
}
const IMG_CACHE = {};
function img(rel, alt, { cls = '', lazy = true, sizes, fetchpriority } = {}) {
  const [w, h] = (IMG_CACHE[rel] ||= imgSize(rel));
  return `<img src="${BASE}/assets/img/${rel}" alt="${esc(alt)}" width="${w}" height="${h}"${cls ? ` class="${cls}"` : ''}${lazy ? ' loading="lazy" decoding="async"' : ''}${fetchpriority ? ` fetchpriority="${fetchpriority}"` : ''}${sizes ? ` sizes="${sizes}"` : ''}>`;
}

/* ----------------------------- routes ------------------------------------- */
const ROUTES = {
  home: { fr: '', en: '' },
  'sites-web': { fr: 'sites-web', en: 'websites' },
  'landing-pages': { fr: 'landing-pages', en: 'landing-pages' },
  'design-produit': { fr: 'design-de-produit', en: 'product-design' },
  coaching: { fr: 'conseil-affaires-web', en: 'business-advisory' },
  publicite: { fr: 'publicite-numerique', en: 'digital-advertising' },
  'medias-sociaux': { fr: 'medias-sociaux', en: 'social-media' },
  'seo-geo': { fr: 'seo-geo', en: 'seo-geo' },
  'a-propos': { fr: 'a-propos', en: 'about' },
  'charles-erick': { fr: 'a-propos/charles-erick-bg', en: 'about/charles-erick-bg' },
  'jean-francois': { fr: 'a-propos/jean-francois-bg', en: 'about/jean-francois-bg' },
  realisations: { fr: 'realisations', en: 'work' },
  contact: { fr: 'contact', en: 'contact' },
  merci: { fr: 'merci', en: 'thank-you' }, // shown after a form submission: noindex, never linked
  actualites: { fr: 'actualites', en: 'news' },
};
/* pages temporarily hidden: still built, but removed from menu, footer, links, sitemap and llms.txt, and marked noindex.
   Edit "hidden" in src/config.json to bring them back (empty list = everything visible). */
const HIDDEN = new Set(CFG.hidden || []);
const isHidden = (key) => (key === 'post' || key.startsWith('post:') ? HIDDEN.has('actualites') || HIDDEN.has(key) : HIDDEN.has(key));
const SERVICE_KEYS = ['sites-web', 'landing-pages', 'design-produit', 'coaching', 'publicite', 'medias-sociaux', 'seo-geo'];
const POSTS = { fr: [], en: [] };            // filled at load
let CURRENT_POST_SLUGS = {};                 // key -> {fr,en}
const url = (key, lang) => {
  if (key.startsWith('post:')) { const s = CURRENT_POST_SLUGS[key.slice(5)]; return s?.[lang] ? `${BASE}/${lang}/${ROUTES.actualites[lang]}/${s[lang]}/` : `${BASE}/${lang}/${ROUTES.actualites[lang]}/`; }
  const r = ROUTES[key]; if (!r) throw new Error('Unknown route ' + key);
  return `${BASE}/${lang}/${r[lang]}${r[lang] ? '/' : ''}`;
};
const abs = (u) => ORIGIN + (BASE && !(u === BASE || u.startsWith(BASE + '/')) ? BASE : '') + u;

/* ----------------------------- text formatting ---------------------------- */
function fmt(s, lang) {
  if (s == null) return '';
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]\(@([\w:-]+)\)/g, (_, t, k) => (isHidden(k) ? t : `<a href="${url(k, lang)}">${t}</a>`));
  h = h.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em class="acc">$1</em>');
  if (lang === 'fr') h = h.replace(/ ([:;!?»])/g, ' $1').replace(/« /g, '« ');
  return h;
}
const plain = (s = '') => String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1');
const ico = (n, cls = '') => `<svg aria-hidden="true" focusable="false"${cls ? ` class="${cls}"` : ''}><use href="#i-${n}"/></svg>`;
const sparks = (n = 3) => Array.from({ length: n }, () => ico('spark', 'spark')).join('');

/* ----------------------------- section renderers -------------------------- */
const R = {};
const rv = (d = 0) => ` class="rv" style="--d:${d}s"`;
function secHead(s, c, type, { id = '', h2 = s.h2 } = {}) {
  const label = c.T.labels?.[type];
  return `<div class="sec-head"><div class="sec-head__side">${label ? `<p class="label rv">${esc(label)}</p>` : ''}${s.lead ? `<p class="lead rv" style="--d:.08s">${fmt(s.lead, c.lang)}</p>` : ''}</div>${h2 ? `<h2${id ? ` id="${id}"` : ''} class="rv" style="--d:.04s">${fmt(h2, c.lang)}</h2>` : ''}</div>`;
}
const splitLabel = (c, type) => (c.T.labels?.[type] ? `<p class="label rv">${esc(c.T.labels[type])}</p>` : '');

R['hero-home'] = (s, c) => {
  const { lang, T } = c;
  const logos = s.logos.map((l) => img(`logo-${l.id}.png`, l.alt, { lazy: false }));
  const dup = logos.map((x) => x.replace(/alt="[^"]*"/, 'alt=""'));
  return `<section class="hero" aria-labelledby="h1">
  <div class="hero__art" aria-hidden="true"><div class="hero__dots"></div></div>
  <div class="wrap">
    <p class="label">${fmt(s.tag, lang)}</p>
    <h1 id="h1">${fmt(s.h1, lang)}</h1>
    <p class="hero__lead">${fmt(s.lead, lang)}</p>
    <div class="hero__cta"><a class="pill" href="${url('contact', lang)}">${esc(s.cta)}</a></div>
    <div class="logos">
      <div class="logos__head"><p class="label">${esc(s.advised)}</p>${s.more ? `<span class="more">${esc(s.more)}</span>` : ''}</div>
      <div class="logos__mask" role="group" aria-label="${esc(s.logosLabel)}"><div class="logos__row">${logos.join('')}<span aria-hidden="true" style="display:contents">${dup.join('')}</span>${logos.map((x) => x.replace(/alt="[^"]*"/, 'alt=""')).join('')}${dup.join('')}</div></div>
    </div>
  </div>
</section>`;
};

R['page-hero'] = (s, c) => {
  const { lang, T, page } = c;
  const crumbs = c.crumbs.map((b, i) => i === c.crumbs.length - 1 ? `<li><span aria-current="page">${esc(b.name)}</span></li>` : `<li><a href="${b.url}">${esc(b.name)}</a></li>`).join('');
  const ctas = (s.ctas || []).filter((b) => !(b.to.startsWith('@') && isHidden(b.to.slice(1)))).map((b) => `<a class="pill ${b.style === 'ghost' ? 'pill--ghost' : b.style === 'violet' ? 'pill--violet' : ''}" href="${b.to.startsWith('@') ? url(b.to.slice(1), lang) : b.to}">${esc(b.label)}</a>`).join('');
  const brief = s.brief ? `<aside class="brief rv" aria-labelledby="brief-t" style="--d:.15s"><h2 id="brief-t">${esc(T.brief)}</h2><ul>${s.brief.map((i) => `<li>${ico('check')}<span>${i.b ? `<strong>${fmt(i.b, lang)}</strong> ` : ''}${fmt(i.t, lang)}</span></li>`).join('')}</ul><p class="upd">${esc(T.updated)} <time datetime="${page.updated || BUILD_DATE}">${new Date(page.updated || BUILD_DATE).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</time></p></aside>` : '';
  return `<section class="phero" aria-labelledby="h1"><div class="wrap">
  ${c.crumbs.length > 2 ? `<nav aria-label="${esc(T.breadcrumb)}"><ol class="crumbs">${crumbs}</ol></nav>` : ''}
  <div class="phero__grid">
    <div>
      ${s.tag ? `<p class="eyebrow-tag">${fmt(s.tag, lang)}</p>` : ''}
      <h1 id="h1" class="display">${fmt(s.h1, lang)}</h1>
      <p class="lead">${fmt(s.lead, lang)}</p>
      ${s.guarantee ? `<p class="guar" style="margin-bottom:1.6rem">${ico('shield')}${esc(s.guarantee)}</p><br>` : ''}
      <div class="phero__actions">${ctas}</div>
    </div>
    ${brief}
  </div></div></section>`;
};

R.statement = (s, c) => `<section class="section statement${s.wide ? ' statement--wide' : ''}"><div class="wrap">
  <p${rv()}>${fmt(s.text, c.lang)}</p>
  ${s.prose ? `<div class="prose rv" style="--d:.1s">${s.prose.map((p) => `<p>${fmt(p, c.lang)}</p>`).join('')}</div>` : ''}
</div></section>`;

R.friction = (s, c) => {
  const { lang } = c;
  return `<section class="section friction"><div class="wrap">
  ${secHead(s, c, 'friction')}
  <div class="friction__grid">
    <ul class="pains">${s.pains.map((p, i) => `<li class="rv" style="--d:${i * 0.07}s">${ico('spark')}<span>${fmt(p, lang)}</span></li>`).join('')}</ul>
    <figure class="flowfig" aria-hidden="true">
      <svg viewBox="0 0 520 380" preserveAspectRatio="xMidYMid meet" role="presentation">
        <defs><linearGradient id="fg" x1="0" x2="1"><stop offset="0" stop-color="#7a4dff"/><stop offset=".6" stop-color="#c3b1ff"/><stop offset="1" stop-color="#d68bff"/></linearGradient></defs>
        <path class="zig" d="M20 300 L70 300 L88 236 L120 316 L146 210 L176 300 L214 182 L240 290 L268 168 L296 276 L330 158 L352 250 L384 136 L410 222 L440 118 L470 190 L500 90"/>
        <path class="flow" d="M20 300 C 110 300, 120 240, 200 230 S 320 220, 360 160 S 450 80, 500 70"/>
        <circle class="node" cx="20" cy="300" r="7"/><circle class="node" cx="500" cy="70" r="9"/>
      </svg>
      <figcaption><span>${esc(s.fig[0])}</span><span>${esc(s.fig[1])}</span></figcaption>
    </figure>
  </div>
  <div class="friction__reveal">
    <div><h3 class="rv">${fmt(s.reveal.h3, lang)}</h3></div>
    <div class="stack rv" style="--d:.1s">${s.reveal.p.map((p) => `<p class="prose">${fmt(p, lang)}</p>`).join('')}<p class="friction__cost">${esc(s.reveal.cost)}</p></div>
  </div>
</div></section>`;
};

R.founders = (s, c) => {
  const { lang } = c;
  return `<section class="section founders" id="fondateurs"><div class="wrap">
  <div class="founders__grid">
    <div>
      <p class="founders__kicker rv">${fmt(s.kicker, lang)}</p>
      <h2 class="rv">${fmt(s.h2, lang)}</h2>
      <div class="prose rv" style="margin-top:1.4rem">${s.text.map((p) => `<p>${fmt(p, lang)}</p>`).join('')}</div>
      <ul class="checks">${s.checks.map((k) => `<li class="rv">${ico('check')}<span>${fmt(k, lang)}</span></li>`).join('')}</ul>
      ${s.cta && !isHidden(s.cta.to) ? `<p style="margin-top:2rem"><a class="link-arrow" href="${url(s.cta.to, lang)}">${esc(s.cta.label)} ${ico('arrow')}</a></p>` : ''}
    </div>
    <div class="founders__photo rv">
      <div class="frame">${img('founders-1.jpg', s.photoAlt, { sizes: '(min-width:960px) 480px, 90vw' })}<p class="chip"><b>${esc(s.chip.b)}</b>${esc(s.chip.t)}</p></div>
      ${s.sub ? (() => { const [who, ...rest] = s.sub.split(' — '); return `<div class="fcap"><div><b>${esc(who)}</b><span>${esc(rest.join(' — ').replace(/ (\([^)]*\))$/, '\u00a0$1'))}</span></div>${s.school ? img(s.school.file, s.school.alt) : ''}</div>`; })() : ''}
    </div>
  </div>
  <div class="press rv"><span class="press__label">${esc(s.press.label)}</span>${s.press.items.map((p) => img(p.file, p.alt)).join('')}</div>
</div></section>`;
};

R.services = (s, c) => {
  const { lang } = c;
  const cards = s.cards.filter((k) => !(k.to.startsWith('@') && isHidden(k.to.slice(1)))).map((k, i) => {
    const to = k.to.startsWith('@') ? url(k.to.slice(1), lang) : k.to;
    return `<article class="card ${k.span} ${k.hero ? 'card--hero' : ''} ${k.mini ? 'card--mini' : ''} rv" style="--d:${(i % 3) * 0.08}s">
    ${k.guarantee ? `<p class="guar">${ico('shield')}${esc(k.guarantee)}</p>` : ''}
    <h3><a class="more" href="${to}" aria-label="${esc(k.title)}"></a>${fmt(k.title, lang)}</h3>
    ${k.goal ? `<p class="goal">${fmt(k.goal, lang)}</p>` : ''}
    <p>${fmt(k.desc, lang)}</p>
    ${k.items ? `<ul class="items">${k.items.map((it) => `<li>${ico('check')}<span>${it.b ? `<b>${fmt(it.b, lang)}</b> — ` : ''}${fmt(it.t, lang)}</span></li>`).join('')}</ul>` : ''}
    <div class="card__foot"><span class="link-arrow">${esc(k.cta)} ${ico('arrow')}</span></div>
  </article>`;
  }).join('');
  return `<section class="section" id="services"><div class="wrap">
  ${secHead(s, c, 'services')}
  <div class="bento">${cards}</div>
</div></section>`;
};

R.stats = (s, c) => `<section class="section"><div class="wrap">
  ${s.h2 ? secHead(s, c, 'stats') : ''}
  <div class="stats">${s.items.map((i, k) => `<div class="stat rv" style="--d:${k * .06}s"><div class="stat__n" aria-hidden="false">${esc(i.n)}</div><div><h3>${fmt(i.h, c.lang)}</h3><p>${fmt(i.p, c.lang)}</p></div></div>`).join('')}</div>
</div></section>`;

R.work = (s, c) => `<section class="section"${s.id ? ` id="${s.id}"` : ''}><div class="wrap">
  ${secHead(s, c, 'work')}
  <div class="work">${s.items.map((i, k) => `<figure class="work__item rv" style="--d:${(k % 3) * .07}s">${img('work/' + i.img, i.alt, { sizes: k === 0 ? '(min-width:760px) 66vw, 100vw' : '(min-width:760px) 33vw, 100vw' })}<figcaption><b>${esc(i.title)}</b>${i.result ? `<span>${esc(i.result)}</span>` : ''}</figcaption></figure>`).join('')}</div>
  ${s.awards ? `<div class="awards rv"><span class="press__label">${esc(s.awards.label)}</span>${s.awards.items.map((p) => img(p.file, p.alt)).join('')}</div>` : ''}
  ${s.cta && !isHidden(s.cta.to) ? `<p style="margin-top:2.5rem"><a class="pill pill--violet" href="${url(s.cta.to, c.lang)}">${esc(s.cta.label)}</a></p>` : ''}
</div></section>`;

R.fit = (s, c) => {
  const { lang } = c;
  const li = (a, n) => a.map((t) => `<li>${ico(n)}<span>${fmt(t, lang)}</span></li>`).join('');
  return `<section class="section"><div class="wrap">
  ${secHead(s, c, 'fit')}
  <div class="fit">
    <div class="fit__col fit__col--yes rv"><h3>${fmt(s.yes.h, lang)}</h3><ul>${li(s.yes.items, 'check')}</ul></div>
    <div class="fit__col fit__col--no rv" style="--d:.1s"><h3>${fmt(s.no.h, lang)}</h3><ul>${li(s.no.items, 'x')}</ul></div>
  </div>
  ${s.foot ? `<div class="fit__foot rv"><p>${fmt(s.foot.p, lang)}</p><a class="pill pill--violet" href="${url(s.foot.to, lang)}">${esc(s.foot.label)}</a></div>` : ''}
</div></section>`;
};

R.testimonials = (s, c) => {
  const { lang } = c;
  const initials = (n) => n.replace(/[^\p{L}\s-]/gu, '').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const loc = lang === 'fr' ? 'fr-CA' : 'en-CA';
  // full dates (YYYY-MM-DD) or month-only dates (YYYY-MM, when the source only gives an approximate month)
  const fmtDate = (d) => (d.length === 7
    ? new Date(d + '-15').toLocaleDateString(loc, { year: 'numeric', month: 'long', timeZone: 'UTC' })
    : new Date(d).toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }));
  const items = s.items.slice().sort((a, b) => b.date.localeCompare(a.date)); // newest first
  return `<section class="section" id="temoignages"><div class="wrap">
  ${secHead({ h2: s.h2 }, c, 'testimonials')}
  <div class="tgrid">${items.map((t, k) => `<figure class="tcard rv" style="--d:${(k % 3) * .06}s"><blockquote lang="${t.lang}">${t.title ? `<h3 class="tq">${esc(t.title)}</h3>` : ''}${t.text ? t.text.split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : ''}</blockquote>${t.translatedFrom ? `<p class="tnote">${esc(c.T.translatedFrom[t.translatedFrom])}</p>` : ''}<figcaption><span class="who"><b>${esc(t.name)}</b>${(t.role || t.company) ? `<span>${esc([t.role, t.company ? `${t.role ? (t.joiner || c.T.at) + (/[’']$/.test(t.joiner || '') ? '' : ' ') : ''}${t.company}` : ''].filter(Boolean).join(' '))}</span>` : ''}<time datetime="${t.date}">${esc(fmtDate(t.date))}</time></span>${t.logo ? img('testimonials/' + t.logo, t.company || t.name, { cls: 'tlogo' }) : ''}</figcaption></figure>`).join('')}
    <a class="tcard tcard--slot rv" href="${url('contact', lang)}"><h3>${fmt(s.slot.h3, lang)}</h3><span class="slot-go" aria-hidden="true">${ico('arrow')}</span></a>
  </div>
</div></section>`;
};

R.slot = (s, c) => `<section class="section section--tight"><div class="wrap">
  ${secHead(s, c, 'slot')}
  <div class="slot rv"><h3>${fmt(s.h3, c.lang)}</h3><a class="pill pill--violet" href="${url('contact', c.lang)}">${esc(s.cta)}</a></div>
</div></section>`;

R.faq = (s, c) => {
  const items = c.page.faq || [];
  if (!items.length) return '';
  return `<section class="section" id="faq" aria-labelledby="faq-t"><div class="wrap">
  ${secHead(s, c, 'faq', { id: 'faq-t', h2: s.h2 || c.T.faqTitle })}
  <div class="faq rv">${items.map((f, i) => `<details${i === 0 && s.open ? ' open' : ''}><summary><span>${fmt(f.q, c.lang)}</span><i aria-hidden="true"></i></summary><div class="ans">${f.a.map((p) => `<p>${fmt(p, c.lang)}</p>`).join('')}</div></details>`).join('')}</div>
</div></section>`;
};

R.deliverables = (s, c) => `<section class="section"${s.id ? ` id="${s.id}"` : ''}><div class="wrap"><div class="split">
  <div class="split__head">${splitLabel(c, 'deliverables')}<h2 class="rv">${fmt(s.h2, c.lang)}</h2>${s.lead ? `<p class="lead rv">${fmt(s.lead, c.lang)}</p>` : ''}</div>
  <div class="dl">${s.items.map((i, k) => `<div class="dl__item rv" style="--d:${k * .04}s"><h3>${fmt(i.h, c.lang)}</h3><p>${fmt(i.p, c.lang)}</p></div>`).join('')}</div>
</div></div></section>`;

R.process = (s, c) => `<section class="section"><div class="wrap">
  ${secHead(s, c, 'process')}
  <ol class="steps" style="--n:${s.steps.length}">${s.steps.map((p, k) => `<li class="step rv" style="--d:${k * .08}s"><h3>${fmt(p.h, c.lang)}</h3><p>${fmt(p.p, c.lang)}</p>${p.out ? `<p class="out">${fmt(p.out, c.lang)}</p>` : ''}</li>`).join('')}</ol>
</div></section>`;

R.compare = (s, c) => {
  const li = (a, n) => a.map((t) => `<li>${ico(n)}<span>${fmt(t, c.lang)}</span></li>`).join('');
  return `<section class="section"><div class="wrap">
  ${secHead(s, c, 'compare')}
  <div class="compare">
    <div class="compare__col compare__col--before rv"><h3>${fmt(s.before.h, c.lang)}</h3><ul>${li(s.before.items, 'x')}</ul></div>
    <div class="compare__col compare__col--after rv" style="--d:.1s"><h3>${fmt(s.after.h, c.lang)}</h3><ul>${li(s.after.items, 'check')}</ul></div>
  </div>
</div></section>`;
};

R.proof = (s, c) => `<section class="section section--tight"><div class="wrap">
  ${s.h2 ? secHead(s, c, 'proof') : ''}
  <div class="proof ${s.items.length === 2 ? 'proof--2' : ''}">${s.items.map((i, k) => `<div class="proof__item rv" style="--d:${k * .08}s"><b>${esc(i.n)}</b><span>${fmt(i.t, c.lang)}</span></div>`).join('')}</div>
</div></section>`;

R.people = (s, c) => `<section class="section"><div class="wrap">
  ${secHead(s, c, 'people')}
  <div class="people">${s.items.map((p, k) => `<article class="person rv" style="--d:${k * .1}s"><div class="person__photo person__photo--${p.photo}">${img('founders-2.jpg', p.alt, { sizes: '(min-width:760px) 50vw, 100vw' })}</div><div class="person__body"><h3><a class="more" href="${url(p.to, c.lang)}" aria-label="${esc(p.name)}"></a>${esc(p.name)}</h3><p class="role">${esc(p.role)}</p><p class="prose">${fmt(p.text, c.lang)}</p><span class="link-arrow">${esc(p.cta)} ${ico('arrow')}</span></div></article>`).join('')}</div>
</div></section>`;

R.facts = (s, c) => `<section class="section"><div class="wrap"><div class="split">
  <div class="split__head">${splitLabel(c, 'facts')}<h2 class="rv">${fmt(s.h2, c.lang)}</h2>${s.lead ? `<p class="lead rv">${fmt(s.lead, c.lang)}</p>` : ''}</div>
  <dl class="facts">${s.items.map((i, k) => `<div class="rv" style="--d:${k * .04}s"><dt>${fmt(i.k, c.lang)}</dt><dd>${fmt(i.v, c.lang)}</dd></div>`).join('')}</dl>
</div></div></section>`;

R['cta-final'] = (s, c) => `<section class="section section--tight"><div class="wrap">
  <div class="cta-final rv">
    <h2 class="display">${fmt(s.h2, c.lang)}</h2>
    <p>${fmt(s.p, c.lang)}</p>
    <div class="actions"><a class="pill" href="${url(s.to || 'contact', c.lang)}">${fmt(s.cta, c.lang)}</a>${s.secondary ? `<a class="pill pill--ghost" href="${s.secondary.href}">${esc(s.secondary.label)}</a>` : ''}</div>
  </div>
</div></section>`;

R['posts-list'] = (s, c) => {
  const list = POSTS[c.lang].slice().sort((a, b) => b.date.localeCompare(a.date));
  return `<section class="section"><div class="wrap"><div class="posts">${list.map((p, k) => `<article class="post-card rv" style="--d:${(k % 2) * .08}s"><span class="tag">${esc(p.tag)}</span><h3><a class="more" href="${url('post:' + p.key, c.lang)}" aria-label="${esc(p.title)}"></a>${esc(p.title)}</h3><p>${esc(p.description)}</p><div class="meta"><time datetime="${p.date}">${new Date(p.date).toLocaleDateString(c.lang === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</time><span>${esc(p.read)}</span></div></article>`).join('')}</div></div></section>`;
};

R.article = (s, c) => {
  const p = c.post, { lang, T } = c;
  const body = p.body.map((b) => {
    if (b.h2) return `<h2>${fmt(b.h2, lang)}</h2>`;
    if (b.h3) return `<h3>${fmt(b.h3, lang)}</h3>`;
    if (b.p) return `<p>${fmt(b.p, lang)}</p>`;
    if (b.ul) return `<ul>${b.ul.map((i) => `<li>${fmt(i, lang)}</li>`).join('')}</ul>`;
    return '';
  }).join('\n');
  return `<section class="section"><div class="wrap"><article class="article" itemscope itemtype="https://schema.org/BlogPosting">
  <div class="meta"><span>${esc(T.by)} ${isHidden('charles-erick') ? 'Charles-Erick BG' : `<a href="${url('charles-erick', lang)}">Charles-Erick BG</a>`} &amp; ${isHidden('jean-francois') ? 'Jean-François BG' : `<a href="${url('jean-francois', lang)}">Jean-François BG</a>`}</span><time datetime="${p.date}" itemprop="datePublished">${new Date(p.date).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</time><span>${esc(p.read)}</span></div>
  <aside class="keypoints" aria-labelledby="kp"><h2 id="kp">${esc(T.keypoints)}</h2><ul>${p.summary.map((i) => `<li>${fmt(i, lang)}</li>`).join('')}</ul></aside>
  ${body}
  <div class="author">${img('founders-1.jpg', '', { cls: '' }).replace('<img', '<img style="width:3.6rem;height:3.6rem;border-radius:50%;object-fit:cover;object-position:70% 25%"')}<div><b>Charles-Erick &amp; Jean-François BG</b><span>${esc(T.authorLine)}</span></div></div>
</article></div></section>`;
};

const DIAL = { CA: 1, US: 1, FR: 33, BE: 32, CH: 41, LU: 352, GB: 44, IE: 353, DE: 49, ES: 34, IT: 39, PT: 351, NL: 31, AT: 43, SE: 46, NO: 47, DK: 45, FI: 358, PL: 48, CZ: 420, GR: 30, RO: 40, HU: 36, TR: 90, IL: 972, LB: 961, AE: 971, SA: 966, QA: 974, EG: 20, MA: 212, DZ: 213, TN: 216, SN: 221, CI: 225, CM: 237, NG: 234, ZA: 27, KE: 254, IN: 91, PK: 92, CN: 86, JP: 81, KR: 82, SG: 65, HK: 852, TW: 886, TH: 66, VN: 84, PH: 63, ID: 62, MY: 60, AU: 61, NZ: 64, MX: 52, BR: 55, AR: 54, CL: 56, CO: 57, PE: 51, UY: 598, HT: 509, CR: 506, PA: 507, RU: 7, UA: 380 };
const flagOf = (cc) => String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
function countryOptions(lang) {
  const dn = new Intl.DisplayNames([lang === 'fr' ? 'fr-CA' : 'en-CA'], { type: 'region' });
  const top = ['CA', 'US', 'FR'];
  const rest = Object.keys(DIAL).filter((cc) => !top.includes(cc)).sort((x, y) => dn.of(x).localeCompare(dn.of(y), lang));
  return [...top, ...rest].map((cc) => ({ cc, name: dn.of(cc), dial: '+' + DIAL[cc], flag: flagOf(cc) }));
}

R.contact = (s, c) => {
  const { lang, T } = c;
  const f = s.form;
  const countries = countryOptions(lang);
  const req = '<span class="req" aria-hidden="true">*</span>';
  const err = '<p class="err" role="alert"></p>';
  return `<section class="section"><div class="wrap"><div class="contact">
  <div class="contact__info">
    <h2 class="rv">${fmt(s.h2, lang)}</h2>
    <p class="lead rv">${fmt(s.lead, lang)}</p>
    <ul class="checks rv">${s.points.map((p) => `<li>${ico('check')}<span>${fmt(p, lang)}</span></li>`).join('')}</ul>
    <dl class="contact__list rv">
      <div><dt>${esc(s.labels.phone)}</dt><dd><a href="tel:${CFG.phoneRaw}">${esc(CFG.phone)}</a></dd></div>
      <div><dt>${esc(s.labels.where)}</dt><dd>Québec, Canada<br>Vancouver, Canada</dd></div>
      <div><dt>${esc(s.labels.hours)}</dt><dd>${esc(s.hours)}</dd></div>
    </dl>
  </div>
  <form class="form rv" novalidate method="post" action="${CFG.formEndpoint || '#'}" data-endpoint="${esc(CFG.formEndpoint || '')}" data-thanks="${url('merci', lang)}" data-mailto="${esc(CFG.email || '')}" data-subject="${esc(f.subject)}" data-msg-ok="${esc(f.ok)}" data-msg-fail="${esc(f.fail)}" data-msg-required="${esc(f.required)}" data-msg-email="${esc(f.emailErr)}">
    <div class="row2">
      <div class="field"><label for="f-first">${esc(f.firstName)} ${req}</label><input id="f-first" name="first_name" autocomplete="given-name" required>${err}</div>
      <div class="field"><label for="f-last">${esc(f.lastName)} ${req}</label><input id="f-last" name="last_name" autocomplete="family-name" required>${err}</div>
    </div>
    <div class="row2">
      <div class="field"><label for="f-email">${esc(f.email)} ${req}</label><input id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required>${err}</div>
      <div class="field"><label for="f-phone">${esc(f.phone)} ${req}</label><div class="phone"><select name="dial" aria-label="${esc(f.dial)}" data-dial>${countries.map((k) => `<option value="${k.dial}" data-cc="${k.cc}"${k.cc === 'CA' ? ' selected' : ''}>${k.flag} ${k.dial}</option>`).join('')}</select><input id="f-phone" name="phone" type="tel" autocomplete="tel-national" inputmode="tel" required></div>${err}</div>
    </div>
    <div class="row2">
      <div class="field"><label for="f-site">${esc(f.website)} ${req}</label><input id="f-site" name="website" autocomplete="url" inputmode="url" required>${err}</div>
      <div class="field"><label for="f-budget">${esc(f.budget)} ${req}</label><input id="f-budget" name="budget" inputmode="text" placeholder="${esc(f.budgetPh)}" required>${err}</div>
    </div>
    <div class="row2">
      <div class="field"><label for="f-country">${esc(f.country)} ${req}</label><select id="f-country" name="country" autocomplete="country" required data-country>${countries.map((k) => `<option value="${k.cc}"${k.cc === 'CA' ? ' selected' : ''}>${k.flag} ${esc(k.name)}</option>`).join('')}</select>${err}</div>
      <div class="field"><label for="f-need">${esc(f.need)} ${req}</label><select id="f-need" name="need" required><option value="">${esc(f.choose)}</option>${f.needs.filter((t) => !(t.page && isHidden(t.page))).map((t) => `<option>${esc(t.t)}</option>`).join('')}</select>${err}</div>
    </div>
    <div class="field"><label for="f-msg">${esc(f.message)} ${req}</label><textarea id="f-msg" name="message" required></textarea>${err}</div>
    <div class="hp" aria-hidden="true"><label>Website<input name="website_hp" tabindex="-1" autocomplete="off"></label></div>
    <p class="status" role="status" tabindex="-1" hidden></p>
    <button class="pill pill--violet" type="submit">${esc(f.submit)}</button>
    <p class="note">${esc(f.note)}</p>
  </form>
</div></div></section>`;
};

R['rich-text'] = (s, c) => `<section class="section section--tight"><div class="wrap"><div class="prose">${s.p.map((p) => `<p>${fmt(p, c.lang)}</p>`).join('')}</div></div></section>`;

/* ----------------------------- layout ------------------------------------- */
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></symbol>
<symbol id="i-spark" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0c.9 6.6 4.9 10.8 12 12-7.1 1.2-11.1 5.4-12 12-.9-6.6-4.9-10.8-12-12C7.1 10.8 11.1 6.6 12 0z"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-up" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-gift" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1-3-5-4-5-1.5S10 8 12 8zm0 0c1-3 5-4 5-1.5S14 8 12 8z"/></g></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6l8-3z" fill="currentColor" opacity=".18"/><path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6l8-3zM8.5 12l2.6 2.6L16 9.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-phone" viewBox="0 0 24 24"><path d="M5 4h3.5l1.5 4-2 1.3a11 11 0 005.7 5.7L15 13l4 1.5V18a2 2 0 01-2 2A14 14 0 013 6a2 2 0 012-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
<symbol id="i-fb" viewBox="0 0 24 24"><path fill="currentColor" d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.9.5-1.7 1.8-1.7h1.6V3.9s-1.4-.3-2.8-.3c-2.8 0-4.5 1.7-4.5 4.6v2.3H6.8v3.3h2.8V22h3.9z"/></symbol>
<symbol id="i-in" viewBox="0 0 24 24"><path fill="currentColor" d="M4.5 9h3.6v11H4.5V9zm1.8-5.5a2.1 2.1 0 110 4.2 2.1 2.1 0 010-4.2zM10.3 9h3.4v1.5h.1c.5-.9 1.6-1.8 3.4-1.8 3.600 0 4.300 2.400 4.300 5.400V20h-3.600v-5.100c0-1.200 0-2.800-1.700-2.800s-2 1.300-2 2.700V20h-3.600V9z"/></symbol>
</defs></svg>`;

function head({ lang, T, page, canonical, alternates, jsonld, type = 'website', image, post, hidden = false }) {
  const title = page.meta.title, desc = page.meta.description;
  const css = `${BASE}/assets/css/site.css?v=${ASSET_HASH.css}`;
  return `<!doctype html>
<html lang="${lang}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>try{if(sessionStorage.getItem('vz-menu')==='1')document.documentElement.classList.add('menu-restore')}catch(e){}</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
${alternates.map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}">`).join('\n')}
${hidden || NOINDEX ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">'}
<meta name="theme-color" content="#05051a">
<meta name="color-scheme" content="dark">
<meta name="author" content="Charles-Erick BG, Jean-François BG">
<meta property="og:site_name" content="Viesigners">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="${lang === 'fr' ? 'fr_CA' : 'en_CA'}">
<meta property="og:locale:alternate" content="${lang === 'fr' ? 'en_CA' : 'fr_CA'}">
<meta property="og:image" content="${abs('/assets/img/' + (image || 'og-card.jpg'))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${post ? `<meta property="article:published_time" content="${post.date}">\n<meta property="article:modified_time" content="${post.modified || post.date}">` : ''}
<link rel="alternate" type="text/markdown" href="${canonical}index.md">
<link rel="alternate" type="text/plain" title="llms.txt" href="${abs('/llms.txt')}">
<link rel="icon" href="${BASE}/assets/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="${BASE}/assets/img/favicon.png">
<link rel="preload" href="${BASE}/assets/fonts/hanken-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BASE}/assets/css/fonts.css?v=${ASSET_HASH.fonts}">
<link rel="stylesheet" href="${css}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>`;
}

function header(c) {
  const { lang, T, key } = c;
  const alt = lang === 'fr' ? 'en' : 'fr';
  const altUrl = c.altUrls[alt] || `/${alt}/`;
  const cur = (k, extra = []) => (key === k || extra.includes(key) ? ' aria-current="page"' : '');
  const main = [['home', 'home'], ['a-propos', 'a-propos'], ['realisations', 'realisations'], ['actualites', 'actualites'], ['contact', 'contact']]
      .filter(([k]) => !isHidden(k))
    .map(([k, label]) => `<a href="${url(k, lang)}"${cur(k, k === 'a-propos' ? ['charles-erick', 'jean-francois'] : k === 'actualites' ? ['post'] : [])}>${esc(T.nav[label])}</a>`).join('');
  const services = SERVICE_KEYS.filter((k) => !isHidden(k)).map((k) => `<a href="${url(k, lang)}"${cur(k)}>${esc(T.nav[k])}<small>${esc(T.navSub[k])}</small></a>`).join('');
  return `<a class="skip" href="#main">${esc(T.skip)}</a>
<header class="header" id="top">
  <div class="header__in">
    <a class="hbtn hphone" href="tel:${CFG.phoneRaw}" aria-label="${esc(T.call)} ${esc(CFG.phone)}">${ico('phone')}<span>${esc(CFG.phone)}</span></a>
    <a class="brand" href="${url('home', lang)}" aria-label="Viesigners — ${esc(T.nav.home)}">${img('logo-viesigners.png', 'Viesigners', { lazy: false })}</a>
    <button class="hbtn hmenu" type="button" aria-expanded="false" aria-controls="drawer" data-open="${esc(T.menu)}" data-close="${esc(T.close)}"><span class="hmenu__t" data-close="${esc(T.close)}">${esc(T.menu)}</span><span class="hmenu__i" aria-hidden="true"><i></i><i></i><i></i></span></button>
  </div>
</header>
<div class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="${esc(T.menu)}">
  <div class="wrap drawer__in">
    <nav class="drawer__main" aria-label="${esc(T.mainNav)}">${main}</nav>
    <nav class="drawer__services" aria-label="${esc(T.servicesLabel)}"><p class="label">${esc(T.nav.services)}</p>${services}</nav>
    <div class="drawer__foot">
      <div class="lang-m" role="group" aria-label="${esc(T.langLabel)}">${['en', 'fr'].map((l) => (l === lang ? `<span aria-current="true">${l.toUpperCase()}</span>` : `<a href="${altUrl}" hreflang="${l}" lang="${l}" aria-label="${esc(T.langSwitch)}">${l.toUpperCase()}</a>`)).join('')}</div>
      <a class="pill" href="${url('contact', lang)}">${esc(T.ctaShort)}</a>
    </div>
  </div>
</div>`;
}

function footer(c) {
  const { lang, T } = c;
  return `<footer class="footer"><div class="wrap">
  <p class="footer__tag display">${fmt(T.footerTag, lang)}</p>
  <div class="footer__grid">
    <div><h2>${esc(T.footer.who)}</h2><p style="color:var(--text-2);max-width:34ch">${esc(T.footer.blurb)}</p>
      <p style="margin-top:1.4rem"><a class="pill pill--sm" href="${url('contact', lang)}">${esc(T.footer.cta)}</a></p></div>
    <div><h2>${esc(T.nav.services)}</h2><ul>${SERVICE_KEYS.filter((k) => !isHidden(k)).map((k) => `<li><a href="${url(k, lang)}">${esc(T.nav[k])}</a></li>`).join('')}</ul></div>
    <div><h2>${esc(T.footer.company)}</h2><ul>${['a-propos', 'realisations', 'actualites', 'contact'].filter((k) => !isHidden(k)).map((k) => `<li><a href="${url(k, lang)}">${esc(T.nav[k])}</a></li>`).join('')}</ul></div>
    <div><h2>${esc(T.nav.contact)}</h2><address><span>Québec, Canada</span><span>Vancouver, Canada</span><a href="tel:${CFG.phoneRaw}">${esc(CFG.phone)}</a></address>
      <div class="footer__social"><a href="${CFG.social.facebook}" target="_blank" rel="noopener noreferrer me" aria-label="Facebook ${esc(T.newTab)}">${ico('fb')}</a><a href="${CFG.social.linkedin}" target="_blank" rel="noopener noreferrer me" aria-label="LinkedIn ${esc(T.newTab)}">${ico('in')}</a></div></div>
  </div>
  <div class="footer__base"><span>© ${new Date().getFullYear()} ${esc(T.footer.rights)}</span><span><a href="${CFG.legal[lang].privacy}" target="_blank" rel="noopener noreferrer" aria-label="${esc(T.footer.privacy)} ${esc(T.newTab)}">${esc(T.footer.privacy)}</a> · <a href="${CFG.legal[lang].terms}" target="_blank" rel="noopener noreferrer" aria-label="${esc(T.footer.terms)} ${esc(T.newTab)}">${esc(T.footer.terms)}</a></span></div>
</div></footer>`;
}

/* ----------------------------- JSON-LD ------------------------------------ */
function orgNodes(lang, T) {
  const o = abs('/#organization');
  return [
    {
      '@type': ['Organization', 'ProfessionalService'], '@id': o, name: 'Viesigners', alternateName: ['Les Viesigners', 'Les frères BG', 'The BG Twins'],
      url: abs('/'), logo: { '@type': 'ImageObject', url: abs('/assets/img/favicon.png') }, image: abs('/assets/img/og-card.jpg'),
      description: T.orgDescription, telephone: CFG.phone, foundingDate: '2009',
      address: [{ '@type': 'PostalAddress', addressLocality: 'Québec', addressRegion: 'QC', addressCountry: 'CA' }, { '@type': 'PostalAddress', addressLocality: 'Vancouver', addressRegion: 'BC', addressCountry: 'CA' }],
      areaServed: [{ '@type': 'Country', name: 'Canada' }, { '@type': 'Place', name: 'Worldwide' }],
      availableLanguage: ['fr', 'en'], sameAs: [CFG.social.facebook, CFG.social.linkedin, CFG.social.toptal].filter(Boolean),
      knowsAbout: T.knowsAbout, founder: [{ '@id': abs('/#charles-erick') }, { '@id': abs('/#jean-francois') }],
      award: T.awards, slogan: T.footerTag.replace(/\*/g, ''),
    },
    { '@type': 'WebSite', '@id': abs('/#website'), url: abs('/'), name: 'Viesigners', publisher: { '@id': o }, inLanguage: ['fr', 'en'] },
    { '@type': 'Person', '@id': abs('/#charles-erick'), name: 'Charles-Erick BG', jobTitle: T.jobTitle, worksFor: { '@id': o }, image: abs('/assets/img/founders-1.jpg'), ...(isHidden('charles-erick') ? {} : { url: abs(url('charles-erick', lang)) }), knowsAbout: T.knowsAbout, nationality: 'CA' },
    { '@type': 'Person', '@id': abs('/#jean-francois'), name: 'Jean-François BG', jobTitle: T.jobTitle, worksFor: { '@id': o }, image: abs('/assets/img/founders-1.jpg'), ...(isHidden('jean-francois') ? {} : { url: abs(url('jean-francois', lang)) }), sameAs: [CFG.social.toptalJF], knowsAbout: T.knowsAbout, nationality: 'CA' },
  ];
}

/* ----------------------------- markdown mirror ---------------------------- */
function toMd(page, c) {
  const { lang, T } = c;
  const L = [];
  const t = (s) => plain(s);
  L.push(`# ${t(page.meta.h1 || page.meta.title)}`, '', `> ${page.meta.description}`, '', `URL: ${abs(c.selfUrl)}`, `${T.updated} ${page.updated || BUILD_DATE}`, '');
  for (const s of page.sections) {
    switch (s.type) {
      case 'hero-home': L.push(t(s.h1), '', t(s.lead), ''); break;
      case 'page-hero': L.push(t(s.lead), '', s.brief ? `## ${T.brief}` : '', ...(s.brief || []).map((b) => `- ${b.b ? t(b.b) + ' ' : ''}${t(b.t)}`), ''); break;
      case 'statement': L.push(t(s.text), '', ...(s.prose || []).flatMap((p) => [t(p), '']), ''); break;
      case 'friction': L.push(`## ${t(s.h2)}`, '', t(s.lead), '', ...s.pains.map((p) => `- ${t(p)}`), '', t(s.reveal.h3), '', ...s.reveal.p.flatMap((p) => [t(p), '']), t(s.reveal.cost), ''); break;
      case 'founders': L.push(`## ${t(s.h2)}`, '', ...s.text.flatMap((p) => [t(p), '']), ...s.checks.map((k) => `- ${t(k)}`), ''); break;
      case 'services': L.push(`## ${t(s.h2)}`, '', t(s.lead), '', ...s.cards.flatMap((k) => [`### ${t(k.title)}`, t(k.desc), ...(k.items || []).map((i) => `- ${i.b ? t(i.b) + ' — ' : ''}${t(i.t)}`), '']), ''); break;
      case 'stats': L.push(s.h2 ? `## ${t(s.h2)}` : '', '', ...s.items.map((i) => `- **${i.n}** ${t(i.h)}: ${t(i.p)}`), ''); break;
      case 'work': L.push(`## ${t(s.h2)}`, '', ...s.items.map((i) => `- ${i.title}${i.result ? ' — ' + i.result : ''}`), ''); break;
      case 'fit': L.push(`## ${t(s.h2)}`, '', `### ${t(s.yes.h)}`, ...s.yes.items.map((i) => `- ${t(i)}`), '', `### ${t(s.no.h)}`, ...s.no.items.map((i) => `- ${t(i)}`), ''); break;
      case 'deliverables': L.push(`## ${t(s.h2)}`, '', ...(s.lead ? [t(s.lead), ''] : []), ...s.items.map((i) => `- **${t(i.h)}** — ${t(i.p)}`), ''); break;
      case 'process': L.push(`## ${t(s.h2)}`, '', ...s.steps.map((p, i) => `${i + 1}. **${t(p.h)}** — ${t(p.p)}`), ''); break;
      case 'compare': L.push(`## ${t(s.h2)}`, '', `### ${t(s.before.h)}`, ...s.before.items.map((i) => `- ${t(i)}`), '', `### ${t(s.after.h)}`, ...s.after.items.map((i) => `- ${t(i)}`), ''); break;
      case 'proof': L.push(...s.items.map((i) => `- **${i.n}** ${t(i.t)}`), ''); break;
      case 'people': L.push(`## ${t(s.h2)}`, '', ...s.items.map((p) => `- **${p.name}** (${p.role}) — ${t(p.text)}`), ''); break;
      case 'facts': L.push(`## ${t(s.h2)}`, '', ...s.items.map((i) => `- **${t(i.k)}**: ${t(i.v)}`), ''); break;
      case 'article': L.push(...c.post.summary.map((i) => `- ${t(i)}`), '', ...c.post.body.flatMap((b) => b.h2 ? [`## ${t(b.h2)}`, ''] : b.h3 ? [`### ${t(b.h3)}`, ''] : b.p ? [t(b.p), ''] : b.ul ? [...b.ul.map((i) => `- ${t(i)}`), ''] : [])); break;
      case 'posts-list': L.push(...POSTS[lang].map((p) => `- [${p.title}](${abs(url('post:' + p.key, lang))}) — ${p.description}`), ''); break;
      case 'contact': L.push(t(s.lead), '', ...s.points.map((p) => `- ${t(p)}`), '', `${s.labels.phone}: ${CFG.phone}`, 'Québec, Canada · Vancouver, Canada', ''); break;
      case 'testimonials': L.push(`## ${t(s.h2)}`, '', ...s.items.map((x) => `> ${x.text}\n> — ${x.name}${x.role ? ', ' + x.role : ''} (${x.date})`), ''); break;
      case 'cta-final': L.push(`## ${t(s.h2)}`, '', t(s.p), ''); break;
      case 'faq': if (page.faq?.length) L.push(`## ${t(s.h2 || T.faqTitle)}`, '', ...page.faq.flatMap((f) => [`### ${t(f.q)}`, '', ...f.a.flatMap((p) => [t(p), ''])])); break;
    }
  }
  return L.filter((x) => x !== undefined).join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/* ----------------------------- page assembly ------------------------------ */
/* default light/dark sheet per section type (override with "theme" in the JSON) */
const THEME = {
  'hero-home': 'dark', 'page-hero': 'dark', 'cta-final': 'dark',
  friction: 'light', founders: 'dark', services: 'light', stats: 'dark', work: 'light', fit: 'dark', slot: 'light', testimonials: 'light', faq: 'light',
  statement: 'light', deliverables: 'dark', process: 'light', compare: 'dark', proof: 'light', people: 'dark', facts: 'light',
  'posts-list': 'light', article: 'light', contact: 'light', 'rich-text': 'light',
};
const ASSET_HASH = {};
const PAGES_OUT = []; // for sitemap + llms

function buildPage({ lang, key, page, post }) {
  const T = TR[lang];
  const selfUrl = key === 'post' ? url('post:' + post.key, lang) : url(key, lang);
  const canonical = abs(selfUrl);
  const altUrls = {};
  for (const l of LANGS) {
    if (key === 'post') { const s = CURRENT_POST_SLUGS[post.key]; altUrls[l] = s?.[l] ? url('post:' + post.key, l) : null; }
    else altUrls[l] = url(key, l);
  }
  const alternates = LANGS.filter((l) => altUrls[l]).map((l) => ({ hreflang: l, href: abs(altUrls[l]) }));
  alternates.push({ hreflang: 'x-default', href: abs('/') });

  /* breadcrumbs */
  const crumbs = [{ name: T.nav.home, url: url('home', lang) }];
  if (SERVICE_KEYS.includes(key)) { /* Home > Service */ }
  if (['charles-erick', 'jean-francois'].includes(key)) crumbs.push({ name: T.nav['a-propos'], url: url('a-propos', lang) });
  if (key === 'post') crumbs.push({ name: T.nav.actualites, url: url('actualites', lang) });
  if (key !== 'home') crumbs.push({ name: key === 'post' ? post.title : T.nav[key], url: selfUrl });

  const ctx = { lang, T, key, page, post, crumbs, altUrls, selfUrl };
  let prevTheme = null;
  const body = page.sections.map((s, i) => {
    if (!R[s.type]) throw new Error('No renderer for ' + s.type + ' in ' + key);
    const html = R[s.type](s, ctx);
    if (!html) return '';
    const th = s.theme || THEME[s.type] || 'light';
    const cls = `theme theme--${th}${prevTheme === null ? ' theme--first' : ''}${prevTheme === th ? ' theme--join' : ''}`;
    prevTheme = th;
    return `<div class="${cls}">${html}</div>`;
  }).join('\n');

  /* JSON-LD graph */
  const graph = [...orgNodes(lang, T)];
  const pageId = canonical + '#webpage';
  const webpage = {
    '@type': key === 'post' ? 'WebPage' : key === 'contact' ? 'ContactPage' : key === 'a-propos' ? 'AboutPage' : ['actualites', 'realisations'].includes(key) ? 'CollectionPage' : 'WebPage',
    '@id': pageId, url: canonical, name: page.meta.title, description: page.meta.description, inLanguage: lang, isPartOf: { '@id': abs('/#website') }, about: { '@id': abs('/#organization') },
    datePublished: page.published || CFG.published, dateModified: page.updated || BUILD_DATE, breadcrumb: { '@id': canonical + '#breadcrumb' },
    primaryImageOfPage: { '@type': 'ImageObject', url: abs('/assets/img/' + (page.image || 'og-card.jpg')) },
  };
  if (page.speakable !== false) webpage.speakable = { '@type': 'SpeakableSpecification', cssSelector: ['h1', '.lead', '.brief li'] };
  graph.push(webpage);
  graph.push({ '@type': 'BreadcrumbList', '@id': canonical + '#breadcrumb', itemListElement: crumbs.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.name, item: abs(b.url) })) });
  if (SERVICE_KEYS.includes(key) && page.service) {
    graph.push({
      '@type': 'Service', '@id': canonical + '#service', name: page.service.name, serviceType: page.service.type, description: page.meta.description, provider: { '@id': abs('/#organization') },
      areaServed: [{ '@type': 'Country', name: 'Canada' }, { '@type': 'Place', name: 'Worldwide' }], availableChannel: { '@type': 'ServiceChannel', serviceUrl: abs(url('contact', lang)) },
      audience: { '@type': 'BusinessAudience', audienceType: page.service.audience }, mainEntityOfPage: { '@id': pageId },
    });
  }
  if (key === 'charles-erick' || key === 'jean-francois') webpage.mainEntity = { '@id': abs('/#' + key) };
  if (key === 'post') {
    graph.push({ '@type': 'BlogPosting', '@id': canonical + '#article', headline: post.title, description: post.description, inLanguage: lang, datePublished: post.date, dateModified: post.modified || post.date, mainEntityOfPage: { '@id': pageId }, author: [{ '@id': abs('/#charles-erick') }, { '@id': abs('/#jean-francois') }], publisher: { '@id': abs('/#organization') }, image: abs('/assets/img/og-card.jpg'), keywords: post.keywords, wordCount: post.body.map((b) => b.h2 || b.h3 || b.p || (b.ul || []).join(' ')).join(' ').split(/\s+/).length });
  }
  if (page.faq?.length) graph.push({ '@type': 'FAQPage', '@id': canonical + '#faq', inLanguage: lang, mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: plain(f.q), acceptedAnswer: { '@type': 'Answer', text: f.a.map(plain).join(' ') } })) });
  if (key === 'realisations') graph.push({ '@type': 'ItemList', '@id': canonical + '#list', itemListElement: page.sections.filter((s) => s.type === 'work').flatMap((s) => s.items).map((i, n) => ({ '@type': 'ListItem', position: n + 1, item: { '@type': 'CreativeWork', name: i.title, description: i.result || i.alt, image: abs('/assets/img/work/' + i.img), creator: { '@id': abs('/#organization') } } })) });

  const jsonld = { '@context': 'https://schema.org', '@graph': graph };
  const html = `${head({ lang, T, page, canonical, alternates, jsonld, type: key === 'post' ? 'article' : 'website', post, hidden: isHidden(key) || !!page.noindex })}
<body class="${key === 'home' ? 'home' : ''}">
${SPRITE}
<div class="page-bg" aria-hidden="true"></div>
${header(ctx)}
<main id="main" tabindex="-1">
${body}
</main>
${footer(ctx)}
<script src="${BASE}/assets/js/site.js?v=${ASSET_HASH.js}" defer></script>
</body>
</html>
`;
  const out = path.join(DIST, selfUrl.slice(BASE.length)); // files live at the site root; BASE is only the public URL prefix
  write(path.join(out, 'index.html'), html);
  write(path.join(out, 'index.md'), toMd(page, ctx));
  PAGES_OUT.push({ hidden: isHidden(key) || !!page.noindex, lang, key, selfUrl, altUrls, title: page.meta.title, description: page.meta.description, md: toMd(page, ctx), nav: key === 'post' ? 'post' : key });
}

/* ----------------------------- driver ------------------------------------- */
const TR = {};
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  mkdir(DIST);
  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
  const fontsCss = fs.readFileSync(path.join(SRC, 'assets/css/fonts.css'), 'utf8');
  for (const f of fs.readdirSync(path.join(DIST, 'assets/fonts'))) if (!fontsCss.includes(f)) fs.unlinkSync(path.join(DIST, 'assets/fonts', f)); // drop unused fonts from the build output
  ASSET_HASH.css = hash(path.join(SRC, 'assets/css/site.css'));
  ASSET_HASH.fonts = hash(path.join(SRC, 'assets/css/fonts.css'));
  ASSET_HASH.js = hash(path.join(SRC, 'assets/js/site.js'));
  PAGES_OUT.length = 0;

  /* load content */
  CURRENT_POST_SLUGS = {};
  for (const l of LANGS) {
    TR[l] = rd(path.join(SRC, 'content', l, '_site.json'));
    POSTS[l] = [];
    const dir = path.join(SRC, 'content', l, 'posts');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const p = rd(path.join(dir, f)); POSTS[l].push(p);
      (CURRENT_POST_SLUGS[p.key] ||= {})[l] = p.slug;
    }
  }
  const pages = {};
  for (const l of LANGS) for (const k of Object.keys(ROUTES)) pages[`${l}:${k}`] = rd(path.join(SRC, 'content', l, `${k}.json`));

  for (const l of LANGS) {
    for (const k of Object.keys(ROUTES)) buildPage({ lang: l, key: k, page: pages[`${l}:${k}`] });
    for (const p of POSTS[l]) {
      const T = TR[l];
      buildPage({
        lang: l, key: 'post', post: p,
        page: {
          meta: { title: p.metaTitle || `${p.title} | Viesigners`, description: p.description, h1: p.title }, updated: p.modified || p.date, published: p.date, faq: p.faq, speakable: true,
          sections: [
            { type: 'page-hero', tag: p.tag, h1: p.title, lead: p.description, ctas: [] },
            { type: 'article' },
            { type: 'faq', h2: T.faqTitle },
            { type: 'cta-final', ...T.postCta },
          ],
        },
      });
    }
  }

  /* root "/" — no language screen: send each visitor to the language of their browser.
     1) hosting rules (_redirects / .htaccess, generated below) redirect server-side using Accept-Language;
     2) this tiny page is the fallback on hosts without such rules: it redirects instantly with JS
        (saved choice → browser languages → English) and still offers plain links for crawlers/no-JS. */
  const rootAlt = [...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs('/' + l + '/')}">`), `<link rel="alternate" hreflang="x-default" href="${abs('/')}">`].join('\n');
  write(path.join(DIST, 'index.html'), `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Viesigners | Agence web Québec — Web agency</title>
<meta name="description" content="Viesigners — UX/UI, CRO, sites web, landing pages et design de produit. / UX/UI, CRO, websites, landing pages and product design.">
<link rel="canonical" href="${abs('/')}">
${rootAlt}
<meta name="theme-color" content="#101421"><meta name="color-scheme" content="dark"><meta name="robots" content="${NOINDEX ? 'noindex, follow' : 'index, follow'}">
<link rel="icon" href="${BASE}/assets/img/favicon.png">
<style>html{background:#101421;color:#fff;font-family:system-ui,sans-serif}body{margin:0;min-height:100dvh;display:grid;place-items:center}a{color:#ff488b;margin:0 .75rem}p{text-align:center}</style>
<script>(function(){var l;try{l=localStorage.getItem('vz-lang')}catch(e){}if(l!=='fr'&&l!=='en'){var a=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en'];l='en';for(var i=0;i<a.length;i++){var c=String(a[i]).toLowerCase().slice(0,2);if(c==='fr'||c==='en'){l=c;break}}}location.replace('${BASE}/'+l+'/'+location.search+location.hash)})();</script>
</head><body><p><a href="${BASE}/fr/" hreflang="fr" lang="fr">Viesigners — Français</a><a href="${BASE}/en/" hreflang="en" lang="en">Viesigners — English</a></p></body></html>`);

  /* 404 */
  write(path.join(DIST, '404.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>404 | Viesigners</title><meta name="robots" content="noindex"><link rel="stylesheet" href="${BASE}/assets/css/fonts.css"><link rel="stylesheet" href="${BASE}/assets/css/site.css"></head><body><div class="page-bg"></div><main class="chooser"><div><h1 class="display">404.<br><em class="acc">Cette page a pris un détour.</em></h1><p class="lead" style="margin:0 auto 2rem">This page took a detour.</p><div class="opts"><a class="pill" href="${BASE}/fr/">Accueil</a><a class="pill pill--ghost" href="${BASE}/en/">Home</a></div></div></main></body></html>`);

  /* sitemap with hreflang alternates */
  const urls = [{ loc: abs('/'), alts: LANGS.map((l) => ({ l, href: abs('/' + l + '/') })).concat([{ l: 'x-default', href: abs('/') }]) }];
  for (const p of PAGES_OUT.filter((x) => !x.hidden)) {
    const alts = LANGS.filter((l) => p.altUrls[l]).map((l) => ({ l, href: abs(p.altUrls[l]) })).concat([{ l: 'x-default', href: abs('/') }]);
    urls.push({ loc: abs(p.selfUrl), alts });
  }
  write(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.map((u) => `<url><loc>${u.loc}</loc><lastmod>${BUILD_DATE}</lastmod>${u.alts.map((a) => `<xhtml:link rel="alternate" hreflang="${a.l}" href="${a.href}"/>`).join('')}</url>`).join('\n')}\n</urlset>\n`);

  write(path.join(DIST, '.nojekyll'), ''); // GitHub Pages: serve files as-is
  /* robots: everything open, AI crawlers explicitly welcome */
  const bots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot', 'cohere-ai', 'Meta-ExternalAgent', 'Amazonbot', 'DuckAssistBot', 'MistralAI-User'];
  if (NOINDEX) write(path.join(DIST, 'robots.txt'), `# staging build — do not index\nUser-agent: *\nDisallow: /\n`);
  else write(path.join(DIST, 'robots.txt'), `# Viesigners — all crawlers, including AI search and assistants, are welcome.\nUser-agent: *\nAllow: /\n\n${bots.map((b) => `User-agent: ${b}\nAllow: /\n`).join('\n')}\nSitemap: ${abs('/sitemap.xml')}\n# LLM-friendly summaries: ${abs('/llms.txt')} and ${abs('/llms-full.txt')}\n`);

  /* llms.txt + llms-full.txt */
  const llms = [`# Viesigners`, '', `> ${TR.fr.orgDescription}`, '', `> ${TR.en.orgDescription}`, ''];
  for (const l of LANGS) {
    llms.push(`## ${l === 'fr' ? 'Français' : 'English'}`, '');
    for (const p of PAGES_OUT.filter((x) => x.lang === l && !x.hidden)) llms.push(`- [${plain(p.title)}](${abs(p.selfUrl)}): ${p.description}`);
    llms.push('');
  }
  llms.push('## Contact', '', `- ${CFG.phone} — Québec, Canada · Vancouver, Canada`, `- ${abs('/fr/contact/')} · ${abs('/en/contact/')}`, '');
  write(path.join(DIST, 'llms.txt'), llms.join('\n'));
  write(path.join(DIST, 'llms-full.txt'), `# Viesigners — full content\n\n` + PAGES_OUT.filter((x) => !x.hidden).map((p) => `<!-- ${p.selfUrl} -->\n` + p.md).join('\n---\n\n'));

  /* hosting rules: server-side language redirect for "/" (302 + Vary so caches/crawlers stay correct) */
  write(path.join(DIST, '_redirects'), `/  /fr/  302!  Language=fr\n/  /en/  302!\n`);
  write(path.join(DIST, '.htaccess'), `# Apache: send "/" to the browser language (English by default)\n<IfModule mod_rewrite.c>\nRewriteEngine On\nRewriteCond %{HTTP:Accept-Language} ^fr [NC]\nRewriteRule ^$ /fr/ [R=302,L]\nRewriteRule ^$ /en/ [R=302,L]\n</IfModule>\n<IfModule mod_headers.c>\nHeader append Vary Accept-Language\n</IfModule>\n`);
  /* hosting hints */
  write(path.join(DIST, '_headers'), `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/\n  Vary: Accept-Language\n  Cache-Control: no-store\n`);
  console.log(`✓ built ${PAGES_OUT.length} pages (${PAGES_OUT.filter((x) => x.hidden).length} hidden: noindex, unlinked) (${LANGS.join(' + ')}) → dist/  [${new Date().toLocaleTimeString()}]`);
}

build();

if (process.argv.includes('--serve')) {
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') { // same behaviour as the production rules: pick the language from Accept-Language (default: English)
      const al = String(req.headers['accept-language'] || '').toLowerCase().split(',').map((x) => x.trim().slice(0, 2));
      const lang = al.find((x) => x === 'fr' || x === 'en') || 'en';
      res.writeHead(302, { Location: `/${lang}/`, Vary: 'Accept-Language' }); return res.end();
    }
    let f = path.join(DIST, p);
    if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(DIST, '404.html'))); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(4173, () => console.log('→ http://localhost:4173'));
  let t; fs.watch(SRC, { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 200); });
}
