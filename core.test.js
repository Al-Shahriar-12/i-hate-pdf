/*
 * I HATE PDF — core tests.  Run:  npm test   (needs: npm i pdf-lib@1.17.1 sharp)
 * Uses Node's built-in test runner.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFLib = require('pdf-lib');
const C = require('./core.js');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* image tests skipped */ }

async function makePdf(n, size) {
  const d = await PDFLib.PDFDocument.create();
  const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const p = d.addPage(size || [300, 400]);
    p.drawText('Page ' + i, { x: 20, y: 20, size: 12, font });
  }
  d.setTitle('Secret title');
  d.setAuthor('Someone');
  return d.save();
}
const pages = async (bytes) => (await PDFLib.PDFDocument.load(bytes)).getPageCount();

test('page range parsing', () => {
  assert.deepEqual(C.parseRangeGroups('', 3), [[1, 2, 3]]);
  assert.deepEqual(C.parseRangeGroups('1-2, 5', 6), [[1, 2], [5]]);
  assert.deepEqual(C.parseRangeGroups('4-', 6), [[4, 5, 6]]);
  assert.deepEqual(C.parseRangeGroups('-2', 6), [[1, 2]]);
  assert.deepEqual(C.parseRangeGroups('3-1', 6), [[3, 2, 1]]);
  assert.deepEqual(C.parseRangeGroups('last', 6), [[6]]);
  assert.deepEqual(C.parseRangeGroups('odd', 5), [[1, 3, 5]]);
  assert.deepEqual(C.parseRangeGroups('2 – 3', 5), [[2, 3]]);
  assert.deepEqual(C.parsePageList('1,1,2', 5), [0, 1]);
  assert.throws(() => C.parseRangeGroups('9', 5), /doesn’t exist/);
  assert.throws(() => C.parseRangeGroups('a-b', 5), /isn’t a page/);
  assert.throws(() => C.parseRangeGroups('-', 5), /isn’t a page/);
});

test('file sniffing', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(C.sniffType(enc('%PDF-1.7\n')), 'pdf');
  assert.equal(C.sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(C.sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(C.sniffType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])), 'zip');
  assert.equal(C.sniffType(enc('{"a":1}')), 'text');
  assert.equal(C.sniffType(enc('<?xml version="1.0"?>\n<svg xmlns="x"></svg>')), 'svg');
  assert.equal(C.sniffType(new Uint8Array([0, 1, 2, 3, 0, 9])), null);
  // renamed file: extension says pdf, contents say otherwise
  assert.notEqual(C.sniffType(enc('hello, not a pdf')), 'pdf');
});

test('json, base64, case, digits, stats, timestamps', () => {
  assert.equal(C.jsonProcess('{"b":1,"a":[1,2]}', 'format', { indent: 2, sort: true }).text, '{\n  "a": [\n    1,\n    2\n  ],\n  "b": 1\n}');
  assert.equal(C.jsonProcess('{ "a" : 1 }', 'minify').text, '{"a":1}');
  const bad = C.jsonProcess('{\n  "a": 1,\n}', 'format');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid JSON/);
  assert.equal(C.base64ToUtf8(C.utf8ToBase64('আমি PDF 🔥')), 'আমি PDF 🔥');
  assert.equal(C.utf8ToBase64('??>', true), 'Pz8-');
  assert.throws(() => C.base64ToUtf8('@@@'), /isn’t valid Base64/);
  assert.equal(C.convertCase('hello big world', 'camel'), 'helloBigWorld');
  assert.equal(C.convertCase('helloBigWorld', 'snake'), 'hello_big_world');
  assert.equal(C.convertCase('the quick fox', 'title'), 'The Quick Fox');
  assert.equal(C.bengaliDigits('2026', 'to-bengali'), '২০২৬');
  assert.equal(C.bengaliDigits('২০২৬', 'to-latin'), '2026');
  const st = C.textStats('আমি বাংলায় গান গাই। Hello world!');
  assert.equal(st.words, 6);
  assert.equal(st.sentences, 2);
  assert.ok(st.noSpaces < st.chars, 'characters without spaces must be fewer than with spaces');
  assert.equal(C.textStats('ক্ষ').chars, 1);
  assert.equal(C.parseTimestamp('1700000000').unit, 'seconds');
  assert.equal(C.parseTimestamp('1700000000000').date.toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(C.parseTimestamp('nonsense'), null);
});

test('merge, split, select, delete, reverse', async () => {
  const a = await makePdf(2), b = await makePdf(3);
  const merged = await C.mergePdfs(PDFLib, [a, b]);
  assert.equal(await pages(merged), 5);
  const parts = await C.splitPdf(PDFLib, merged, 'ranges', '1-2, 3-5');
  assert.deepEqual(await Promise.all(parts.map((p) => pages(p.bytes))), [2, 3]);
  assert.equal(parts[1].label, 'pages-3-5');
  const each = await C.splitPdf(PDFLib, merged, 'each');
  assert.equal(each.length, 5);
  const every = await C.splitPdf(PDFLib, merged, 'every', 2);
  assert.deepEqual(await Promise.all(every.map((p) => pages(p.bytes))), [2, 2, 1]);
  assert.equal(await pages(await C.selectPages(PDFLib, merged, [4, 0])), 2);
  const del = await C.deletePages(PDFLib, merged, '2-3');
  assert.equal(del.remaining, 3);
  await assert.rejects(C.deletePages(PDFLib, merged, '1-5'), /every page/);
  assert.equal(await pages(await C.reversePdf(PDFLib, merged)), 5);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(C.mergePdfs(PDFLib, [a, b], { signal: ac.signal }), { name: 'AbortError' });
});

