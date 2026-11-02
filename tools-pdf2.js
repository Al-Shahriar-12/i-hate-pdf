/*!
 * I HATE PDF — v1.1 PDF tools and OCR
 */
(function () {
  'use strict';
  const MAS = window.MAS, Core = window.MASCore;
  const UserError = Core.UserError;
  const pages = (n) => n + (n === 1 ? ' page' : ' pages');

  async function inspectPdf(entry) {
    const PDFLib = await MAS.lib('pdflib');
    const meta = await Core.inspectPdf(PDFLib, new Uint8Array(await entry.file.arrayBuffer()));
    return { info: pages(meta.pages), meta };
  }
  const one = { types: ['pdf'], multiple: false, maxMB: 200, inspect: inspectPdf };
  const out = (ctx, bytes, f, suffix, extra) => ctx.out(bytes, Core.outName(f.file.name, suffix, 'pdf'), extra);

  MAS.impl['crop-pdf'] = Object.assign({}, one, {
    action: 'Crop PDF', actionIcon: 'crop',
    options: [
      { id: 'top', type: 'number', label: 'Top (mm)', default: 10, min: 0 },
      { id: 'bottom', type: 'number', label: 'Bottom (mm)', default: 10, min: 0 },
      { id: 'left', type: 'number', label: 'Left (mm)', default: 10, min: 0 },
      { id: 'right', type: 'number', label: 'Right (mm)', default: 10, min: 0 },
      { id: 'pages', type: 'text', label: 'Pages (optional)', default: '', placeholder: 'All pages', help: 'Margins are measured as the page looks on screen, even on rotated pages.', wide: true },
    ],
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      ctx.status('Cropping');
      const r = await Core.cropPdf(PDFLib, await ctx.bytes(f), ctx.opts, ctx.opts.pages);
      ctx.summary.push(pages(r.count) + ' cropped.');
      return [out(ctx, r.bytes, f, 'cropped')];
    },
  });

  MAS.impl['header-footer-pdf'] = Object.assign({}, one, {
    action: 'Add headers and footers', actionIcon: 'list-ordered',
    options: [
      { id: 'hl', type: 'text', label: 'Header left', default: '{file}' },
      { id: 'hc', type: 'text', label: 'Header centre', default: '' },
      { id: 'hr', type: 'text', label: 'Header right', default: '{date}' },
      { id: 'fl', type: 'text', label: 'Footer left', default: '' },
      { id: 'fc', type: 'text', label: 'Footer centre', default: '' },
      { id: 'fr', type: 'text', label: 'Footer right', default: 'Page {n} of {total}', help: 'Use {n} for the page number, {total} for the page count, {date} for today and {file} for the file name.' },
      { id: 'size', type: 'range', label: 'Text size', default: 9, min: 7, max: 16, format: (v) => v + ' pt' },
      { id: 'from', type: 'number', label: 'Start on page', default: 1, min: 1 },
      { id: 'color', type: 'color', label: 'Colour', default: '#374151' },
    ],
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0], o = ctx.opts;
      const r = await Core.headerFooter(PDFLib, await ctx.bytes(f), {
        header: { left: o.hl, center: o.hc, right: o.hr }, footer: { left: o.fl, center: o.fc, right: o.fr },
        size: o.size, from: o.from, color: o.color, file: f.file.name,
      });
      ctx.summary.push('Headers and footers added to ' + pages(r.count) + '.');
      return [out(ctx, r.bytes, f, 'headers')];
    },
  });

  MAS.impl['pages-per-sheet'] = Object.assign({}, one, {
    action: 'Arrange pages', actionIcon: 'layout-grid',
    options: [
      { id: 'per', type: 'segmented', label: 'Pages per sheet', default: '4', options: [['2', '2'], ['4', '4'], ['6', '6'], ['8', '8'], ['9', '9'], ['16', '16']] },
      { id: 'sheet', type: 'segmented', label: 'Sheet size', default: 'a4', options: [['a4', 'A4'], ['letter', 'Letter']] },
      { id: 'order', type: 'segmented', label: 'Order', default: 'row', options: [['row', 'Across, then down'], ['column', 'Down, then across']] },
      { id: 'border', type: 'checkbox', label: 'Borders', checkLabel: 'Draw a thin border around each page', default: true },
    ],
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      ctx.status('Arranging pages');
      const r = await Core.pagesPerSheet(PDFLib, await ctx.bytes(f), { per: Number(ctx.opts.per), sheet: ctx.opts.sheet, order: ctx.opts.order, border: ctx.opts.border, signal: ctx.signal });
      ctx.summary.push(pages(f.meta.pages) + ' on ' + r.sheets + (r.sheets === 1 ? ' sheet.' : ' sheets.'));
      return [out(ctx, r.bytes, f, ctx.opts.per + '-up')];
    },
  });

  MAS.impl['grayscale-pdf'] = Object.assign({}, one, {
    action: 'Convert to grayscale', actionIcon: 'image-minus', limitNote: 'Up to 300 pages.',
    options: [
      { id: 'dpi', type: 'segmented', label: 'Resolution', default: '150', options: [['100', '100 DPI'], ['150', '150 DPI'], ['200', '200 DPI']], help: 'Pages become grayscale images. Higher resolution keeps small text sharper but makes a larger file.' },
      { id: 'quality', type: 'range', label: 'Image quality', default: 0.8, min: 0.5, max: 0.95, step: 0.05, format: (v) => Math.round(v * 100) + '%' },
    ],
    validate: (st) => (st.files[0] && st.files[0].meta && st.files[0].meta.pages > 300 ? 'Choose a PDF with 300 pages or fewer.' : ''),
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      const pdf = await MAS.openPdfJs(await ctx.bytes(f));
      const images = [], sizes = [];
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          ctx.check();
          ctx.progress((n - 1) / pdf.numPages, 'Converting page ' + n + ' of ' + pdf.numPages);
          const r = await MAS.renderPdfPage(pdf, n, Number(ctx.opts.dpi) / 72);
          const c = r.canvas, cx = c.getContext('2d');
          const img = cx.getImageData(0, 0, c.width, c.height), d = img.data;
          for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; }
          cx.putImageData(img, 0, 0);
          const blob = await MAS.canvasToBlob(c, 'image/jpeg', Number(ctx.opts.quality));
          images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), kind: 'jpg', width: c.width, height: c.height });
          sizes.push([r.pageW, r.pageH]);
          c.width = c.height = 0;
          await ctx.tick();
        }
      } finally { pdf.destroy(); }
      ctx.status('Building the PDF');
      const bytes = await Core.imagesToPdf(PDFLib, images, { exactSizes: sizes, signal: ctx.signal });
      ctx.summary.push(pages(images.length) + ' converted to grayscale. Text is now part of the page images.');
      return [out(ctx, bytes, f, 'grayscale')];
    },
  });

  MAS.impl['protect-pdf'] = Object.assign({}, one, {
    action: 'Protect PDF', actionIcon: 'lock',
    options: [
      { id: 'pw', type: 'password', label: 'Password', default: '', placeholder: 'At least 4 characters', help: 'Anyone opening the file will need this password. It can’t be recovered if you forget it.' },
      { id: 'pw2', type: 'password', label: 'Type it again', default: '' },
      { id: 'allowPrinting', type: 'checkbox', label: 'Printing', checkLabel: 'Allow printing', default: true },
      { id: 'allowCopying', type: 'checkbox', label: 'Copying', checkLabel: 'Allow copying text', default: true },
      { id: 'allowEditing', type: 'checkbox', label: 'Editing', checkLabel: 'Allow editing and comments', default: false },
    ],
    validate: (st) => {
      const a = String(st.opts.pw || ''), b = String(st.opts.pw2 || '');
      if (a.length < 4) return 'Enter a password of at least 4 characters.';
      if (a !== b) return 'The two passwords don’t match.';
      return '';
    },
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      ctx.status('Encrypting with AES-256');
      const bytes = await Core.protectPdf(PDFLib, await ctx.bytes(f), { userPassword: ctx.opts.pw, allowPrinting: ctx.opts.allowPrinting, allowCopying: ctx.opts.allowCopying, allowEditing: ctx.opts.allowEditing });
      ctx.summary.push('Protected with AES-256. Permissions are respected by most PDF apps, but only the password truly protects the content.');
      return [out(ctx, bytes, f, 'protected')];
    },
  });

  MAS.impl['unlock-pdf'] = {
    types: ['pdf'], multiple: false, maxMB: 200, action: 'Unlock PDF', actionIcon: 'key-round',
    async inspect(entry) {
      const PDFLib = await MAS.lib('pdflib');
      const enc = await Core.isEncrypted(PDFLib, new Uint8Array(await entry.file.arrayBuffer()));
      return { info: enc ? 'password-protected' : 'not protected', meta: { encrypted: enc } };
    },
    options: [{ id: 'pw', type: 'password', label: 'Password', default: '', placeholder: 'The PDF’s password', help: 'Only unlock files you own or are allowed to open.' }],
    validate: (st) => {
      if (st.files[0] && st.files[0].meta && !st.files[0].meta.encrypted) return 'This PDF isn’t password-protected, so there’s nothing to unlock.';
      return '';
    },
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      ctx.status('Decrypting');
      const bytes = await Core.unlockPdf(PDFLib, await ctx.bytes(f), ctx.opts.pw);
      ctx.summary.push('Password removed. You can now use this copy with every other tool.');
      return [out(ctx, bytes, f, 'unlocked')];
    },
    next: ['merge-pdf', 'compress-pdf', 'organize-pdf'],
  };

  /* ---------- OCR (Tesseract.js, English + Bengali, files served from this site) ---------- */
  let ocrWorker = null, ocrLangs = '';
  async function getOcr(langs, onLog) {
    const T = await MAS.lib('tesseract');
    if (ocrWorker && ocrLangs === langs) return ocrWorker;
    if (ocrWorker) { try { await ocrWorker.terminate(); } catch (e) { /* ignore */ } ocrWorker = null; }
    const base = MAS.abs('./').replace(/\/$/, '');
    ocrWorker = await T.createWorker(langs.split('+'), 1, {
      workerPath: MAS.abs('tesseract-worker.min.js'), corePath: base, langPath: base, gzip: true,
      logger: (m) => { if (MAS._ocrLog) MAS._ocrLog(m); },
      errorHandler: () => {},
    });
    ocrLangs = langs;
    void onLog;
    return ocrWorker;
  }
  MAS.impl['ocr'] = {
    types: ['jpeg', 'png', 'webp', 'bmp', 'gif', 'pdf'], multiple: true, max: 30, maxMB: 50, totalMB: 200, action: 'Read text', actionIcon: 'scan-text', doneTitle: 'Text recognised',
    limitNote: 'Up to 50 PDF pages per run. The first run downloads about 7–11 MB of engine and language data; after that it works offline.',
    options: [
      { id: 'lang', type: 'segmented', label: 'Language', default: 'eng+ben', options: [['eng', 'English'], ['ben', 'বাংলা'], ['eng+ben', 'Both']] },
      { id: 'output', type: 'segmented', label: 'Output', default: 'text', options: [['text', 'Text'], ['pdf', 'Searchable PDF']], help: (o) => (o.output === 'pdf' ? 'A PDF of your pages with an invisible text layer, so you can search and copy.' : 'Plain text you can copy or download.') },
    ],
    async run(ctx) {
      const pagesToRead = [];
      for (const f of ctx.files) {
        if (f.type === 'pdf') {
          const pdf = await MAS.openPdfJs(await ctx.bytes(f));
          if (pdf.numPages > 50) { pdf.destroy(); throw new UserError('“' + f.file.name + '” has ' + pdf.numPages + ' pages. OCR handles up to 50 pages per run; split it first.'); }
          for (let n = 1; n <= pdf.numPages; n++) pagesToRead.push({ name: f.file.name, page: n, pdf, last: n === pdf.numPages });
        } else pagesToRead.push({ name: f.file.name, file: f.file });
      }
      MAS._ocrLog = (m) => {
        if (m.status === 'recognizing text') return;
        ctx.status(/load|init/i.test(m.status) ? 'Preparing the OCR engine (first time only)…' : m.status);
      };
      let worker;
      try { worker = await getOcr(ctx.opts.lang); }
      catch (e) { throw new UserError('The OCR engine couldn’t start. Check your connection for the first run, then try again.'); }
      const texts = [], pdfParts = [];
      try {
        for (let k = 0; k < pagesToRead.length; k++) {
          ctx.check();
          const p = pagesToRead[k];
          const label = p.page ? p.name + ', page ' + p.page : p.name;
          ctx.progress(k / pagesToRead.length, 'Reading ' + label + ' (' + (k + 1) + ' of ' + pagesToRead.length + ')');
          let src = p.file, canvas = null;
          if (p.pdf) { canvas = (await MAS.renderPdfPage(p.pdf, p.page, 2.6)).canvas; src = canvas; }
          const r = await worker.recognize(src, {}, { text: true, pdf: ctx.opts.output === 'pdf' });
          texts.push((pagesToRead.length > 1 ? '--- ' + label + ' ---\n' : '') + (r.data.text || '').trim());
          if (r.data.pdf) pdfParts.push(new Uint8Array(r.data.pdf));
          if (canvas) canvas.width = canvas.height = 0;
          if (p.last) p.pdf.destroy();
          await ctx.tick();
        }
      } finally { MAS._ocrLog = null; }
      const text = texts.join('\n\n');
      const chars = text.replace(/\s|-{3}.*-{3}/g, '').length;
      ctx.summary.push(chars ? chars.toLocaleString() + ' characters from ' + pagesToRead.length + (pagesToRead.length === 1 ? ' image or page.' : ' images or pages.') + ' Proofread names and numbers.' : 'No text was found. Try a sharper image, or the other language setting.');
      const base = Core.baseName(ctx.files[0].file.name);
      if (ctx.opts.output === 'pdf') {
        const PDFLib = await ctx.lib('pdflib');
        const merged = pdfParts.length === 1 ? pdfParts[0] : await Core.mergePdfs(PDFLib, pdfParts, { signal: ctx.signal });
        return [ctx.out(merged, Core.safeFileName(base, 'ocr') + '-searchable.pdf'), ctx.textOut(text, Core.safeFileName(base, 'ocr') + '-text.txt')];
      }
      return [ctx.textOut(text, Core.safeFileName(base, 'ocr') + '-text.txt')];
    },
  };
})();
