/*!
 * I HATE PDF — image tools (Canvas API, lossless metadata removal, QR codes)
 */
(function () {
  'use strict';
  const MAS = window.MAS, Core = window.MASCore, h = MAS.h, icon = MAS.icon;
  const UserError = Core.UserError;
  const MAX_PIXELS = 16000000;

  async function decodeImage(entry) {
    const file = entry.file || entry;
    const type = entry.type;
    if (type !== 'svg' && typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close && bmp.close() };
      } catch (e) { /* fall back to <img> */ }
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try { await img.decode(); }
    catch (e) {
      URL.revokeObjectURL(url);
      if (type === 'heic') throw new UserError('Your browser can’t open HEIC photos. Safari on iPhone, iPad or Mac usually can, or set your camera to “Most Compatible” (JPG).');
      if (type === 'avif') throw new UserError('Your browser can’t open AVIF images. Try an up-to-date Chrome, Firefox or Safari.');
      throw new UserError('“' + file.name + '” couldn’t be opened as an image. It may be damaged.');
    }
    let w = img.naturalWidth, hgt = img.naturalHeight;
    if (!w || !hgt) { w = 1024; hgt = 1024; }
    return { source: img, width: w, height: hgt, close: () => URL.revokeObjectURL(url) };
  }

  /** Draw with optional resize, rotation (deg) and flips; returns a canvas. */
  function drawImage(img, o) {
    o = o || {};
    let w = Math.max(1, Math.round(o.width || img.width));
    let hgt = Math.max(1, Math.round(o.height || img.height));
    let clamped = false;
    if (w * hgt > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (w * hgt)); w = Math.floor(w * k); hgt = Math.floor(hgt * k); clamped = true; }
    // Step down in halves for smoother large reductions
    let src = img.source, sw = img.width, sh = img.height, temp = null;
    while (sw / 2 > w && sh / 2 > hgt) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw / 2)); c.height = Math.max(1, Math.round(sh / 2));
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, 0, 0, c.width, c.height);
      if (temp) { temp.width = 0; temp.height = 0; }
      temp = c; src = c; sw = c.width; sh = c.height;
    }
    const rot = ((o.rotate || 0) % 360 + 360) % 360;
    const canvas = document.createElement('canvas');
    canvas.width = rot % 180 ? hgt : w;
    canvas.height = rot % 180 ? w : hgt;
    const ctx = canvas.getContext('2d');
    if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
    ctx.drawImage(src, -w / 2, -hgt / 2, w, hgt);
    if (temp) { temp.width = 0; temp.height = 0; }
    canvas._clamped = clamped;
    return canvas;
  }

  const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
  const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
  async function encode(canvas, format, quality) {
    const mime = MIME[format];
    const blob = await MAS.canvasToBlob(canvas, mime, format === 'png' ? undefined : quality);
    if (blob.type && blob.type !== mime) throw new UserError('Your browser can’t create ' + format.toUpperCase() + ' files. Choose another format.');
    return blob;
  }
  const encodeSupport = {};
  async function canEncode(format) {
    if (format in encodeSupport) return encodeSupport[format];
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const p = new Promise((r) => { try { c.toBlob((b) => r(!!b && b.type === MIME[format]), MIME[format], 0.5); } catch (e) { r(false); } });
    encodeSupport[format] = await p;
    return encodeSupport[format];
  }

  function hasAlpha(canvas) {
    const s = document.createElement('canvas');
    s.width = Math.min(64, canvas.width); s.height = Math.min(64, canvas.height);
    const cx = s.getContext('2d');
    cx.drawImage(canvas, 0, 0, s.width, s.height);
    const d = cx.getImageData(0, 0, s.width, s.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  /** Prepare an image for pdf-lib: raw JPEG/PNG bytes when safe, otherwise a re-encode. */
  MAS.imageForPdf = async function (entry) {
    const file = entry.file;
    if (entry.type === 'png') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ihdr = { w: (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0, h: (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0 };
      return { bytes, kind: 'png', width: ihdr.w, height: ihdr.h };
    }
    if (entry.type === 'jpeg') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (Core.jpegOrientation(bytes) === 1) {
        const img = await decodeImage(entry);
        const r = { bytes, kind: 'jpg', width: img.width, height: img.height };
        img.close();
        return r;
      }
    }
    const img = await decodeImage(entry);
    try {
      const canvas = drawImage(img);
      const alpha = entry.type !== 'jpeg' && hasAlpha(canvas);
      const blob = await encode(canvas, alpha ? 'png' : 'jpeg', 0.92);
      const r = { bytes: new Uint8Array(await blob.arrayBuffer()), kind: alpha ? 'png' : 'jpg', width: canvas.width, height: canvas.height };
      canvas.width = canvas.height = 0;
      return r;
    } finally { img.close(); }
  };

  MAS.img = { decodeImage, drawImage, encode, canEncode, hasAlpha, MIME, EXT };
  const RASTER = ['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic'];
  const imgBase = { multiple: true, max: 100, maxMB: 50, totalMB: 500, bundleSuffix: 'images' };
  const fmtFor = (type) => (type === 'jpeg' || type === 'png' || type === 'webp' ? type : 'png');
  const pct = (v) => Math.round(v * 100) + '%';

  async function eachImage(ctx, fn) {
    const outs = [];
    for (let k = 0; k < ctx.files.length; k++) {
      ctx.check();
      const f = ctx.files[k];
      ctx.progress(k / ctx.files.length, 'Processing ' + (k + 1) + ' of ' + ctx.files.length + ': ' + f.file.name);
      const img = await decodeImage(f);
      try { outs.push(await fn(f, img)); }
      finally { img.close(); }
      await ctx.tick();
    }
    return outs;
  }

  /* ---------- Convert ---------- */
  MAS.impl['convert-image'] = Object.assign({}, imgBase, {
    types: RASTER.concat(['svg']), action: 'Convert', actionIcon: 'repeat',
    options(tool) {
      const preset = tool && tool.preset && tool.preset.format;
      const f = [];
      if (!preset) f.push({ id: 'format', type: 'segmented', label: 'Convert to', default: 'jpeg', options: [['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF']], help: (o) => (o.format === 'avif' ? 'AVIF output works only in browsers that can encode it; you’ll see a clear message if yours can’t.' : '') });
      f.push({ id: 'quality', type: 'range', label: 'Quality', default: 0.9, min: 0.4, max: 1, step: 0.01, format: pct, showIf: (o) => o.format !== 'png' });
      f.push({ id: 'background', type: 'color', label: 'Background for transparent areas', default: '#ffffff', showIf: (o) => o.format === 'jpeg' });
      f.push({ id: 'svgScale', type: 'segmented', label: 'SVG size', default: '2', options: [['1', '1×'], ['2', '2×'], ['4', '4×']], help: 'Only used for SVG input.', showIf: () => true });
      return f;
    },
    async run(ctx) {
      const fmt = ctx.opts.format;
      if (fmt === 'avif' && !(await canEncode('avif'))) throw new UserError('Your browser can’t create AVIF files. Choose WebP for similar savings.');
      if (fmt === 'webp' && !(await canEncode('webp'))) throw new UserError('Your browser can’t create WebP files. Update it, or choose JPG or PNG.');
      return eachImage(ctx, async (f, img) => {
        const k = f.type === 'svg' ? Number(ctx.opts.svgScale) || 1 : 1;
        const canvas = drawImage(img, { width: img.width * k, height: img.height * k, background: fmt === 'jpeg' ? ctx.opts.background : null });
        const blob = await encode(canvas, fmt, Number(ctx.opts.quality));
        const note = canvas.width + ' × ' + canvas.height + ' px' + (canvas._clamped ? ', reduced to fit device limits' : '');
        canvas.width = canvas.height = 0;
        return ctx.out(blob, Core.outName(f.file.name, '', EXT[fmt]), { note });
      });
    },
  });

  /* ---------- Compress ---------- */
  MAS.impl['compress-image'] = Object.assign({}, imgBase, {
    types: ['jpeg', 'png', 'webp'], action: 'Compress', actionIcon: 'image-minus', bundleSuffix: 'compressed',
    options: [
      { id: 'format', type: 'select', label: 'Output', default: 'auto', options: [['auto', 'Best for each file (JPG stays JPG, PNG becomes WebP)'], ['same', 'Keep the original format'], ['jpeg', 'Always JPG'], ['webp', 'Always WebP']] },
      { id: 'quality', type: 'range', label: 'Quality', default: 0.72, min: 0.3, max: 0.95, step: 0.01, format: pct, help: '70–80% is hard to tell apart from the original for most photos.' },
      { id: 'maxDim', type: 'select', label: 'Maximum size', default: '0', options: [['0', 'Keep dimensions'], ['3840', '3840 px (4K)'], ['2560', '2560 px'], ['1920', '1920 px (Full HD)'], ['1280', '1280 px'], ['800', '800 px']] },
    ],
    async run(ctx) {
      let before = 0, after = 0;
      const outs = await eachImage(ctx, async (f, img) => {
        let fmt = ctx.opts.format === 'auto' ? (f.type === 'jpeg' ? 'jpeg' : 'webp') : ctx.opts.format === 'same' ? f.type : ctx.opts.format;
        if (fmt === 'webp' && !(await canEncode('webp'))) fmt = f.type === 'png' ? 'png' : 'jpeg';
        const md = Number(ctx.opts.maxDim);
        const k = md && Math.max(img.width, img.height) > md ? md / Math.max(img.width, img.height) : 1;
        const canvas = drawImage(img, { width: img.width * k, height: img.height * k, background: fmt === 'jpeg' ? '#ffffff' : null });
        const blob = await encode(canvas, fmt, Number(ctx.opts.quality));
        canvas.width = canvas.height = 0;
        before += f.file.size;
        if (blob.size >= f.file.size && k === 1) {
          after += f.file.size;
          return ctx.out(f.file, f.file.name, { note: 'Already optimised. Original kept.', warn: true });
        }
        after += blob.size;
        return ctx.out(blob, Core.outName(f.file.name, 'compressed', EXT[fmt]), { note: Core.formatBytes(f.file.size) + ' → ' + Core.formatBytes(blob.size) + ' (' + Math.abs(Core.percentChange(f.file.size, blob.size)) + '% smaller)' });
      });
      if (after < before) ctx.summary.push('Total: ' + Core.formatBytes(before) + ' → ' + Core.formatBytes(after) + ' (' + Math.abs(Core.percentChange(before, after)) + '% smaller). Metadata such as EXIF is dropped when images are re-encoded.');
      else ctx.summary.push('These images were already well optimised, so the originals are offered unchanged.');
      return outs;
    },
  });

  /* ---------- Resize ---------- */
  MAS.impl['resize-image'] = Object.assign({}, imgBase, {
    types: RASTER, action: 'Resize', actionIcon: 'scaling', bundleSuffix: 'resized',
    options: [
      { id: 'mode', type: 'segmented', label: 'Resize by', default: 'percent', options: [['percent', 'Percentage'], ['pixels', 'Pixels']] },
      { id: 'percent', type: 'range', label: 'Scale', default: 50, min: 5, max: 300, step: 5, format: (v) => v + '%', showIf: (o) => o.mode === 'percent' },
      { id: 'width', type: 'number', label: 'Width (px)', default: 1280, min: 1, max: 20000, showIf: (o) => o.mode === 'pixels' },
      { id: 'height', type: 'number', label: 'Height (px)', default: '', min: 1, max: 20000, placeholder: 'Automatic', showIf: (o) => o.mode === 'pixels' },
      { id: 'fit', type: 'checkbox', label: 'Aspect ratio', checkLabel: 'Keep aspect ratio (fit inside the box)', default: true, showIf: (o) => o.mode === 'pixels' },
      { id: 'quality', type: 'range', label: 'Quality (JPG and WebP)', default: 0.9, min: 0.5, max: 1, step: 0.01, format: pct },
    ],
    validate: (st) => (st.opts.mode === 'pixels' && !st.opts.width && !st.opts.height ? 'Enter a width or a height.' : ''),
    async run(ctx) {
      const o = ctx.opts;
      return eachImage(ctx, async (f, img) => {
        let w, hgt;
        if (o.mode === 'percent') { w = img.width * o.percent / 100; hgt = img.height * o.percent / 100; }
        else {
          const W = Number(o.width) || 0, H = Number(o.height) || 0;
          if (o.fit) {
            const k = Math.min(W ? W / img.width : Infinity, H ? H / img.height : Infinity);
            w = img.width * k; hgt = img.height * k;
          } else { w = W || img.width * (H / img.height); hgt = H || img.height * (W / img.width); }
        }
        const fmt = fmtFor(f.type);
        const canvas = drawImage(img, { width: w, height: hgt });
        const blob = await encode(canvas, fmt, Number(o.quality));
        const note = img.width + ' × ' + img.height + ' → ' + canvas.width + ' × ' + canvas.height + ' px' + (canvas._clamped ? ' (reduced to fit device limits)' : '');
        canvas.width = canvas.height = 0;
        return ctx.out(blob, Core.outName(f.file.name, canvasLabel(w, hgt), EXT[fmt]), { note });
      });
    },
  });
  const canvasLabel = (w, hgt) => Math.round(w) + 'x' + Math.round(hgt);

  /* ---------- Rotate / flip ---------- */
  MAS.impl['rotate-image'] = Object.assign({}, imgBase, {
    types: RASTER, action: 'Apply', actionIcon: 'rotate-cw', bundleSuffix: 'rotated',
    options: [
      { id: 'rotate', type: 'segmented', label: 'Rotate', default: '90', options: [['0', 'None'], ['90', '90° right'], ['180', '180°'], ['270', '90° left']] },
      { id: 'flipH', type: 'checkbox', label: 'Mirror', checkLabel: 'Flip horizontally', default: false },
      { id: 'flipV', type: 'checkbox', label: 'Flip', checkLabel: 'Flip vertically', default: false },
      { id: 'quality', type: 'range', label: 'Quality (JPG and WebP)', default: 0.92, min: 0.5, max: 1, step: 0.01, format: pct },
    ],
    validate: (st) => (st.opts.rotate === '0' && !st.opts.flipH && !st.opts.flipV ? 'Choose a rotation or a flip.' : ''),
    async run(ctx) {
      return eachImage(ctx, async (f, img) => {
        const fmt = fmtFor(f.type);
        const canvas = drawImage(img, { rotate: Number(ctx.opts.rotate), flipH: ctx.opts.flipH, flipV: ctx.opts.flipV });
        const blob = await encode(canvas, fmt, Number(ctx.opts.quality));
        canvas.width = canvas.height = 0;
        return ctx.out(blob, Core.outName(f.file.name, 'rotated', EXT[fmt]));
      });
    },
  });

  /* ---------- Remove metadata ---------- */
  MAS.impl['remove-image-metadata'] = Object.assign({}, imgBase, {
    types: ['jpeg', 'png', 'webp'], action: 'Remove metadata', actionIcon: 'eraser', bundleSuffix: 'clean',
    options: [{ id: 'bake', type: 'checkbox', label: 'Phone photos', checkLabel: 'Keep photos upright (re-encodes rotated JPGs at 95% quality)', default: true,
      help: 'Phones often store rotation as metadata. With this on, rotated JPGs are redrawn upright before cleaning; all other files stay lossless.' }],
    async run(ctx) {
      const outs = [];
      for (let k = 0; k < ctx.files.length; k++) {
        ctx.check();
        const f = ctx.files[k];
        ctx.progress(k / ctx.files.length, 'Cleaning ' + f.file.name);
        const bytes = await ctx.bytes(f);
        let r = f.type === 'jpeg' ? Core.stripJpegMetadata(bytes) : f.type === 'png' ? Core.stripPngMetadata(bytes) : Core.stripWebpMetadata(bytes);
        let note;
        if (f.type === 'jpeg' && r.orientation !== 1 && ctx.opts.bake) {
          const img = await decodeImage(f);
          const canvas = drawImage(img);
          img.close();
          const blob = await encode(canvas, 'jpeg', 0.95);
          canvas.width = canvas.height = 0;
          r = Core.stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
          note = 'Rotation applied, metadata removed';
        } else if (r.removed) note = r.removed + ' metadata block' + (r.removed === 1 ? '' : 's') + ' removed (' + Core.formatBytes(r.removedBytes) + ')';
        else note = 'No metadata found';
        const warn = f.type === 'jpeg' && r.orientation !== 1 && !ctx.opts.bake;
        outs.push(ctx.out(r.bytes, Core.outName(f.file.name, 'clean', f.type === 'jpeg' ? 'jpg' : f.type), { note: warn ? note + '. This photo had rotation info and may now appear sideways.' : note, warn }));
        await ctx.tick();
      }
      ctx.summary.push('EXIF (including GPS location), XMP, IPTC and comments are removed. Colour profiles are kept so colours stay accurate.');
      return outs;
    },
  });

  /* ---------- Image to Base64 ---------- */
  MAS.impl['image-to-base64'] = {
    types: ['jpeg', 'png', 'webp', 'gif', 'svg', 'avif'], multiple: false, maxMB: 10, action: 'Encode', actionIcon: 'binary', doneTitle: 'Encoded',
    options: [{ id: 'form', type: 'segmented', label: 'Output', default: 'uri', options: [['uri', 'Data URI'], ['raw', 'Base64 only'], ['css', 'CSS background']] }],
    async run(ctx) {
      const f = ctx.files[0];
      const bytes = await ctx.bytes(f);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const b64 = btoa(bin);
      const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' }[f.type];
      const uri = 'data:' + mime + ';base64,' + b64;
      const text = ctx.opts.form === 'raw' ? b64 : ctx.opts.form === 'css' ? 'background-image: url("' + uri + '");' : uri;
      ctx.summary.push(Core.formatBytes(bytes.length) + ' image → ' + text.length.toLocaleString() + ' characters. Base64 is about a third larger than the file, so it suits small images best.');
      return [ctx.textOut(text, Core.outName(f.file.name, 'base64', 'txt'))];
    },
  };

  /* ---------- QR code generator ---------- */
  function utf8Latin1(s) { return unescape(encodeURIComponent(s)); }
  function wifiString(o) {
    const esc = (v) => String(v || '').replace(/([\\;,":])/g, '\\$1');
    return 'WIFI:T:' + (o.sec === 'nopass' ? 'nopass' : o.sec) + ';S:' + esc(o.ssid) + ';' + (o.sec === 'nopass' ? '' : 'P:' + esc(o.pass) + ';') + (o.hidden ? 'H:true;' : '') + ';';
  }
  function luminance(hex) {
    const v = parseInt(hex.slice(1), 16);
    const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  MAS.impl['qr-code-generator'] = {
    kind: 'custom',
    limits: ['Up to about 2,900 characters of Latin text at Low error correction; less at higher levels or with Bengali text.'],
    mount(root) {
      const st = { mode: 'text', text: '', ssid: '', pass: '', sec: 'WPA', hidden: false, ec: 'M', size: 1024, margin: 4, fg: '#111827', bg: '#ffffff' };
      let qr = null;
      const preview = h('div', { class: 'qr-preview', 'aria-live': 'polite' });
      const msg = h('p', { class: 'text-msg' });
      const fieldsBox = h('div');
      const optsBox = h('div', { class: 'ws-options' });
      const dlPng = h('button', { type: 'button', class: 'btn btn--cta', disabled: true, onclick: () => download('png') }, icon('download'), 'Download PNG');
      const dlSvg = h('button', { type: 'button', class: 'btn btn--ghost', disabled: true, onclick: () => download('svg') }, icon('download'), 'Download SVG');

      function content() { return st.mode === 'wifi' ? (st.ssid ? wifiString(st) : '') : st.text; }

      async function update() {
        const data = content();
        dlPng.disabled = dlSvg.disabled = true;
        msg.textContent = ''; msg.className = 'text-msg';
        if (!data.trim()) { qr = null; preview.replaceChildren(h('p', { class: 'muted' }, st.mode === 'wifi' ? 'Enter the network name to see the QR code.' : 'Type a link or text to see the QR code.')); return; }
        const qrcode = await MAS.lib('qrcode').catch((e) => { msg.textContent = MAS.userMessage(e); msg.className = 'text-msg is-error'; return null; });
        if (!qrcode) return;
        try {
          const q = qrcode(0, st.ec);
          q.addData(utf8Latin1(data), 'Byte');
          q.make();
          qr = q;
        } catch (e) {
          qr = null;
          preview.replaceChildren();
          msg.textContent = 'That’s too much content for one QR code at this error-correction level. Shorten it, or choose Low.';
          msg.className = 'text-msg is-error';
          return;
        }
        preview.replaceChildren(h('div', { class: 'qr-svg', html: svgString(512) }));
        const contrast = (Math.max(luminance(st.fg), luminance(st.bg)) + 0.05) / (Math.min(luminance(st.fg), luminance(st.bg)) + 0.05);
        const inverted = luminance(st.fg) > luminance(st.bg);
        if (contrast < 3) { msg.textContent = 'Low contrast between colours. Some phones may fail to scan this code.'; msg.className = 'text-msg is-error'; }
        else if (inverted) { msg.textContent = 'Light-on-dark codes don’t scan on every reader. Test it before printing.'; msg.className = 'text-msg is-error'; }
        else { msg.textContent = qr.getModuleCount() + ' × ' + qr.getModuleCount() + ' modules. Test scan before printing.'; msg.className = 'text-msg is-ok'; }
        dlPng.disabled = dlSvg.disabled = false;
      }
      const later = MAS.debounce(update, 150);

      function svgString(px) {
        const n = qr.getModuleCount(), m = st.margin, total = n + 2 * m;
        let d = '';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="' + st.bg + '"/><path d="' + d + '" fill="' + st.fg + '"/></svg>';
      }
      async function download(kind) {
        if (!qr) return;
        if (kind === 'svg') { await MAS.save(new Blob([svgString(st.size)], { type: 'image/svg+xml' }), 'qr-code.svg'); return; }
        const n = qr.getModuleCount(), total = n + 2 * st.margin;
        const scale = Math.max(1, Math.floor(st.size / total));
        const c = document.createElement('canvas');
        c.width = c.height = total * scale;
        const cx = c.getContext('2d');
        cx.fillStyle = st.bg; cx.fillRect(0, 0, c.width, c.height);
        cx.fillStyle = st.fg;
        for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) cx.fillRect((col + st.margin) * scale, (r + st.margin) * scale, scale, scale);
        const blob = await MAS.canvasToBlob(c, 'image/png');
        await MAS.save(blob, 'qr-code.png');
      }

      function drawFields() {
        fieldsBox.replaceChildren();
        const tabs = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Content type' },
          [['text', 'Link or text'], ['wifi', 'Wi-Fi']].map(([v, l]) => h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(st.mode === v), onclick: () => { st.mode = v; drawFields(); update(); } }, l)));
        fieldsBox.append(tabs);
        if (st.mode === 'text') {
          const ta = h('textarea', { class: 'input', rows: 3, id: 'qr-text', placeholder: 'https://example.com', oninput: (e) => { st.text = e.target.value; later(); } });
          ta.value = st.text;
          fieldsBox.append(h('div', { class: 'opt opt--wide qr-field' }, h('label', { class: 'opt-label', for: 'qr-text' }, 'Content'), ta));
        } else {
          const inp = (id, label, key, type) => {
            const i = h('input', { class: 'input', id, type: type || 'text', autocomplete: 'off', value: st[key], oninput: (e) => { st[key] = e.target.value; later(); } });
            return h('div', { class: 'opt' }, h('label', { class: 'opt-label', for: id }, label), i);
          };
          const sec = h('select', { class: 'input', id: 'qr-sec', onchange: (e) => { st.sec = e.target.value; drawFields(); update(); } },
            [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'No password']].map(([v, l]) => h('option', { value: v, selected: st.sec === v ? true : null }, l)));
          fieldsBox.append(h('div', { class: 'opts qr-field' }, inp('qr-ssid', 'Network name (SSID)', 'ssid'),
            h('div', { class: 'opt' }, h('label', { class: 'opt-label', for: 'qr-sec' }, 'Security'), sec),
            st.sec !== 'nopass' ? inp('qr-pass', 'Password', 'pass', 'password') : null,
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.hidden, onchange: (e) => { st.hidden = e.target.checked; update(); } }), h('span', null, 'Hidden network'))));
        }
      }
      const fields = [
        { id: 'ec', type: 'segmented', label: 'Error correction', default: 'M', options: [['L', 'Low'], ['M', 'Medium'], ['Q', 'High'], ['H', 'Max']], help: 'Higher levels survive scratches or a logo overlay, but make the code denser.' },
        { id: 'size', type: 'segmented', label: 'PNG size', default: 1024, options: [[512, '512 px'], [1024, '1024 px'], [2048, '2048 px']] },
        { id: 'margin', type: 'range', label: 'Quiet zone', default: 4, min: 0, max: 8, format: (v) => v + ' modules', help: 'Most scanners need at least 4.' },
        { id: 'fg', type: 'color', label: 'Code colour', default: '#111827' },
        { id: 'bg', type: 'color', label: 'Background', default: '#ffffff' },
      ];
      const onOpt = (f, re) => { if (re) MAS.renderOptions(optsBox, fields, st, onOpt); later(); };
      MAS.renderOptions(optsBox, fields, st, onOpt);
      drawFields();
      update();
      root.append(h('div', { class: 'qr' }, h('div', { class: 'qr-inputs' }, fieldsBox, optsBox), h('div', { class: 'qr-out' }, preview, msg, h('div', { class: 'row-gap' }, dlPng, dlSvg))));
      return () => {};
    },
  };
})();
