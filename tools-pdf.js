/*!
 * I HATE PDF — PDF tools (pdf-lib for writing, PDF.js for rendering and text)
 */
(function () {
  'use strict';
  const MAS = window.MAS, Core = window.MASCore, h = MAS.h, icon = MAS.icon;
  const UserError = Core.UserError;

  /* ---------- shared helpers ---------- */

  async function inspectPdf(entry) {
    const PDFLib = await MAS.lib('pdflib');
    const bytes = new Uint8Array(await entry.file.arrayBuffer());
    const meta = await Core.inspectPdf(PDFLib, bytes);
    return { info: meta.pages + (meta.pages === 1 ? ' page' : ' pages'), meta };
  }

  async function openPdfJs(bytes) {
    const pdfjs = await MAS.lib('pdfjs');
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableAutoFetch: true, disableStream: true });
    try { return await task.promise; }
    catch (e) {
      if (e && e.name === 'PasswordException') throw new UserError('This PDF is password-protected. Unlock it first (only if you’re authorised to), then try again.');
      throw new UserError('This PDF couldn’t be opened for rendering. It may be damaged.');
    }
  }
  MAS.openPdfJs = openPdfJs;

  const MAX_PIXELS = 16000000; // stays inside mobile Safari's canvas limit
  async function renderPage(pdf, n, scale) {
    const page = await pdf.getPage(n);
    let vp = page.getViewport({ scale });
    let clamped = false;
    if (vp.width * vp.height > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
      vp = page.getViewport({ scale: scale * k });
      clamped = true;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const base = page.getViewport({ scale: 1 });
    page.cleanup();
    return { canvas, clamped, pageW: base.width, pageH: base.height };
  }
  MAS.renderPdfPage = renderPage;

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new UserError('The browser couldn’t encode this image. Try a lower resolution.'))), type, quality);
      } else {
        try {
          const url = canvas.toDataURL(type, quality);
          const bin = atob(url.split(',')[1]);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          resolve(new Blob([u8], { type }));
        } catch (e) { reject(e); }
      }
    });
  }
  MAS.canvasToBlob = canvasToBlob;
  const freeCanvas = (c) => { c.width = 0; c.height = 0; };

  async function extractText(bytes, o) {
    o = o || {};
    const pdf = await openPdfJs(bytes);
    const parts = [];
    let chars = 0;
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        if (o.signal) Core.checkAbort(o.signal);
        const page = await pdf.getPage(n);
        const tc = await page.getTextContent();
        let s = '';
        for (const it of tc.items) { if ('str' in it) { s += it.str; if (it.hasEOL) s += '\n'; } }
        s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        chars += s.replace(/\s/g, '').length;
        parts.push(o.markers ? '--- Page ' + n + ' ---\n' + s : s);
        page.cleanup();
        if (o.onProgress) o.onProgress(n / pdf.numPages, 'Reading page ' + n + ' of ' + pdf.numPages);
      }
    } finally { pdf.destroy(); }
    return { text: parts.join('\n\n'), pages: parts.length, chars };
  }
  MAS.extractPdfText = extractText;

  const one = { types: ['pdf'], multiple: false, maxMB: 200, inspect: inspectPdf };
  const many = { types: ['pdf'], multiple: true, max: 20, maxMB: 200, totalMB: 400, inspect: inspectPdf };
  const pdfOut = (ctx, bytes, entry, suffix, extra) => ctx.out(bytes, Core.outName(entry.file.name, suffix, 'pdf'), extra);
  const pages = (n) => n + (n === 1 ? ' page' : ' pages');

  /* ---------- tools ---------- */

  MAS.impl['merge-pdf'] = Object.assign({}, many, {
    min: 2, max: 50, reorder: true, action: 'Merge PDFs', actionIcon: 'merge', doneTitle: 'Your merged PDF is ready',
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const list = [];
      for (const f of ctx.files) list.push(await ctx.bytes(f));
      const out = await Core.mergePdfs(PDFLib, list, { signal: ctx.signal, onProgress: (p) => ctx.progress(p, 'Merging file ' + Math.max(1, Math.round(p * list.length)) + ' of ' + list.length) });
      const total = ctx.files.reduce((s, f) => s + (f.meta ? f.meta.pages : 0), 0);
      ctx.summary.push(ctx.files.length + ' files combined into ' + pages(total) + '.');
      return [ctx.out(out, 'merged.pdf')];
    },
  });

  MAS.impl['split-pdf'] = Object.assign({}, one, {
    action: 'Split PDF', actionIcon: 'scissors', bundleSuffix: 'split',
    options: [
      { id: 'mode', type: 'segmented', label: 'Split into', default: 'ranges', options: [['ranges', 'Custom ranges'], ['each', 'Every page'], ['every', 'Every N pages']] },
      { id: 'ranges', type: 'text', label: 'Ranges', default: '', placeholder: 'e.g. 1-3, 4-6, 7-', help: 'Each range becomes its own PDF.', showIf: (o) => o.mode === 'ranges' },
      { id: 'n', type: 'number', label: 'Pages per file', default: 2, min: 1, showIf: (o) => o.mode === 'every' },
    ],
    validate: (st) => (st.opts.mode === 'ranges' && !String(st.opts.ranges || '').trim() ? 'Enter the ranges to split, for example 1-3, 4-6.' : ''),
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      const parts = await Core.splitPdf(PDFLib, await ctx.bytes(f), ctx.opts.mode, ctx.opts.mode === 'every' ? ctx.opts.n : ctx.opts.ranges,
        { signal: ctx.signal, onProgress: (p) => ctx.progress(p, 'Creating file ' + Math.max(1, Math.ceil(p * 100)) + '%') });
      ctx.summary.push('Split into ' + parts.length + (parts.length === 1 ? ' file.' : ' files.'));
      return parts.map((p) => pdfOut(ctx, p.bytes, f, p.label));
    },
  });

  MAS.impl['extract-pdf-pages'] = Object.assign({}, one, {
    action: 'Extract pages', actionIcon: 'file-output',
    options: [{ id: 'pages', type: 'text', label: 'Pages to extract', default: '', placeholder: 'e.g. 1-3, 7, 10-', help: 'Pages are copied in the order you type them. Use “last” for the final page.' }],
    validate: (st) => (!String(st.opts.pages || '').trim() ? 'Enter the pages to extract.' : ''),
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      const bytes = await ctx.bytes(f);
      const idx = Core.parsePageList(ctx.opts.pages, f.meta.pages);
      const out = await Core.selectPages(PDFLib, bytes, idx);
      ctx.summary.push(pages(idx.length) + ' extracted.');
      return [pdfOut(ctx, out, f, 'extracted')];
    },
  });

  MAS.impl['delete-pdf-pages'] = Object.assign({}, one, {
    action: 'Delete pages', actionIcon: 'trash-2',
    options: [{ id: 'pages', type: 'text', label: 'Pages to delete', default: '', placeholder: 'e.g. 2, 5-6, last', help: 'Everything else is kept in its original order.' }],
    validate: (st) => (!String(st.opts.pages || '').trim() ? 'Enter the pages to delete.' : ''),
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      const r = await Core.deletePages(PDFLib, await ctx.bytes(f), ctx.opts.pages);
      ctx.summary.push(pages(r.removed) + ' removed, ' + pages(r.remaining) + ' left.');
      return [pdfOut(ctx, r.bytes, f, 'edited')];
    },
  });

  MAS.impl['rotate-pdf'] = Object.assign({}, many, {
    action: 'Rotate PDF', actionIcon: 'rotate-cw',
    options: [
      { id: 'angle', type: 'segmented', label: 'Rotate', default: '90', options: [['90', '90° right'], ['180', '180°'], ['270', '90° left']] },
      { id: 'pages', type: 'text', label: 'Pages (optional)', default: '', placeholder: 'All pages', help: 'Leave empty to rotate every page, or enter pages like 2, 4-6.' },
    ],
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const outs = [];
      for (let k = 0; k < ctx.files.length; k++) {
        ctx.progress(k / ctx.files.length, 'Rotating ' + ctx.files[k].file.name);
        const r = await Core.rotatePdf(PDFLib, await ctx.bytes(ctx.files[k]), Number(ctx.opts.angle), ctx.opts.pages);
        outs.push(pdfOut(ctx, r.bytes, ctx.files[k], 'rotated', { note: pages(r.count) + ' rotated' }));
        await ctx.tick();
      }
      return outs;
    },
  });

  MAS.impl['reverse-pdf'] = Object.assign({}, many, {
    action: 'Reverse pages', actionIcon: 'arrow-down-up',
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const outs = [];
      for (const f of ctx.files) { outs.push(pdfOut(ctx, await Core.reversePdf(PDFLib, await ctx.bytes(f)), f, 'reversed')); await ctx.tick(); }
      return outs;
    },
  });

  MAS.impl['add-page-numbers'] = Object.assign({}, one, {
    action: 'Add page numbers', actionIcon: 'list-ordered',
    options: [
      { id: 'position', type: 'select', label: 'Position', default: 'bottom-center', options: [['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-center', 'Top centre'], ['top-right', 'Top right'], ['top-left', 'Top left']] },
      { id: 'format', type: 'select', label: 'Format', default: 'n', options: [['n', '1'], ['page-n', 'Page 1'], ['n-of', '1 / 10'], ['page-n-of', 'Page 1 of 10']] },
      { id: 'from', type: 'number', label: 'Start on page', default: 1, min: 1, help: 'Use 2 to skip a cover page.' },
      { id: 'start', type: 'number', label: 'First number', default: 1, min: 0 },
      { id: 'size', type: 'range', label: 'Text size', default: 11, min: 7, max: 24, format: (v) => v + ' pt' },
      { id: 'margin', type: 'segmented', label: 'Distance from edge', default: '28', options: [['18', 'Close'], ['28', 'Normal'], ['42', 'Far']] },
      { id: 'color', type: 'color', label: 'Colour', default: '#1f2937' },
    ],
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      ctx.status('Numbering pages');
      const r = await Core.addPageNumbers(PDFLib, await ctx.bytes(f), Object.assign({}, ctx.opts, { margin: Number(ctx.opts.margin) }));
      ctx.summary.push(pages(r.count) + ' numbered.');
      return [pdfOut(ctx, r.bytes, f, 'numbered')];
    },
  });

  MAS.impl['add-watermark-pdf'] = Object.assign({}, one, {
    action: 'Add watermark', actionIcon: 'stamp',
    options: [
      { id: 'text', type: 'text', label: 'Watermark text', default: 'CONFIDENTIAL', wide: true },
      { id: 'size', type: 'range', label: 'Size', default: 56, min: 16, max: 140, format: (v) => v + ' pt' },
      { id: 'angle', type: 'segmented', label: 'Angle', default: '45', options: [['0', 'Flat'], ['45', 'Diagonal'], ['90', 'Vertical']] },
      { id: 'opacity', type: 'range', label: 'Opacity', default: 0.18, min: 0.05, max: 0.8, step: 0.01, format: (v) => Math.round(v * 100) + '%' },
      { id: 'color', type: 'color', label: 'Colour', default: '#e11d48' },
      { id: 'pages', type: 'text', label: 'Pages (optional)', default: '', placeholder: 'All pages' },
    ],
    validate: (st) => (!String(st.opts.text || '').trim() ? 'Enter the watermark text.' : ''),
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      ctx.status('Adding watermark');
      const r = await Core.addWatermark(PDFLib, await ctx.bytes(f), Object.assign({}, ctx.opts, { angle: Number(ctx.opts.angle) }));
      ctx.summary.push('Watermark added to ' + pages(r.count) + '. Like any visible watermark, it can be removed by someone with editing tools.');
      return [pdfOut(ctx, r.bytes, f, 'watermarked')];
    },
  });

  MAS.impl['compress-pdf'] = Object.assign({}, one, {
    action: 'Compress PDF', actionIcon: 'shrink', limitNote: 'Strong mode handles up to 300 pages.',
    options: [
      { id: 'level', type: 'segmented', label: 'Compression', default: 'lossless', options: [['lossless', 'Lossless'], ['strong', 'Strong']],
        help: (o) => (o.level === 'strong' ? 'Pages become compressed images. Much smaller for scans and photos, but text can’t be selected or searched afterwards.' : 'Rebuilds the file structure without touching content. Safe, but gains are usually modest.') },
      { id: 'dpi', type: 'segmented', label: 'Resolution', default: '120', options: [['72', 'Low (72)'], ['120', 'Medium (120)'], ['150', 'High (150)']], showIf: (o) => o.level === 'strong' },
      { id: 'quality', type: 'range', label: 'Image quality', default: 0.65, min: 0.3, max: 0.9, step: 0.05, format: (v) => Math.round(v * 100) + '%', showIf: (o) => o.level === 'strong' },
    ],
    validate: (st) => (st.opts.level === 'strong' && st.files[0] && st.files[0].meta && st.files[0].meta.pages > 300 ? 'Strong mode handles up to 300 pages. Split the PDF first.' : ''),
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      const bytes = await ctx.bytes(f);
      let out;
      if (ctx.opts.level === 'strong') {
        const pdf = await openPdfJs(bytes);
        const images = [], sizes = [];
        let clamped = false;
        try {
          for (let n = 1; n <= pdf.numPages; n++) {
            ctx.check();
            ctx.progress((n - 1) / pdf.numPages, 'Compressing page ' + n + ' of ' + pdf.numPages);
            const r = await renderPage(pdf, n, Number(ctx.opts.dpi) / 72);
            clamped = clamped || r.clamped;
            const blob = await canvasToBlob(r.canvas, 'image/jpeg', Number(ctx.opts.quality));
            images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), kind: 'jpg', width: r.canvas.width, height: r.canvas.height });
            sizes.push([r.pageW, r.pageH]);
            freeCanvas(r.canvas);
            await ctx.tick();
          }
        } finally { pdf.destroy(); }
        ctx.status('Building the compressed PDF');
        out = await Core.imagesToPdf(PDFLib, images, { exactSizes: sizes, signal: ctx.signal });
        if (clamped) ctx.summary.push('Some very large pages were rendered at a lower resolution to fit your device’s limits.');
      } else {
        ctx.status('Optimising structure');
        out = await Core.optimizePdf(PDFLib, bytes);
      }
      const before = bytes.length, after = out.length;
      if (after >= before) {
        ctx.summary.push('This PDF is already compact: the compressed version was ' + Core.formatBytes(after) + ', not smaller than the original ' + Core.formatBytes(before) + '. Your original is offered unchanged.' + (ctx.opts.level === 'lossless' ? ' Strong mode may help if it contains scans or photos.' : ''));
        return [ctx.out(bytes, f.file.name, { note: 'Original, unchanged', warn: true })];
      }
      ctx.summary.push(Core.formatBytes(before) + ' → ' + Core.formatBytes(after) + ' (' + Math.abs(Core.percentChange(before, after)) + '% smaller).');
      return [pdfOut(ctx, out, f, 'compressed')];
    },
  });

  MAS.impl['image-to-pdf'] = {
    types: ['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic'], multiple: true, max: 100, maxMB: 50, totalMB: 400, reorder: true,
    action: 'Create PDF', actionIcon: 'file-image', doneTitle: 'Your PDF is ready',
    options: [
      { id: 'pageSize', type: 'segmented', label: 'Page size', default: 'a4', options: [['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Same as image']] },
      { id: 'orientation', type: 'segmented', label: 'Orientation', default: 'auto', options: [['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], showIf: (o) => o.pageSize !== 'fit' },
      { id: 'margin', type: 'segmented', label: 'Margin', default: '18', options: [['0', 'None'], ['18', 'Small'], ['40', 'Large']] },
    ],
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const images = [];
      for (let k = 0; k < ctx.files.length; k++) {
        ctx.check();
        ctx.progress(k / ctx.files.length * 0.8, 'Preparing image ' + (k + 1) + ' of ' + ctx.files.length);
        images.push(await MAS.imageForPdf(ctx.files[k]));
        await ctx.tick();
      }
      ctx.status('Building the PDF');
      const out = await Core.imagesToPdf(PDFLib, images, { pageSize: ctx.opts.pageSize, orientation: ctx.opts.orientation, margin: Number(ctx.opts.margin), signal: ctx.signal });
      ctx.summary.push(ctx.files.length + (ctx.files.length === 1 ? ' image' : ' images') + ' on ' + pages(ctx.files.length) + '.');
      return [ctx.out(out, ctx.files.length === 1 ? Core.outName(ctx.files[0].file.name, '', 'pdf') : 'images.pdf')];
    },
  };

  function pdfToImages(format) {
    return Object.assign({}, one, {
      action: 'Convert to ' + format.toUpperCase(), actionIcon: 'image', bundleSuffix: format, limitNote: 'Up to 300 pages per run.',
      options: [
        { id: 'pages', type: 'text', label: 'Pages (optional)', default: '', placeholder: 'All pages', help: 'For example 1-3, 8.' },
        { id: 'dpi', type: 'segmented', label: 'Resolution', default: '150', options: [['72', '72 DPI'], ['150', '150 DPI'], ['220', '220 DPI'], ['300', '300 DPI']], help: '150 DPI suits screens; 300 DPI suits printing.' },
      ].concat(format !== 'png' ? [{ id: 'quality', type: 'range', label: format.toUpperCase() + ' quality', default: 0.88, min: 0.5, max: 0.98, step: 0.01, format: (v) => Math.round(v * 100) + '%' }] : []),
      async run(ctx) {
        const f = ctx.files[0];
        const list = Core.parsePageList(ctx.opts.pages, f.meta.pages);
        if (list.length > 300) throw new UserError('Choose 300 pages or fewer per run.');
        const pdf = await openPdfJs(await ctx.bytes(f));
        const outs = [];
        let clamped = false;
        try {
          for (let k = 0; k < list.length; k++) {
            ctx.check();
            const n = list[k] + 1;
            ctx.progress(k / list.length, 'Rendering page ' + n + ' (' + (k + 1) + ' of ' + list.length + ')');
            const r = await renderPage(pdf, n, Number(ctx.opts.dpi) / 72);
            clamped = clamped || r.clamped;
            const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
            const blob = await canvasToBlob(r.canvas, mime, format === 'png' ? undefined : Number(ctx.opts.quality || 0.85));
            if (blob.type && blob.type !== mime) throw new UserError('Your browser can’t create ' + format.toUpperCase() + ' images. Use PDF to JPG or PDF to PNG instead.');
            outs.push(ctx.out(blob, Core.outName(f.file.name, 'page-' + n, format), { note: r.canvas.width + ' × ' + r.canvas.height + ' px' }));
            freeCanvas(r.canvas);
            await ctx.tick();
          }
        } finally { pdf.destroy(); }
        if (clamped) ctx.summary.push('Some pages were too large for your device at this resolution and were reduced to fit.');
        ctx.summary.push(pages(outs.length) + ' converted.');
        return outs;
      },
    });
  }
  MAS.impl['pdf-to-jpg'] = pdfToImages('jpg');
  MAS.impl['pdf-to-png'] = pdfToImages('png');
  MAS.pdfToImages = pdfToImages;

  MAS.impl['pdf-to-text'] = Object.assign({}, one, {
    action: 'Extract text', actionIcon: 'pilcrow', doneTitle: 'Text extracted',
    options: [{ id: 'markers', type: 'checkbox', label: 'Page markers', checkLabel: 'Mark where each page starts', default: true }],
    async run(ctx) {
      const f = ctx.files[0];
      const r = await extractText(await ctx.bytes(f), { markers: ctx.opts.markers, signal: ctx.signal, onProgress: ctx.progress });
      if (r.chars < 20) ctx.summary.push('Very little text was found. This is probably a scanned document; text recognition (OCR) is planned for Phase 2.');
      else ctx.summary.push(r.chars.toLocaleString() + ' characters from ' + pages(r.pages) + '. Layout and tables are simplified to plain text.');
      return [ctx.textOut(r.text, Core.outName(f.file.name, '', 'txt'))];
    },
  });

  MAS.impl['text-to-pdf'] = {
    input: 'text', maxChars: 500000, action: 'Create PDF', actionIcon: 'file-plus-2', placeholder: 'Type or paste your text here.',
    options: [
      { id: 'pageSize', type: 'segmented', label: 'Page size', default: 'a4', options: [['a4', 'A4'], ['letter', 'Letter']] },
      { id: 'font', type: 'segmented', label: 'Font', default: 'Helvetica', options: [['Helvetica', 'Sans'], ['Times', 'Serif'], ['Courier', 'Mono']] },
      { id: 'size', type: 'range', label: 'Text size', default: 11, min: 8, max: 20, format: (v) => v + ' pt' },
      { id: 'title', type: 'text', label: 'Document title (optional)', default: '' },
    ],
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      if (ctx.text.length > 500000) throw new UserError('That’s more than 500,000 characters. Split the text into smaller parts.');
      ctx.status('Laying out pages');
      const r = await Core.textToPdf(PDFLib, ctx.text, ctx.opts);
      ctx.summary.push(pages(r.pages) + ' created.');
      return [ctx.out(r.bytes, Core.safeFileName(ctx.opts.title, 'document') + '.pdf')];
    },
  };

  MAS.impl['edit-pdf-metadata'] = Object.assign({}, one, {
    action: 'Save details', actionIcon: 'tag',
    options: [
      { id: 'title', type: 'text', label: 'Title', default: '', wide: true },
      { id: 'author', type: 'text', label: 'Author', default: '' },
      { id: 'subject', type: 'text', label: 'Subject', default: '' },
      { id: 'keywords', type: 'text', label: 'Keywords', default: '', placeholder: 'Comma separated', wide: true },
    ],
    prefill(meta, opts) { opts.title = meta.title; opts.author = meta.author; opts.subject = meta.subject; opts.keywords = meta.keywords; },
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const f = ctx.files[0];
      const out = await Core.setPdfMetadata(PDFLib, await ctx.bytes(f), ctx.opts);
      ctx.summary.push('Title, author, subject and keywords updated.');
      return [pdfOut(ctx, out, f, '')];
    },
  });

  MAS.impl['remove-pdf-metadata'] = Object.assign({}, many, {
    action: 'Remove metadata', actionIcon: 'eraser',
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const outs = [];
      for (const f of ctx.files) {
        const r = await Core.removePdfMetadata(PDFLib, await ctx.bytes(f));
        outs.push(pdfOut(ctx, r.bytes, f, 'clean', { note: r.removed ? r.removed + ' metadata entries removed' : 'No metadata found' }));
        await ctx.tick();
      }
      return outs;
    },
  });

  /* ---------- Organize PDF: visual page editor ---------- */

  MAS.impl['organize-pdf'] = {
    kind: 'custom',
    limits: ['One PDF at a time, up to 200 MB.', 'Up to 500 pages.'],
    mount(root, c) {
      const tool = c.tool;
      let file = null, bytes = null, pdf = null, order = [], ac = null, thumbJob = 0;
      const stage = h('div', { class: 'org' });
      root.append(stage);

      function reset() {
        if (pdf) { pdf.destroy(); pdf = null; }
        file = null; bytes = null; order = []; thumbJob++;
        stage.replaceChildren(MAS.dropzone({ types: ['pdf'], big: true, title: 'Drop a PDF here', hint: 'PDF up to 200 MB. Nothing is uploaded.', onFiles: load }));
      }

      async function load(files) {
        const f = files[0];
        if (!f) return;
        const t = await MAS.classify(f);
        const fail = (m) => stage.prepend(MAS.errorView(m));
        if (t !== 'pdf') { fail('“' + f.name + '” isn’t a PDF.'); return; }
        if (f.size > 200 * 1048576) { fail('That file is larger than 200 MB.'); return; }
        stage.replaceChildren(h('p', { class: 'muted' }, 'Opening ' + f.name + '…'));
        try {
          bytes = new Uint8Array(await f.arrayBuffer());
          const PDFLib = await MAS.lib('pdflib');
          await Core.inspectPdf(PDFLib, bytes);
          pdf = await openPdfJs(bytes);
        } catch (e) { reset(); stage.prepend(MAS.errorView(MAS.userMessage(e))); return; }
        if (pdf.numPages > 500) { reset(); stage.prepend(MAS.errorView('This PDF has more than 500 pages. Split it first.')); return; }
        file = f;
        order = Array.from({ length: pdf.numPages }, (_, i) => ({ index: i, rotate: 0, key: 'p' + i }));
        draw();
        renderThumbs();
      }

      const thumbs = new Map();
      async function renderThumbs() {
        const job = ++thumbJob;
        for (let i = 0; i < pdf.numPages; i++) {
          if (job !== thumbJob || !pdf) return;
          if (thumbs.has(i)) continue;
          try {
            const page = await pdf.getPage(i + 1);
            const vp1 = page.getViewport({ scale: 1 });
            const scale = 160 / Math.max(vp1.width, vp1.height);
            const r = await renderPage(pdf, i + 1, scale * (window.devicePixelRatio > 1 ? 2 : 1));
            const url = MAS.url(await canvasToBlob(r.canvas, 'image/jpeg', 0.8));
            freeCanvas(r.canvas);
            thumbs.set(i, url);
            stage.querySelectorAll('img[data-page="' + i + '"]').forEach((img) => { img.src = url; img.classList.add('is-loaded'); });
          } catch (e) { /* leave placeholder */ }
        }
      }

      function moveTo(from, to) {
        if (to < 0 || to >= order.length || from === to) return;
        const [x] = order.splice(from, 1);
        order.splice(to, 0, x);
        draw();
        const btn = stage.querySelectorAll('.org-card')[to];
        if (btn) btn.querySelector('.org-move') && btn.querySelector('.org-move').focus();
        MAS.announce('Page moved to position ' + (to + 1));
      }

      function draw() {
        const grid = h('ol', { class: 'org-grid', 'aria-label': 'Pages' });
        order.forEach((p, k) => {
          const card = h('li', { class: 'org-card', draggable: 'true', dataset: { k: String(k) } },
            h('div', { class: 'org-thumb' }, h('img', { alt: 'Page ' + (p.index + 1), dataset: { page: String(p.index) }, src: thumbs.get(p.index) || null, class: thumbs.has(p.index) ? 'is-loaded' : '', style: { transform: 'rotate(' + p.rotate + 'deg)' } })),
            h('div', { class: 'org-label' }, h('span', null, String(k + 1)), p.index !== k ? h('span', { class: 'muted small' }, 'was ' + (p.index + 1)) : null),
            h('div', { class: 'org-tools' },
              h('button', { type: 'button', class: 'icon-btn icon-btn--sm org-move', 'aria-label': 'Move page ' + (k + 1) + ' earlier', disabled: k === 0, onclick: () => moveTo(k, k - 1) }, icon('chevron-left')),
              h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'Rotate page ' + (k + 1), onclick: () => { p.rotate = (p.rotate + 90) % 360; draw(); stage.querySelectorAll('.org-card')[k].querySelectorAll('button')[1].focus(); } }, icon('rotate-cw')),
              h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'Delete page ' + (k + 1), onclick: () => { if (order.length === 1) { MAS.toast('Keep at least one page.', 'error'); return; } order.splice(k, 1); draw(); MAS.announce('Page deleted'); } }, icon('trash-2')),
              h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'Move page ' + (k + 1) + ' later', disabled: k === order.length - 1, onclick: () => moveTo(k, k + 1) }, icon('chevron-right'))));
          card.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ihp-page', String(k)); card.classList.add('is-dragging'); });
          card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
          card.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types).includes('text/x-ihp-page')) { e.preventDefault(); card.classList.add('is-target'); } });
          card.addEventListener('dragleave', () => card.classList.remove('is-target'));
          card.addEventListener('drop', (e) => { const from = e.dataTransfer.getData('text/x-ihp-page'); if (from === '') return; e.preventDefault(); e.stopPropagation(); moveTo(Number(from), k); });
          grid.append(card);
        });
        const changed = order.length !== pdf.numPages || order.some((p, k) => p.index !== k || p.rotate);
        stage.replaceChildren(
          h('div', { class: 'org-bar' },
            h('div', { class: 'org-file' }, icon('file-text'), h('span', null, h('strong', null, file.name), h('span', { class: 'muted small' }, ' ' + order.length + ' of ' + pdf.numPages + ' pages'))),
            h('div', { class: 'row-gap' },
              h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { order.forEach((p) => { p.rotate = (p.rotate + 90) % 360; }); draw(); } }, icon('rotate-cw'), 'Rotate all'),
              h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: !changed, onclick: () => { order = Array.from({ length: pdf.numPages }, (_, i) => ({ index: i, rotate: 0 })); draw(); } }, icon('undo-2'), 'Reset'),
              h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: reset }, icon('x'), 'Close'))),
          h('p', { class: 'muted small org-help' }, 'Drag pages to reorder them, or use the arrow buttons. Changes apply when you save.'),
          grid,
          h('div', { class: 'ws-actions ws-actions--sticky' }, h('button', { type: 'button', class: 'btn btn--cta btn--lg', onclick: saveIt }, icon('check'), 'Save changes')));
      }

      async function saveIt() {
        ac = new AbortController();
        const pv = MAS.progressView(null);
        pv.set(null, 'Building your PDF');
        const keep = stage.cloneNode(false);
        stage.replaceChildren(pv.el);
        try {
          const PDFLib = await MAS.lib('pdflib');
          const out = await Core.organizePdf(PDFLib, bytes, order);
          const output = MAS.makeOutput(out, Core.outName(file.name, 'organized', 'pdf'));
          const rotated = order.filter((p) => p.rotate).length;
          const removed = pdf.numPages - order.length;
          stage.replaceChildren(MAS.resultView({
            title: 'Your organized PDF is ready', toolId: tool.id, next: tool.related.concat(['add-page-numbers', 'compress-pdf']),
            summary: [order.length + ' pages' + (removed ? ', ' + removed + ' removed' : '') + (rotated ? ', ' + rotated + ' rotated' : '') + '.'],
            outputs: [output], onReset: reset, onAgain: () => draw(),
          }));
          void keep;
        } catch (e) { draw(); stage.prepend(MAS.errorView(MAS.userMessage(e))); }
      }

      reset();
      MAS.setPageDrop((f) => load(f));
      if (MAS.pending && MAS.pending.slug === tool.id) { const f = MAS.pending.files; MAS.pending = null; load(f); }
      return () => { thumbJob++; if (pdf) pdf.destroy(); if (ac) ac.abort(); MAS.setPageDrop(null); };
    },
  };
})();
