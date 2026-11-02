/*!
 * I HATE PDF — processing core, part 2 (v1.1)
 * Pure functions, no DOM: shared by the browser app and Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else Object.assign(root.MASCore, factory(root.MASCore));
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const { UserError, loadPdf, parsePageList, checkAbort } = C;
  const MM = 72 / 25.4;

  function stamp(doc) {
    doc.setProducer(C.PRODUCER); doc.setCreator(C.PRODUCER); doc.setModificationDate(new Date());
  }
  function boxOf(page) {
    return page.getCropBox ? page.getCropBox() : { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() };
  }
  const rotOf = (page) => ((page.getRotation().angle % 360) + 360) % 360;

  /* ---------- PDF: crop (margins measured as the page looks on screen) ---------- */
  async function cropPdf(PDFLib, bytes, m, pagesInput) {
    const doc = await loadPdf(PDFLib, bytes);
    const total = doc.getPageCount();
    const targets = pagesInput && String(pagesInput).trim() ? parsePageList(pagesInput, total) : doc.getPageIndices();
    const v = { top: (+m.top || 0) * MM, right: (+m.right || 0) * MM, bottom: (+m.bottom || 0) * MM, left: (+m.left || 0) * MM };
    if (Object.values(v).some((x) => x < 0)) throw new UserError('Margins can’t be negative.');
    for (const i of targets) {
      const page = doc.getPage(i);
      const b = boxOf(page);
      const r = rotOf(page);
      // map visual sides to unrotated page sides
      const map = r === 90 ? { l: v.top, r: v.bottom, b: v.left, t: v.right }
        : r === 180 ? { l: v.right, r: v.left, b: v.top, t: v.bottom }
          : r === 270 ? { l: v.bottom, r: v.top, b: v.right, t: v.left }
            : { l: v.left, r: v.right, b: v.bottom, t: v.top };
      const w = b.width - map.l - map.r, hgt = b.height - map.b - map.t;
      if (w < 36 || hgt < 36) throw new UserError('Those margins would leave almost nothing of page ' + (i + 1) + '. Use smaller margins.');
      page.setMediaBox(b.x + map.l, b.y + map.b, w, hgt);
      page.setCropBox(b.x + map.l, b.y + map.b, w, hgt);
    }
    stamp(doc);
    return { bytes: await doc.save({ useObjectStreams: true }), count: targets.length };
  }

  /* ---------- PDF: headers and footers ---------- */
  function fillTokens(s, ctx) {
    return String(s || '').replace(/\{n\}/g, ctx.n).replace(/\{total\}/g, ctx.total).replace(/\{date\}/g, ctx.date).replace(/\{file\}/g, ctx.file);
  }
  async function headerFooter(PDFLib, bytes, o) {
    o = Object.assign({ size: 9, margin: 24, color: '#374151', from: 1, file: '' }, o || {});
    const doc = await loadPdf(PDFLib, bytes);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const color = C.__hexToRgb ? C.__hexToRgb(PDFLib, o.color) : PDFLib.rgb(0.2, 0.2, 0.25);
    const pages = doc.getPages();
    const total = pages.length;
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const slots = [['header', 'left'], ['header', 'center'], ['header', 'right'], ['footer', 'left'], ['footer', 'center'], ['footer', 'right']];
    const texts = slots.map(([a, b]) => ((o[a] || {})[b] || '').trim());
    if (!texts.some(Boolean)) throw new UserError('Type at least one header or footer text.');
    const sample = texts.join(' ').replace(/\{[a-z]+\}/g, '');
    for (const ch of Array.from(sample)) {
      if (!C.isWinAnsi(ch)) throw new UserError('Header and footer text can only use Latin characters for now (“' + ch + '” can’t be shown with built-in PDF fonts).');
    }
    o.file = Array.from(String(o.file || '')).map((ch) => (C.isWinAnsi(ch) ? ch : '?')).join('');
    const size = Math.max(6, Math.min(24, Number(o.size) || 9));
    const margin = Math.max(8, Number(o.margin) || 24);
    let count = 0;
    pages.forEach((page, i) => {
      if (i + 1 < (Number(o.from) || 1)) return;
      const f = C.__pageFrame(page);
      slots.forEach(([where, pos], k) => {
        const raw = texts[k];
        if (!raw) return;
        const t = fillTokens(raw, { n: i + 1, total, date, file: o.file });
        const tw = font.widthOfTextAtSize(t, size);
        const vx = pos === 'left' ? margin : pos === 'right' ? f.W - margin - tw : (f.W - tw) / 2;
        const vy = where === 'header' ? f.H - margin - size * 0.75 : margin;
        C.__drawVisualText(PDFLib, page, t, { vx, vy, size, font, color });
      });
      count++;
    });
    stamp(doc);
    return { bytes: await doc.save({ useObjectStreams: true }), count };
  }

  /* ---------- PDF: several pages per sheet ---------- */
  const SHEETS = { a4: [595.28, 841.89], letter: [612, 792] };
  const GRID = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 16: [4, 4] };
  async function pagesPerSheet(PDFLib, bytes, o) {
    o = Object.assign({ per: 4, sheet: 'a4', order: 'row', border: false, gap: 12 }, o || {});
    const src = await loadPdf(PDFLib, bytes);
    const out = await PDFLib.PDFDocument.create();
    const pages = src.getPages();
    const boxes = pages.map((p) => { const b = boxOf(p); return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }; });
    const emb = await out.embedPages(pages, boxes);
    const per = Number(o.per);
    let [cols, rows] = GRID[per] || GRID[4];
    // landscape sheet for 2, 6, 8 per sheet (they read better side by side)
    let [sw, sh] = SHEETS[o.sheet] || SHEETS.a4;
    if (cols > rows) [sw, sh] = [sh, sw];
    const gap = Math.max(0, Number(o.gap) || 0), pad = 24;
    const cw = (sw - 2 * pad - (cols - 1) * gap) / cols, ch = (sh - 2 * pad - (rows - 1) * gap) / rows;
    let sheet = null;
    for (let i = 0; i < emb.length; i++) {
      checkAbort(o.signal);
      const k = i % per;
      if (k === 0) sheet = out.addPage([sw, sh]);
      const col = o.order === 'column' ? Math.floor(k / rows) : k % cols;
      const row = o.order === 'column' ? k % rows : Math.floor(k / cols);
      const r = rotOf(pages[i]);
      const e = emb[i];
      const vw = r % 180 ? e.height : e.width, vh = r % 180 ? e.width : e.height;
      const s = Math.min(cw / vw, ch / vh);
      const x0 = pad + col * (cw + gap) + (cw - vw * s) / 2;
      const y0 = sh - pad - (row + 1) * ch - row * gap + (ch - vh * s) / 2;
      let x = x0, y = y0, rot = 0;
      if (r === 90) { y = y0 + e.width * s; rot = -90; }
      else if (r === 180) { x = x0 + e.width * s; y = y0 + e.height * s; rot = 180; }
      else if (r === 270) { x = x0 + e.height * s; rot = 90; }
      sheet.drawPage(e, { x, y, xScale: s, yScale: s, rotate: PDFLib.degrees(rot) });
      if (o.border) sheet.drawRectangle({ x: x0, y: y0, width: vw * s, height: vh * s, borderColor: PDFLib.rgb(0.75, 0.78, 0.84), borderWidth: 0.6 });
    }
    stamp(out);
    return { bytes: await out.save({ useObjectStreams: true }), sheets: out.getPageCount() };
  }

  /* ---------- PDF: password protect / unlock (AES-256) ---------- */
  async function protectPdf(PDFLib, bytes, o) {
    o = o || {};
    const user = String(o.userPassword || '');
    if (user.length < 4) throw new UserError('Use a password of at least 4 characters. Longer is safer.');
    const doc = await loadPdf(PDFLib, bytes);
    if (typeof doc.encrypt !== 'function') throw new UserError('This build can’t encrypt PDFs.');
    const owner = String(o.ownerPassword || '') || user + '#owner#' + Math.random().toString(36).slice(2);
    doc.encrypt({
      userPassword: user, ownerPassword: owner,
      permissions: {
        printing: o.allowPrinting === false ? false : 'highResolution', copying: o.allowCopying !== false,
        modifying: !!o.allowEditing, annotating: !!o.allowEditing, fillingForms: true, contentAccessibility: true, documentAssembly: !!o.allowEditing,
      },
    });
    stamp(doc);
    return doc.save();
  }
  async function unlockPdf(PDFLib, bytes, password) {
    let doc;
    try { doc = await PDFLib.PDFDocument.load(bytes, { password: String(password == null ? '' : password), updateMetadata: false }); }
    catch (e) {
      const msg = String((e && e.message) || e);
      if (/password/i.test(msg) || /decrypt/i.test(msg)) throw new UserError('That password isn’t correct. Check it and try again.');
      throw new UserError('This PDF couldn’t be opened. It may be damaged or use an unsupported encryption method.');
    }
    if (doc.getPageCount() < 1) throw new UserError('This PDF has no pages.');
    // Copy the decrypted pages into a fresh, unencrypted document
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
    if (doc.getTitle()) out.setTitle(doc.getTitle());
    if (doc.getAuthor()) out.setAuthor(doc.getAuthor());
    stamp(out);
    return out.save({ useObjectStreams: true });
  }
  async function isEncrypted(PDFLib, bytes) {
    try { return (await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).isEncrypted; }
    catch (e) { return false; }
  }

  /* ---------- Bengali calendar (Bangladesh, revised 2019) ---------- */
  const BN_MONTHS = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'];
  const BN_MONTHS_EN = ['Boishakh', 'Joishtho', 'Asharh', 'Shrabon', 'Bhadro', 'Ashwin', 'Kartik', 'Agrahayon', 'Poush', 'Magh', 'Falgun', 'Chaitro'];
  const BN_SEASONS = ['গ্রীষ্ম', 'বর্ষা', 'শরৎ', 'হেমন্ত', 'শীত', 'বসন্ত'];
  const BN_DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  function toBengaliDate(y, m, d) {
    // y, m (1-12), d as a calendar date (no time zone involved)
    const day = Date.UTC(y, m - 1, d);
    const startYear = (m > 4 || (m === 4 && d >= 14)) ? y : y - 1;
    let off = Math.round((day - Date.UTC(startYear, 3, 14)) / 86400000);
    const lens = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, isLeap(startYear + 1) ? 30 : 29, 30];
    let mi = 0;
    while (off >= lens[mi]) { off -= lens[mi]; mi++; }
    const weekday = new Date(day).getUTCDay();
    return { year: startYear - 593, month: mi, day: off + 1, monthName: BN_MONTHS[mi], monthNameEn: BN_MONTHS_EN[mi], season: BN_SEASONS[Math.floor(mi / 2)], weekday: BN_DAYS[weekday] };
  }
  function fromBengaliDate(by, bm, bd) {
    const gy = by + 593;
    const lens = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, isLeap(gy + 1) ? 30 : 29, 30];
    if (bm < 0 || bm > 11 || bd < 1 || bd > lens[bm]) throw new UserError(BN_MONTHS[bm] + ' has ' + lens[bm] + ' days in that year.');
    let off = bd - 1;
    for (let i = 0; i < bm; i++) off += lens[i];
    const dt = new Date(Date.UTC(gy, 3, 14) + off * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  /* ---------- Numbers in words (Bangladesh lakh/crore system) ---------- */
  const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function en99(n) { return n < 20 ? EN_ONES[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + EN_ONES[n % 10] : ''); }
  function en999(n) { const h = Math.floor(n / 100), r = n % 100; return (h ? EN_ONES[h] + ' hundred' + (r ? ' ' : '') : '') + (r || !h ? en99(r) : ''); }
  const BN_99 = ('শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ বিশ একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আটাশ ঊনত্রিশ ' +
    'ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ ঊনচল্লিশ চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ ' +
    'পঞ্চাশ একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন ঊনষাট ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি ঊনসত্তর ' +
    'সত্তর একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি আশি একাশি বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি সাতাশি আটাশি ঊননব্বই ' +
    'নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই সাতানব্বই আটানব্বই নিরানব্বই').split(' ');
  function bn999(n) { const h = Math.floor(n / 100), r = n % 100; return (h ? BN_99[h] + 'শ' + (r ? ' ' : '') : '') + (r || !h ? BN_99[r] : ''); }
  function intWords(n, lang) {
    if (!Number.isFinite(n) || n < 0) throw new UserError('Enter a positive number.');
    n = Math.floor(n);
    if (n >= 1e15) throw new UserError('That number is too large.');
    const isBn = lang === 'bn';
    const unit = isBn ? { crore: 'কোটি', lakh: 'লক্ষ', thousand: 'হাজার' } : { crore: 'crore', lakh: 'lakh', thousand: 'thousand' };
    const s999 = isBn ? bn999 : en999;
    if (n === 0) return isBn ? BN_99[0] : 'zero';
    const parts = [];
    const crore = Math.floor(n / 1e7), rest = n % 1e7;
    if (crore) parts.push((crore >= 1000 ? intWords(crore, lang) : s999(crore)) + ' ' + unit.crore);
    const lakh = Math.floor(rest / 1e5), th = Math.floor((rest % 1e5) / 1000), r = rest % 1000;
    if (lakh) parts.push((isBn ? BN_99[lakh] : en99(lakh)) + ' ' + unit.lakh);
    if (th) parts.push((isBn ? BN_99[th] : en99(th)) + ' ' + unit.thousand);
    if (r) parts.push(s999(r));
    return parts.join(' ');
  }
  function amountInWords(value, lang, currency) {
    const v = Number(String(value).replace(/[,\s]/g, '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)));
    if (!Number.isFinite(v) || v < 0) throw new UserError('Enter an amount like 125000.50.');
    const whole = Math.floor(v + 1e-9), frac = Math.round((v - whole) * 100);
    const isBn = lang === 'bn', cur = currency !== false;
    let s = intWords(whole, lang);
    if (!isBn) s = s.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    if (!cur) return s + (frac ? (isBn ? ' দশমিক ' + BN_99[frac] : ' Point ' + en99(frac).replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase())) : '');
    if (isBn) return s + ' টাকা' + (frac ? ' ' + BN_99[frac] + ' পয়সা' : '') + ' মাত্র';
    return 'Taka ' + s + (frac ? ' and ' + en99(frac).replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase()) + ' Poisha' : '') + ' Only';
  }
  function groupBD(n) {
    const [i, f] = String(n).split('.');
    const neg = i.startsWith('-'), d = neg ? i.slice(1) : i;
    const last3 = d.slice(-3), rest = d.slice(0, -3);
    const g = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
    return (neg ? '-' : '') + g + (f ? '.' + f : '');
  }

  /* ---------- Engineering unit conversion (factors to SI base) ---------- */
  const UNITS = {
    length: { base: 'm', u: { mm: 1e-3, cm: 1e-2, m: 1, km: 1e3, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
    area: { base: 'm²', u: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1, ha: 1e4, 'km²': 1e6, 'in²': 0.00064516, 'ft²': 0.09290304, 'yd²': 0.83612736, acre: 4046.8564224, 'decimal (shotangsho)': 40.468564224, 'katha (720 ft²)': 66.8901888, 'bigha (20 katha)': 1337.803776 } },
    volume: { base: 'm³', u: { 'cm³': 1e-6, L: 1e-3, 'm³': 1, 'in³': 1.6387064e-5, 'ft³ (cft)': 0.028316846592, 'yd³': 0.764554857984, 'US gal': 0.003785411784 } },
    mass: { base: 'kg', u: { g: 1e-3, kg: 1, 'tonne (t)': 1e3, lb: 0.45359237, 'US ton': 907.18474, 'seer (BD)': 0.93310, 'maund (BD)': 37.3242 } },
    force: { base: 'N', u: { N: 1, kN: 1e3, MN: 1e6, kgf: 9.80665, 'tf (tonne-force)': 9806.65, lbf: 4.4482216152605, kip: 4448.2216152605 } },
    stress: { base: 'Pa', u: { Pa: 1, kPa: 1e3, 'MPa (N/mm²)': 1e6, GPa: 1e9, 'kgf/cm²': 98066.5, 'tf/m²': 9806.65, psi: 6894.757293168, ksi: 6894757.293168, psf: 47.880258980336, ksf: 47880.258980336, bar: 1e5, atm: 101325 } },
    moment: { base: 'N·m', u: { 'N·m': 1, 'kN·m': 1e3, 'kgf·m': 9.80665, 'tf·m': 9806.65, 'lbf·ft': 1.3558179483314, 'lbf·in': 0.11298482902762, 'kip·ft': 1355.8179483314, 'kip·in': 112.98482902762 } },
    'unit weight': { base: 'N/m³', u: { 'kN/m³': 1e3, 'N/m³': 1, 'kgf/m³': 9.80665, 'lbf/ft³ (pcf)': 157.08746384, 'kip/ft³': 157087.46384 } },
    'line load': { base: 'N/m', u: { 'N/m': 1, 'kN/m': 1e3, 'kgf/m': 9.80665, 'lbf/ft (plf)': 14.593902937206, 'kip/ft (klf)': 14593.902937206 } },
    temperature: { base: 'K', u: { '°C': 'C', '°F': 'F', K: 'K' } },
  };
  function convertUnit(q, value, from, to) {
    const t = UNITS[q];
    if (!t || !(from in t.u) || !(to in t.u)) throw new UserError('Unknown unit.');
    const v = Number(value);
    if (!Number.isFinite(v)) throw new UserError('Enter a number.');
    if (q === 'temperature') {
      const k = from === '°C' ? v + 273.15 : from === '°F' ? (v - 32) * 5 / 9 + 273.15 : v;
      return to === '°C' ? k - 273.15 : to === '°F' ? (k - 273.15) * 9 / 5 + 32 : k;
    }
    return v * t.u[from] / t.u[to];
  }

  /* ---------- Calculators ---------- */
  const rebarKgPerM = (d) => (d * d) / 162;
  function emi(principal, annualRatePct, months) {
    const P = Number(principal), n = Math.round(Number(months)), r = Number(annualRatePct) / 1200;
    if (!(P > 0) || !(n > 0) || !(r >= 0)) throw new UserError('Enter a loan amount, a rate of 0% or more, and the number of months.');
    const pay = r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    const rows = [];
    let bal = P;
    for (let i = 1; i <= n; i++) {
      const interest = bal * r, princ = pay - interest;
      bal = Math.max(0, bal - princ);
      rows.push({ month: i, payment: pay, principal: princ, interest, balance: bal });
    }
    return { payment: pay, total: pay * n, interest: pay * n - P, rows };
  }
  const UGC_GRADES = [['A+', 4, 80], ['A', 3.75, 75], ['A-', 3.5, 70], ['B+', 3.25, 65], ['B', 3, 60], ['B-', 2.75, 55], ['C+', 2.5, 50], ['C', 2.25, 45], ['D', 2, 40], ['F', 0, 0]];
  function cgpa(courses) {
    let cr = 0, pts = 0;
    for (const c of courses) {
      const credit = Number(c.credit);
      if (!(credit > 0)) continue;
      const g = UGC_GRADES.find((x) => x[0] === c.grade);
      const gp = g ? g[1] : Number(c.gp);
      if (!Number.isFinite(gp)) continue;
      cr += credit; pts += credit * gp;
    }
    return { credits: cr, points: pts, cgpa: cr ? pts / cr : 0 };
  }
  function dateDiff(a, b) {
    // a, b: {y, m, d}; returns years/months/days from a to b (b >= a)
    let y = b.y - a.y, m = b.m - a.m, d = b.d - a.d;
    if (d < 0) { m--; d += new Date(Date.UTC(b.y, b.m - 1, 0)).getUTCDate(); }
    if (m < 0) { y--; m += 12; }
    const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
    return { years: y, months: m, days: d, totalDays: days, weeks: Math.floor(days / 7) };
  }

  /* ---------- CSV ---------- */
  function detectDelimiter(text) {
    const line = String(text).split(/\r?\n/).find((l) => l.trim()) || '';
    const counts = [',', ';', '\t', '|'].map((d) => [d, line.split(d).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] ? counts[0][0] : ',';
  }
  function parseCsv(text, delim) {
    const s = String(text).replace(/^\uFEFF/, '');
    const d = delim || detectDelimiter(s);
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"' && field === '') q = true;
      else if (c === d) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (q) throw new UserError('A quoted field is never closed. Check for a missing ".');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return { rows: rows.filter((r) => !(r.length === 1 && r[0] === '')), delimiter: d };
  }
  function csvToJson(text, o) {
    o = o || {};
    const { rows } = parseCsv(text, o.delimiter);
    if (!rows.length) throw new UserError('No rows found.');
    const typed = (v) => (o.types === false ? v : v === '' ? '' : /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v);
    if (o.header === false) return rows.map((r) => r.map(typed));
    const head = rows[0].map((h, i) => h.trim() || 'column' + (i + 1));
    return rows.slice(1).map((r) => head.reduce((obj, h, i) => { obj[h] = typed(r[i] == null ? '' : r[i]); return obj; }, {}));
  }
  function flatten(obj, pre, out) {
    out = out || {};
    for (const k of Object.keys(obj)) {
      const v = obj[k], key = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
    return out;
  }
  function jsonToCsv(value, delim) {
    const d = delim || ',';
    let arr = value;
    if (!Array.isArray(arr)) { if (arr && typeof arr === 'object') arr = [arr]; else throw new UserError('JSON must be an array of objects, or a single object.'); }
    const flat = arr.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? flatten(x) : { value: x }));
    const cols = [];
    flat.forEach((r) => Object.keys(r).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    const esc = (v) => { const s = v == null ? '' : String(v); return /["\n\r]/.test(s) || s.includes(d) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(esc).join(d)].concat(flat.map((r) => cols.map((c) => esc(r[c])).join(d))).join('\n');
  }

  /* ---------- JWT (decode only; never verifies) ---------- */
  function jwtDecode(token) {
    const parts = String(token || '').trim().replace(/^Bearer\s+/i, '').split('.');
    if (parts.length < 2) throw new UserError('A JWT has three parts separated by dots: header.payload.signature.');
    const dec = (p, what) => {
      try { return JSON.parse(new TextDecoder().decode(C.base64ToBytes(p))); }
      catch (e) { throw new UserError('The ' + what + ' isn’t valid Base64URL-encoded JSON.'); }
    };
    const header = dec(parts[0], 'header'), payload = dec(parts[1], 'payload');
    const now = Date.now() / 1000;
    const status = payload.exp == null ? 'No expiry claim' : payload.exp < now ? 'Expired' : 'Not expired';
    return { header, payload, signaturePresent: !!parts[2], status };
  }

  /* ---------- Colours ---------- */
  function parseColor(s) {
    s = String(s || '').trim().toLowerCase();
    let m;
    if ((m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s))) {
      let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const v = parseInt(h, 16); return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    }
    if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s))) return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]) };
    if ((m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s))) {
      const hh = (+m[1] % 360) / 360, ss = +m[2] / 100, ll = +m[3] / 100;
      const f = (n) => { const k = (n + hh * 12) % 12; const a = ss * Math.min(ll, 1 - ll); return Math.round(255 * (ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      return { r: f(0), g: f(8), b: f(4) };
    }
    return null;
  }
  function colorFormats(c) {
    const { r, g, b } = c;
    const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      h = mx === R ? (G - B) / dd + (G < B ? 6 : 0) : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4; h *= 60;
    }
    const k = 1 - mx;
    const cm = k === 1 ? [0, 0, 0, 100] : [(1 - R - k) / (1 - k), (1 - G - k) / (1 - k), (1 - B - k) / (1 - k), k].map((x) => Math.round(x * 100));
    return { hex, rgb: 'rgb(' + r + ', ' + g + ', ' + b + ')', hsl: 'hsl(' + Math.round(h) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l * 100) + '%)', cmyk: 'cmyk(' + cm.join('%, ') + '%)' };
  }
  function relLum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function contrastRatio(a, b) { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  /* ---------- Palette (k-means on sampled pixels) ---------- */
  function kmeansPalette(pixels, k, iters) {
    // pixels: flat array [r,g,b,r,g,b...]
    const n = Math.floor(pixels.length / 3);
    if (!n) return [];
    k = Math.min(k, n);
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]]);
    const cents = [pts[0]];
    while (cents.length < k) { // farthest-point init (deterministic)
      let best = null, bd = -1;
      for (const p of pts) { const d = Math.min(...cents.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2)); if (d > bd) { bd = d; best = p; } }
      cents.push(best.slice());
    }
    const assign = new Array(n).fill(0);
    for (let it = 0; it < (iters || 12); it++) {
      pts.forEach((p, i) => { let bi = 0, bd = Infinity; cents.forEach((c, j) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; bi = j; } }); assign[i] = bi; });
      const sums = cents.map(() => [0, 0, 0, 0]);
      pts.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
      sums.forEach((s, j) => { if (s[3]) cents[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }
    const counts = cents.map((_, j) => assign.filter((a) => a === j).length);
    return cents.map((c, j) => ({ r: Math.round(c[0]), g: Math.round(c[1]), b: Math.round(c[2]), share: counts[j] / n })).filter((c) => c.share > 0).sort((a, b) => b.share - a.share);
  }

  /* ---------- ICO writer (PNG-compressed entries) ---------- */
  function buildIco(images) {
    const count = images.length;
    const head = new Uint8Array(6 + 16 * count);
    const dv = new DataView(head.buffer);
    dv.setUint16(2, 1, true); dv.setUint16(4, count, true);
    let offset = head.length;
    images.forEach((im, i) => {
      const o = 6 + i * 16;
      head[o] = im.size >= 256 ? 0 : im.size; head[o + 1] = im.size >= 256 ? 0 : im.size;
      dv.setUint16(o + 4, 1, true); dv.setUint16(o + 6, 32, true);
      dv.setUint32(o + 8, im.png.length, true); dv.setUint32(o + 12, offset, true);
      offset += im.png.length;
    });
    const out = new Uint8Array(offset);
    out.set(head);
    let p = head.length;
    images.forEach((im) => { out.set(im.png, p); p += im.png.length; });
    return out;
  }

  /* ---------- Passwords ---------- */
  function passwordEntropy(length, poolSize) { return Math.round(length * Math.log2(poolSize)); }

  return {
    cropPdf, headerFooter, pagesPerSheet, protectPdf, unlockPdf, isEncrypted, fillTokens,
    BN_MONTHS, BN_MONTHS_EN, toBengaliDate, fromBengaliDate, intWords, amountInWords, groupBD,
    UNITS, convertUnit, rebarKgPerM, emi, UGC_GRADES, cgpa, dateDiff,
    detectDelimiter, parseCsv, csvToJson, jsonToCsv, jwtDecode, parseColor, colorFormats, contrastRatio, kmeansPalette, buildIco, passwordEntropy,
  };
});
