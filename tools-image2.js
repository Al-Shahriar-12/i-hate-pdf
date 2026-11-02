/*!
 * I HATE PDF — v1.1 image and design tools
 */
(function () {
  'use strict';
  const MAS = window.MAS, Core = window.MASCore, h = MAS.h, icon = MAS.icon;
  const UserError = Core.UserError;
  const IMG = () => MAS.img;
  const RASTER = ['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic'];
  const pct = (v) => Math.round(v * 100) + '%';
  const fmtFor = (type) => (type === 'jpeg' || type === 'png' || type === 'webp' ? type : 'png');
  const base = { multiple: true, max: 100, maxMB: 50, totalMB: 500 };

  async function eachImage(ctx, fn) {
    const outs = [];
    for (let k = 0; k < ctx.files.length; k++) {
      ctx.check();
      const f = ctx.files[k];
      ctx.progress(k / ctx.files.length, 'Processing ' + (k + 1) + ' of ' + ctx.files.length);
      const img = await IMG().decodeImage(f);
      try { outs.push(await fn(f, img, k)); } finally { img.close(); }
      await ctx.tick();
    }
    return outs;
  }
  async function finish(ctx, canvas, f, suffix, quality, forceFmt) {
    const fmt = forceFmt || fmtFor(f.type);
    const blob = await IMG().encode(canvas, fmt, quality);
    const note = canvas.width + ' × ' + canvas.height + ' px';
    canvas.width = canvas.height = 0;
    return ctx.out(blob, Core.outName(f.file.name, suffix, IMG().EXT[fmt]), { note });
  }

  /* ---------- Filters (pixel maths, so they work in every browser) ---------- */
  MAS.impl['image-filters'] = Object.assign({}, base, {
    types: RASTER, action: 'Apply filters', actionIcon: 'sliders-horizontal', bundleSuffix: 'edited',
    options: [
      { id: 'brightness', type: 'range', label: 'Brightness', default: 0, min: -100, max: 100, format: (v) => (v > 0 ? '+' : '') + v },
      { id: 'contrast', type: 'range', label: 'Contrast', default: 0, min: -100, max: 100, format: (v) => (v > 0 ? '+' : '') + v },
      { id: 'saturation', type: 'range', label: 'Saturation', default: 0, min: -100, max: 100, format: (v) => (v > 0 ? '+' : '') + v },
      { id: 'effect', type: 'segmented', label: 'Effect', default: 'none', options: [['none', 'None'], ['gray', 'Grayscale'], ['sepia', 'Sepia'], ['invert', 'Invert']] },
      { id: 'quality', type: 'range', label: 'Quality (JPG and WebP)', default: 0.92, min: 0.5, max: 1, step: 0.01, format: pct },
    ],
    validate: (st) => (!st.opts.brightness && !st.opts.contrast && !st.opts.saturation && st.opts.effect === 'none' ? 'Move a slider or choose an effect.' : ''),
    async run(ctx) {
      const o = ctx.opts;
      const b = o.brightness * 2.55, cf = (259 * (o.contrast * 2.55 + 255)) / (255 * (259 - o.contrast * 2.55)), sat = 1 + o.saturation / 100;
      return eachImage(ctx, async (f, img) => {
        const c = IMG().drawImage(img);
        const cx = c.getContext('2d');
        const id = cx.getImageData(0, 0, c.width, c.height), d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          let r = d[i], g = d[i + 1], bl = d[i + 2];
          r = cf * (r + b - 128) + 128; g = cf * (g + b - 128) + 128; bl = cf * (bl + b - 128) + 128;
          const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
          r = y + (r - y) * sat; g = y + (g - y) * sat; bl = y + (bl - y) * sat;
          if (o.effect === 'gray') { r = g = bl = 0.2126 * r + 0.7152 * g + 0.0722 * bl; }
          else if (o.effect === 'sepia') { const R = r, G = g, B = bl; r = 0.393 * R + 0.769 * G + 0.189 * B; g = 0.349 * R + 0.686 * G + 0.168 * B; bl = 0.272 * R + 0.534 * G + 0.131 * B; }
          else if (o.effect === 'invert') { r = 255 - r; g = 255 - g; bl = 255 - bl; }
          d[i] = r; d[i + 1] = g; d[i + 2] = bl; // Uint8ClampedArray clamps for us
        }
        cx.putImageData(id, 0, 0);
        return finish(ctx, c, f, 'edited', Number(o.quality));
      });
    },
  });

  /* ---------- Text watermark (canvas text, so বাংলা works) ---------- */
  MAS.impl['watermark-image'] = Object.assign({}, base, {
    types: RASTER, action: 'Add watermark', actionIcon: 'stamp', bundleSuffix: 'watermarked',
    options: [
      { id: 'text', type: 'text', label: 'Watermark text', default: '© MAS Studio', wide: true },
      { id: 'layout', type: 'segmented', label: 'Placement', default: 'corner', options: [['corner', 'Bottom right'], ['center', 'Centre'], ['tile', 'Repeat across']] },
      { id: 'size', type: 'range', label: 'Size', default: 5, min: 2, max: 20, format: (v) => v + '% of width' },
      { id: 'opacity', type: 'range', label: 'Opacity', default: 0.55, min: 0.1, max: 1, step: 0.05, format: pct },
      { id: 'color', type: 'color', label: 'Colour', default: '#ffffff' },
      { id: 'shadow', type: 'checkbox', label: 'Readability', checkLabel: 'Add a soft shadow', default: true },
    ],
    validate: (st) => (!String(st.opts.text || '').trim() ? 'Type the watermark text.' : ''),
    async run(ctx) {
      const o = ctx.opts;
      try { await document.fonts.load('600 32px "Noto Sans Bengali"', o.text); } catch (e) { /* system font fallback */ }
      return eachImage(ctx, async (f, img) => {
        const c = IMG().drawImage(img);
        const cx = c.getContext('2d');
        const size = Math.max(10, Math.round(c.width * o.size / 100));
        cx.font = '600 ' + size + 'px Inter, "Noto Sans Bengali", system-ui, sans-serif';
        cx.fillStyle = o.color; cx.globalAlpha = o.opacity; cx.textBaseline = 'middle';
        if (o.shadow) { cx.shadowColor = 'rgba(0,0,0,.45)'; cx.shadowBlur = size / 6; cx.shadowOffsetY = size / 14; }
        const tw = cx.measureText(o.text).width;
        if (o.layout === 'corner') { cx.textAlign = 'right'; cx.fillText(o.text, c.width - size * 0.8, c.height - size * 0.9); }
        else if (o.layout === 'center') { cx.textAlign = 'center'; cx.fillText(o.text, c.width / 2, c.height / 2); }
        else {
          cx.textAlign = 'center';
          cx.translate(c.width / 2, c.height / 2); cx.rotate(-Math.PI / 6);
          const stepX = tw + size * 3, stepY = size * 4, R = Math.hypot(c.width, c.height);
          for (let y = -R; y < R; y += stepY) for (let x = -R; x < R; x += stepX) cx.fillText(o.text, x + ((y / stepY) % 2 ? stepX / 2 : 0), y);
        }
        return finish(ctx, c, f, 'watermarked', 0.92);
      });
    },
  });

  /* ---------- Combine images ---------- */
  MAS.impl['combine-images'] = Object.assign({}, base, {
    types: RASTER, min: 2, max: 40, reorder: true, action: 'Combine', actionIcon: 'images', doneTitle: 'Your combined image is ready',
    options: [
      { id: 'layout', type: 'segmented', label: 'Layout', default: 'vertical', options: [['vertical', 'Stacked'], ['horizontal', 'Side by side'], ['grid', 'Grid']] },
      { id: 'cols', type: 'number', label: 'Columns', default: 2, min: 1, max: 10, showIf: (o) => o.layout === 'grid' },
      { id: 'gap', type: 'range', label: 'Gap', default: 12, min: 0, max: 80, format: (v) => v + ' px' },
      { id: 'bg', type: 'color', label: 'Background', default: '#ffffff' },
      { id: 'format', type: 'segmented', label: 'Save as', default: 'jpeg', options: [['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']] },
    ],
    async run(ctx) {
      const o = ctx.opts, gap = Number(o.gap);
      const imgs = [];
      try {
        for (const f of ctx.files) { ctx.check(); imgs.push(await IMG().decodeImage(f)); }
        const cols = o.layout === 'vertical' ? 1 : o.layout === 'horizontal' ? imgs.length : Math.max(1, Math.min(10, Number(o.cols) || 2));
        // normalise: same width in a column layout, same height in a row
        const cellW = o.layout === 'horizontal' ? null : Math.min(2400, Math.max(...imgs.map((i) => i.width)));
        const cellH = o.layout === 'horizontal' ? Math.min(2400, Math.max(...imgs.map((i) => i.height))) : null;
        const sized = imgs.map((i) => cellW ? { w: cellW, h: Math.round(i.height * cellW / i.width) } : { w: Math.round(i.width * cellH / i.height), h: cellH });
        const rows = Math.ceil(imgs.length / cols);
        const colW = [], rowH = [];
        sized.forEach((s, k) => { const c = k % cols, r = Math.floor(k / cols); colW[c] = Math.max(colW[c] || 0, s.w); rowH[r] = Math.max(rowH[r] || 0, s.h); });
        let W = colW.reduce((a, b) => a + b, 0) + gap * (cols + 1), H = rowH.reduce((a, b) => a + b, 0) + gap * (rows + 1);
        let k = Math.min(1, Math.sqrt(16000000 / (W * H)), 16000 / Math.max(W, H));
        const c = document.createElement('canvas');
        c.width = Math.round(W * k); c.height = Math.round(H * k);
        const cx = c.getContext('2d');
        cx.fillStyle = o.bg; cx.fillRect(0, 0, c.width, c.height);
        cx.imageSmoothingQuality = 'high';
        let y = gap;
        for (let r = 0; r < rows; r++) {
          let x = gap;
          for (let col = 0; col < cols; col++) {
            const i = r * cols + col;
            if (i >= imgs.length) break;
            const s = sized[i];
            cx.drawImage(imgs[i].source, (x + (colW[col] - s.w) / 2) * k, (y + (rowH[r] - s.h) / 2) * k, s.w * k, s.h * k);
            x += colW[col] + gap;
          }
          y += rowH[r] + gap;
        }
        const blob = await IMG().encode(c, o.format, 0.9);
        ctx.summary.push(imgs.length + ' images combined into one ' + c.width + ' × ' + c.height + ' px picture.' + (k < 1 ? ' It was scaled down to stay within device limits.' : ''));
        c.width = c.height = 0;
        return [ctx.out(blob, 'combined.' + IMG().EXT[o.format])];
      } finally { imgs.forEach((i) => i.close()); }
    },
  });

  /* ---------- Favicon generator ---------- */
  MAS.impl['favicon-generator'] = {
    types: ['png', 'jpeg', 'webp', 'svg'], multiple: false, maxMB: 20, action: 'Make icons', actionIcon: 'image', bundleSuffix: 'favicons', doneTitle: 'Your icon pack is ready',
    options: [
      { id: 'fit', type: 'segmented', label: 'Fit', default: 'contain', options: [['contain', 'Fit inside'], ['cover', 'Fill and crop']] },
      { id: 'bg', type: 'segmented', label: 'Background', default: 'transparent', options: [['transparent', 'Transparent'], ['white', 'White'], ['custom', 'Colour']] },
      { id: 'color', type: 'color', label: 'Background colour', default: '#7657ff', showIf: (o) => o.bg === 'custom' },
      { id: 'pad', type: 'range', label: 'Padding', default: 0, min: 0, max: 25, format: (v) => v + '%' },
    ],
    async run(ctx) {
      const f = ctx.files[0], o = ctx.opts;
      const img = await IMG().decodeImage(f);
      const sizes = [16, 32, 48, 180, 192, 512];
      const pngs = {};
      try {
        for (const s of sizes) {
          const c = document.createElement('canvas'); c.width = c.height = s;
          const cx = c.getContext('2d');
          if (o.bg !== 'transparent') { cx.fillStyle = o.bg === 'white' ? '#ffffff' : o.color; cx.fillRect(0, 0, s, s); }
          const inner = s * (1 - 2 * o.pad / 100);
          const k = o.fit === 'cover' ? Math.max(inner / img.width, inner / img.height) : Math.min(inner / img.width, inner / img.height);
          const w = img.width * k, hh = img.height * k;
          cx.imageSmoothingQuality = 'high';
          cx.save(); cx.beginPath(); cx.rect((s - inner) / 2, (s - inner) / 2, inner, inner); cx.clip();
          cx.drawImage(img.source, (s - w) / 2, (s - hh) / 2, w, hh);
          cx.restore();
          pngs[s] = new Uint8Array(await (await MAS.canvasToBlob(c, 'image/png')).arrayBuffer());
        }
      } finally { img.close(); }
      const ico = Core.buildIco([16, 32, 48].map((s) => ({ size: s, png: pngs[s] })));
      const snippet = '<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">';
      const manifest = JSON.stringify({ name: 'My site', short_name: 'Site', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }], display: 'standalone' }, null, 2);
      ctx.summary.push('favicon.ico holds 16, 32 and 48 px versions. Put the files in your site’s root folder and paste the HTML into <head>.');
      return [
        ctx.out(ico, 'favicon.ico', { note: '16, 32 and 48 px' }),
        ctx.out(pngs[180], 'apple-touch-icon.png', { note: '180 × 180' }),
        ctx.out(pngs[192], 'icon-192.png', { note: '192 × 192' }), ctx.out(pngs[512], 'icon-512.png', { note: '512 × 512' }),
        ctx.out(pngs[32], 'favicon-32.png', { note: '32 × 32' }),
        ctx.out(new Blob([manifest], { type: 'application/json' }), 'site.webmanifest', { note: 'Web app manifest' }),
        ctx.textOut(snippet, 'favicon-html.txt'),
      ];
    },
  };

  /* ---------- Crop image (interactive) ---------- */
  MAS.impl['crop-image'] = {
    kind: 'custom', limits: ['One image at a time, up to 50 MB.'],
    mount(root, c) {
      const st = { file: null, type: null, img: null, url: null, ratio: 0, box: null };
      const stage = h('div', { class: 'crop' });
      root.append(stage);
      const RATIOS = [['0', 'Free'], ['1', '1:1'], ['1.3333', '4:3'], ['1.5', '3:2'], ['1.7778', '16:9'], ['0.5625', '9:16'], ['0.7778', 'Passport 35×45']];
      function reset() {
        if (st.img) st.img.close();
        Object.assign(st, { file: null, img: null, box: null });
        stage.replaceChildren(MAS.dropzone({ types: RASTER, big: true, title: 'Drop an image here', hint: 'JPG, PNG, WebP and more. Nothing is uploaded.', onFiles: load }));
      }
      async function load(files) {
        const f = files[0];
        const type = await MAS.classify(f);
        if (!RASTER.includes(type)) { stage.prepend(MAS.errorView('“' + f.name + '” isn’t an image this tool can open.')); return; }
        if (f.size > 50 * 1048576) { stage.prepend(MAS.errorView('Choose an image under 50 MB.')); return; }
        try { st.img = await IMG().decodeImage({ file: f, type }); } catch (e) { stage.prepend(MAS.errorView(MAS.userMessage(e))); return; }
        st.file = f; st.type = type;
        st.box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        draw();
      }
      function applyRatio() {
        if (!st.ratio) return;
        const iw = st.img.width, ih = st.img.height;
        let w = st.box.w * iw, hh = w / st.ratio;
        if (hh > ih * 0.98) { hh = ih * 0.9; w = hh * st.ratio; }
        if (w > iw) { w = iw * 0.9; hh = w / st.ratio; }
        st.box = { x: Math.max(0, Math.min(1 - w / iw, st.box.x)), y: Math.max(0, Math.min(1 - hh / ih, st.box.y)), w: w / iw, h: hh / ih };
      }
      function draw() {
        const canvas = IMG().drawImage(st.img, { width: Math.min(st.img.width, 1400), height: Math.min(st.img.width, 1400) * st.img.height / st.img.width });
        const view = h('div', { class: 'crop-view' });
        const shown = h('img', { alt: 'Image to crop', src: canvas.toDataURL('image/jpeg', 0.85), draggable: 'false' });
        canvas.width = canvas.height = 0;
        const boxEl = h('div', { class: 'crop-box', tabindex: '0', 'aria-label': 'Crop area. Use arrow keys to move, Shift and arrows to resize.' }, h('span', { class: 'crop-handle', 'aria-hidden': 'true' }));
        view.append(shown, boxEl);
        const info = h('p', { class: 'muted small' });
        function place() {
          const b = st.box;
          Object.assign(boxEl.style, { left: b.x * 100 + '%', top: b.y * 100 + '%', width: b.w * 100 + '%', height: b.h * 100 + '%' });
          info.textContent = 'Crop: ' + Math.round(b.w * st.img.width) + ' × ' + Math.round(b.h * st.img.height) + ' px';
        }
        let drag = null;
        boxEl.addEventListener('pointerdown', (e) => {
          e.preventDefault(); boxEl.setPointerCapture(e.pointerId);
          const r = view.getBoundingClientRect();
          drag = { mode: e.target.classList.contains('crop-handle') ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, b: Object.assign({}, st.box), W: r.width, H: r.height };
        });
        boxEl.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const dx = (e.clientX - drag.sx) / drag.W, dy = (e.clientY - drag.sy) / drag.H, b = drag.b;
          if (drag.mode === 'move') st.box = Object.assign({}, b, { x: Math.max(0, Math.min(1 - b.w, b.x + dx)), y: Math.max(0, Math.min(1 - b.h, b.y + dy)) });
          else {
            let w = Math.max(0.03, Math.min(1 - b.x, b.w + dx)), hh = Math.max(0.03, Math.min(1 - b.y, b.h + dy));
            if (st.ratio) { const k = st.img.width / st.img.height; hh = w * k / st.ratio; if (b.y + hh > 1) { hh = 1 - b.y; w = hh * st.ratio / k; } }
            st.box = Object.assign({}, b, { w, h: hh });
          }
          place();
        });
        boxEl.addEventListener('pointerup', () => { drag = null; });
        boxEl.addEventListener('keydown', (e) => {
          const step = 0.01, b = st.box;
          const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (!m) return;
          e.preventDefault();
          if (e.shiftKey && !st.ratio) st.box = Object.assign({}, b, { w: Math.max(0.03, Math.min(1 - b.x, b.w + m[0])), h: Math.max(0.03, Math.min(1 - b.y, b.h + m[1])) });
          else st.box = Object.assign({}, b, { x: Math.max(0, Math.min(1 - b.w, b.x + m[0])), y: Math.max(0, Math.min(1 - b.h, b.y + m[1])) });
          place();
        });
        const ratios = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Shape' }, RATIOS.map(([v, l]) =>
          h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(String(st.ratio) === v || (!st.ratio && v === '0')), onclick: () => { st.ratio = Number(v); applyRatio(); draw(); } }, l)));
        const save = h('button', { type: 'button', class: 'btn btn--cta btn--lg', onclick: async () => {
          const b = st.box, iw = st.img.width, ih = st.img.height;
          const sx = Math.round(b.x * iw), sy = Math.round(b.y * ih), sw = Math.max(1, Math.round(b.w * iw)), sh = Math.max(1, Math.round(b.h * ih));
          const out = document.createElement('canvas'); out.width = sw; out.height = sh;
          out.getContext('2d').drawImage(st.img.source, sx, sy, sw, sh, 0, 0, sw, sh);
          const fmt = fmtFor(st.type);
          const blob = await IMG().encode(out, fmt, 0.92);
          out.width = out.height = 0;
          stage.replaceChildren(MAS.resultView({ title: 'Your cropped image is ready', toolId: c.tool.id, next: c.tool.related, summary: [sw + ' × ' + sh + ' px.'],
            outputs: [MAS.makeOutput(blob, Core.outName(st.file.name, 'cropped', IMG().EXT[fmt]))], onReset: reset, onAgain: draw }));
        } }, icon('crop'), 'Crop image');
        stage.replaceChildren(h('div', { class: 'org-bar' }, h('div', { class: 'org-file' }, icon('image'), h('strong', null, st.file.name)), h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: reset }, icon('x'), 'Close')),
          ratios, view, info, h('div', { class: 'ws-actions' }, save));
        place();
      }
      reset();
      MAS.setPageDrop(load);
      if (MAS.pending && MAS.pending.slug === c.tool.id) { const f = MAS.pending.files; MAS.pending = null; load(f); }
      return () => { MAS.setPageDrop(null); if (st.img) st.img.close(); };
    },
  };

  /* ---------- Palette from image ---------- */
  MAS.impl['color-palette'] = {
    kind: 'custom',
    mount(root, c) {
      const box = h('div', { class: 'palette-out' });
      let count = 6, last = null;
      async function load(files) {
        const f = files[0];
        const type = await MAS.classify(f);
        if (!['jpeg', 'png', 'webp', 'gif', 'bmp'].includes(type)) { MAS.toast('That isn’t a supported image.', 'error'); return; }
        last = await IMG().decodeImage({ file: f, type });
        analyse();
      }
      function analyse() {
        if (!last) return;
        const cv = document.createElement('canvas');
        const k = 72 / Math.max(last.width, last.height);
        cv.width = Math.max(1, Math.round(last.width * k)); cv.height = Math.max(1, Math.round(last.height * k));
        const cx = cv.getContext('2d');
        cx.drawImage(last.source, 0, 0, cv.width, cv.height);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        const px = [];
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push(d[i], d[i + 1], d[i + 2]);
        const pal = Core.kmeansPalette(px, count);
        const hexes = pal.map((p) => Core.colorFormats(p).hex);
        box.replaceChildren(
          h('img', { class: 'palette-img', src: cv.toDataURL('image/png'), alt: 'Analysed image' }),
          h('ul', { class: 'swatches' }, pal.map((p, i) => h('li', null, h('button', { type: 'button', class: 'swatch', style: { background: hexes[i] }, 'aria-label': 'Copy ' + hexes[i], onclick: () => MAS.copy(hexes[i]) }),
            h('code', null, hexes[i]), h('span', { class: 'muted small' }, Math.round(p.share * 100) + '%')))),
          h('div', { class: 'row-gap' },
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => MAS.copy(hexes.join(', ')) }, icon('copy'), 'Copy all'),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => MAS.save(new Blob([':root {\n' + hexes.map((x, i) => '  --palette-' + (i + 1) + ': ' + x + ';').join('\n') + '\n}\n'], { type: 'text/plain' }), 'palette.css') }, icon('download'), 'Save as CSS')));
      }
      const fields = [{ id: 'count', type: 'segmented', label: 'Colours', default: '6', options: [['4', '4'], ['6', '6'], ['8', '8'], ['10', '10']] }];
      const opts = { count: '6' }, optsBox = h('div', { class: 'ws-options ws-options--flat' });
      const onOpt = (f, re) => { if (re) MAS.renderOptions(optsBox, fields, opts, onOpt); count = Number(opts.count); analyse(); };
      MAS.renderOptions(optsBox, fields, opts, onOpt);
      root.append(MAS.dropzone({ types: ['jpeg', 'png', 'webp', 'gif', 'bmp'], title: 'Drop an image here', hint: 'Colours are read on your device.', onFiles: load }), optsBox, box);
      MAS.setPageDrop(load);
      if (MAS.pending && MAS.pending.slug === c.tool.id) { const f = MAS.pending.files; MAS.pending = null; load(f); }
      return () => { MAS.setPageDrop(null); if (last) last.close(); };
    },
  };

  /* ---------- Barcode ---------- */
  MAS.impl['barcode-generator'] = {
    kind: 'custom',
    mount(root) {
      const svgWrap = h('div', { class: 'barcode-preview' });
      const msg = h('p', { class: 'text-msg' });
      let lastSvg = null;
      const fields = [
        { id: 'value', type: 'text', label: 'Value', default: 'I-HATE-PDF-2026', wide: true },
        { id: 'format', type: 'select', label: 'Format', default: 'CODE128', options: [['CODE128', 'CODE128 (any text)'], ['EAN13', 'EAN-13 (12–13 digits)'], ['EAN8', 'EAN-8 (7–8 digits)'], ['UPC', 'UPC-A (11–12 digits)'], ['CODE39', 'CODE39'], ['ITF14', 'ITF-14 (13–14 digits)'], ['codabar', 'Codabar']] },
        { id: 'height', type: 'range', label: 'Height', default: 90, min: 30, max: 200, format: (v) => v + ' px' },
        { id: 'width', type: 'range', label: 'Bar width', default: 2, min: 1, max: 4 },
        { id: 'text', type: 'checkbox', label: 'Label', checkLabel: 'Show the value under the bars', default: true },
        { id: 'fg', type: 'color', label: 'Bars', default: '#111827' },
        { id: 'bg', type: 'color', label: 'Background', default: '#ffffff' },
      ];
      const opts = {};
      fields.forEach((f) => { opts[f.id] = f.default; });
      const optsBox = h('div', { class: 'ws-options ws-options--flat' });
      async function draw() {
        const JsBarcode = await MAS.lib('jsbarcode').catch(() => null);
        if (!JsBarcode) { msg.textContent = 'The barcode component didn’t load.'; return; }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        let ok = true;
        try {
          JsBarcode(svg, String(opts.value || ''), { format: opts.format, height: opts.height, width: opts.width, displayValue: opts.text, lineColor: opts.fg, background: opts.bg, margin: 12, font: 'monospace', valid: (v) => { ok = v; } });
        } catch (e) { ok = false; }
        if (!ok || !String(opts.value || '').trim()) {
          svgWrap.replaceChildren(); lastSvg = null;
          msg.textContent = 'That value doesn’t fit the ' + opts.format + ' format. Check the number of digits, or choose CODE128 for any text.'; msg.className = 'text-msg is-error';
          return;
        }
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        lastSvg = svg; svgWrap.replaceChildren(svg);
        msg.textContent = 'Test-scan before printing.'; msg.className = 'text-msg is-ok';
      }
      const later = MAS.debounce(draw, 120);
      const onOpt = (f, re) => { if (re) MAS.renderOptions(optsBox, fields, opts, onOpt); later(); };
      MAS.renderOptions(optsBox, fields, opts, onOpt);
      async function dl(kind) {
        if (!lastSvg) return;
        const str = new XMLSerializer().serializeToString(lastSvg);
        if (kind === 'svg') { MAS.save(new Blob([str], { type: 'image/svg+xml' }), 'barcode.svg'); return; }
        const w = Number(lastSvg.getAttribute('width')) || 300, hh = Number(lastSvg.getAttribute('height')) || 120;
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
        await img.decode();
        const cv = document.createElement('canvas'); cv.width = w * 3; cv.height = hh * 3;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        MAS.save(await MAS.canvasToBlob(cv, 'image/png'), 'barcode.png');
      }
      root.append(optsBox, svgWrap, msg, h('div', { class: 'row-gap' },
        h('button', { type: 'button', class: 'btn btn--cta', onclick: () => dl('png') }, icon('download'), 'Download PNG'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dl('svg') }, icon('download'), 'Download SVG')));
      draw();
      return () => {};
    },
  };

  /* ---------- Colour converter ---------- */
  MAS.impl['color-converter'] = {
    kind: 'custom',
    mount(root) {
      const input = h('input', { class: 'input input--mono', id: 'cc-in', value: '#7657FF', autocomplete: 'off', spellcheck: 'false', placeholder: '#7657FF, rgb(118, 87, 255) or hsl(250, 100%, 67%)' });
      const pick = h('input', { type: 'color', value: '#7657ff', 'aria-label': 'Pick a colour', class: 'cc-pick' });
      const out = h('div');
      function draw() {
        const c = Core.parseColor(input.value);
        if (!c) { out.replaceChildren(h('p', { class: 'text-msg is-error' }, 'Type a colour as HEX, rgb() or hsl().')); return; }
        const f = Core.colorFormats(c);
        pick.value = f.hex.toLowerCase();
        const cw = Core.contrastRatio(c, { r: 255, g: 255, b: 255 }), cb = Core.contrastRatio(c, { r: 0, g: 0, b: 0 });
        const grade = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA large text only' : 'Fails');
        out.replaceChildren(h('div', { class: 'cc-swatch', style: { background: f.hex } }, h('span', { style: { color: '#fff' } }, 'Aa white'), h('span', { style: { color: '#000' } }, 'Aa black')),
          MAS.resultRows([['HEX', f.hex, true], ['RGB', f.rgb, true], ['HSL', f.hsl, true], ['CMYK', f.cmyk, true],
            ['White text on it', cw.toFixed(2) + ':1, ' + grade(cw)], ['Black text on it', cb.toFixed(2) + ':1, ' + grade(cb)]]),
          h('p', { class: 'muted small' }, 'CMYK is a simple conversion without a print profile; ask your printer for exact values.'));
      }
      input.addEventListener('input', MAS.debounce(draw, 80));
      pick.addEventListener('input', () => { input.value = pick.value.toUpperCase(); draw(); });
      root.append(h('div', { class: 'opt opt--wide' }, h('label', { class: 'opt-label', for: 'cc-in' }, 'Colour'), h('div', { class: 'row-gap cc-row' }, pick, input)), out);
      draw();
      return () => {};
    },
  };

  /* ---------- Base64 to image ---------- */
  MAS.impl['base64-to-image'] = {
    kind: 'custom',
    mount(root, c) {
      const ta = h('textarea', { class: 'input input--mono', rows: 6, id: 'b64-in', placeholder: 'data:image/png;base64,iVBORw0KGgo… or plain Base64', spellcheck: 'false' });
      const out = h('div');
      function draw() {
        out.replaceChildren();
        if (!ta.value.trim()) return;
        let bytes;
        try { bytes = Core.base64ToBytes(ta.value); } catch (e) { out.append(h('p', { class: 'text-msg is-error' }, MAS.userMessage(e))); return; }
        const t = Core.sniffType(bytes);
        const ext = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', svg: 'svg', avif: 'avif', bmp: 'bmp' }[t];
        if (!ext) { out.append(h('p', { class: 'text-msg is-error' }, 'This decodes to ' + (t ? 'a ' + t.toUpperCase() + ' file' : 'data') + ', not a recognised image.')); return; }
        const output = MAS.makeOutput(bytes, 'decoded-image.' + ext);
        out.append(MAS.resultView({ title: 'Decoded image', toolId: c.tool.id, summary: [t.toUpperCase() + ', ' + Core.formatBytes(bytes.length) + '.'], outputs: [output] }));
      }
      ta.addEventListener('input', MAS.debounce(draw, 200));
      root.append(h('label', { class: 'opt-label', for: 'b64-in' }, 'Base64 or data URI'), ta, out);
      return () => {};
    },
  };
})();
