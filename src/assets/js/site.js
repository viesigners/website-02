/* Viesigners — progressive enhancement only. All content is already in the HTML. */
(() => {
  const d = document, root = d.documentElement;
  root.classList.add('js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* remember the visitor's language so "/" sends them back to it next time */
  try { localStorage.setItem('vz-lang', d.documentElement.lang); } catch (_) {}

  /* header: hide on scroll down, show on scroll up */
  const header = d.querySelector('.header');
  const drawer = d.querySelector('.drawer'), menuBtn = d.querySelector('.hmenu');
  let lastY = scrollY, ticking = false;
  const roleNav = d.querySelector('.rolenav'), roleSecs = d.querySelectorAll('[data-role-section]'), lastRole = roleSecs[roleSecs.length - 1];
  // profile tabs: the tab links end with #<role> so the page lands on the content; once there, drop the
  // fragment so the address bar shows the clean tab URL (the one to copy into a resume)
  const roleTarget = location.hash && d.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (roleNav && roleTarget && roleTarget.hasAttribute('data-role-section')) {
    addEventListener('load', () => setTimeout(() => history.replaceState(history.state, '', location.pathname + location.search), 0), { once: true });
  }
  // profile tabs: on narrow screens the bar scrolls sideways — bring the active tab into view
  const activeTab = roleNav && roleNav.querySelector('.is-active');
  if (activeTab && roleNav.scrollWidth > roleNav.clientWidth) roleNav.scrollLeft = activeTab.offsetLeft - (roleNav.clientWidth - activeTab.offsetWidth) / 2;
  const onScroll = () => {
    const y = Math.max(0, scrollY), dy = y - lastY;
    header && header.classList.toggle('is-stuck', y > 24);
    if (header && !(drawer && drawer.classList.contains('is-open'))) {
      if (y < 80 || dy < -4) header.classList.remove('is-hidden');
      else if (dy > 6) header.classList.add('is-hidden');
    }
    d.documentElement.classList.toggle('hdr-hidden', !!header && header.classList.contains('is-hidden'));
    // portfolio page: the role bar stops following once the last role section (UX/UI) has ended
    if (roleNav && lastRole) roleNav.classList.toggle('is-done', lastRole.getBoundingClientRect().bottom < 150);
    if (Math.abs(dy) > 4) lastY = y;
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll();
  // keep the header visible while a keyboard user tabs into it
  header && header.addEventListener('focusin', () => header.classList.remove('is-hidden'));

  /* full-screen menu */
  if (menuBtn && drawer) {
    const label = menuBtn.querySelector('.hmenu__t');
    const setOpen = (open, focus = true) => {
      drawer.classList.toggle('is-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      label.textContent = open ? menuBtn.dataset.close : menuBtn.dataset.open;
      drawer.toggleAttribute('inert', !open);
      d.body.style.overflow = open ? 'hidden' : '';
      header.classList.remove('is-hidden');
      header.classList.toggle('is-open', open);
      if (open && focus) drawer.querySelector('a')?.focus({ preventScroll: true });
    };
    drawer.setAttribute('inert', '');
    menuBtn.addEventListener('click', () => setOpen(menuBtn.getAttribute('aria-expanded') !== 'true'));
    // links close the menu — except the language switch, which keeps it open on the next page
    drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      if (a.closest('.lang-m')) { try { sessionStorage.setItem('vz-menu', '1'); } catch (_) {} return; }
      setOpen(false);
    }));
    try {
      if (sessionStorage.getItem('vz-menu') === '1') {
        sessionStorage.removeItem('vz-menu');
        drawer.classList.add('no-anim');
        setOpen(true, false);
        requestAnimationFrame(() => requestAnimationFrame(() => { drawer.classList.remove('no-anim'); d.documentElement.classList.remove('menu-restore'); }));
      }
    } catch (_) {}
    d.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('is-open')) { setOpen(false); menuBtn.focus(); } });
  }

  /* portfolio page: copy a role's direct link, highlight the role being read */
  d.querySelectorAll('.copylink').forEach(b => b.addEventListener('click', async () => {
    const url = location.origin + location.pathname + b.dataset.copy;
    try { await navigator.clipboard.writeText(url); } catch (_) { return; }
    const t = b.textContent; b.textContent = b.dataset.done; setTimeout(() => { b.textContent = t; }, 1800);
  }));
  // contact form: ?need=<key> (from the profile links) pre-selects the matching option
  const needSel = d.getElementById('f-need'), needKey = new URLSearchParams(location.search).get('need');
  if (needSel) { const o = needKey && needSel.querySelector(`option[data-key="${CSS.escape(needKey)}"]`); needSel.value = o ? o.value : ''; }
  const spy = d.querySelectorAll('[data-spy]'), secs = d.querySelectorAll('[data-role-section]');
  if (spy.length && secs.length && 'IntersectionObserver' in window) {
    const so = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) spy.forEach(a => a.classList.toggle('is-active', a.dataset.spy === e.target.id)); }), { rootMargin: '-35% 0px -55% 0px' });
    secs.forEach(s => so.observe(s));
  }

  /* reveal on first view */
  const rv = d.querySelectorAll('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    rv.forEach(el => io.observe(el));
  } else rv.forEach(el => el.classList.add('in'));

  /* card spotlight follows pointer */
  d.querySelectorAll('.card, .person, .post-card').forEach(c => c.addEventListener('pointermove', e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
    c.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
  }));

  /* friction → flow: the smooth path is drawn as the section scrolls through */
  const fig = d.querySelector('.flowfig');
  if (fig) {
    const path = fig.querySelector('.flow');
    path && path.setAttribute('pathLength', '1');
    const tick = () => {
      const r = fig.getBoundingClientRect(), vh = innerHeight;
      const p = reduce ? 1 : Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.9)));
      fig.style.setProperty('--p', p.toFixed(3));
    };
    addEventListener('scroll', tick, { passive: true }); tick();
  }

  /* contact form (posts to data-endpoint if set, otherwise opens a prefilled email) */
  const form = d.querySelector('form.form');
  if (form) {
    const status = form.querySelector('.status');
    // project fields (phone, website, budget, country) only appear once a project need is chosen:
    // hidden — and left out of the submission — while the need is still "Choose…" or "just wanted to say hi"
    const need = form.querySelector('#f-need');
    const syncNeed = () => {
      const opt = need && need.selectedOptions[0];
      const short = !!opt && (!need.value || opt.dataset.key === 'hi');
      form.classList.toggle('is-short', short);
      form.querySelectorAll('[data-project]').forEach(w => {
        w.hidden = short;
        w.querySelectorAll('input, select, textarea').forEach(i => {
          if (i.dataset.req === undefined) i.dataset.req = i.required ? '1' : '0';
          i.required = !short && i.dataset.req === '1';
          i.disabled = short;
          if (short) { i.removeAttribute('aria-invalid'); const err = i.closest('.field')?.querySelector('.err'); if (err) err.textContent = ''; }
        });
      });
    };
    if (need) { need.addEventListener('change', syncNeed); syncNeed(); }
    const show = (msg, err) => { status.hidden = false; status.textContent = msg; status.classList.toggle('is-err', !!err); status.focus?.(); };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      let ok = true;
      form.querySelectorAll('[required]').forEach(f => {
        const bad = !f.checkValidity();
        f.setAttribute('aria-invalid', String(bad));
        const err = f.closest('.field')?.querySelector('.err');
        if (err) err.textContent = bad ? (f.type === 'email' ? form.dataset.msgEmail : form.dataset.msgRequired) : '';
        if (bad && ok) { f.focus(); ok = false; }
      });
      if (!ok) return;
      if (form.querySelector('.hp input').value) return; // honeypot
      const data = Object.fromEntries(new FormData(form).entries());
      const endpoint = form.dataset.endpoint;
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        if (!endpoint) throw new Error('no-endpoint');
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ...data, _subject: form.dataset.subject, _replyto: data.email, _template: 'table', _captcha: 'false' }) });
        if (!res.ok) throw new Error('http');
        form.reset(); if (form.dataset.thanks) { location.href = form.dataset.thanks; return; } show(form.dataset.msgOk, false);
      } catch (_) {
        const to = form.dataset.mailto;
        if (to) {
          const body = Object.entries(data).filter(([k]) => k !== 'website_hp').map(([k, v]) => `${k}: ${v}`).join('\n');
          location.href = `mailto:${to}?subject=${encodeURIComponent(form.dataset.subject)}&body=${encodeURIComponent(body)}`;
        } else show(form.dataset.msgFail, true);
      } finally { btn.disabled = false; }
    });
    // picking a country also sets the matching calling code
    const country = form.querySelector('[data-country]'), dial = form.querySelector('[data-dial]');
    country && dial && country.addEventListener('change', () => { const o = [...dial.options].find(x => x.dataset.cc === country.value); if (o) dial.value = o.value; });
    form.querySelectorAll('[required]').forEach(f => f.addEventListener('blur', () => { f.setAttribute('aria-invalid', String(!f.checkValidity())); }));
  }

  /* cookie consent: Microsoft Clarity loads only after an explicit "accept"; nothing runs without a choice (or without JS) */
  const ck = d.querySelector('.cookie');
  if (ck) {
    const KEY = 'vz-consent', id = ck.dataset.clarity;
    const read = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
    const save = v => { try { localStorage.setItem(KEY, v); } catch (_) {} };
    let loaded = false;
    // add further trackers (e.g. a Meta pixel) as extra functions in this list: they all run only after consent
    const trackers = [
      () => {
        if (!id) return;
      (function (c, l, a, r, i, t, y) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); }; t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i; y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, d, 'clarity', 'script', id);
      },
    ];
    const load = () => { if (loaded) return; loaded = true; trackers.forEach(run => run()); };
    const stop = () => {
      try { if (window.clarity) window.clarity('consent', false); } catch (_) {}
      const host = location.hostname.replace(/^www\./, '');
      ['_clck', '_clsk', 'CLID', 'ANONCHK', 'MR', 'MUID', 'SM'].forEach(n => ['', '; domain=' + host, '; domain=.' + host].forEach(dm => { d.cookie = n + '=; Max-Age=0; path=/' + dm; }));
    };
    const show = () => { ck.hidden = false; };
    const choose = v => { save(v); ck.hidden = true; v === 'granted' ? load() : stop(); };
    ck.querySelectorAll('[data-cookie]').forEach(btn => btn.addEventListener('click', () => choose(btn.dataset.cookie)));
    d.querySelectorAll('[data-cookie-open]').forEach(btn => btn.addEventListener('click', show));
    const saved = read();
    if (saved === 'granted') load();
    else if (saved === 'denied') { /* respect the earlier choice */ }
    else if (navigator.globalPrivacyControl === true) save('denied'); // Global Privacy Control counts as a refusal
    else requestAnimationFrame(show);
  }
})();
