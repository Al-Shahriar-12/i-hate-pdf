/*!
 * I HATE PDF — processing core
 * MAS Studio Production
 * Pure functions with no DOM access, so they run in the browser and in Node tests.
 * PDF functions receive the pdf-lib module as their first argument.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MASCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PRODUCER = 'I HATE PDF by MAS Studio';

  /* ---------- small helpers ---------- */

  class UserError extends Error {
    constructor(message) { super(message); this.name = 'UserError'; this.userFacing = true; }
  }

  function abortError() {
    const e = new Error('Cancelled');
    e.name = 'AbortError';
    return e;
  }

  function checkAbort(signal) {
    if (signal && signal.aborted) throw abortError();
  }

  function seq(a, b) {
    const out = [];
    if (a <= b) for (let i = a; i <= b; i++) out.push(i);
    else for (let i = a; i >= b; i--) out.push(i);
    return out;
  }

  function formatBytes(n) {
    if (!isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB'];
    let v = n / 1024, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + units[u];
  }

  function percentChange(before, after) {
    if (!before) return 0;
    return Math.round(((after - before) / before) * 100);
  }

  function baseName(name) {
    const n = String(name || 'file');
    const i = n.lastIndexOf('.');
    return (i > 0 ? n.slice(0, i) : n) || 'file';
  }

  function safeFileName(name, fallback) {
    let n = String(name || '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ').trim();
    n = n.replace(/^\.+/, '').slice(0, 180);
    return n || fallback || 'file';
  }

  function outName(original, suffix, ext) {
    const b = safeFileName(baseName(original), 'file');
    return b + (suffix ? '-' + suffix : '') + '.' + ext;
  }

  /* ---------- page ranges ---------- */

  /**
   * Parse "1-3, 5, 8-, last, odd" into groups of 1-based page numbers.
   * Empty input or "all" means every page. Throws UserError with a readable message.
   */
  function parseRangeGroups(input, total) {
    if (!Number.isInteger(total) || total < 1) throw new UserError('This document has no pages.');
    const s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s || s === 'all') return [seq(1, total)];
    const groups = [];
    const num = (v) => (v === 'last' ? total : parseInt(v, 10));
    for (const raw of s.split(/[,;]+/)) {
      const t = raw.replace(/\s+/g, '').replace(/[–—]/g, '-');
      if (!t) continue;
      if (t === 'odd' || t === 'even') {
        const g = seq(1, total).filter((p) => (t === 'odd' ? p % 2 === 1 : p % 2 === 0));
        if (g.length) groups.push(g);
        continue;
      }
      let a, b, m;
      if ((m = /^(\d+|last)$/.exec(t))) { a = b = num(m[1]); }
      else if ((m = /^(\d+|last)?-(\d+|last)?$/.exec(t)) && (m[1] || m[2])) {
        a = m[1] ? num(m[1]) : 1;
        b = m[2] ? num(m[2]) : total;
      } else {
        throw new UserError('“' + raw.trim() + '” isn’t a page number or range. Use a format like 1-3, 5, 8-.');
      }
      for (const p of [a, b]) {
        if (p < 1 || p > total) throw new UserError('Page ' + p + ' doesn’t exist. This document has ' + total + (total === 1 ? ' page.' : ' pages.'));
      }
      groups.push(seq(a, b));
    }
    if (!groups.length) throw new UserError('Enter at least one page number.');
    return groups;
  }

  /** Flattened, 0-based, de-duplicated in first-seen order. */
  function parsePageList(input, total) {
    const seen = new Set();
    const out = [];
    for (const g of parseRangeGroups(input, total)) for (const p of g) if (!seen.has(p)) { seen.add(p); out.push(p - 1); }
    return out;
  }

  /* ---------- file sniffing ---------- */

  function sniffType(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const at = (arr, off) => arr.every((v, i) => b[(off || 0) + i] === v);
    if (b.length >= 5 && at([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
    if (b.length >= 3 && at([0xff, 0xd8, 0xff])) return 'jpeg';
    if (b.length >= 8 && at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (b.length >= 12 && at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
    if (b.length >= 4 && at([0x47, 0x49, 0x46, 0x38])) return 'gif';
    if (b.length >= 4 && (at([0x50, 0x4b, 0x03, 0x04]) || at([0x50, 0x4b, 0x05, 0x06]))) return 'zip';
    if (b.length >= 12 && at([0x66, 0x74, 0x79, 0x70], 4)) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (/^avi[fs]$/.test(brand)) return 'avif';
      if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(brand)) return 'heic';
    }
    if (b.length >= 4 && (at([0x49, 0x49, 0x2a, 0x00]) || at([0x4d, 0x4d, 0x00, 0x2a]))) return 'tiff';
    if (b.length >= 2 && at([0x42, 0x4d]) && b.length >= 26) return 'bmp';
    // PDF header may be preceded by junk within the first 1024 bytes
    const lim = Math.min(b.length - 5, 1024);
    for (let i = 1; i < lim; i++) {
      if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return 'pdf';
    }
    // Text-like content
    let text = true;
    const n = Math.min(b.length, 512);
    for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) { text = false; break; } }
    if (text && n > 0) {
      let head = '';
      try { head = new TextDecoder('utf-8').decode(b.subarray(0, n)).trimStart().toLowerCase(); } catch (e) { head = ''; }
      if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(head)) return 'svg';
      return 'text';
    }
    return null;
  }

  /* ---------- image metadata (lossless) ---------- */

  function readU16(b, o, le) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
  function readU32(b, o, le) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216 : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }

  /** Returns the EXIF orientation (1–8) of a JPEG, or 1 when absent. */
  function jpegOrientation(u8) {
    if (!(u8[0] === 0xff && u8[1] === 0xd8)) return 1;
    let i = 2;
    while (i + 4 < u8.length) {
      if (u8[i] !== 0xff) return 1;
      const m = u8[i + 1];
      if (m === 0xd9 || m === 0xda) return 1;
      const len = readU16(u8, i + 2, false);
      if (m === 0xe1 && u8[i + 4] === 0x45 && u8[i + 5] === 0x78 && u8[i + 6] === 0x69 && u8[i + 7] === 0x66) {
        const t = i + 10;
        const le = u8[t] === 0x49;
        const ifd = t + readU32(u8, t + 4, le);
        if (ifd + 2 > u8.length) return 1;
        const count = readU16(u8, ifd, le);
        for (let k = 0; k < count; k++) {
          const e = ifd + 2 + k * 12;
          if (e + 10 > u8.length) break;
          if (readU16(u8, e, le) === 0x0112) {
            const v = readU16(u8, e + 8, le);
            return v >= 1 && v <= 8 ? v : 1;
          }
        }
        return 1;
      }
      i += 2 + len;
    }
    return 1;
  }

  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /**
   * Remove EXIF, XMP, IPTC and comments from a JPEG without re-encoding.
   * Keeps JFIF, Adobe (colour transform) and ICC colour profile segments.
   */
  function stripJpegMetadata(u8) {
    if (!(u8[0] === 0xff && u8[1] === 0xd8)) throw new UserError('This file isn’t a valid JPEG.');
    const orientation = jpegOrientation(u8);
    const parts = [u8.subarray(0, 2)];
    let i = 2, removed = 0, removedBytes = 0;
    const isIcc = (o) => String.fromCharCode.apply(null, Array.from(u8.subarray(o + 4, o + 15))) === 'ICC_PROFILE';
    while (i < u8.length) {
      if (u8[i] !== 0xff) throw new UserError('This JPEG appears to be damaged.');
      const m = u8[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd9) { parts.push(u8.subarray(i, i + 2)); i += 2; break; }
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { parts.push(u8.subarray(i, i + 2)); i += 2; continue; }
      if (i + 4 > u8.length) throw new UserError('This JPEG appears to be damaged.');
      const len = readU16(u8, i + 2, false);
      if (len < 2 || i + 2 + len > u8.length) throw new UserError('This JPEG appears to be damaged.');
      const seg = u8.subarray(i, i + 2 + len);
      const isApp = m >= 0xe0 && m <= 0xef;
      const keep = !(m === 0xfe || (isApp && !(m === 0xe0 || m === 0xee || (m === 0xe2 && isIcc(i)))));
      if (keep) parts.push(seg); else { removed++; removedBytes += seg.length; }
      i += 2 + len;
      if (m === 0xda) {
        let j = i;
        while (j < u8.length) {
          if (u8[j] === 0xff) {
            const n = u8[j + 1];
            if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { j += 2; continue; }
            if (n === 0xff) { j += 1; continue; }
            break;
          }
          j++;
        }
        parts.push(u8.subarray(i, j));
        i = j;
      }
    }
    const trailing = u8.length - i;
    return { bytes: concat(parts), removed, removedBytes: removedBytes + Math.max(0, trailing), orientation };
  }

  /** Remove text, EXIF and timestamp chunks from a PNG without re-encoding. */
  function stripPngMetadata(u8) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!sig.every((v, k) => u8[k] === v)) throw new UserError('This file isn’t a valid PNG.');
    const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
    const parts = [u8.subarray(0, 8)];
    let i = 8, removed = 0, removedBytes = 0;
    while (i + 12 <= u8.length) {
      const len = readU32(u8, i, false);
      const type = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
      const end = i + 12 + len;
      if (end > u8.length) throw new UserError('This PNG appears to be damaged.');
      if (drop.has(type)) { removed++; removedBytes += 12 + len; } else parts.push(u8.subarray(i, end));
      i = end;
      if (type === 'IEND') break;
    }
    return { bytes: concat(parts), removed, removedBytes, orientation: 1 };
  }

  /** Remove EXIF and XMP chunks from a WebP without re-encoding. */
  function stripWebpMetadata(u8) {
    if (sniffType(u8) !== 'webp') throw new UserError('This file isn’t a valid WebP.');
    const parts = [];
    let i = 12, removed = 0, removedBytes = 0, vp8xIndex = -1;
    while (i + 8 <= u8.length) {
      const type = String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
      const size = readU32(u8, i + 4, true);
      const end = i + 8 + size + (size & 1);
      if (i + 8 + size > u8.length) throw new UserError('This WebP appears to be damaged.');
      const chunk = u8.slice(i, Math.min(end, u8.length));
      if (type === 'EXIF' || type === 'XMP ') { removed++; removedBytes += chunk.length; }
      else { if (type === 'VP8X') vp8xIndex = parts.length; parts.push(chunk); }
      i = end;
    }
    if (vp8xIndex >= 0) parts[vp8xIndex][8] &= ~(0x08 | 0x04); // clear EXIF and XMP flags
    const body = concat(parts);
    const header = new Uint8Array(12);
    header.set([0x52, 0x49, 0x46, 0x46]);
    const riff = body.length + 4;
    header[4] = riff & 255; header[5] = (riff >> 8) & 255; header[6] = (riff >> 16) & 255; header[7] = (riff >>> 24) & 255;
    header.set([0x57, 0x45, 0x42, 0x50], 8);
    return { bytes: concat([header, body]), removed, removedBytes, orientation: 1 };
  }

  /* ---------- text ---------- */

  function jsonProcess(text, mode, opts) {
    opts = opts || {};
    const src = String(text || '');
    if (!src.trim()) return { ok: false, error: 'Paste some JSON first.' };
    let value;
    try { value = JSON.parse(src); }
    catch (e) {
      const msg = String(e.message || e);
      let pos = null;
      const m = /position (\d+)/.exec(msg);
      if (m) pos = +m[1];
      let line = null, col = null;
      const lc = /line (\d+) column (\d+)/.exec(msg);
      if (lc) { line = +lc[1]; col = +lc[2]; }
      else if (pos != null) {
        const before = src.slice(0, pos).split('\n');
        line = before.length; col = before[before.length - 1].length + 1;
      }
      const clean = msg.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '').replace(/\s*\(line \d+ column \d+\)/, '');
      return { ok: false, error: 'Invalid JSON' + (line ? ' at line ' + line + ', column ' + col : '') + ': ' + clean, line, col };
    }
    const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
      ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {}) : v;
    if (opts.sort) value = sortKeys(value);
    if (mode === 'validate') return { ok: true, text: src, info: 'Valid JSON.' };
    if (mode === 'minify') return { ok: true, text: JSON.stringify(value) };
    const indent = opts.indent === 'tab' ? '\t' : Number(opts.indent) || 2;
    return { ok: true, text: JSON.stringify(value, null, indent) };
  }

  function utf8ToBase64(str, urlSafe) {
    const bytes = new TextEncoder().encode(String(str));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    let out = btoa(bin);
    if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return out;
  }

  function base64ToBytes(b64) {
    let s = String(b64 || '').trim().replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (/[^A-Za-z0-9+/=]/.test(s)) throw new UserError('This isn’t valid Base64. Only A–Z, a–z, 0–9, +, /, - , _ and = are allowed.');
    s = s.replace(/=+$/, '');
    if (s.length % 4 === 1) throw new UserError('This Base64 text has the wrong length. It may be cut off.');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function base64ToUtf8(b64) {
    const bytes = base64ToBytes(b64);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { throw new UserError('This Base64 decodes to binary data, not text. Use Base64 to Image for images.'); }
  }

  function textStats(text) {
    const s = String(text || '');
    let words = 0;
    const graphemes = (str) => {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) { let n = 0; for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)) n++; return n; } // eslint-disable-line no-unused-vars
      return Array.from(str).length;
    };
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      for (const seg of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(s)) if (seg.isWordLike) words++;
    } else {
      words = (s.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu) || []).length;
    }
    const chars = graphemes(s);
    const noSpaces = graphemes(s.replace(/\s+/g, ''));
    const sentences = (s.match(/[^.!?।]+[.!?।]+(\s|$)|[^.!?।]+$/g) || []).filter((x) => x.trim()).length;
    const paragraphs = s.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const lines = s ? s.split('\n').length : 0;
    const minutes = words / 200;
    return { words, chars, noSpaces, sentences, paragraphs, lines, readingMinutes: minutes };
  }

  function convertCase(text, mode) {
    const s = String(text || '');
    const words = () => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    switch (mode) {
      case 'upper': return s.toUpperCase();
      case 'lower': return s.toLowerCase();
      case 'title': return s.toLowerCase().replace(/(^|[\s\-–—("“'‘/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      case 'sentence': return s.toLowerCase().replace(/(^\s*|[.!?।]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      case 'camel': return words().map((w, i) => i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join('');
      case 'pascal': return words().map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
      case 'snake': return words().map((w) => w.toLowerCase()).join('_');
      case 'kebab': return words().map((w) => w.toLowerCase()).join('-');
      case 'constant': return words().map((w) => w.toUpperCase()).join('_');
      default: return s;
    }
  }

  const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  function bengaliDigits(text, direction) {
    const s = String(text || '');
    if (direction === 'to-latin') return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
    return s.replace(/[0-9]/g, (d) => BN_DIGITS[+d]);
  }

  function parseTimestamp(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      const abs = Math.abs(n);
      // Heuristic: 13+ digits are milliseconds, 16+ microseconds, 19+ nanoseconds
      let ms, unit;
      if (abs >= 1e17) { ms = n / 1e6; unit = 'nanoseconds'; }
      else if (abs >= 1e14) { ms = n / 1e3; unit = 'microseconds'; }
      else if (abs >= 1e11) { ms = n; unit = 'milliseconds'; }
      else { ms = n * 1000; unit = 'seconds'; }
      const d = new Date(ms);
      return isNaN(d) ? null : { date: d, unit };
    }
    const d = new Date(s);
    return isNaN(d) ? null : { date: d, unit: 'date' };
  }

  /* ---------- PDF (pdf-lib) ---------- */

  async function loadPdf(PDFLib, bytes, opts) {
    try {
      const doc = await PDFLib.PDFDocument.load(bytes, Object.assign({ updateMetadata: false }, opts || {}));
      if (doc.getPageCount() < 1) throw new Error('no pages');
      return doc;
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/encrypt/i.test(msg) || (e && e.name === 'EncryptedPDFError')) {
        throw new UserError('This PDF is password-protected. Use Unlock PDF first (you’ll need its password), then try again.');
      }
      throw new UserError('This PDF couldn’t be read. It may be damaged or use features this tool doesn’t support yet.');
    }
  }

  function stamp(doc) {
    doc.setProducer(PRODUCER);
    doc.setCreator(PRODUCER);
    doc.setModificationDate(new Date());
  }

  async function inspectPdf(PDFLib, bytes) {
    let doc, pages;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      pages = doc.getPageCount();
    } catch (e) { throw new UserError('This PDF couldn’t be read. It may be damaged.'); }
    if (!pages) throw new UserError('This PDF has no pages.');
    if (doc.isEncrypted) throw new UserError('This PDF is password-protected. Use Unlock PDF first (you’ll need its password), then try again.');
    return {
      pages,
      title: doc.getTitle() || '', author: doc.getAuthor() || '', subject: doc.getSubject() || '',
      keywords: doc.getKeywords() || '', creator: doc.getCreator() || '', producer: doc.getProducer() || '',
    };
  }

  async function copyInto(PDFLib, out, src, indices) {
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    return pages;
  }

  async function mergePdfs(PDFLib, list, o) {
    o = o || {};
    const out = await PDFLib.PDFDocument.create();
    for (let k = 0; k < list.length; k++) {
      checkAbort(o.signal);
      const src = await loadPdf(PDFLib, list[k]);
      await copyInto(PDFLib, out, src, src.getPageIndices());
      if (o.onProgress) o.onProgress((k + 1) / list.length);
    }
    stamp(out);
    return out.save({ useObjectStreams: true });
  }

  async function selectPages(PDFLib, bytes, indices) {
    const src = await loadPdf(PDFLib, bytes);
    if (!indices.length) throw new UserError('No pages selected.');
    const out = await PDFLib.PDFDocument.create();
    await copyInto(PDFLib, out, src, indices);
    stamp(out);
    return out.save({ useObjectStreams: true });
  }

  async function deletePages(PDFLib, bytes, input) {
    const src = await loadPdf(PDFLib, bytes);
    const total = src.getPageCount();
    const del = new Set(parsePageList(input, total));
    const keep = src.getPageIndices().filter((i) => !del.has(i));
    if (!keep.length) throw new UserError('That would delete every page. Leave at least one page.');
    return { bytes: await selectPages(PDFLib, bytes, keep), removed: del.size, remaining: keep.length };
  }

  async function splitPdf(PDFLib, bytes, mode, value, o) {
    o = o || {};
    const src = await loadPdf(PDFLib, bytes);
    const total = src.getPageCount();
    let groups;
    if (mode === 'each') groups = seq(1, total).map((p) => [p]);
    else if (mode === 'every') {
      const n = Math.max(1, Math.floor(Number(value) || 1));
      groups = [];
      for (let p = 1; p <= total; p += n) groups.push(seq(p, Math.min(total, p + n - 1)));
    } else groups = parseRangeGroups(value, total);
    const outs = [];
    for (let k = 0; k < groups.length; k++) {
      checkAbort(o.signal);
      const out = await PDFLib.PDFDocument.create();
      await copyInto(PDFLib, out, src, groups[k].map((p) => p - 1));
      stamp(out);
      const g = groups[k];
      const label = g.length === 1 ? 'page-' + g[0] : 'pages-' + g[0] + '-' + g[g.length - 1];
      outs.push({ bytes: await out.save({ useObjectStreams: true }), label });
      if (o.onProgress) o.onProgress((k + 1) / groups.length);
    }
    return outs;
  }

  /** order: [{index, rotate}] — builds a new document in that order with extra rotation. */
  async function organizePdf(PDFLib, bytes, order) {
    if (!order.length) throw new UserError('Keep at least one page.');
    const src = await loadPdf(PDFLib, bytes);
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, order.map((o) => o.index));
    pages.forEach((p, k) => {
      const extra = ((order[k].rotate || 0) % 360 + 360) % 360;
      if (extra) p.setRotation(PDFLib.degrees((p.getRotation().angle + extra) % 360));
      out.addPage(p);
    });
    stamp(out);
    return out.save({ useObjectStreams: true });
  }

  async function rotatePdf(PDFLib, bytes, angle, pagesInput) {
    const doc = await loadPdf(PDFLib, bytes);
    const total = doc.getPageCount();
    const targets = pagesInput && String(pagesInput).trim() ? parsePageList(pagesInput, total) : doc.getPageIndices();
    for (const i of targets) {
      const p = doc.getPage(i);
      p.setRotation(PDFLib.degrees(((p.getRotation().angle + Number(angle)) % 360 + 360) % 360));
    }
    stamp(doc);
    return { bytes: await doc.save({ useObjectStreams: true }), count: targets.length };
  }

  async function reversePdf(PDFLib, bytes) {
    const src = await loadPdf(PDFLib, bytes);
    return selectPages(PDFLib, bytes, src.getPageIndices().reverse());
  }

  function hexToRgb(PDFLib, hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    const v = m ? parseInt(m[1], 16) : 0;
    return PDFLib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
  }

  // Characters the built-in PDF fonts (WinAnsi encoding) can show
  const WINANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));
  function isWinAnsi(ch) {
    const c = ch.codePointAt(0);
    return (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch);
  }
  function assertEncodable(font, text, what) {
    const bad = new Set();
    for (const ch of Array.from(String(text))) {
      if (ch === '\n' || ch === '\r' || ch === '\t') continue;
      if (!isWinAnsi(ch)) bad.add(ch);
      if (bad.size >= 6) break;
    }
    if (bad.size) {
      throw new UserError(what + ' uses characters the built-in PDF fonts can’t display: ' + Array.from(bad).join(' ') +
        '. Latin text works today; Bengali and other scripts need embedded fonts, which are on the roadmap.');
    }
  }

  /** Visual-space geometry for a page, honouring /Rotate and the crop box. */
  function pageFrame(page) {
    const box = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() };
    const r = ((page.getRotation().angle % 360) + 360) % 360;
    const W = r % 180 ? box.height : box.width;
    const H = r % 180 ? box.width : box.height;
    const toPage = (vx, vy) => {
      let x, y;
      if (r === 90) { x = box.width - vy; y = vx; }
      else if (r === 180) { x = box.width - vx; y = box.height - vy; }
      else if (r === 270) { x = vy; y = box.height - vx; }
      else { x = vx; y = vy; }
      return { x: x + box.x, y: y + box.y };
    };
    return { W, H, r, toPage };
  }

  /** Draw text at a visual position (start of baseline) with a visual angle in degrees. */
  function drawVisualText(PDFLib, page, text, o) {
    const f = pageFrame(page);
    const p = f.toPage(o.vx, o.vy);
    page.drawText(text, {
      x: p.x, y: p.y, size: o.size, font: o.font, color: o.color,
      opacity: o.opacity == null ? 1 : o.opacity,
      rotate: PDFLib.degrees(((o.angle || 0) + f.r) % 360),
    });
  }

  async function addPageNumbers(PDFLib, bytes, o) {
    o = Object.assign({ position: 'bottom-center', format: 'n', start: 1, from: 1, size: 11, margin: 28, color: '#1f2937' }, o || {});
    const doc = await loadPdf(PDFLib, bytes);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const color = hexToRgb(PDFLib, o.color);
    const pages = doc.getPages();
    const total = pages.length;
    const from = Math.max(1, Math.min(total, Math.floor(Number(o.from) || 1)));
    const start = Math.floor(Number(o.start) || 1);
    const last = start + (total - from);
    const size = Math.max(6, Math.min(48, Number(o.size) || 11));
    const margin = Math.max(8, Number(o.margin) || 28);
    let count = 0;
    pages.forEach((page, i) => {
      if (i + 1 < from) return;
      const n = start + (i + 1 - from);
      const label = o.format === 'page-n' ? 'Page ' + n
        : o.format === 'page-n-of' ? 'Page ' + n + ' of ' + last
          : o.format === 'n-of' ? n + ' / ' + last
            : String(n);
      const f = pageFrame(page);
      const tw = font.widthOfTextAtSize(label, size);
      const [v, hpos] = o.position.split('-');
      const vx = hpos === 'left' ? margin : hpos === 'right' ? f.W - margin - tw : (f.W - tw) / 2;
      const vy = v === 'top' ? f.H - margin - size * 0.75 : margin;
      drawVisualText(PDFLib, page, label, { vx, vy, size, font, color });
      count++;
    });
    stamp(doc);
    return { bytes: await doc.save({ useObjectStreams: true }), count };
  }

  async function addWatermark(PDFLib, bytes, o) {
    o = Object.assign({ text: 'CONFIDENTIAL', size: 56, opacity: 0.18, angle: 45, color: '#e11d48', pages: '' }, o || {});
    const text = String(o.text || '').trim();
    if (!text) throw new UserError('Enter the watermark text.');
    const doc = await loadPdf(PDFLib, bytes);
    const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    assertEncodable(font, text, 'The watermark');
    const color = hexToRgb(PDFLib, o.color);
    const total = doc.getPageCount();
    const targets = String(o.pages || '').trim() ? parsePageList(o.pages, total) : doc.getPageIndices();
    const size = Math.max(8, Math.min(200, Number(o.size) || 56));
    const ang = (Number(o.angle) || 0) * Math.PI / 180;
    for (const i of targets) {
      const page = doc.getPage(i);
      const f = pageFrame(page);
      const tw = font.widthOfTextAtSize(text, size);
      const th = font.heightAtSize(size, { descender: false });
      const cx = f.W / 2, cy = f.H / 2;
      const ox = (tw / 2) * Math.cos(ang) - (th / 2) * Math.sin(ang);
      const oy = (tw / 2) * Math.sin(ang) + (th / 2) * Math.cos(ang);
      drawVisualText(PDFLib, page, text, { vx: cx - ox, vy: cy - oy, size, font, color, opacity: Math.max(0.03, Math.min(1, Number(o.opacity))), angle: Number(o.angle) || 0 });
    }
    stamp(doc);
    return { bytes: await doc.save({ useObjectStreams: true }), count: targets.length };
  }

  const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };

  /**
   * images: [{bytes, kind: 'jpg'|'png', width, height}] (width/height in px).
   * o.pageSize: 'fit' | 'a4' | 'letter' | 'legal' ; o.orientation: 'auto'|'portrait'|'landscape' ; o.margin in pt
   * o.exactSizes: [[w,h], ...] page sizes in pt (used by rasterized compression)
   */
  async function imagesToPdf(PDFLib, images, o) {
    o = Object.assign({ pageSize: 'a4', orientation: 'auto', margin: 0 }, o || {});
    if (!images.length) throw new UserError('Add at least one image.');
    const doc = await PDFLib.PDFDocument.create();
    for (let k = 0; k < images.length; k++) {
      checkAbort(o.signal);
      const im = images[k];
      const img = im.kind === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
      const iw = im.width || img.width, ih = im.height || img.height;
      let pw, ph;
      if (o.exactSizes && o.exactSizes[k]) { [pw, ph] = o.exactSizes[k]; }
      else if (o.pageSize === 'fit') { pw = iw + 2 * o.margin; ph = ih + 2 * o.margin; }
      else {
        const base = PAGE_SIZES[o.pageSize] || PAGE_SIZES.a4;
        const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && iw > ih);
        [pw, ph] = landscape ? [base[1], base[0]] : base;
      }
      const page = doc.addPage([pw, ph]);
      const m = o.exactSizes ? 0 : o.margin;
      const bw = pw - 2 * m, bh = ph - 2 * m;
      const scale = o.exactSizes ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih, o.pageSize === 'fit' ? 1 : Infinity);
      const dw = o.exactSizes ? pw : iw * scale, dh = o.exactSizes ? ph : ih * scale;
      page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      if (o.onProgress) o.onProgress((k + 1) / images.length);
    }
    stamp(doc);
    return doc.save({ useObjectStreams: true });
  }

  function wrapLines(font, size, text, maxWidth) {
    const out = [];
    for (const para of String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
      if (!para) { out.push(''); continue; }
      const words = para.split(/(\s+)/);
      let line = '';
      for (const w of words) {
        const trial = line + w;
        if (font.widthOfTextAtSize(trial, size) <= maxWidth) { line = trial; continue; }
        if (line.trim()) out.push(line.replace(/\s+$/, ''));
        line = w.trimStart();
        while (line && font.widthOfTextAtSize(line, size) > maxWidth) {
          let cut = line.length;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out;
  }

  async function textToPdf(PDFLib, text, o) {
    o = Object.assign({ pageSize: 'a4', font: 'Helvetica', size: 11, margin: 56, lineHeight: 1.45 }, o || {});
    if (!String(text || '').trim()) throw new UserError('Type or paste some text first.');
    const doc = await PDFLib.PDFDocument.create();
    const fonts = { Helvetica: PDFLib.StandardFonts.Helvetica, Times: PDFLib.StandardFonts.TimesRoman, Courier: PDFLib.StandardFonts.Courier };
    const font = await doc.embedFont(fonts[o.font] || fonts.Helvetica);
    assertEncodable(font, text, 'This text');
    const [pw, ph] = PAGE_SIZES[o.pageSize] || PAGE_SIZES.a4;
    const size = Math.max(6, Math.min(36, Number(o.size) || 11));
    const lh = size * o.lineHeight;
    const lines = wrapLines(font, size, text, pw - 2 * o.margin);
    let page = null, y = 0;
    for (const line of lines) {
      if (!page || y < o.margin) { page = doc.addPage([pw, ph]); y = ph - o.margin - size; }
      if (line) page.drawText(line, { x: o.margin, y, size, font, color: PDFLib.rgb(0.1, 0.12, 0.16) });
      y -= lh;
    }
    if (o.title) doc.setTitle(String(o.title));
    stamp(doc);
    return { bytes: await doc.save({ useObjectStreams: true }), pages: doc.getPageCount() };
  }

  async function setPdfMetadata(PDFLib, bytes, meta) {
    const doc = await loadPdf(PDFLib, bytes);
    doc.setTitle(meta.title || '');
    doc.setAuthor(meta.author || '');
    doc.setSubject(meta.subject || '');
    doc.setKeywords(String(meta.keywords || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean));
    doc.setProducer(PRODUCER);
    doc.setModificationDate(new Date());
    return doc.save({ useObjectStreams: true });
  }

  async function removePdfMetadata(PDFLib, bytes) {
    const doc = await loadPdf(PDFLib, bytes);
    let removed = 0;
    const info = typeof doc.getInfoDict === 'function' ? doc.getInfoDict() : null;
    if (info && info.keys) for (const k of info.keys()) { info.delete(k); removed++; }
    if (doc.catalog.has(PDFLib.PDFName.of('Metadata'))) { doc.catalog.delete(PDFLib.PDFName.of('Metadata')); removed++; }
    return { bytes: await doc.save({ useObjectStreams: true, updateFieldAppearances: false }), removed };
  }

  /** Lossless re-save with object streams; returns null when it doesn't help. */
  async function optimizePdf(PDFLib, bytes) {
    const doc = await loadPdf(PDFLib, bytes);
    return doc.save({ useObjectStreams: true, addDefaultPage: false });
  }

  return {
    PRODUCER, UserError, abortError, checkAbort, seq, formatBytes, percentChange, baseName, safeFileName, outName,
    parseRangeGroups, parsePageList, sniffType, jpegOrientation, stripJpegMetadata, stripPngMetadata, stripWebpMetadata,
    jsonProcess, utf8ToBase64, base64ToBytes, base64ToUtf8, textStats, convertCase, bengaliDigits, parseTimestamp,
    loadPdf, inspectPdf, mergePdfs, selectPages, deletePages, splitPdf, organizePdf, rotatePdf, reversePdf,
    addPageNumbers, addWatermark, imagesToPdf, textToPdf, setPdfMetadata, removePdfMetadata, optimizePdf, wrapLines, PAGE_SIZES,
    pageFrame, drawVisualText, assertEncodable, hexToRgb,
    __pageFrame: pageFrame, __drawVisualText: drawVisualText, __hexToRgb: hexToRgb, isWinAnsi,
  };
});
