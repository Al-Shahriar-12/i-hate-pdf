/*
 * I HATE PDF — tests for core-more.js.  Run: npm test
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFLib = require('@cantoo/pdf-lib');
const C = Object.assign({}, require('./core.js'), require('./core-more.js'));
let pdfjs = null;
try { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); } catch (e) { /* interop test skipped */ }

async function makePdf(n) {
  const d = await PDFLib.PDFDocument.create();
  const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) d.addPage([600, 800]).drawText('Page ' + i, { x: 20, y: 20, size: 12, font: f });
  return d.save();
}

test('crop respects visual margins, including rotated pages', async () => {
  const a = await makePdf(2);
  const rot = (await C.rotatePdf(PDFLib, a, 90, '2')).bytes;
  const r = await C.cropPdf(PDFLib, rot, { top: 10, right: 0, bottom: 0, left: 0 });
  const d = await PDFLib.PDFDocument.load(r.bytes);
  const p1 = d.getPage(0).getCropBox(), p2 = d.getPage(1).getCropBox();
  const mm10 = 10 * 72 / 25.4;
  assert.ok(Math.abs(p1.height - (800 - mm10)) < 0.01, 'unrotated: height shrinks');
  assert.ok(Math.abs(p2.width - (600 - mm10)) < 0.01 && Math.abs(p2.x - mm10) < 0.01, 'rotated 90: visual top is the page’s left side');
  await assert.rejects(C.cropPdf(PDFLib, a, { top: 400, bottom: 400 }), /almost nothing/);
});

test('headers, footers and pages per sheet', async () => {
  const a = await makePdf(5);
  const hf = await C.headerFooter(PDFLib, a, { header: { left: '{file}' }, footer: { right: 'Page {n} of {total}' }, file: 'report.pdf' });
  assert.equal(hf.count, 5);
  assert.equal(C.fillTokens('{n}/{total}', { n: 2, total: 9 }), '2/9');
  await assert.rejects(C.headerFooter(PDFLib, a, {}), /at least one/);
  const rot = (await C.rotatePdf(PDFLib, a, 90, '1')).bytes;
  const n = await C.pagesPerSheet(PDFLib, rot, { per: 4, border: true });
  assert.equal(n.sheets, 2);
  const two = await C.pagesPerSheet(PDFLib, a, { per: 2 });
  const d = await PDFLib.PDFDocument.load(two.bytes);
  assert.equal(d.getPageCount(), 3);
  assert.ok(d.getPage(0).getWidth() > d.getPage(0).getHeight(), '2-up uses a landscape sheet');
});

test('protect with AES-256 and unlock again', async () => {
  const a = await makePdf(3);
  const locked = await C.protectPdf(PDFLib, a, { userPassword: 'secret-123', allowCopying: false });
  assert.equal(await C.isEncrypted(PDFLib, locked), true);
  await assert.rejects(C.inspectPdf(PDFLib, locked), /Unlock PDF/);
  await assert.rejects(C.unlockPdf(PDFLib, locked, 'wrong'), /isn’t correct/);
  const open = await C.unlockPdf(PDFLib, locked, 'secret-123');
  assert.equal(await C.isEncrypted(PDFLib, open), false);
  assert.equal((await PDFLib.PDFDocument.load(open)).getPageCount(), 3);
  await assert.rejects(C.protectPdf(PDFLib, a, { userPassword: 'ab' }), /at least 4/);
  if (pdfjs) { // interoperability: a separate PDF engine opens the encrypted file with the password
    const doc = await pdfjs.getDocument({ data: new Uint8Array(locked), password: 'secret-123', isEvalSupported: false }).promise;
    assert.equal(doc.numPages, 3);
    await doc.destroy();
  }
});

test('Bengali calendar matches national days (revised 2019 calendar)', () => {
  const f = (y, m, d) => { const b = C.toBengaliDate(y, m, d); return b.day + ' ' + b.monthName + ' ' + b.year; };
  assert.equal(f(2026, 4, 14), '1 বৈশাখ 1433');
  assert.equal(f(2026, 2, 21), '8 ফাল্গুন 1432');
  assert.equal(f(2026, 3, 26), '12 চৈত্র 1432');
  assert.equal(f(2025, 12, 16), '1 পৌষ 1432');
  assert.equal(f(2028, 3, 14), '30 ফাল্গুন 1434', 'leap-year Falgun has 30 days');
  assert.equal(f(2026, 4, 13), '30 চৈত্র 1432');
  assert.equal(C.toBengaliDate(2026, 10, 26).weekday, 'সোমবার');
  assert.deepEqual(C.fromBengaliDate(1432, 10, 8), { y: 2026, m: 2, d: 21 });
  assert.deepEqual(C.fromBengaliDate(1433, 0, 1), { y: 2026, m: 4, d: 14 });
});

