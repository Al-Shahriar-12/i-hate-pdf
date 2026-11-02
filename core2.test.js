/* I HATE PDF — tests for core2.js and bijoy.js. Run: node --test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFLib = require('pdf-lib');
const C = Object.assign({}, require('./core.js'), require('./core-more.js'), require('./core2.js'));
const B = require('./bijoy.js');

test('Bengali calendar cross-check (national days, round trips)', () => {
  const t = (y, m, d) => C.toBengaliDate(y, m + 1, d);
  const pick = (r) => [r.day, r.monthName || C.BN_MONTHS[r.month - 1], r.year];
  assert.deepEqual(pick(t(2024, 3, 14)), [1, 'বৈশাখ', 1431]);
  assert.deepEqual(pick(t(2023, 11, 16)).slice(0, 2), [1, 'পৌষ']);
  assert.deepEqual(pick(t(2025, 1, 21)).slice(0, 2), [8, 'ফাল্গুন']);
  assert.deepEqual(pick(t(2024, 2, 26)).slice(0, 2), [12, 'চৈত্র']);
  assert.deepEqual(pick(t(2025, 2, 26)).slice(0, 2), [12, 'চৈত্র']);
  assert.equal(t(2024, 3, 13).year, 1430);
});

test('amount in words cross-check', () => {
  const bn = C.amountInWords('1250', 'bn', 'BDT');
  assert.match(bn, /এক হাজার/); assert.match(bn, /পঞ্চাশ/);
  assert.match(C.amountInWords('125300', 'en', 'BDT'), /lakh/i);
});

test('line diff', () => {
  const d = C.diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.equal(d.added, 2); assert.equal(d.removed, 1); assert.equal(d.same, 3);
  assert.equal(C.diffLines('A  b', 'a b', { ignoreCase: true, ignoreSpace: true }).added, 0);
  assert.equal(C.diffLines('', 'x').added, 1);
});

test('bases, text helpers, SSE parsing', () => {
  assert.deepEqual(C.numberBases('ff', 16), { bin: '11111111', oct: '377', dec: '255', hex: 'FF' });
  assert.equal(C.numberBases('-10', 10).hex, '-A');
  assert.throws(() => C.numberBases('12', 2), /base-2/);
  assert.equal(C.cleanText(' b\na\n\nb \na', { trim: true, empty: true, dedupe: true, sort: 'az' }), 'a\nb');
  assert.equal(C.htmlEncode('<a href="x">ক</a>', true), '&lt;a href=&quot;x&quot;&gt;&#2453;&lt;/a&gt;');
  assert.equal(C.lorem(5, 'words', () => 0).split(' ').length, 5);
  const got = [];
  const push = C.sseParser((d) => got.push(d));
  push('data: {"a":1}\n\nda'); push('ta: [DONE]\n\n');
  assert.deepEqual(got, ['{"a":1}', '[DONE]']);
});

test('Bijoy and Unicode both ways', () => {
  const cases = [['Avwg evsjvq Mvb MvB', 'আমি বাংলায় গান গাই'], ['wek¦we`¨vjq', 'বিশ্ববিদ্যালয়'], ['cÖ‡KŠkj', 'প্রকৌশল'], ['¯^vaxbZv', 'স্বাধীনতা'],
    ['iex›`ªbv_', 'রবীন্দ্রনাথ'], ['K…ò', 'কৃষ্ণ'], ['‡ÿÎ', 'ক্ষেত্র'], ['Kg©', 'কর্ম'], ['‰`wbK', 'দৈনিক'], ['‡`Šo', 'দৌড়'], ['wkÿK', 'শিক্ষক'], ['iv¯Ív', 'রাস্তা'], ['kZvãx', 'শতাব্দী']];
  for (const [bj, uni] of cases) {
    assert.equal(B.toUnicode(bj), uni.normalize('NFC'), bj);
    assert.equal(B.toUnicode(B.toBijoy(uni)), uni.normalize('NFC'), 'round trip ' + uni);
  }
});

async function pdf(n, rot) {
  const d = await PDFLib.PDFDocument.create();
  const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) { const p = d.addPage([600, 800]); p.drawText('P' + (i + 1), { x: 50, y: 700, size: 30, font: f }); if (rot && i === 0) p.setRotation(PDFLib.degrees(rot)); }
  return d.save();
}

test('flatten and stamp', async () => {
  const src = await pdf(5, 90);
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage();
  const form = d.getForm();
  const tf = form.createTextField('name'); tf.setText('MAS'); tf.addToPage(p, { x: 50, y: 50 });
  const fl = await C.flattenPdf(PDFLib, await d.save());
  assert.equal(fl.fields, 1);
  assert.equal((await PDFLib.PDFDocument.load(fl.bytes)).getForm().getFields().length, 0);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const st = await C.stampImagePdf(PDFLib, src, { bytes: png, kind: 'png' }, { pages: 'all', position: 'bottom-right' });
  assert.equal(st.count, 5);
});
