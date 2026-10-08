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
  const onScroll = () => {
    const y = Math.max(0, scrollY), dy = y - lastY;
    header && header.classList.toggle('is-stuck', y > 24);
    if (header && !(drawer && drawer.classList.contains('is-open'))) {
      if (y < 80 || dy < -4) header.classList.remove('is-hidden');
      else if (dy > 6) header.classList.add('is-hidden');
    }
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
        form.reset(); show(form.dataset.msgOk, false);
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
})();
