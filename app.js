/*!
 * I HATE PDF — app shell and shared tool engine
 * MAS Studio Production
 */
(function () {
  'use strict';

  const CFG = Object.assign({ mode: 'hash', site: '', ai: false, version: '1.1.0', libs: {}, features: {}, assets: {} }, window.MAS_CONFIG || {});
  const Core = window.MASCore;
  const REG = window.MAS_REGISTRY;
  const ICONS = window.MAS_ICONS || {};
  const MAS = (window.MAS = window.MAS || {});
  MAS.cfg = CFG;
  MAS.impl = MAS.impl || {};
  const UserError = Core.UserError;

  /* =========================================================
     DOM helpers
     ========================================================= */
  const $ = (s, r) => (r || document).querySelector(s);

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach((x) => append(el, x)); return; }
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function icon(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.innerHTML = ICONS[name] || ICONS['file-text'] || '';
    return svg;
  }
  const debounce = (fn, ms) => { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); }; };
  let uid = 0;
  const nextId = (p) => (p || 'id') + '-' + (++uid);
  MAS.h = h; MAS.icon = icon; MAS.debounce = debounce; MAS.nextId = nextId;

  /* =========================================================
     Library loader (lazy; local files on GitHub Pages, pinned CDN in the artifact)
     ========================================================= */
  const libCache = {};
  const LIB_GLOBALS = { pdflib: 'PDFLib', pdfjs: 'pdfjsLib', jszip: 'JSZip', qrcode: 'qrcode', jsyaml: 'jsyaml', marked: 'marked', purify: 'DOMPurify', diff: 'Diff', jsbarcode: 'JsBarcode', tesseract: 'Tesseract', bijoy: 'Bijoy', react: 'MASReact' };
  MAS.asset = (name) => (CFG.assets && CFG.assets[name]) || name;
  MAS.abs = (name) => new URL(name, location.href).href;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function loadFirst(urls, test) {
    for (const u of [].concat(urls || [])) {
      try { await loadScript(u); if (test()) return true; } catch (e) { /* try next */ }
    }
    return test();
  }
  MAS.lib = function (name) {
    if (libCache[name]) return libCache[name];
    const p = (async () => {
      const g = LIB_GLOBALS[name];
      if (!window[g] && name !== 'react') {
        const ok = await loadFirst(CFG.libs[name], () => !!window[g]);
        if (!ok) throw new UserError('A component this tool needs didn’t load. Check your connection and try again.');
      }
      if (name === 'pdfjs') {
        const pdfjs = window.pdfjsLib;
        if (CFG.libs.pdfjsWorkerMode === 'script') {
          if (!(window.pdfjsWorker && window.pdfjsWorker.WorkerMessageHandler)) {
            await loadFirst(CFG.libs.pdfjsWorker, () => !!(window.pdfjsWorker && window.pdfjsWorker.WorkerMessageHandler));
          }
          pdfjs.GlobalWorkerOptions.workerSrc = [].concat(CFG.libs.pdfjsWorker)[0];
        } else {
          pdfjs.GlobalWorkerOptions.workerSrc = [].concat(CFG.libs.pdfjsWorker)[0];
        }
      }
      if (name === 'qrcode') window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['default'];
      if (name === 'react') {
        for (const [u, test] of [[CFG.libs.reactCore, () => window.React], [CFG.libs.reactDom, () => window.ReactDOM], [CFG.libs.htm, () => window.htm]]) {
          if (!test()) await loadFirst(u, test);
          if (!test()) throw new UserError('A component this tool needs didn’t load. Check your connection and try again.');
        }
        window.MASReact = { React: window.React, ReactDOM: window.ReactDOM, html: window.htm.bind(window.React.createElement) };
      }
      return window[g];
    })();
    libCache[name] = p;
    p.catch(() => { delete libCache[name]; });
    return p;
  };

  /* =========================================================
     Theme: light | dark | system (persisted; applied pre-paint by the inline head script)
     ========================================================= */
  const THEME_KEY = 'ihp-theme';
  function storedTheme() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; } }
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#080B16' : '#F7F8FC');
    document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === t)));
    const tb = $('#theme-button');
    if (tb) {
      tb.replaceChildren(icon(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor'));
      tb.setAttribute('aria-label', 'Theme: ' + t[0].toUpperCase() + t.slice(1));
    }
  }
  function setTheme(t) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode */ }
    applyTheme(t);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(storedTheme()));

  /* =========================================================
     Announcements, toasts, clipboard, downloads
     ========================================================= */
  function announce(msg) {
    const live = $('#live');
    if (!live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 30);
  }
  function toast(msg, tone) {
    let wrap = $('#toasts');
    if (!wrap) { wrap = h('div', { id: 'toasts', class: 'toasts' }); document.body.append(wrap); }
    const t = h('div', { class: 'toast' + (tone ? ' toast--' + tone : ''), role: 'status' }, icon(tone === 'error' ? 'circle-alert' : 'circle-check'), h('span', null, msg));
    wrap.append(t);
    setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 300); }, 3200);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return true; }
    catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text; document.body.append(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      toast(ok ? 'Copied to clipboard' : 'Couldn’t copy. Select the text and copy it manually.', ok ? null : 'error');
      return ok;
    }
  }
  let downloadsCap;
  function downloadsCapability() {
    if (downloadsCap !== undefined) return downloadsCap;
    downloadsCap = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
    return downloadsCap;
  }
  async function save(blob, name) {
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await downloadsCapability();
      if (dl) {
        const ext = (name.split('.').pop() || '').toLowerCase();
        const OK = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip'];
        if (!OK.includes(ext)) {
          if (/^text\//.test(blob.type) || /^(ya?ml|xml|sql|css|js|log)$/.test(ext)) name = name + '.txt';
          else { blob = await zipOutputs([makeOutput(blob, name)], name + '.zip'); name = name + '.zip'; }
        }
        try { await dl.save({ filename: name, data: blob }); return true; }
        catch (e) {
          if (e && e.code === 'declined') return false;
          if (e && e.code === 'rejected_extension') { toast('This file type can’t be saved from this view.', 'error'); return false; }
          if (e && e.code === 'rate_limited') { toast('A save prompt is already open.', 'error'); return false; }
          if (e && e.code !== 'unavailable' && e.code !== 'not_granted') { toast('The file couldn’t be saved. Try again.', 'error'); return false; }
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }
  MAS.announce = announce; MAS.toast = toast; MAS.copy = copyText; MAS.save = save;

  // Object URLs created for the current view; released on navigation
  let viewUrls = [];
  MAS.url = (blob) => { const u = URL.createObjectURL(blob); viewUrls.push(u); return u; };
  function releaseUrls() { viewUrls.forEach((u) => URL.revokeObjectURL(u)); viewUrls = []; }

  /* =========================================================
     Registry helpers
     ========================================================= */
  const toolsById = new Map(REG.tools.map((t) => [t.id, t]));
  const catsById = new Map(REG.categories.map((c) => [c.id, c]));
  const catsBySlug = new Map(REG.categories.map((c) => [c.slug, c]));
  function isAvailable(t) {
    if (!t || t.status !== 'implemented') return false;
    if (t.requires && t.requires !== 'ai' && !CFG.features[t.requires]) return false;
    return !!MAS.impl[t.impl || t.id];
  }
  const available = () => REG.tools.filter(isAvailable);
  const toolsIn = (catId) => available().filter((t) => t.cat === catId || t.also.includes(catId));
  const plannedIn = (catId) => REG.roadmap.filter((r) => r.cat === catId);
  MAS.tool = (id) => toolsById.get(id);
  MAS.isAvailable = isAvailable;

  /* =========================================================
     Routing — "pages" mode uses real flat files (merge-pdf.html), "hash" mode uses #merge-pdf
     ========================================================= */
  const STATIC = { tools: 'All tools', roadmap: 'Roadmap', about: 'About', privacy: 'Privacy', apps: 'MAS apps', upcoming: 'Upcoming' };
  function href(slug) {
    if (CFG.mode === 'pages') return slug ? slug + '.html' : './';
    return slug ? '#' + slug : '#home';
  }
  function slugFromLocation() {
    if (CFG.mode === 'pages') {
      if (!routedOnce && document.body.dataset.route === 'notfound') return 'notfound';
      const f = decodeURIComponent(location.pathname.split('/').pop() || '');
      return f.replace(/\.html$/, '').replace(/^index$/, '');
    }
    const t = location.hash.replace(/^#/, '');
    return t === 'home' ? '' : t;
  }
  let routedOnce = false;
  let currentSlug = null;
  let disposeView = null;
  MAS.pending = null;
  MAS.flow = null;

  function link(slug, attrs) {
    const a = h('a', Object.assign({ href: href(slug) }, attrs || {}));
    a.dataset.route = slug;
    for (let i = 2; i < arguments.length; i++) append(a, arguments[i]);
    return a;
  }
  MAS.link = link;
  MAS.href = href;

  function go(slug, opts) {
    opts = opts || {};
    if (opts.files) MAS.pending = { slug, files: opts.files };
    if (opts.flow !== undefined) MAS.flow = opts.flow;
    if (CFG.mode === 'pages') {
      const url = href(slug);
      if (opts.replace) history.replaceState({ slug }, '', url); else history.pushState({ slug }, '', url);
      render(slug);
    } else {
      const target = slug ? slug : 'home';
      if (location.hash.replace(/^#/, '') === target) render(slug);
      else location.hash = target;
    }
  }
  MAS.go = go;

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-route]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    closeDrawer();
    go(a.dataset.route);
  });
  window.addEventListener('popstate', () => { if (CFG.mode === 'pages') render(slugFromLocation()); });
  window.addEventListener('hashchange', () => { if (CFG.mode === 'hash') render(slugFromLocation()); });

  function setMeta(title, desc, slug) {
    document.title = title;
    const d = $('meta[name="description"]');
    if (d) d.setAttribute('content', desc);
    const og = $('meta[property="og:title"]'); if (og) og.setAttribute('content', title);
    const ogd = $('meta[property="og:description"]'); if (ogd) ogd.setAttribute('content', desc);
    if (CFG.mode === 'pages' && CFG.site) {
      let c = $('link[rel="canonical"]');
      if (!c) { c = h('link', { rel: 'canonical' }); document.head.append(c); }
      c.setAttribute('href', CFG.site + (slug ? slug + '.html' : ''));
    }
  }

  function render(slug) {
    slug = slug == null ? '' : slug;
    routedOnce = true;
    if (disposeView) { try { disposeView(); } catch (e) { /* ignore */ } disposeView = null; }
    releaseUrls();
    currentSlug = slug;
    const main = $('#main');
    main.replaceChildren();
    let view;
    if (!slug) view = pageHome();
    else if (slug === 'tools') view = pageTools();
    else if (slug === 'roadmap') view = pageRoadmap();
    else if (slug === 'about') view = pageAbout();
    else if (slug === 'privacy') view = pagePrivacy();
    else if (slug === 'apps') view = pageApps();
    else if (slug === 'upcoming') view = pageUpcoming();
    else if (catsBySlug.has(slug)) view = pageCategory(catsBySlug.get(slug));
    else if (toolsById.has(slug)) view = pageTool(toolsById.get(slug));
    else view = pageNotFound();
    main.append(view.el);
    disposeView = view.dispose || null;
    setMeta(view.title, view.desc, slug);
    updateNav(slug);
    window.scrollTo(0, 0);
    const focusTarget = main.querySelector('h1');
    if (focusTarget && document.body.dataset.ready) { focusTarget.setAttribute('tabindex', '-1'); focusTarget.focus({ preventScroll: true }); }
    document.body.dataset.ready = '1';
  }

  /* =========================================================
     Search
     ========================================================= */
  const STOP = new Set(['to', 'a', 'an', 'the', 'my', 'of', 'for', 'and', 'in', 'into', 'from', 'with', 'online', 'free', 'tool']);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  function searchTools(q, limit) {
    const raw = norm(q).trim();
    const terms = raw.split(/[\s/,]+/).filter((t) => t && !STOP.has(t));
    if (!terms.length) return [];
    const scored = [];
    for (const t of available()) {
      const name = norm(t.name), kw = norm(t.kw), desc = norm(t.desc), cat = norm((catsById.get(t.cat) || {}).name);
      let score = 0, all = true;
      for (const term of terms) {
        let s = 0;
        if (name.startsWith(term)) s += 6;
        else if (new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) s += 5;
        else if (name.includes(term)) s += 3;
        if (kw.includes(term)) s += 2;
        if (desc.includes(term)) s += 1;
        if (cat.includes(term)) s += 1;
        if (!s) { all = false; break; }
        score += s;
      }
      if (!all) continue;
      if (raw.length > 3 && (name.includes(raw) || kw.includes(raw))) score += 5;
      if (t.featured) score += 0.5;
      scored.push({ t, score });
    }
    scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
    return scored.slice(0, limit || 8).map((x) => x.t);
  }
  function searchRoadmap(q) {
    const terms = norm(q).split(/\s+/).filter((t) => t && !STOP.has(t));
    if (!terms.length) return [];
    return REG.roadmap.filter((r) => terms.every((t) => norm(r.name).includes(t))).slice(0, 3);
  }
  MAS.search = searchTools;

  function searchBox(opts) {
    opts = opts || {};
    const listId = nextId('sr');
    const input = h('input', {
      type: 'search', class: 'search-input', id: opts.id || nextId('q'), placeholder: opts.placeholder || 'Search tools, formats or tasks…',
      autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list',
      'aria-label': 'Search tools',
    });
    const list = h('ul', { class: 'search-results', id: listId, role: 'listbox', hidden: true });
    const wrap = h('div', { class: 'search' + (opts.big ? ' search--big' : '') }, h('span', { class: 'search-icon' }, icon('search')), input, list);
    let items = [], active = -1;
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
    function pick(t) { close(); input.value = ''; if (opts.onPick) opts.onPick(t); go(t.id); }
    function setActive(i) {
      active = i;
      Array.from(list.children).forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
      const li = list.children[i];
      if (li && li.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    }
    function update() {
      const q = input.value;
      items = searchTools(q, 8);
      list.replaceChildren();
      if (!q.trim()) { close(); return; }
      items.forEach((t, i) => {
        const li = h('li', { role: 'option', id: listId + '-' + i, class: 'search-item', 'aria-selected': 'false', onmousedown: (e) => { e.preventDefault(); pick(t); } },
          h('span', { class: 'chip-icon chip-icon--' + t.cat }, icon(t.icon)),
          h('span', { class: 'search-item-text' }, h('span', { class: 'search-item-name' }, t.name), h('span', { class: 'search-item-desc' }, t.desc)));
        list.append(li);
      });
      if (!items.length) {
        const planned = searchRoadmap(q);
        list.append(h('li', { class: 'search-empty', role: 'presentation' },
          planned.length ? 'No working tool for that yet. Planned: ' + planned.map((p) => p.name).join(', ') + '.' : 'No tools match “' + q.trim() + '”. Try a format, like PDF or JPG.'));
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (items.length) setActive(0);
    }
    input.addEventListener('input', update);
    input.addEventListener('focus', () => { if (input.value.trim()) update(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) update(); else if (items.length) setActive((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter') { if (items[active]) { e.preventDefault(); pick(items[active]); } }
      else if (e.key === 'Escape') { if (!list.hidden) { e.stopPropagation(); close(); } }
    });
    return { el: wrap, input };
  }

  let palette;
  function openPalette() {
    if (!palette) {
      const box = searchBox({ placeholder: 'Search tools, formats or tasks…', onPick: () => palette.close() });
      palette = h('dialog', { class: 'palette', 'aria-label': 'Search tools' },
        h('div', { class: 'palette-inner' }, box.el,
          h('p', { class: 'palette-hint' }, 'Try “compress”, “jpg to pdf” or “json”. Press Esc to close.')));
      palette.addEventListener('click', (e) => { if (e.target === palette) palette.close(); });
      palette._input = box.input;
      document.body.append(palette);
    }
    palette._input.value = '';
    palette.showModal();
    palette._input.focus();
  }
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable);
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openPalette(); }
  });

  /* =========================================================
     Layout: header, drawer, footer
     ========================================================= */
  function logoMark(size) {
    const s = size || 36;
    const wrap = h('span', { class: 'logo-mark', style: { width: s + 'px', height: s + 'px' } });
    wrap.innerHTML = '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" aria-hidden="true"><defs><linearGradient id="lgm" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6A4BF5"/><stop offset=".55" stop-color="#C026D3"/><stop offset="1" stop-color="#E11D63"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#lgm)"/><path d="M20 12h17l11 11v27a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="#fff"/><path d="M37 12v8a3 3 0 0 0 3 3h8" fill="none" stroke="url(#lgm)" stroke-width="3" stroke-linejoin="round"/><path d="M8 58 58 8" stroke="url(#lgm)" stroke-width="7" stroke-linecap="round"/><path d="M24 34h12M24 41h16" stroke="#C9C2F5" stroke-width="3" stroke-linecap="round"/></svg>';
    return wrap;
  }
  MAS.logoMark = logoMark;
  function brand(small) {
    return link('', { class: 'brand' + (small ? ' brand--small' : ''), 'aria-label': 'I HATE PDF, by MAS Studio — home' },
      logoMark(small ? 30 : 36),
      h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'I HATE PDF'), h('span', { class: 'brand-by' }, 'BY MAS STUDIO')));
  }

  const NAV = [['', 'Home'], ['tools', 'All tools'], ['pdf-tools', 'PDF'], ['image-tools', 'Images'], ['ai-tools', 'AI'], ['apps', 'MAS apps'], ['about', 'About']];
  function navItems() { return NAV.filter(([s]) => s !== 'ai-tools' || toolsIn('ai').length); }

  function buildHeader() {
    const header = $('#site-header');
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, h('ul', null, navItems().map(([s, label]) => h('li', null, link(s, { class: 'nav-link' }, label)))));
    const themeBtn = h('button', { class: 'icon-btn', id: 'theme-button', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    const themeMenu = h('div', { class: 'menu', id: 'theme-menu', hidden: true, role: 'group', 'aria-label': 'Theme' },
      [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'monitor']].map(([v, l, ic]) =>
        h('button', { type: 'button', class: 'menu-item', dataset: { themeChoice: v }, 'aria-pressed': 'false', onclick: () => { setTheme(v); closeMenu(); themeBtn.focus(); } }, icon(ic), l)));
    function closeMenu() { themeMenu.hidden = true; themeBtn.setAttribute('aria-expanded', 'false'); }
    themeBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = themeMenu.hidden; themeMenu.hidden = !open; themeBtn.setAttribute('aria-expanded', String(open)); if (open) themeMenu.querySelector('[aria-pressed="true"]') && themeMenu.querySelector('[aria-pressed="true"]').focus(); });
    document.addEventListener('click', (e) => { if (!themeMenu.hidden && !themeMenu.contains(e.target)) closeMenu(); });
    themeMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); themeBtn.focus(); } });
    const searchBtn = h('button', { class: 'search-trigger', type: 'button', onclick: openPalette, 'aria-label': 'Search tools' }, icon('search'), h('span', { class: 'search-trigger-text' }, 'Search tools'), h('kbd', null, '/'));
    const menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open menu', onclick: openDrawer }, icon('menu'));
    header.replaceChildren(h('div', { class: 'header-inner' }, brand(), nav,
      h('div', { class: 'header-actions' }, searchBtn, h('div', { class: 'menu-wrap' }, themeBtn, themeMenu), menuBtn)));
  }

  let drawer;
  function openDrawer() {
    if (!drawer) {
      drawer = h('dialog', { class: 'drawer', 'aria-label': 'Menu' });
      drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.close(); });
      document.body.append(drawer);
    }
    const cats = REG.categories.filter((c) => toolsIn(c.id).length);
    drawer.replaceChildren(h('div', { class: 'drawer-inner' },
      h('div', { class: 'drawer-head' }, brand(true), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close menu', onclick: () => drawer.close() }, icon('x'))),
      h('nav', { 'aria-label': 'Mobile' },
        h('ul', { class: 'drawer-list' }, [['', 'Home'], ['tools', 'All tools']].map(([s, l]) => h('li', null, link(s, null, l)))),
        h('p', { class: 'drawer-label' }, 'Categories'),
        h('ul', { class: 'drawer-list' }, cats.map((c) => h('li', null, link(c.slug, null, h('span', { class: 'chip-icon chip-icon--' + c.id }, icon(c.icon)), c.title, h('span', { class: 'count' }, String(toolsIn(c.id).length)))))),
        h('ul', { class: 'drawer-list' }, [['apps', 'MAS Studio apps'], ['upcoming', 'Upcoming Pro features'], ['roadmap', 'Roadmap'], ['about', 'About'], ['privacy', 'Privacy']].map(([s, l]) => h('li', null, link(s, null, l))))),
      themeSwitch()));
    drawer.showModal();
  }
  function closeDrawer() { if (drawer && drawer.open) drawer.close(); }

  function themeSwitch() {
    return h('div', { class: 'theme-switch', role: 'group', 'aria-label': 'Theme' },
      [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'monitor']].map(([v, l, ic]) =>
        h('button', { type: 'button', dataset: { themeChoice: v }, 'aria-pressed': String(storedTheme() === v), onclick: () => setTheme(v) }, icon(ic), h('span', null, l))));
  }

  function updateNav(slug) {
    const tool = toolsById.get(slug);
    const cat = tool ? catsById.get(tool.cat) : catsBySlug.get(slug);
    document.querySelectorAll('.nav-link').forEach((a) => {
      const s = a.dataset.route;
      const on = s === slug || (cat && s === cat.slug) || (s === 'tools' && !cat && slug === 'roadmap');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function buildFooter() {
    const cats = REG.categories.filter((c) => toolsIn(c.id).length);
    const featured = available().filter((t) => t.featured).slice(0, 6);
    const year = new Date().getFullYear();
    $('#site-footer').replaceChildren(h('div', { class: 'footer-inner' },
      h('div', { class: 'footer-brand' }, brand(true),
        h('p', null, 'Every file. Every tool. One powerful workspace.'),
        h('p', { class: 'muted small' }, 'Completely free. No sign-up, no watermarks, no ads. Local tools never upload your files.'),
        h('span', { class: 'sig-mark sig-mark--footer', role: 'img', 'aria-label': 'MAS Studio signature', style: { '-webkit-mask-image': 'url(' + MAS.asset('mas-signature.png') + ')', maskImage: 'url(' + MAS.asset('mas-signature.png') + ')' } })),
      h('nav', { class: 'footer-cols', 'aria-label': 'Footer' },
        h('div', null, h('h2', null, 'Product'), h('ul', null, [['tools', 'All tools'], ['upcoming', 'Upcoming Pro features'], ['roadmap', 'Roadmap'], ['about', 'About'], ['privacy', 'Privacy']].map(([s, l]) => h('li', null, link(s, null, l))))),
        h('div', null, h('h2', null, 'MAS Studio apps'), h('ul', null, REG.masApps.map((a) => h('li', null, h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.name))), h('li', null, h('a', { href: REG.masLinks.chess, target: '_blank', rel: 'noopener' }, 'Chess.MAS')))),
        h('div', null, h('h2', null, 'Categories'), h('ul', null, cats.slice(0, 7).map((c) => h('li', null, link(c.slug, null, c.title))))),
        h('div', null, h('h2', null, 'Popular'), h('ul', null, featured.map((t) => h('li', null, link(t.id, null, t.name))))),
        h('div', null, h('h2', null, 'Support'), h('ul', null,
          h('li', null, h('a', { href: 'https://github.com/Al-Shahriar-12/i-hate-pdf/issues', target: '_blank', rel: 'noopener' }, 'Report a bug')),
          h('li', null, h('a', { href: 'https://github.com/Al-Shahriar-12/i-hate-pdf/issues/new?title=Tool%20request%3A%20', target: '_blank', rel: 'noopener' }, 'Request a tool')),
          h('li', null, h('a', { href: 'https://www.youtube.com/channel/UCywFnnFoQ9N071noUAL_m8A', target: '_blank', rel: 'noopener' }, 'YouTube'))))),
      h('div', { class: 'footer-base' },
        h('p', null, '© ' + year + ' MAS Studio. Free for everyone. Version ' + CFG.version + '.'),
        h('div', { class: 'footer-theme' }, h('span', { class: 'small muted' }, 'Theme'), themeSwitch()))));
  }

  /* =========================================================
     Shared pieces
     ========================================================= */
  function toolCard(t, compact) {
    return link(t.id, { class: 'tool-card' + (compact ? ' tool-card--compact' : '') },
      h('span', { class: 'chip-icon chip-icon--' + t.cat }, icon(t.icon)),
      h('span', { class: 'tool-card-text' }, h('span', { class: 'tool-card-name' }, t.name), compact ? null : h('span', { class: 'tool-card-desc' }, t.desc)),
      t.where === 'ai' ? h('span', { class: 'badge badge--ai' }, 'AI') : null);
  }
  function section(cls, title, sub) {
    const s = h('section', { class: 'section ' + (cls || '') });
    if (title) s.append(h('div', { class: 'section-head' }, h('h2', null, title), sub ? h('p', { class: 'muted' }, sub) : null));
    return s;
  }
  function crumbs(items) {
    return h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('ol', null, items.map(([slug, label], i) =>
      h('li', null, i < items.length - 1 ? link(slug, null, label) : h('span', { 'aria-current': 'page' }, label)))));
  }

  /* =========================================================
     Pages
     ========================================================= */
  const SUGGEST = {
    pdf: ['merge-pdf', 'compress-pdf', 'organize-pdf', 'pdf-to-jpg', 'split-pdf', 'add-page-numbers', 'pdf-to-text', 'ai-document-assistant', 'add-watermark-pdf', 'remove-pdf-metadata'],
    jpeg: ['image-to-pdf', 'compress-image', 'resize-image', 'remove-image-metadata', 'jpg-to-png', 'rotate-image'],
    png: ['image-to-pdf', 'compress-image', 'png-to-jpg', 'resize-image', 'remove-image-metadata', 'image-to-base64'],
    webp: ['convert-image', 'image-to-pdf', 'compress-image', 'resize-image', 'remove-image-metadata'],
    gif: ['convert-image', 'image-to-pdf', 'resize-image'], bmp: ['convert-image', 'image-to-pdf'], avif: ['convert-image', 'image-to-pdf'],
    heic: ['convert-image', 'image-to-pdf'], svg: ['convert-image', 'image-to-base64'],
    zip: ['extract-zip', 'hash-generator'], text: ['text-to-pdf', 'json-formatter', 'word-counter'],
  };

  function smartDrop() {
    const result = h('div', { class: 'smart-result', 'aria-live': 'polite' });
    let held = [];
    const dz = dropzone({
      types: ['any'], multiple: true, big: true,
      title: 'Drop a file here', hint: 'We’ll show what you can do with it. Nothing is uploaded.',
      onFiles: async (files) => {
        held = files;
        const types = await Promise.all(files.map(classify));
        const first = types[0] || 'other';
        const same = types.every((t) => t === first);
        let ids = (SUGGEST[first] || ['create-zip', 'hash-generator']).slice();
        if (first === 'pdf' && files.length < 2) ids = ids.filter((i) => i !== 'merge-pdf');
        if (!same) ids = ['create-zip'];
        ids = ids.filter((i) => isAvailable(toolsById.get(i))).slice(0, 6);
        result.replaceChildren(
          h('p', { class: 'smart-file' }, icon('file-check'), h('span', null, files.length === 1 ? files[0].name : files.length + ' files', h('span', { class: 'muted' }, ', ' + Core.formatBytes(files.reduce((s, f) => s + f.size, 0))))),
          h('ul', { class: 'smart-list' }, ids.map((id) => {
            const t = toolsById.get(id);
            return h('li', null, h('button', { type: 'button', class: 'smart-option', onclick: () => go(id, { files: held }) },
              h('span', { class: 'chip-icon chip-icon--' + t.cat }, icon(t.icon)), h('span', null, t.name), icon('chevron-right', 'smart-chev')));
          })));
        announce(ids.length + ' tools suggested for ' + (files.length === 1 ? files[0].name : files.length + ' files'));
      },
    });
    return h('div', { class: 'smart' }, dz, result);
  }

  const WORKFLOWS = [
    { title: 'Prepare a report', steps: ['merge-pdf', 'add-page-numbers', 'compress-pdf'] },
    { title: 'Turn phone photos into one PDF', steps: ['image-to-pdf', 'compress-pdf'] },
    { title: 'Get photos under an upload limit', steps: ['resize-image', 'compress-image'] },
    { title: 'Share a draft safely', steps: ['organize-pdf', 'add-watermark-pdf', 'remove-pdf-metadata'] },
    { title: 'Summarize a long PDF', steps: ['ai-document-assistant'] },
  ];

  const GUIDES = [
    { q: 'How do I get a PDF under an email size limit?', a: ['Open Compress PDF and try Lossless first; it never changes how the document looks.', 'If the file is still too big and mostly scanned pages or photos, switch to Strong and start at 120 DPI. Text won’t be selectable afterwards, so keep the original.', 'Still too large? Split PDF can break it into parts you send separately.'] },
    { q: 'How do I remove location data from photos before sharing?', a: ['Open Remove photo metadata and add your JPG, PNG or WebP files.', 'The tool cuts out EXIF and XMP blocks, including GPS coordinates, without re-encoding the image.', 'If a phone photo then shows sideways, run Rotate or flip image on it.'] },
    { q: 'How do I combine scanned pages into one PDF?', a: ['Add the photos to Images to PDF and put them in order.', 'Choose A4 or Letter with a small margin for a document look.', 'Then use Compress PDF if the result is large, and Add page numbers if you need them.'] },
  ];

  function pageHome() {
    const el = h('div', { class: 'page page-home' });
    const sb = searchBox({ big: true, id: 'hero-search' });
    const examples = ['Compress PDF', 'Merge documents', 'JPG to PNG', 'JSON formatter', 'Remove photo metadata', 'Bengali digits'];
    const hero = h('section', { class: 'hero grid-bg grid-bg--fade' },
      h('div', { class: 'hero-copy' },
        h('h1', { class: 'hero-title' }, h('span', null, 'Every file.'), ' ', h('span', null, 'Every tool.'), ' ', h('span', null, 'One powerful workspace.')),
        h('p', { class: 'hero-sub' }, 'Convert, compress, sign, read and create with ' + available().length + ' free PDF, image, AI, Bengali and engineering tools, running right in your browser.'),
        sb.el,
        h('p', { class: 'hero-examples' }, h('span', { class: 'muted' }, 'Try '), examples.map((x, i) => [i ? ' ' : '', h('button', { type: 'button', class: 'link-btn', onclick: () => { sb.input.value = x; sb.input.dispatchEvent(new Event('input')); sb.input.focus(); } }, x)])),
        h('div', { class: 'hero-ctas' }, link('tools', { class: 'btn btn--cta' }, 'Explore all tools'), link('pdf-tools', { class: 'btn btn--ghost' }, 'Try PDF tools'))),
      h('div', { class: 'hero-drop' }, smartDrop()));

    const n = available().length;
    const facts = h('ul', { class: 'facts', 'aria-label': 'What to expect' },
      [['heart', 'Completely free', 'No sign-up, no watermarks, no ads.'],
        ['shield-check', 'Files stay on your device', 'Local tools never upload anything.'],
        ['info', 'Clear limits', 'Every tool states its size and file limits.'],
        ['wifi-off', 'Works offline', 'After the first visit, on GitHub Pages.'],
        ['layers', n + ' working tools', 'Counted from the live registry.']].map(([ic, a, b]) =>
        h('li', null, icon(ic), h('span', null, h('strong', null, a), h('span', { class: 'muted' }, b)))));

    const featured = section('featured', 'Featured tools', 'The most useful everyday tasks, all free.');
    featured.append(h('div', { class: 'grid grid--tools' }, available().filter((t) => t.featured).map((t) => toolCard(t))));

    const cats = section('cats', 'Browse by category');
    cats.append(h('div', { class: 'grid grid--cats' }, REG.categories.filter((c) => toolsIn(c.id).length).map((c) =>
      link(c.slug, { class: 'cat-card cat-card--' + c.id },
        h('span', { class: 'chip-icon chip-icon--lg chip-icon--' + c.id }, icon(c.icon)),
        h('span', { class: 'cat-card-name' }, c.title),
        h('span', { class: 'cat-card-blurb' }, c.blurb),
        h('span', { class: 'cat-card-count' }, toolsIn(c.id).length + (toolsIn(c.id).length === 1 ? ' tool' : ' tools'))))));
    const soon = REG.categories.filter((c) => !toolsIn(c.id).length);
    if (soon.length) cats.append(h('p', { class: 'muted small cats-soon' }, 'Coming in later phases: ' + soon.map((c) => c.title).join(', ') + '. ', link('roadmap', null, 'See the roadmap')));

    const flows = section('flows', 'Workflows', 'Each result offers the next step, and your file comes along.');
    flows.classList.add('grid-bg');
    flows.append(h('ul', { class: 'flows-list' }, WORKFLOWS.filter((w) => w.steps.every((s) => isAvailable(toolsById.get(s)))).map((w) =>
      h('li', { class: 'flow' },
        h('span', { class: 'flow-title' }, w.title),
        h('span', { class: 'flow-steps' }, w.steps.map((s, i) => [i ? icon('chevron-right', 'flow-sep') : null, h('span', { class: 'flow-step' }, toolsById.get(s).name)])),
        h('button', { type: 'button', class: 'btn btn--small', onclick: () => go(w.steps[0], { flow: { steps: w.steps, title: w.title } }) }, 'Start')))));

    const how = section('how', 'How it works');
    how.append(h('dl', { class: 'how-grid' },
      [['cloud-upload', 'Drag, drop or pick', 'Add files from your phone’s Files app or drag them onto any tool page.'],
        ['files', 'Batch where it helps', 'Convert, compress or clean many images and PDFs in one go, then save them as a ZIP.'],
        ['lock', 'Processed locally', 'PDF, image, text and developer tools run on your device using open-source engines.'],
        ['sparkles', 'AI only when you ask', CFG.ai ? 'The AI assistant clearly says when text leaves your device.' : 'AI tools need a secure server and arrive in a later phase.']].map(([ic, t, d]) =>
        h('div', null, h('dt', null, icon(ic), t), h('dd', null, d)))));

    const guides = section('guides', 'Guides');
    guides.append(h('div', { class: 'guides' }, GUIDES.map((g) => h('details', { class: 'guide' }, h('summary', null, g.q), h('ol', null, g.a.map((x) => h('li', null, x)))))));

    const support = section('support', 'Feedback and support');
    support.append(h('div', { class: 'support-row' },
      h('a', { class: 'support-link', href: 'https://github.com/Al-Shahriar-12/i-hate-pdf/issues', target: '_blank', rel: 'noopener' }, icon('github'), h('span', null, h('strong', null, 'Report a bug or request a tool'), h('span', { class: 'muted' }, 'Open an issue on GitHub.'))),
      h('a', { class: 'support-link', href: 'https://www.youtube.com/channel/UCywFnnFoQ9N071noUAL_m8A', target: '_blank', rel: 'noopener' }, icon('youtube'), h('span', null, h('strong', null, 'Watch tutorials'), h('span', { class: 'muted' }, 'MAS Studio on YouTube.')))));

    const free = h('section', { class: 'free-band hatch' }, h('div', { class: 'free-inner' },
      h('div', null, h('h2', null, 'Free for everyone. Really.'), h('p', null, 'Every tool on this site is free to use, with no account, no daily limits on tools, no watermarks on your files and no ads. Pro features are on the way, and today’s tools stay free.')),
      link('upcoming', { class: 'btn btn--ghost' }, icon('sparkle'), 'See upcoming Pro features')));
    el.append(hero, facts, free, featured, cats, masAppsSection(true), flows, how, guides, support);
    return { el, title: 'I HATE PDF — PDF, image and file tools that run in your browser', desc: 'Merge, split, compress and convert PDFs, images and more for free, right in your browser. No uploads, no account. By MAS Studio Production.' };
  }

  function pageTools() {
    const el = h('div', { class: 'page' });
    let filter = 'all', q = '';
    const grid = h('div');
    const input = h('input', { type: 'search', class: 'filter-input', placeholder: 'Filter tools', 'aria-label': 'Filter tools', oninput: (e) => { q = e.target.value; draw(); } });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Category' });
    const cats = REG.categories.filter((c) => toolsIn(c.id).length);
    function drawChips() {
      chips.replaceChildren(...[['all', 'All', available().length]].concat(cats.map((c) => [c.id, c.name, toolsIn(c.id).length])).map(([id, label, n]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === id), onclick: () => { filter = id; drawChips(); draw(); } }, label, h('span', { class: 'count' }, String(n)))));
    }
    function draw() {
      grid.replaceChildren();
      let list = q.trim() ? searchTools(q, 100) : available();
      if (filter !== 'all') list = list.filter((t) => t.cat === filter || t.also.includes(filter));
      if (!list.length) { grid.append(h('p', { class: 'empty' }, 'No tools match. ', link('roadmap', null, 'Check the roadmap'), ' to see what’s planned.')); return; }
      if (filter === 'all' && !q.trim()) {
        cats.forEach((c) => {
          const ts = available().filter((t) => t.cat === c.id);
          if (!ts.length) return;
          grid.append(h('h2', { class: 'group-title' }, h('span', { class: 'chip-icon chip-icon--' + c.id }, icon(c.icon)), c.title), h('div', { class: 'grid grid--tools' }, ts.map((t) => toolCard(t))));
        });
      } else grid.append(h('div', { class: 'grid grid--tools' }, list.map((t) => toolCard(t))));
    }
    drawChips(); draw();
    el.append(crumbs([['', 'Home'], ['tools', 'All tools']]),
      h('header', { class: 'page-head' }, h('h1', null, 'All tools'), h('p', { class: 'muted' }, available().length + ' working tools today. ' + REG.roadmap.length + ' more are planned and listed on the ', link('roadmap', null, 'roadmap'), '.')),
      h('div', { class: 'filters' }, input, chips), grid);
    return { el, title: 'All tools | I HATE PDF', desc: 'Every working PDF, image, developer, text and file tool in I HATE PDF, by category.' };
  }

  function pageCategory(c) {
    const el = h('div', { class: 'page' });
    const ts = toolsIn(c.id);
    const planned = plannedIn(c.id);
    el.append(crumbs([['', 'Home'], ['tools', 'All tools'], [c.slug, c.title]]),
      h('header', { class: 'page-head page-head--cat' }, h('span', { class: 'chip-icon chip-icon--lg chip-icon--' + c.id }, icon(c.icon)),
        h('div', null, h('h1', null, c.title), h('p', { class: 'muted' }, c.blurb))),
      ts.length ? h('div', { class: 'grid grid--tools' }, ts.map((t) => toolCard(t))) : h('p', { class: 'empty' }, c.id === 'ai'
        ? 'AI tools need a server that keeps API keys private, so they aren’t available on this static deployment yet.'
        : 'No tools in this category yet.'),
      planned.length ? h('details', { class: 'planned' }, h('summary', null, planned.length + ' planned tools'), h('ul', { class: 'planned-list' }, planned.map((p) => h('li', null, p.name)))) : null);
    return { el, title: c.title + ' | I HATE PDF', desc: c.blurb + ' Free, private and in your browser.' };
  }

  function pageRoadmap() {
    const el = h('div', { class: 'page page-narrow' });
    el.append(crumbs([['', 'Home'], ['tools', 'All tools'], ['roadmap', 'Roadmap']]),
      h('header', { class: 'page-head' }, h('h1', null, 'Roadmap'), h('p', { class: 'muted' }, 'These tools are planned, not built. They appear here so you know what’s coming, and they’re never shown as working until they are.')),
      h('ol', { class: 'phases' },
        h('li', null, h('strong', null, 'Done: v1.0 and v1.1. '), 'Core app and ' + available().length + ' free tools, including OCR, Sign PDF, password protection, Bijoy to Unicode, engineering calculators and AI with your choice of provider.'),
        h('li', null, h('strong', null, 'Next. '), 'Bengali fonts inside PDFs, Unicode to Bijoy, more image editing. See ', link('upcoming', null, 'Upcoming Pro features'), '.'),
        h('li', null, h('strong', null, 'Phase 3. '), 'Secure server for Office conversions (Word, Excel, PowerPoint) with sandboxed LibreOffice.'),
        h('li', null, h('strong', null, 'Phase 4. '), 'Multi-document AI and a public API.')));
    REG.categories.forEach((c) => {
      const p = plannedIn(c.id);
      if (!p.length) return;
      el.append(h('section', { class: 'roadmap-group' }, h('h2', null, h('span', { class: 'chip-icon chip-icon--' + c.id }, icon(c.icon)), c.title, h('span', { class: 'count' }, String(p.length))),
        h('ul', { class: 'planned-list' }, p.map((x) => h('li', null, x.name)))));
    });
    return { el, title: 'Roadmap | I HATE PDF', desc: 'Planned tools and phases for I HATE PDF by MAS Studio Production.' };
  }


  /* =========================================================
     MAS Studio apps, upcoming Pro features
     ========================================================= */
  const SHARE_TEXT = 'Dear well-wishers,\nThese free web apps by MAS Studio solve beam, frame and truss problems, some of the most asked questions in civil engineering. Frame, truss and beam, all in one!\n\n' +
    REG.masApps.map((a, i) => (i + 1) + '. ' + a.name + ' (' + a.what + '): ' + a.url).join('\n') +
    '\n\nHow to use: ' + REG.masLinks.howTo + '\nIt’s completely free and works offline too. Please check it out and share it with your friends and juniors.\n\nTired of solving problems? Play Chess.MAS: ' + REG.masLinks.chess + '\n\nRegards with thanks,\nAl Shahriar';
  async function shareApps() {
    if (navigator.share) {
      try { await navigator.share({ title: 'MAS Studio engineering apps', text: SHARE_TEXT }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copyText(SHARE_TEXT);
  }
  function masAppsSection(compact) {
    const s = h('section', { class: 'section mas-apps' + (compact ? '' : ' mas-apps--page') });
    s.append(h('div', { class: 'mas-apps-panel blueprint' },
      h('div', { class: 'mas-apps-head' },
        h('h2', null, 'Engineering apps by MAS Studio'),
        h('p', null, 'Beam, frame and truss problems are some of the most asked questions in civil engineering. These free web apps solve them: frame, truss and beam, all in one place. They work offline too.')),
      h('ul', { class: 'mas-app-list' }, REG.masApps.map((a) => h('li', null,
        h('a', { class: 'mas-app', href: a.url, target: '_blank', rel: 'noopener' },
          h('span', { class: 'mas-app-icon' }, icon('building-2')),
          h('span', { class: 'mas-app-text' }, h('strong', null, a.name), h('span', null, a.what)),
          icon('external-link', 'mas-app-ext'))))),
      h('div', { class: 'mas-apps-actions' },
        h('a', { class: 'btn btn--cta', href: REG.masLinks.howTo, target: '_blank', rel: 'noopener' }, icon('play'), 'Watch how to use them'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: shareApps }, icon('share-2'), 'Share with friends and juniors'))));
    s.append(h('a', { class: 'chess-card hatch', href: REG.masLinks.chess, target: '_blank', rel: 'noopener' },
      h('span', { class: 'chess-icon' }, icon('crown')),
      h('span', null, h('strong', null, 'Tired of solving problems? Take a break.'), h('span', { class: 'muted' }, 'Play Chess.MAS against a fast bot with a real clock, free and offline.')),
      icon('chevron-right', 'smart-chev')));
    return s;
  }

  function pageApps() {
    const el = h('div', { class: 'page' });
    el.append(crumbs([['', 'Home'], ['apps', 'MAS Studio apps']]),
      h('header', { class: 'page-head' }, h('h1', null, 'MAS Studio apps'), h('p', { class: 'muted' }, 'Free apps for civil engineering students and engineers, plus a game for the breaks in between.')),
      masAppsSection(false),
      h('section', { class: 'section note-card' }, h('h2', null, 'A note from the developer'),
        h('blockquote', { class: 'note' }, SHARE_TEXT.split('\n\n').map((para) => h('p', null, para.split('\n').map((line, i) => [i ? h('br') : null, line]))))));
    return { el, title: 'MAS Studio apps: Flexure MAS, Frame MAS, BNBC Frame MAS, Beam-Frame MAS, Truss MAS | I HATE PDF', desc: 'Free beam, frame and truss analysis web apps by MAS Studio, plus Chess.MAS. They work offline too.' };
  }

  function pageUpcoming() {
    const el = h('div', { class: 'page page-narrow' });
    const groups = {};
    REG.upcoming.forEach((u) => { (groups[u.v] = groups[u.v] || []).push(u); });
    el.append(crumbs([['', 'Home'], ['upcoming', 'Upcoming Pro features']]),
      h('header', { class: 'page-head' }, h('h1', null, 'Upcoming Pro features'),
        h('p', { class: 'muted' }, 'Everything you can use today is free. These Pro features are planned for upcoming versions. They aren’t built yet, so they’re listed here and never shown as working tools.')),
      h('ol', { class: 'pro-list' }, Object.keys(groups).map((v) => h('li', { class: 'pro-group' },
        h('h2', { class: 'pro-version' }, h('span', { class: 'pro-badge' }, 'Pro'), v),
        h('ul', null, groups[v].map((u) => h('li', { class: 'pro-item' }, h('strong', null, u.title), h('span', { class: 'muted' }, u.text))))))),
      h('p', { class: 'muted small' }, 'Want something sooner? ', h('a', { href: 'https://github.com/Al-Shahriar-12/i-hate-pdf/issues/new?title=Feature%20request%3A%20', target: '_blank', rel: 'noopener' }, 'Request it on GitHub'), '.'));
    return { el, title: 'Upcoming Pro features | I HATE PDF', desc: 'Pro features planned for upcoming versions of I HATE PDF by MAS Studio. Everything available today is free.' };
  }

  /** Live calculator helper: renders option fields and a result area that updates as you type. */
  function formTool(root, fields, compute, o) {
    o = o || {};
    const opts = defaults(fields);
    Object.assign(opts, o.initial || {});
    const optsBox = h('div', { class: 'ws-options ws-options--flat' });
    const out = h('div', { class: 'calc-out', 'aria-live': 'polite' });
    function update() {
      let r;
      try { r = compute(opts); } catch (e) { r = h('p', { class: 'text-msg is-error' }, userMessage(e)); }
      out.replaceChildren();
      if (r) append(out, r);
    }
    const onOpt = (f, re) => { if (re) renderOptions(optsBox, fields, opts, onOpt); update(); };
    renderOptions(optsBox, fields, opts, onOpt);
    root.append(optsBox, out);
    if (o.after) root.append(o.after);
    update();
    return { opts, update, redraw: () => renderOptions(optsBox, fields, opts, onOpt) };
  }
  MAS.formTool = formTool;
  /** Result rows: [[label, value, copyable?], ...] */
  MAS.resultRows = function (rows, cls) {
    return h('dl', { class: 'kv ' + (cls || '') }, rows.filter(Boolean).map(([k, v, copy]) => h('div', { class: 'kv-row' }, h('dt', null, k), h('dd', null,
      h('span', { class: 'kv-val' }, v),
      copy ? h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'Copy ' + k, onclick: () => copyText(String(copy === true ? v : copy)) }, icon('copy')) : null))));
  };

  function pageAbout() {
    const el = h('div', { class: 'page page-narrow prose' });
    const sig = (cls) => h('span', { class: 'sig-mark ' + (cls || ''), role: 'img', 'aria-label': 'MAS Studio signature', style: { '-webkit-mask-image': 'url(' + MAS.asset('mas-signature.png') + ')', maskImage: 'url(' + MAS.asset('mas-signature.png') + ')' } });
    el.append(crumbs([['', 'Home'], ['about', 'About']]),
      h('header', { class: 'page-head' }, h('h1', null, 'About'), h('p', { class: 'muted' }, 'I HATE PDF is built and maintained by MAS Studio, and it’s free for everyone.')),
      h('section', { class: 'about-hero hatch' },
        h('img', { class: 'about-photo', src: MAS.asset('mas-portrait.jpg'), alt: 'Portrait of the developer', width: '160', height: '160', loading: 'lazy', decoding: 'async' }),
        h('div', { class: 'about-id' },
          h('h2', null, 'MD Al Shahriar'),
          h('p', null, 'BSc in Civil Engineering, BUET'),
          h('p', null, 'Founder of MAS Studio (Mohammad Al Shahriar Studio)'),
          sig(),
          h('ul', { class: 'about-links' },
            h('li', null, h('a', { href: REG.masLinks.github, target: '_blank', rel: 'noopener' }, icon('github'), 'GitHub: Al-Shahriar-12')),
            h('li', null, h('a', { href: REG.masLinks.youtube, target: '_blank', rel: 'noopener' }, icon('youtube'), 'YouTube channel'))))),
      h('figure', { class: 'about-wide' }, h('img', { src: MAS.asset('mas-wall.jpg'), alt: 'The developer in front of a red brick wall with a painted Bengali logo', loading: 'lazy', decoding: 'async' })),
      h('h2', null, 'Apps by MAS Studio'),
      h('ul', { class: 'app-links' }, REG.masApps.map((a) => h('li', null, h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.name), ': ' + a.what + '.')),
        h('li', null, h('a', { href: REG.masLinks.chess, target: '_blank', rel: 'noopener' }, 'Chess.MAS'), ': the game section, for when you’re tired of solving problems.'),
        h('li', null, h('a', { href: REG.masLinks.howTo, target: '_blank', rel: 'noopener' }, 'How to use the engineering apps'), ' (video).')),
      h('h2', null, 'How this app works'),
      h('p', null, 'Local tools load open-source engines into your browser and process files in memory on your device. Nothing is uploaded, and closing the tab clears everything. AI tools use the provider you pick; the on-device model never sends anything anywhere.'),
      h('h2', null, 'Open-source components'),
      h('ul', { class: 'credits' },
        [['pdf-lib (@cantoo fork)', 'MIT', 'creating, editing and encrypting PDFs'], ['PDF.js', 'Apache 2.0', 'rendering pages and reading text'], ['Tesseract.js', 'Apache 2.0', 'OCR in English and Bengali'],
          ['WebLLM', 'Apache 2.0', 'the on-device AI model'], ['React', 'MIT', 'the AI studio and Sign PDF'], ['bijoy2unicode', 'MIT', 'Bijoy to Unicode'],
          ['JSZip', 'MIT', 'ZIP archives'], ['js-yaml, marked, jsdiff, JsBarcode, qrcode-generator', 'MIT/BSD', 'developer and design tools'], ['DOMPurify', 'Apache 2.0', 'safe Markdown previews'],
          ['Lucide', 'ISC', 'icons'], ['Inter, Manrope, Noto Sans Bengali, Dancing Script', 'SIL Open Font License', 'typefaces']].map(([n, l, u]) =>
          h('li', null, h('strong', null, n), ' (' + l + ') for ' + u + '.'))),
      h('p', { class: 'muted small' }, 'Version ' + CFG.version + '. Full licence texts ship with the source in THIRD_PARTY_LICENSES.txt.'));
    return { el, title: 'About | I HATE PDF', desc: 'I HATE PDF is built by MAS Studio, the studio of MD Al Shahriar (BSc Civil Engineering, BUET). Free for everyone.' };
  }

  function pagePrivacy() {
    const el = h('div', { class: 'page page-narrow prose' });
    const cdn = CFG.mode === 'hash';
    el.append(crumbs([['', 'Home'], ['privacy', 'Privacy']]),
      h('header', { class: 'page-head' }, h('h1', null, 'Privacy'), h('p', { class: 'muted' }, 'A plain-language description of what happens to your data.')),
      h('h2', null, 'Files you add'),
      h('p', null, 'Every tool marked “Runs in your browser” reads files into your device’s memory and processes them there. They aren’t uploaded to any server. Results exist only in this tab until you save them.'),
      h('h2', null, 'AI tools'),
      h('p', null, 'You choose the AI. The on-device model runs in your browser and sends nothing anywhere. With an online provider (such as Gemini, Groq, OpenRouter, OpenAI or Anthropic), your text goes directly from your browser to that provider, using your own API key, and is covered by their privacy terms. It never passes through a MAS Studio server. API keys are kept only in your browser, and only if you tick “Remember”.'),
      h('h2', null, 'Stored on your device'),
      h('p', null, 'Your theme choice is saved in your browser’s local storage.' + (cdn ? '' : ' A service worker caches the app’s own files so it opens quickly and works offline.')),
      h('h2', null, 'Third parties'),
      h('p', null, cdn
        ? 'In this hosted version, the open-source processing libraries load from a public CDN (cdnjs or jsDelivr) and fonts load from Google Fonts. Those services see a normal web request, never your files.'
        : 'Fonts and libraries are served from this site. There are no analytics, ads, trackers or cookies.'),
      h('h2', null, 'Contact'),
      h('p', null, 'Questions or concerns: open an issue on ', h('a', { href: 'https://github.com/Al-Shahriar-12/i-hate-pdf/issues', target: '_blank', rel: 'noopener' }, 'GitHub'), '.'));
    return { el, title: 'Privacy | I HATE PDF', desc: 'How I HATE PDF handles your files: local processing, no uploads, no tracking.' };
  }

  function pageNotFound() {
    const el = h('div', { class: 'page page-narrow' });
    const sb = searchBox({ big: true });
    el.append(h('header', { class: 'page-head' }, h('h1', null, 'Page not found'), h('p', { class: 'muted' }, 'This address doesn’t match a page or tool. Search for the tool you need instead.')), sb.el,
      h('p', null, link('', { class: 'btn btn--ghost' }, 'Go to the home page')));
    return { el, title: 'Page not found | I HATE PDF', desc: 'The page you were looking for doesn’t exist.' };
  }

  /* =========================================================
     Tool page
     ========================================================= */
  const TYPE_LABEL = { pdf: 'PDF', jpeg: 'JPG', png: 'PNG', webp: 'WebP', gif: 'GIF', bmp: 'BMP', avif: 'AVIF', heic: 'HEIC', svg: 'SVG', zip: 'ZIP', text: 'TXT, JSON, MD, CSV', tiff: 'TIFF', any: 'Any file' };
  const ACCEPT_ATTR = { pdf: '.pdf,application/pdf', jpeg: '.jpg,.jpeg,image/jpeg', png: '.png,image/png', webp: '.webp,image/webp', gif: '.gif,image/gif', bmp: '.bmp,image/bmp', avif: '.avif,image/avif', heic: '.heic,.heif,image/heic,image/heif', svg: '.svg,image/svg+xml', zip: '.zip,application/zip', text: '.txt,.json,.md,.csv,.log,.xml,.html,text/plain,application/json' };
  MAS.TYPE_LABEL = TYPE_LABEL;

  function pageTool(t) {
    const el = h('div', { class: 'page page-tool' });
    const cat = catsById.get(t.cat);
    const impl = MAS.impl[t.impl || t.id];
    const avail = isAvailable(t);
    const local = t.where === 'local';
    const accepts = (impl && impl.acceptsLabel) || (t.accepts.length ? t.accepts.map((x) => TYPE_LABEL[x] || x.toUpperCase()).join(', ') : null);
    const limits = impl && impl.limits ? impl.limits : impl ? limitLines(impl) : [];
    const head = h('header', { class: 'tool-head' },
      h('span', { class: 'chip-icon chip-icon--lg chip-icon--' + t.cat }, icon(t.icon)),
      h('div', { class: 'tool-head-text' },
        h('h1', null, t.name),
        h('p', { class: 'tool-desc' }, t.desc),
        h('ul', { class: 'tool-badges' },
          h('li', { class: 'badge badge--free' }, icon('gift'), 'Free'),
          h('li', { class: 'badge ' + (local ? 'badge--local' : 'badge--ai') }, icon(local ? 'shield-check' : 'sparkles'), local ? 'Runs in your browser' : 'You choose the AI'),
          accepts ? h('li', { class: 'badge' }, icon('file-type'), accepts) : null)));

    const workspace = h('section', { class: 'workspace', 'aria-label': t.name });
    let dispose = null;
    if (!avail) {
      workspace.append(h('div', { class: 'notice notice--info' }, icon('info'), h('div', null,
        h('strong', null, t.requires ? 'Not available in this view' : 'Coming soon'),
        h('p', null, t.requires === 'ocr' ? 'OCR loads its engine and language data from the site itself, which this preview can’t do. It works on the free GitHub Pages version of I HATE PDF, offline too.' : t.requires === 'python' ? 'Python runs on an engine that loads from the site itself, which this preview can’t do. It works on the free GitHub Pages version, offline too.' : t.requires ? 'This tool needs features this view doesn’t allow. It works on the GitHub Pages version.' : 'This tool is planned and not yet built.'),
        t.requires ? h('a', { class: 'btn btn--cta btn--small', href: 'https://al-shahriar-12.github.io/i-hate-pdf/' + t.id + '.html', target: '_blank', rel: 'noopener' }, icon('external-link'), 'Open the full version') : null)));
    } else {
      try {
        const kind = impl.kind || t.kind || 'file';
        const ctx = { tool: t, impl };
        dispose = kind === 'text' ? mountTextTool(workspace, t, impl) : kind === 'custom' ? impl.mount(workspace, ctx) : mountFileTool(workspace, t, impl);
      } catch (e) {
        console.error(e);
        workspace.append(h('div', { class: 'notice notice--error' }, icon('circle-alert'), h('p', null, 'This tool failed to start. Reload the page and try again.')));
      }
    }

    const faq = t.faq.slice();
    if (local) faq.unshift(REG.LOCAL_FAQ);
    const related = (t.related || []).map((id) => toolsById.get(id)).filter(isAvailable);
    const aside = h('aside', { class: 'tool-side' },
      t.how.length ? h('section', { class: 'side-block' }, h('h2', null, 'How to use it'), h('ol', { class: 'steps' }, t.how.map((s) => h('li', null, s)))) : null,
      limits.length ? h('section', { class: 'side-block' }, h('h2', null, 'Limits'), h('ul', { class: 'limits' }, limits.map((l) => h('li', null, l)))) : null,
      faq.length ? h('section', { class: 'side-block' }, h('h2', null, 'Questions'), faq.map(([q, a]) => h('details', { class: 'faq' }, h('summary', null, q), h('p', null, a)))) : null,
      related.length ? h('section', { class: 'side-block' }, h('h2', null, 'Related tools'), h('div', { class: 'related' }, related.map((r) => toolCard(r, true)))) : null);

    el.append(crumbs([['', 'Home'], [cat.slug, cat.title], [t.id, t.name]]), head, h('div', { class: 'tool-layout' }, workspace, aside));
    return { el, dispose, title: t.name + ' — free and private, in your browser | I HATE PDF', desc: t.desc + ' Free, no sign-up' + (local ? ', and your files never leave your device.' : '.') };
  }

  function limitLines(impl) {
    const out = [];
    if ((impl.kind || 'file') !== 'file') return out;
    if (impl.input === 'text') { out.push('Up to ' + (impl.maxChars || 500000).toLocaleString() + ' characters.'); return out; }
    const max = impl.max || (impl.multiple ? 50 : 1);
    out.push(max === 1 ? 'One file at a time.' : (impl.min > 1 ? impl.min + ' to ' : 'Up to ') + max + ' files.');
    out.push('Up to ' + (impl.maxMB || 100) + ' MB per file' + (impl.multiple ? ', ' + (impl.totalMB || 300) + ' MB in total.' : '.'));
    if (impl.limitNote) out.push(impl.limitNote);
    return out;
  }

  /* =========================================================
     Dropzone
     ========================================================= */
  function acceptAttr(types) {
    if (!types || types.includes('any')) return null;
    return types.map((t) => ACCEPT_ATTR[t]).filter(Boolean).join(',');
  }
  function dropzone(o) {
    const input = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', multiple: !!o.multiple, accept: acceptAttr(o.types) });
    input.addEventListener('change', () => { const f = Array.from(input.files || []); input.value = ''; if (f.length) o.onFiles(f); });
    const btn = h('button', { type: 'button', class: 'btn btn--cta' + (o.big ? '' : ' btn--small'), onclick: (e) => { e.stopPropagation(); input.click(); } }, icon('plus'), o.button || (o.multiple ? 'Choose files' : 'Choose a file'));
    const zone = h('div', { class: 'drop' + (o.big ? ' drop--big' : '') + (o.compact ? ' drop--compact' : '') },
      o.compact ? null : h('span', { class: 'drop-icon' }, icon('cloud-upload')),
      o.compact ? null : h('span', { class: 'drop-title' }, o.title || (o.multiple ? 'Drop files here' : 'Drop a file here')),
      o.compact ? null : h('span', { class: 'drop-hint' }, o.hint || ''),
      btn, input);
    zone.addEventListener('click', (e) => { if (e.target === zone || (!e.target.closest('button') && zone.contains(e.target))) input.click(); });
    let depth = 0;
    zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('is-over'); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('is-over'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); depth = 0; zone.classList.remove('is-over');
      const f = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (f.length) o.onFiles(o.multiple ? f : f.slice(0, 1));
    });
    zone.open = () => input.click();
    return zone;
  }
  MAS.dropzone = dropzone;

  // Dropping files anywhere on a tool page goes to that tool; elsewhere the browser must not navigate away.
  let pageDropTarget = null;
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (f.length && pageDropTarget) pageDropTarget(f);
  });

  async function classify(file) {
    let head;
    try { head = new Uint8Array(await file.slice(0, 1100).arrayBuffer()); } catch (e) { return null; }
    const t = Core.sniffType(head);
    if (t === 'text' || t === null) {
      if (/\.(txt|json|md|markdown|csv|log|xml|html?|ya?ml|js|css)$/i.test(file.name) && t === 'text') return 'text';
      if (/\.(heic|heif)$/i.test(file.name) && t === null) return 'heic';
    }
    return t;
  }
  MAS.classify = classify;

  /* =========================================================
     File tool engine
     ========================================================= */
  function defaults(fields, tool) {
    const o = {};
    (fields || []).forEach((f) => { o[f.id] = f.default; });
    if (tool && tool.preset) Object.assign(o, tool.preset);
    return o;
  }
  function fieldsOf(impl, tool) { return typeof impl.options === 'function' ? impl.options(tool) : (impl.options || []); }

  function renderOptions(container, fields, opts, onChange) {
    container.replaceChildren();
    const visible = fields.filter((f) => !f.showIf || f.showIf(opts));
    if (!visible.length) { container.hidden = true; return; }
    container.hidden = false;
    const grid = h('div', { class: 'opts' });
    visible.forEach((f) => {
      const id = 'opt-' + f.id;
      const helpId = f.help ? id + '-help' : null;
      let control;
      const set = (v, rerender) => { opts[f.id] = v; onChange(f, rerender); };
      if (f.type === 'segmented') {
        control = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': id + '-label' }, f.options.map(([v, l]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(opts[f.id] === v), class: 'seg-btn', onclick: () => { set(v, true); } }, l)));
        control.addEventListener('keydown', (e) => {
          if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
          e.preventDefault();
          const i = f.options.findIndex(([v]) => v === opts[f.id]);
          const n = (i + (/Right|Down/.test(e.key) ? 1 : -1) + f.options.length) % f.options.length;
          set(f.options[n][0], true);
          setTimeout(() => { const b = container.querySelector('#' + id + '-label') && container.querySelector('#' + id + '-label').parentNode.querySelectorAll('.seg-btn')[n]; if (b) b.focus(); }, 0);
        });
      } else if (f.type === 'select') {
        control = h('select', { id, class: 'input', 'aria-describedby': helpId, onchange: (e) => set(e.target.value, true) }, f.options.map(([v, l]) => h('option', { value: v, selected: opts[f.id] === v ? true : null }, l)));
      } else if (f.type === 'checkbox') {
        control = h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: !!opts[f.id], 'aria-describedby': helpId, onchange: (e) => set(e.target.checked, true) }), h('span', null, f.checkLabel || f.label));
      } else if (f.type === 'range') {
        const out = h('output', { for: id, class: 'range-val' }, f.format ? f.format(opts[f.id]) : String(opts[f.id]));
        control = h('div', { class: 'range' }, h('input', { type: 'range', id, min: f.min, max: f.max, step: f.step || 1, value: opts[f.id], 'aria-describedby': helpId,
          oninput: (e) => { const v = Number(e.target.value); opts[f.id] = v; out.textContent = f.format ? f.format(v) : String(v); onChange(f, false); } }), out);
      } else if (f.type === 'color') {
        control = h('div', { class: 'color' }, h('input', { type: 'color', id, value: opts[f.id], 'aria-describedby': helpId, oninput: (e) => set(e.target.value, false) }), h('code', null, opts[f.id]));
        control.querySelector('input').addEventListener('input', (e) => { control.querySelector('code').textContent = e.target.value; });
      } else if (f.type === 'textarea') {
        control = h('textarea', { id, class: 'input', rows: f.rows || 3, placeholder: f.placeholder || '', 'aria-describedby': helpId, oninput: (e) => set(e.target.value, false) });
        control.value = opts[f.id] || '';
      } else {
        control = h('input', { id, class: 'input' + (f.type === 'number' ? ' input--num' : ''), type: f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : f.type === 'date' ? 'date' : 'text', inputmode: f.type === 'number' ? 'decimal' : null, step: f.type === 'number' ? (f.step || 'any') : null,
          min: f.min, max: f.max, placeholder: f.placeholder || '', value: opts[f.id] == null ? '' : opts[f.id], 'aria-describedby': helpId, autocomplete: f.type === 'password' ? 'new-password' : 'off',
          oninput: (e) => set(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value, false) });
      }
      const label = f.type === 'checkbox' ? null : h(f.type === 'segmented' ? 'span' : 'label', { class: 'opt-label', id: id + '-label', for: f.type === 'segmented' ? null : id }, f.label);
      grid.append(h('div', { class: 'opt' + (f.wide ? ' opt--wide' : '') }, label, control, f.help ? h('p', { class: 'opt-help', id: helpId }, typeof f.help === 'function' ? f.help(opts) : f.help) : null));
    });
    container.append(grid);
  }
  MAS.renderOptions = renderOptions;

  function progressView(onCancel) {
    const bar = h('div', { class: 'progress-bar' });
    const track = h('div', { class: 'progress is-indeterminate', role: 'progressbar', 'aria-label': 'Progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
    const label = h('p', { class: 'progress-label' }, 'Working…');
    const cancel = onCancel ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: onCancel }, icon('circle-stop'), 'Cancel') : null;
    const el = h('div', { class: 'progress-wrap' }, h('div', { class: 'progress-row' }, label, cancel), track);
    let pending = null, raf = 0;
    function set(frac, text) {
      pending = { frac, text };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const p = pending;
        if (p.text) label.textContent = p.text;
        if (p.frac == null) { track.classList.add('is-indeterminate'); track.removeAttribute('aria-valuenow'); bar.style.width = ''; }
        else {
          const pct = Math.max(0, Math.min(100, Math.round(p.frac * 100)));
          track.classList.remove('is-indeterminate');
          track.setAttribute('aria-valuenow', String(pct));
          bar.style.width = pct + '%';
        }
      });
    }
    return { el, set };
  }
  MAS.progressView = progressView;

  function kindOf(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (/^(jpe?g|png|webp|gif|avif|bmp)$/.test(ext)) return 'image';
    if (ext === 'svg') return 'svg';
    if (ext === 'zip') return 'zip';
    if (/^(txt|json|md|csv)$/.test(ext)) return 'text';
    return 'file';
  }
  const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml', zip: 'application/zip', txt: 'text/plain', json: 'application/json', md: 'text/markdown', csv: 'text/csv' };
  function makeOutput(data, name, extra) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
    return Object.assign({ name, blob, kind: kindOf(name), size: blob.size }, extra || {});
  }
  MAS.makeOutput = makeOutput;

  async function zipOutputs(outputs, name) {
    const JSZip = await MAS.lib('jszip');
    const zip = new JSZip();
    const used = new Set();
    outputs.forEach((o) => {
      let n = o.name, k = 2;
      while (used.has(n)) { n = Core.baseName(o.name) + ' (' + (k++) + ').' + o.name.split('.').pop(); }
      used.add(n);
      zip.file(n, o.blob, { compression: /\.(pdf|jpe?g|png|webp|zip|avif|gif)$/i.test(n) ? 'STORE' : 'DEFLATE' });
    });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }
  MAS.zipOutputs = zipOutputs;

  /** Renders a result panel. opts: {title, summary[], outputs[], next[], onReset, onAgain, noBundle, toolId} */
  function resultView(o) {
    const el = h('div', { class: 'result', tabindex: '-1' });
    const outputs = o.outputs || [];
    el.append(h('div', { class: 'result-head' }, h('span', { class: 'result-icon' }, icon('circle-check')),
      h('div', null, h('h2', null, o.title || (outputs.length === 1 ? 'Your file is ready' : 'Your files are ready')),
        (o.summary || []).map((s) => h('p', { class: 'result-summary' }, s)))));
    const list = h('ul', { class: 'outputs' });
    outputs.forEach((out) => {
      if (out.node) { list.append(h('li', { class: 'output output--node' }, out.node)); return; }
      if (out.text != null) {
        const ta = h('textarea', { class: 'input input--mono output-text', readonly: true, rows: 10, 'aria-label': out.name });
        ta.value = out.text;
        list.append(h('li', { class: 'output output--text' }, ta, h('div', { class: 'output-actions' },
          h('button', { type: 'button', class: 'btn btn--cta btn--small', onclick: () => copyText(out.text) }, icon('copy'), 'Copy'),
          h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => save(out.blob, out.name) }, icon('download'), 'Download .' + out.name.split('.').pop()))));
        return;
      }
      let thumb;
      if (out.kind === 'image' && outputs.length <= 60) thumb = h('img', { class: 'output-thumb', src: MAS.url(out.blob), alt: '', loading: 'lazy', decoding: 'async' });
      else thumb = h('span', { class: 'output-thumb output-thumb--icon' }, icon(out.kind === 'pdf' ? 'file-text' : out.kind === 'zip' ? 'archive' : out.kind === 'image' ? 'image' : 'file-check'));
      list.append(h('li', { class: 'output' }, thumb,
        h('div', { class: 'output-text-col' }, h('span', { class: 'output-name' }, out.name), h('span', { class: 'output-meta' }, Core.formatBytes(out.size), out.note ? h('span', { class: 'output-note' + (out.warn ? ' is-warn' : '') }, out.note) : null)),
        h('button', { type: 'button', class: 'btn btn--cta btn--small', onclick: () => save(out.blob, out.name), 'aria-label': 'Download ' + out.name }, icon('download'), h('span', { class: 'hide-xs' }, 'Download'))));
    });
    el.append(list);
    const fileOuts = outputs.filter((x) => x.text == null && !x.node);
    if (fileOuts.length > 1 && !o.noBundle) {
      el.append(h('div', { class: 'result-bundle' }, h('button', { type: 'button', class: 'btn btn--cta', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; const old = b.lastChild.textContent; b.lastChild.textContent = 'Preparing ZIP…';
        try { const z = await zipOutputs(fileOuts, o.bundleName || 'i-hate-pdf-results.zip'); await save(z, o.bundleName || 'i-hate-pdf-results.zip'); }
        catch (err) { toast('The ZIP couldn’t be created.', 'error'); }
        finally { b.disabled = false; b.lastChild.textContent = old; }
      } }, icon('archive'), h('span', null, 'Download all as ZIP'))));
    }
    // Continue with: carry outputs into the next tool
    const single = fileOuts.length >= 1 && fileOuts.every((x) => x.kind === fileOuts[0].kind) ? fileOuts[0].kind : null;
    const typeFor = { pdf: 'pdf', image: null, zip: 'zip' };
    if (single && o.toolId) {
      let ids = (o.next || []).slice();
      const flow = MAS.flow;
      let flowNext = null;
      if (flow && flow.steps.includes(o.toolId)) {
        const i = flow.steps.indexOf(o.toolId);
        flowNext = flow.steps[i + 1] || null;
        if (flowNext) ids = [flowNext].concat(ids.filter((x) => x !== flowNext));
      }
      ids = ids.filter((id) => {
        const t = toolsById.get(id);
        if (!isAvailable(t) || id === o.toolId) return false;
        const need = single === 'image' ? ['jpeg', 'png', 'webp'] : [typeFor[single]];
        return t.accepts.some((a) => need.includes(a));
      }).slice(0, 4);
      if (ids.length) {
        el.append(h('div', { class: 'continue' }, h('h3', null, flowNext ? 'Next step in “' + flow.title + '”' : 'Continue with this file'),
          h('div', { class: 'continue-list' }, ids.map((id) => {
            const t = toolsById.get(id);
            return h('button', { type: 'button', class: 'continue-btn' + (id === flowNext ? ' is-next' : ''), onclick: () => {
              const files = fileOuts.map((x) => new File([x.blob], x.name, { type: x.blob.type }));
              go(id, { files });
            } }, h('span', { class: 'chip-icon chip-icon--' + t.cat }, icon(t.icon)), t.name);
          }))));
      } else if (flow && flow.steps[flow.steps.length - 1] === o.toolId) {
        el.append(h('p', { class: 'muted small' }, 'That’s the last step of “' + flow.title + '”.'));
        MAS.flow = null;
      }
    }
    el.append(h('div', { class: 'result-actions' },
      o.onAgain ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: o.onAgain }, icon('undo-2'), 'Change options') : null,
      o.onReset ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: o.onReset }, icon('refresh-cw'), 'Start over') : null));
    return el;
  }
  MAS.resultView = resultView;

  function errorView(msg, onBack) {
    return h('div', { class: 'notice notice--error', role: 'alert' }, icon('circle-alert'), h('div', null,
      h('strong', null, 'That didn’t work'), h('p', null, msg),
      onBack ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: onBack }, 'Back to options') : null));
  }
  MAS.errorView = errorView;

  function userMessage(e) {
    if (e && e.userFacing) return e.message;
    const m = String((e && e.message) || e || '');
    if (/out of memory|allocation|Array buffer allocation/i.test(m)) return 'Your device ran out of memory for this file. Try a smaller file, fewer pages, or a lower resolution.';
    return 'Something went wrong while processing. The file may be damaged or use an unsupported feature. (' + m.slice(0, 140) + ')';
  }
  MAS.userMessage = userMessage;
  const isAbort = (e) => e && e.name === 'AbortError';
  MAS.isAbort = isAbort;

  function mountFileTool(root, tool, impl) {
    const fields = fieldsOf(impl, tool);
    const st = { files: [], text: '', opts: defaults(fields, tool), phase: 'ready', ac: null, meta: null };
    const multiple = !!impl.multiple;
    const max = impl.max || (multiple ? 50 : 1);
    const min = impl.min || 1;
    const maxMB = impl.maxMB || 100;
    const totalMB = impl.totalMB || 300;
    const types = impl.types || tool.accepts;
    const textMode = impl.input === 'text';

    const filesBox = h('div', { class: 'ws-files' });
    const alerts = h('div', { class: 'ws-alerts', 'aria-live': 'polite' });
    const optsBox = h('div', { class: 'ws-options' });
    const actionBtn = h('button', { type: 'button', class: 'btn btn--cta btn--lg', onclick: run }, icon(impl.actionIcon || 'zap'), impl.action || 'Start');
    const actionHint = h('p', { class: 'action-hint muted small' });
    const actions = h('div', { class: 'ws-actions' }, actionBtn, actionHint);
    const stage = h('div', { class: 'ws-stage' });
    const setup = h('div', { class: 'ws-setup' }, filesBox, alerts, optsBox, actions);
    root.append(setup, stage);

    function showAlert(msgs) {
      alerts.replaceChildren();
      if (!msgs.length) return;
      alerts.append(h('div', { class: 'notice notice--warn', role: 'alert' }, icon('triangle-alert'), h('div', null,
        msgs.length === 1 ? h('p', null, msgs[0]) : h('ul', null, msgs.map((m) => h('li', null, m))),
        h('button', { type: 'button', class: 'link-btn small', onclick: () => alerts.replaceChildren() }, 'Dismiss'))));
    }

    async function addFiles(list) {
      if (st.phase === 'processing') return;
      if (textMode) {
        const f = list[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { showAlert(['“' + f.name + '” is larger than 5 MB. Open a smaller text file.']); return; }
        st.text = await f.text();
        drawFiles(); drawActions();
        return;
      }
      const errs = [];
      let incoming = list.slice();
      if (!multiple) { st.files = []; incoming = incoming.slice(0, 1); if (list.length > 1) errs.push('This tool takes one file at a time, so only “' + list[0].name + '” was added.'); }
      const room = max - st.files.length;
      if (incoming.length > room) { errs.push('Only ' + max + ' files can be added. ' + (incoming.length - room) + ' were left out.'); incoming = incoming.slice(0, Math.max(0, room)); }
      let total = st.files.reduce((s, x) => s + x.file.size, 0);
      for (const file of incoming) {
        if (file.size === 0) { errs.push('“' + file.name + '” is empty.'); continue; }
        if (file.size > maxMB * 1048576) { errs.push('“' + file.name + '” is ' + Core.formatBytes(file.size) + '. The limit is ' + maxMB + ' MB per file.'); continue; }
        if (total + file.size > totalMB * 1048576) { errs.push('Adding “' + file.name + '” would pass the ' + totalMB + ' MB total limit.'); continue; }
        const type = await classify(file);
        if (!types.includes('any') && !types.includes(type)) {
          const want = types.map((x) => TYPE_LABEL[x] || x).join(', ');
          errs.push('“' + file.name + '” ' + (type ? 'is a ' + (TYPE_LABEL[type] || type) + ' file' : 'isn’t a recognised file type') + '. This tool accepts ' + want + '.');
          continue;
        }
        const entry = { id: nextId('f'), file, type, info: '', meta: null };
        if (impl.inspect) {
          try {
            const r = await impl.inspect(entry);
            if (r) { entry.info = r.info || ''; entry.meta = r.meta || null; }
          } catch (e) { errs.push('“' + file.name + '”: ' + userMessage(e)); continue; }
        }
        total += file.size;
        st.files.push(entry);
      }
      showAlert(errs);
      if (impl.prefill && st.files[0] && st.files[0].meta) { impl.prefill(st.files[0].meta, st.opts); drawOptions(); }
      if (impl.onFiles) impl.onFiles(st);
      setPhase('ready');
      drawFiles(); drawActions();
      if (st.files.length) announce(st.files.length + (st.files.length === 1 ? ' file ready' : ' files ready'));
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= st.files.length) return;
      const [x] = st.files.splice(i, 1);
      st.files.splice(j, 0, x);
      drawFiles();
      const btn = filesBox.querySelectorAll('.file-row')[j];
      if (btn) { const b = btn.querySelector(d < 0 ? '[data-act="up"]' : '[data-act="down"]') || btn.querySelector('button'); if (b) b.focus(); }
      announce('Moved to position ' + (j + 1));
    }

    function drawFiles() {
      filesBox.replaceChildren();
      if (textMode) {
        const ta = h('textarea', { class: 'input text-input', rows: 12, placeholder: impl.placeholder || 'Type or paste text here', 'aria-label': 'Text', oninput: (e) => { st.text = e.target.value; drawActions(); } });
        ta.value = st.text;
        const open = dropzone({ types: ['text'], compact: true, button: 'Open a text file', onFiles: (f) => addFiles(f) });
        filesBox.append(ta, h('div', { class: 'text-tools' }, open, h('span', { class: 'muted small' }, (st.text.length).toLocaleString() + ' characters')));
        ta.addEventListener('input', debounce(() => { const c = filesBox.querySelector('.text-tools .muted'); if (c) c.textContent = st.text.length.toLocaleString() + ' characters'; }, 150));
        return;
      }
      if (!st.files.length) {
        filesBox.append(dropzone({ types, multiple, big: true, title: multiple ? 'Drop files here' : 'Drop a file here',
          hint: (types.includes('any') ? 'Any file type' : types.map((x) => TYPE_LABEL[x] || x).join(', ')) + '. Up to ' + maxMB + ' MB' + (multiple ? ' each.' : '.'),
          onFiles: addFiles }));
        return;
      }
      const ul = h('ul', { class: 'file-list', 'aria-label': 'Selected files' });
      st.files.forEach((f, i) => {
        const row = h('li', { class: 'file-row', draggable: impl.reorder && st.files.length > 1 ? 'true' : null, dataset: { i: String(i) } },
          impl.reorder && st.files.length > 1 ? h('span', { class: 'file-grip', 'aria-hidden': 'true' }, icon('grip-vertical')) : null,
          h('span', { class: 'file-type file-type--' + (f.type || 'other') }, (TYPE_LABEL[f.type] || 'FILE').split(',')[0]),
          h('span', { class: 'file-text' }, h('span', { class: 'file-name' }, f.file.name), h('span', { class: 'file-meta' }, Core.formatBytes(f.file.size) + (f.info ? ', ' + f.info : ''))),
          h('span', { class: 'file-actions' },
            impl.reorder && st.files.length > 1 ? [
              h('button', { type: 'button', class: 'icon-btn icon-btn--sm', dataset: { act: 'up' }, disabled: i === 0, 'aria-label': 'Move ' + f.file.name + ' up', onclick: () => move(i, -1) }, icon('arrow-up')),
              h('button', { type: 'button', class: 'icon-btn icon-btn--sm', dataset: { act: 'down' }, disabled: i === st.files.length - 1, 'aria-label': 'Move ' + f.file.name + ' down', onclick: () => move(i, 1) }, icon('arrow-down'))] : null,
            h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'Remove ' + f.file.name, onclick: () => { st.files.splice(i, 1); drawFiles(); drawActions(); announce('Removed ' + f.file.name); } }, icon('x'))));
        if (impl.reorder) {
          row.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ihp-row', String(i)); row.classList.add('is-dragging'); });
          row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
          row.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types).includes('text/x-ihp-row')) { e.preventDefault(); row.classList.add('is-target'); } });
          row.addEventListener('dragleave', () => row.classList.remove('is-target'));
          row.addEventListener('drop', (e) => {
            const from = e.dataTransfer.getData('text/x-ihp-row');
            if (from === '') return;
            e.preventDefault(); e.stopPropagation();
            row.classList.remove('is-target');
            const a = Number(from), b = i;
            if (a === b) return;
            const [x] = st.files.splice(a, 1);
            st.files.splice(b, 0, x);
            drawFiles();
          });
        }
        ul.append(row);
      });
      filesBox.append(ul);
      if (multiple && st.files.length < max) {
        filesBox.append(dropzone({ types, multiple, compact: true, button: 'Add more files', onFiles: addFiles }));
      } else if (!multiple) {
        filesBox.append(dropzone({ types, multiple: false, compact: true, button: 'Replace file', onFiles: addFiles }));
      }
    }

    function drawOptions() { renderOptions(optsBox, fields, st.opts, (f, rerender) => { if (rerender) drawOptions(); drawActions(); }); }

    function readyState() {
      if (textMode) return st.text.trim() ? '' : 'Type or paste some text to continue.';
      if (st.files.length < min) return min > 1 ? 'Add at least ' + min + ' files to continue.' : 'Add a file to continue.';
      if (impl.validate) return impl.validate(st) || '';
      return '';
    }
    function drawActions() {
      const why = readyState();
      actionBtn.disabled = !!why;
      actionHint.textContent = why;
      actions.hidden = !textMode && !st.files.length;
    }

    function setPhase(p) {
      st.phase = p;
      setup.hidden = p === 'processing' || p === 'done';
      if (p === 'ready' || p === 'failed' || p === 'cancelled') { if (p === 'ready') stage.replaceChildren(); }
    }

    async function run() {
      if (readyState()) return;
      const ac = new AbortController();
      st.ac = ac;
      setPhase('processing');
      const pv = progressView(() => { ac.abort(); });
      stage.replaceChildren(pv.el);
      const summary = [];
      const ctx = {
        files: st.files, text: st.text, opts: Object.assign({}, st.opts), signal: ac.signal, summary, tool,
        progress: (f, label) => pv.set(f, label),
        status: (label) => pv.set(null, label),
        lib: MAS.lib,
        bytes: async (entry) => new Uint8Array(await entry.file.arrayBuffer()),
        out: makeOutput,
        textOut: (text, name, extra) => Object.assign(makeOutput(new Blob([text], { type: 'text/plain;charset=utf-8' }), name, extra), { text }),
        tick: () => new Promise((r) => setTimeout(r, 0)).then(() => Core.checkAbort(ac.signal)),
        check: () => Core.checkAbort(ac.signal),
      };
      try {
        const res = await impl.run(ctx);
        Core.checkAbort(ac.signal);
        const outputs = Array.isArray(res) ? res : res.outputs;
        st.phase = 'done';
        setup.hidden = true;
        const rv = resultView({
          title: impl.doneTitle, summary, outputs, next: impl.next || tool.related, toolId: tool.id, noBundle: impl.noBundle,
          bundleName: Core.outName(st.files[0] ? st.files[0].file.name : 'results', impl.bundleSuffix || 'results', 'zip'),
          onReset: () => { st.files = []; st.text = ''; setPhase('ready'); drawFiles(); drawActions(); setup.hidden = false; focusFirst(); },
          onAgain: () => { setPhase('ready'); setup.hidden = false; drawActions(); actionBtn.focus(); },
        });
        stage.replaceChildren(rv);
        rv.focus({ preventScroll: false });
        announce('Done. ' + (outputs.length === 1 ? 'One file is' : outputs.length + ' files are') + ' ready.');
      } catch (e) {
        if (isAbort(e)) {
          setPhase('cancelled'); setup.hidden = false;
          stage.replaceChildren(h('div', { class: 'notice notice--info', role: 'status' }, icon('info'), h('p', null, 'Cancelled. Nothing was changed.')));
          announce('Cancelled');
        } else {
          console.error(e);
          setPhase('failed'); setup.hidden = false;
          stage.replaceChildren(errorView(userMessage(e)));
          announce('Error: ' + userMessage(e));
        }
      } finally { st.ac = null; }
    }
    function focusFirst() { const b = root.querySelector('.drop button, textarea'); if (b) b.focus(); }

    drawFiles(); drawOptions(); drawActions();
    pageDropTarget = (f) => addFiles(textMode ? f.slice(0, 1) : f);
    if (MAS.pending && MAS.pending.slug === tool.id) { const f = MAS.pending.files; MAS.pending = null; addFiles(f); }
    return () => { if (st.ac) st.ac.abort(); pageDropTarget = null; };
  }
  MAS.mountFileTool = mountFileTool;
  MAS.setPageDrop = (fn) => { pageDropTarget = fn; };

  /* =========================================================
     Text tool engine (instant transforms)
     ========================================================= */
  function mountTextTool(root, tool, impl) {
    const fields = fieldsOf(impl, tool);
    const opts = defaults(fields, tool);
    let action = (impl.actions && impl.actions[0] && impl.actions[0].id) || 'run';
    const inId = nextId('in'), outId = nextId('out');
    const input = h('textarea', { id: inId, class: 'input text-input' + (impl.mono ? ' input--mono' : ''), rows: 10, spellcheck: impl.mono ? 'false' : null, placeholder: impl.placeholder || 'Paste text here' });
    const output = h('textarea', { id: outId, class: 'input text-input' + (impl.mono ? ' input--mono' : ''), rows: 10, readonly: true, spellcheck: 'false' });
    const msg = h('p', { class: 'text-msg', 'aria-live': 'polite' });
    const optsBox = h('div', { class: 'ws-options' });
    const actBar = h('div', { class: 'text-actions' });
    function drawActs() {
      actBar.replaceChildren();
      (impl.actions || []).forEach((a) => actBar.append(h('button', { type: 'button', class: 'btn ' + (a.id === action ? 'btn--cta' : 'btn--ghost'), 'aria-pressed': String(a.id === action), onclick: () => { action = a.id; drawActs(); doRun(); } }, a.label)));
    }
    function doRun() {
      const src = input.value;
      if (!src) { output.value = ''; msg.textContent = ''; msg.className = 'text-msg'; return; }
      if (src.length > (impl.maxChars || 2000000)) { msg.textContent = 'This text is too long for this tool (limit ' + (impl.maxChars || 2000000).toLocaleString() + ' characters).'; msg.className = 'text-msg is-error'; return; }
      let r;
      try { r = impl.transform(src, opts, action); }
      catch (e) { r = { error: userMessage(e) }; }
      if (r.error) { output.value = ''; msg.textContent = r.error; msg.className = 'text-msg is-error'; }
      else { output.value = r.text; msg.textContent = r.info || (r.text.length.toLocaleString() + ' characters'); msg.className = 'text-msg is-ok'; }
    }
    const live = debounce(doRun, 120);
    input.addEventListener('input', live);
    const open = dropzone({ types: ['text'], compact: true, button: 'Open a file', onFiles: async (f) => {
      if (f[0].size > 10 * 1048576) { msg.textContent = 'That file is larger than 10 MB.'; msg.className = 'text-msg is-error'; return; }
      input.value = await f[0].text(); doRun();
    } });
    drawActs();
    const onOpt = (f, re) => { if (re) renderOptions(optsBox, fields, opts, onOpt); doRun(); };
    renderOptions(optsBox, fields, opts, onOpt);
    root.append(
      h('div', { class: 'text-grid' },
        h('div', { class: 'text-col' }, h('div', { class: 'text-col-head' }, h('label', { for: inId, class: 'opt-label' }, impl.inputLabel || 'Input'), open), input),
        h('div', { class: 'text-col' }, h('div', { class: 'text-col-head' }, h('label', { for: outId, class: 'opt-label' }, impl.outputLabel || 'Result'),
          h('div', { class: 'row-gap' },
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (output.value) copyText(output.value); } }, icon('copy'), 'Copy'),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (output.value) save(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), impl.outputName ? impl.outputName(action, opts) : 'result.txt'); } }, icon('download'), 'Save'),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (output.value) { input.value = output.value; doRun(); input.focus(); } }, 'aria-label': 'Use result as input' }, icon('undo-2'), h('span', { class: 'hide-xs' }, 'Use as input')))),
          output)),
      msg, optsBox, actBar);
    pageDropTarget = async (f) => { input.value = await f[0].text(); doRun(); };
    if (MAS.pending && MAS.pending.slug === tool.id) { const f = MAS.pending.files; MAS.pending = null; f[0].text().then((t) => { input.value = t; doRun(); }); }
    return () => { pageDropTarget = null; };
  }

  /* =========================================================
     Init
     ========================================================= */
  function init() {
    const skip = $('.skip');
    if (skip) skip.addEventListener('click', (e) => { e.preventDefault(); const m = $('#main'); m.focus(); m.scrollIntoView(); });
    applyTheme(storedTheme());
    buildHeader();
    buildFooter();
    applyTheme(storedTheme());
    render(slugFromLocation());
    if (CFG.mode === 'pages' && 'serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    }
  }
  MAS.start = init;
  // Start only after every deferred tool script has run (DOMContentLoaded waits for them); never on a bare timer.
  if (document.readyState === 'complete') setTimeout(init, 0);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
})();