test('amounts in words, Bangladesh system', () => {
  assert.equal(C.amountInWords('125000', 'en'), 'Taka One Lakh Twenty-five Thousand Only');
  assert.equal(C.amountInWords('15,25,30,450.50', 'en'), 'Taka Fifteen Crore Twenty-five Lakh Thirty Thousand Four Hundred Fifty and Fifty Poisha Only');
  assert.equal(C.amountInWords('1999', 'bn'), 'এক হাজার নয়শ নিরানব্বই টাকা মাত্র');
  assert.equal(C.amountInWords('১২৫০০০', 'bn'), 'এক লক্ষ পঁচিশ হাজার টাকা মাত্র');
  assert.equal(C.intWords(0, 'en'), 'zero');
  assert.equal(C.groupBD(1234567.5), '12,34,567.5');
});

test('engineering units and calculators', () => {
  const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b)), a + ' ≈ ' + b);
  near(C.convertUnit('force', 1, 'kip', 'kN'), 4.4482216152605);
  near(C.convertUnit('stress', 1, 'ksi', 'MPa (N/mm²)'), 6.894757293168);
  near(C.convertUnit('moment', 1, 'kip·ft', 'kN·m'), 1.3558179483314);
  near(C.convertUnit('area', 1, 'bigha (20 katha)', 'ft²'), 14400, 1e-9);
  near(C.convertUnit('area', 100, 'decimal (shotangsho)', 'acre'), 1);
  near(C.convertUnit('temperature', 100, '°C', '°F'), 212);
  near(C.convertUnit('unit weight', 150, 'lbf/ft³ (pcf)', 'kN/m³'), 23.563, 1e-4);
  near(C.rebarKgPerM(16), 1.5802469, 1e-6);
  const e = C.emi(100000, 12, 12);
  near(e.payment, 8884.878867, 1e-8);
  near(e.rows[11].balance, 0, 1e-6);
  assert.equal(C.emi(1200, 0, 12).payment, 100);
  const g = C.cgpa([{ credit: 3, grade: 'A+' }, { credit: 1.5, grade: 'B' }]);
  near(g.cgpa, (12 + 4.5) / 4.5);
  assert.deepEqual(C.dateDiff({ y: 2000, m: 2, d: 29 }, { y: 2026, m: 10, d: 26 }).years, 26);
  const dd = C.dateDiff({ y: 2026, m: 1, d: 31 }, { y: 2026, m: 3, d: 1 });
  assert.equal(dd.totalDays, 29);
});

test('CSV, JSON, JWT, colours, palette, ICO', () => {
  const csv = 'name,age,city\n"Rahim, Jr.",24,Dhaka\nKarim,031,"He said ""hi"""\n';
  const j = C.csvToJson(csv);
  assert.deepEqual(j[0], { name: 'Rahim, Jr.', age: 24, city: 'Dhaka' });
  assert.equal(j[1].age, '031', 'leading zeros stay text');
  assert.equal(j[1].city, 'He said "hi"');
  assert.equal(C.detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(C.jsonToCsv([{ a: 1, b: { c: 'x,y' } }]), 'a,b.c\n1,"x,y"');
  assert.throws(() => C.parseCsv('a,"b\n1,2'), /never closed/);
  const tok = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const jw = C.jwtDecode(tok);
  assert.equal(jw.header.alg, 'HS256');
  assert.equal(jw.payload.name, 'John Doe');
  assert.throws(() => C.jwtDecode('abc'), /three parts/);
  assert.equal(C.colorFormats(C.parseColor('#7657ff')).hex, '#7657FF');
  assert.deepEqual(C.parseColor('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0 });
  assert.equal(C.colorFormats({ r: 0, g: 0, b: 0 }).cmyk, 'cmyk(0%, 0%, 0%, 100%)');
  assert.ok(Math.abs(C.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 1e-9);
  const pal = C.kmeansPalette([255, 0, 0, 250, 5, 5, 0, 0, 255, 2, 2, 250, 0, 0, 255], 2);
  assert.equal(pal.length, 2);
  assert.ok(pal[0].b > 200 && pal[0].share === 0.6);
  const ico = C.buildIco([{ size: 16, png: new Uint8Array([1, 2, 3]) }, { size: 256, png: new Uint8Array([4, 5]) }]);
  assert.deepEqual(Array.from(ico.slice(0, 6)), [0, 0, 1, 0, 2, 0]);
  assert.equal(ico[6 + 16], 0, '256 px is stored as 0');
  assert.equal(ico.length, 6 + 32 + 5);
  assert.equal(C.passwordEntropy(16, 94), 105);
});