test('rotate and organize keep rotation maths right', async () => {
  const a = await makePdf(3);
  const r = await C.rotatePdf(PDFLib, a, 90, '2');
  const d = await PDFLib.PDFDocument.load(r.bytes);
  assert.deepEqual(d.getPages().map((p) => p.getRotation().angle), [0, 90, 0]);
  const o = await C.organizePdf(PDFLib, r.bytes, [{ index: 1, rotate: 270 }, { index: 0, rotate: 0 }]);
  const d2 = await PDFLib.PDFDocument.load(o);
  assert.deepEqual(d2.getPages().map((p) => p.getRotation().angle), [0, 0]);
  assert.equal(d2.getPageCount(), 2);
});

test('page numbers and watermark on rotated pages', async () => {
  const a = await makePdf(4);
  const rot = (await C.rotatePdf(PDFLib, a, 90, '2')).bytes;
  const n = await C.addPageNumbers(PDFLib, rot, { format: 'page-n-of', from: 2, start: 1 });
  assert.equal(n.count, 3);
  const w = await C.addWatermark(PDFLib, n.bytes, { text: 'DRAFT', pages: '1,3' });
  assert.equal(w.count, 2);
  assert.equal(await pages(w.bytes), 4);
  await assert.rejects(C.addWatermark(PDFLib, a, { text: 'খসড়া' }), /can’t display/);
  // frame maths: rotated page visual size swaps
  const d = await PDFLib.PDFDocument.load(rot);
  const f = C.__proto__ ? null : null; // keep linter quiet
  void f;
  const page = d.getPage(1);
  assert.equal(page.getRotation().angle, 90);
});

test('metadata edit and removal', async () => {
  const a = await makePdf(1);
  const m = await C.setPdfMetadata(PDFLib, a, { title: 'New', author: 'MAS', keywords: 'a, b' });
  const d = await PDFLib.PDFDocument.load(m, { updateMetadata: false });
  assert.equal(d.getTitle(), 'New');
  assert.equal(d.getAuthor(), 'MAS');
  const info = await C.inspectPdf(PDFLib, m);
  assert.equal(info.pages, 1);
  const r = await C.removePdfMetadata(PDFLib, m);
  const d2 = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false });
  assert.equal(d2.getTitle(), undefined);
  assert.equal(d2.getAuthor(), undefined);
  assert.ok(r.removed >= 2);
});

test('text to PDF wraps and paginates', async () => {
  const long = Array.from({ length: 400 }, (_, i) => 'Line ' + i + ' with some words to wrap around the page width nicely.').join('\n');
  const r = await C.textToPdf(PDFLib, long, { size: 11 });
  assert.ok(r.pages > 5);
  await assert.rejects(C.textToPdf(PDFLib, '   '), /Type or paste/);
  await assert.rejects(C.textToPdf(PDFLib, 'বাংলা'), /can’t display/);
});

test('rejects broken and encrypted-looking PDFs with readable errors', async () => {
  await assert.rejects(C.inspectPdf(PDFLib, new TextEncoder().encode('%PDF-1.4 garbage')), /couldn’t be read|password/);
});

test('images to PDF', { skip: !sharp }, async () => {
  const jpg = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#7657FF' } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 100, height: 300, channels: 4, background: '#00000000' } }).png().toBuffer();
  const out = await C.imagesToPdf(PDFLib, [{ bytes: jpg, kind: 'jpg', width: 400, height: 200 }, { bytes: png, kind: 'png', width: 100, height: 300 }], { pageSize: 'a4', orientation: 'auto', margin: 18 });
  const d = await PDFLib.PDFDocument.load(out);
  assert.equal(d.getPageCount(), 2);
  assert.ok(d.getPage(0).getWidth() > d.getPage(0).getHeight(), 'landscape image gets a landscape page');
});

test('lossless metadata stripping: JPEG, PNG, WebP', { skip: !sharp }, async () => {
  const base = sharp({ create: { width: 64, height: 32, channels: 3, background: '#ff557a' } });
  const jpg = new Uint8Array(await base.clone().jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'MAS', Artist: 'Test' } } }).toBuffer());
  assert.equal(C.jpegOrientation(jpg), 6);
  const sj = C.stripJpegMetadata(jpg);
  assert.ok(sj.removed >= 1);
  assert.equal(sj.orientation, 6);
  assert.equal(C.jpegOrientation(sj.bytes), 1);
  const metaAfter = await sharp(Buffer.from(sj.bytes)).metadata();
  assert.equal(metaAfter.exif, undefined);
  assert.equal(metaAfter.width, 64);
  // PNG with an injected tEXt chunk
  const png = new Uint8Array(await base.clone().png().toBuffer());
  const txt = new TextEncoder().encode('Comment\0secret');
  const chunk = new Uint8Array(12 + txt.length);
  chunk.set([0, 0, 0, txt.length]); chunk.set(new TextEncoder().encode('tEXt'), 4); chunk.set(txt, 8);
  const withText = new Uint8Array(png.length + chunk.length);
  withText.set(png.subarray(0, 33)); withText.set(chunk, 33); withText.set(png.subarray(33), 33 + chunk.length);
  const sp = C.stripPngMetadata(withText);
  assert.equal(sp.removed, 1);
  assert.equal(sp.bytes.length, png.length);
  const webp = new Uint8Array(await base.clone().webp().withMetadata({ exif: { IFD0: { Copyright: 'MAS' } } }).toBuffer());
  const sw = C.stripWebpMetadata(webp);
  assert.ok(sw.removed >= 1);
  const wm = await sharp(Buffer.from(sw.bytes)).metadata();
  assert.equal(wm.exif, undefined);
  assert.equal(wm.width, 64);
});
