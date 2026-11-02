/*!
 * I HATE PDF — processing core, part 2 (functions not covered by core-more.js) (pure functions; runs in the browser and in Node tests)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else Object.assign(root.MASCore, factory(root.MASCore));
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const UserError = C.UserError;

  /* ---------- line diff ---------- */
  function diffLines(aText, bText, o) {
    o = o || {};
    const split = (t) => { const s = String(t || '').replace(/\r\n?/g, '\n'); return s === '' ? [] : s.split('\n'); };
    const A = split(aText), B = split(bText);
    const key = (l) => { let k = l; if (o.ignoreSpace) k = k.replace(/\s+/g, ' ').trim(); if (o.ignoreCase) k = k.toLowerCase(); return k; };
    const KA = A.map(key), KB = B.map(key);
    let pre = 0;
    while (pre < A.length && pre < B.length && KA[pre] === KB[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre && KA[A.length - 1 - suf] === KB[B.length - 1 - suf]) suf++;
    const ops = [];
    for (let i = 0; i < pre; i++) ops.push({ t: '=', a: i + 1, b: i + 1, text: A[i] });
    const a0 = pre, b0 = pre, n = A.length - pre - suf, m = B.length - pre - suf;
    let approximate = false;
    if (n && m && n * m <= 9e6) {
      const W = m + 1;
      const dp = new Uint16Array((n + 1) * W);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = KA[a0 + i] === KB[b0 + j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (KA[a0 + i] === KB[b0 + j]) { ops.push({ t: '=', a: a0 + i + 1, b: b0 + j + 1, text: A[a0 + i] }); i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { ops.push({ t: '-', a: a0 + i + 1, text: A[a0 + i] }); i++; }
        else { ops.push({ t: '+', b: b0 + j + 1, text: B[b0 + j] }); j++; }
      }
      for (; i < n; i++) ops.push({ t: '-', a: a0 + i + 1, text: A[a0 + i] });
      for (; j < m; j++) ops.push({ t: '+', b: b0 + j + 1, text: B[b0 + j] });
    } else {
      approximate = n > 0 && m > 0;
      for (let i = 0; i < n; i++) ops.push({ t: '-', a: a0 + i + 1, text: A[a0 + i] });
      for (let j = 0; j < m; j++) ops.push({ t: '+', b: b0 + j + 1, text: B[b0 + j] });
    }
    for (let k = 0; k < suf; k++) ops.push({ t: '=', a: A.length - suf + k + 1, b: B.length - suf + k + 1, text: A[A.length - suf + k] });
    const added = ops.filter((x) => x.t === '+').length, removed = ops.filter((x) => x.t === '-').length;
    return { ops, added, removed, same: ops.length - added - removed, approximate };
  }
  function diffReport(d) {
    return d.ops.map((x) => (x.t === '=' ? '  ' : x.t + ' ') + x.text).join('\n');
  }

  /* ---------- small text helpers ---------- */
  function numberBases(input, base) {
    let s = String(input || '').trim().replace(/[_\s]/g, '').toLowerCase();
    if (!s) return null;
    const neg = s.startsWith('-');
    if (neg) s = s.slice(1);
    s = s.replace(/^(0x|0b|0o)/, '');
    const valid = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-f]+$/ }[base];
    if (!valid.test(s)) throw new UserError('That isn’t a valid base-' + base + ' number.');
    let v = 0n;
    const B = BigInt(base);
    for (const ch of s) v = v * B + BigInt(parseInt(ch, 16));
    const f = (b) => (neg && v ? '-' : '') + v.toString(b);
    return { bin: f(2), oct: f(8), dec: f(10), hex: f(16).toUpperCase() };
  }
  function cleanText(text, o) {
    let lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    if (o.trim) lines = lines.map((l) => l.trim());
    if (o.spaces) lines = lines.map((l) => l.replace(/[ \t]{2,}/g, ' '));
    if (o.empty) lines = lines.filter((l) => l.trim());
    if (o.dedupe) { const seen = new Set(); lines = lines.filter((l) => { const k = o.ci ? l.toLowerCase() : l; if (seen.has(k)) return false; seen.add(k); return true; }); }
    const cmp = (a, b) => (o.ci ? a.toLowerCase().localeCompare(b.toLowerCase()) : a.localeCompare(b));
    if (o.sort === 'az') lines.sort(cmp); else if (o.sort === 'za') lines.sort((a, b) => cmp(b, a)); else if (o.sort === 'len') lines.sort((a, b) => a.length - b.length);
    if (o.reverse) lines.reverse();
    return lines.join('\n');
  }
  const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
  function lorem(count, unit, rand) {
    rand = rand || Math.random;
    const word = () => LOREM[Math.floor(rand() * LOREM.length)];
    const sentence = () => { const n = 8 + Math.floor(rand() * 9); const w = Array.from({ length: n }, word); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(' ') + '.'; };
    const para = () => Array.from({ length: 4 + Math.floor(rand() * 4) }, sentence).join(' ');
    const n = Math.max(1, Math.min(500, Math.floor(count) || 1));
    if (unit === 'words') { const w = Array.from({ length: n }, word); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(' ') + '.'; }
    if (unit === 'sentences') return Array.from({ length: n }, sentence).join(' ');
    const ps = Array.from({ length: n }, para);
    ps[0] = 'Lorem ipsum dolor sit amet, ' + ps[0][0].toLowerCase() + ps[0].slice(1);
    return ps.join('\n\n');
  }
  function htmlEncode(s, all) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      .replace(all ? /[^\x00-\x7f]/gu : /(?!)/g, (c) => '&#' + c.codePointAt(0) + ';');
  }

  /* ---------- Server-sent events (AI streaming) ---------- */
  function sseParser(onData) {
    let buf = '';
    return function push(chunk, end) {
      buf += chunk;
      const parts = buf.split(/\r?\n\r?\n/);
      buf = end ? '' : parts.pop();
      for (const ev of parts) {
        const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) onData(data);
      }
    };
  }

  /* ---------- PDF operations (pdf-lib) ---------- */
  async function flattenPdf(PDFLib, bytes) {
    const doc = await C.loadPdf(PDFLib, bytes);
    let fields = 0;
    try { const form = doc.getForm(); fields = form.getFields().length; if (fields) form.flatten(); }
    catch (e) { throw new UserError('This PDF’s form couldn’t be flattened. It may use features pdf-lib doesn’t support (such as XFA forms).'); }
    return { bytes: await doc.save({ useObjectStreams: true }), fields };
  }

  /** Place a PNG/JPG (e.g. a signature) on pages. pos: bottom-right | bottom-left | bottom-center | top-right | top-left | center */
  async function stampImagePdf(PDFLib, bytes, img, o) {
    o = Object.assign({ pages: 'last', position: 'bottom-right', width: 30, margin: 36, opacity: 1 }, o || {});
    const doc = await C.loadPdf(PDFLib, bytes);
    const em = img.kind === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const total = doc.getPageCount();
    const targets = o.pages === 'all' ? doc.getPageIndices() : o.pages === 'last' ? [total - 1] : o.pages === 'first' ? [0] : C.parsePageList(o.pages, total);
    for (const i of targets) {
      const page = doc.getPage(i);
      const f = C.pageFrame(page);
      const w = f.W * Math.max(5, Math.min(100, Number(o.width))) / 100;
      const hgt = w * em.height / em.width;
      const [v, hz] = o.position === 'center' ? ['middle', 'center'] : o.position.split('-');
      const vx = hz === 'left' ? o.margin : hz === 'right' ? f.W - o.margin - w : (f.W - w) / 2;
      const vy = v === 'top' ? f.H - o.margin - hgt : v === 'middle' ? (f.H - hgt) / 2 : o.margin;
      const p = f.toPage(vx, vy);
      page.drawImage(em, { x: p.x, y: p.y, width: w, height: hgt, rotate: PDFLib.degrees(f.r), opacity: Math.max(0.05, Math.min(1, Number(o.opacity))) });
    }
    doc.setModificationDate(new Date());
    return { bytes: await doc.save({ useObjectStreams: true }), count: targets.length };
  }

  return {
    diffLines, diffReport, numberBases, cleanText, lorem, htmlEncode, sseParser, flattenPdf, stampImagePdf,
  };
});
