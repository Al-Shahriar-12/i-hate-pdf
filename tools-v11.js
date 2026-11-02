/*!
 * I HATE PDF — v1.1 tools: Sign PDF, Python runner, Flatten, PDF to WebP, Compare PDFs, image border, split, meme,
 * social media sizes, HTML entities, number bases, lorem ipsum, text cleaner, Unicode to Bijoy, file inspector.
 */
(function () {
  'use strict';
  const MAS = window.MAS, Core = window.MASCore, h = MAS.h, icon = MAS.icon;
  const UserError = Core.UserError;
  const IMG = () => MAS.img;
  const pages = (n) => n + (n === 1 ? ' page' : ' pages');
  const RASTER = ['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic'];
  const inspectPdf = async (entry) => {
    const PDFLib = await MAS.lib('pdflib');
    const meta = await Core.inspectPdf(PDFLib, new Uint8Array(await entry.file.arrayBuffer()));
    return { info: pages(meta.pages), meta };
  };

  /* ---------------- PDF ---------------- */
  MAS.impl['flatten-pdf'] = {
    types: ['pdf'], multiple: true, max: 20, maxMB: 200, inspect: inspectPdf, action: 'Flatten', actionIcon: 'layers-3',
    async run(ctx) {
      const PDFLib = await ctx.lib('pdflib');
      const outs = [];
      for (const f of ctx.files) {
        const r = await Core.flattenPdf(PDFLib, await ctx.bytes(f));
        outs.push(ctx.out(r.bytes, Core.outName(f.file.name, 'flat', 'pdf'), { note: r.fields ? r.fields + ' form fields locked' : 'No form fields found', warn: !r.fields }));
        await ctx.tick();
      }
      return outs;
    },
  };

  MAS.impl['pdf-to-webp'] = MAS.pdfToImages ? MAS.pdfToImages('webp') : null;

  function diffNode(d, labels) {
    const rows = d.ops.filter((x, i, a) => x.t !== '=' || a.slice(Math.max(0, i - 2), i + 3).some((y) => y.t !== '='));
    const view = h('div', { class: 'diff-view diff-view--lines', role: 'region', 'aria-label': 'Differences', tabindex: '0' });
    let last = -1;
    rows.forEach((x) => {
      const idx = d.ops.indexOf(x);
      if (last >= 0 && idx > last + 1) view.append(h('div', { class: 'diff-gap' }, '⋯'));
      last = idx;
      view.append(h('div', { class: 'diff-line diff-line--' + (x.t === '+' ? 'add' : x.t === '-' ? 'del' : 'same') },
        h('span', { class: 'diff-num' }, x.t === '+' ? '' : String(x.a || '')), h('span', { class: 'diff-num' }, x.t === '-' ? '' : String(x.b || '')),
        h('span', { class: 'diff-sign', 'aria-hidden': 'true' }, x.t === '=' ? ' ' : x.t), h('span', { class: 'diff-text' }, x.text || ' ')));
    });
    if (!rows.length) view.append(h('p', { class: 'muted' }, 'No differences.'));
    return h('div', null, h('p', { class: 'diff-legend small' }, h('span', { class: 'diff-key diff-key--del' }, 'Removed from ' + labels[0]), ' ', h('span', { class: 'diff-key diff-key--add' }, 'Added in ' + labels[1])), view);
  }
  MAS.diffNode = diffNode;

  MAS.impl['compare-pdf'] = {
    types: ['pdf'], multiple: true, min: 2, max: 2, maxMB: 100, reorder: true, inspect: inspectPdf, action: 'Compare', actionIcon: 'git-compare', doneTitle: 'Comparison',
    options: [{ id: 'ignore', type: 'checkbox', label: 'Ignore', checkLabel: 'Ignore spacing and letter case', default: true }],
    limitNote: 'The first file is the original; the second is the new version.',
    async run(ctx) {
      const [a, b] = ctx.files;
      ctx.progress(0.1, 'Reading ' + a.file.name);
      const ta = await MAS.extractPdfText(await ctx.bytes(a), { markers: false, signal: ctx.signal });
      ctx.progress(0.5, 'Reading ' + b.file.name);
      const tb = await MAS.extractPdfText(await ctx.bytes(b), { markers: false, signal: ctx.signal });
      if (ta.chars < 20 && tb.chars < 20) throw new UserError('Neither PDF has a text layer to compare. Run OCR on scanned PDFs first.');
      const d = Core.diffLines(ta.text, tb.text, { ignoreCase: ctx.opts.ignore, ignoreSpace: ctx.opts.ignore });
      ctx.summary.push(d.added + ' lines added, ' + d.removed + ' removed, ' + d.same + ' unchanged.' + (d.approximate ? ' The files are very large, so changed blocks are shown whole.' : ''));
      const report = 'Comparing\n- ' + a.file.name + '\n+ ' + b.file.name + '\n\n' + Core.diffReport(d);
      return [{ node: diffNode(d, [a.file.name, b.file.name]) }, ctx.textOut(report, 'comparison.txt')];
    },
  };

  /* ---------------- Sign PDF ---------------- */
  MAS.impl['sign-pdf'] = {
    kind: 'custom',
    limits: ['One PDF up to 200 MB.', 'Signature images: PNG or JPG.'],
    mount(root, c) {
      const st = { file: null, bytes: null, total: 0, mode: 'draw', ink: '#14213d', typed: '', font: 'script', sig: null, opts: { pages: 'last', custom: '', position: 'bottom-right', width: 28, margin: 36 } };
      const stage = h('div', { class: 'sign' });
      root.append(stage);
      let pdfDoc = null;

      async function load(files) {
        const f = files[0];
        if (!f) return;
        if ((await MAS.classify(f)) !== 'pdf') { stage.prepend(MAS.errorView('“' + f.name + '” isn’t a PDF.')); return; }
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const PDFLib = await MAS.lib('pdflib');
          const meta = await Core.inspectPdf(PDFLib, bytes);
          st.file = f; st.bytes = bytes; st.total = meta.pages;
          if (pdfDoc) pdfDoc.destroy();
          pdfDoc = await MAS.openPdfJs(bytes);
          draw();
        } catch (e) { stage.prepend(MAS.errorView(MAS.userMessage(e))); }
      }

      function trimCanvas(cv) {
        const cx = cv.getContext('2d');
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) return null;
        const pad = 6, out = document.createElement('canvas');
        out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
        out.getContext('2d').drawImage(cv, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
        return out;
      }

      function sigPad() {
        const cv = h('canvas', { class: 'sig-pad', width: '900', height: '300', 'aria-label': 'Signature drawing area. Draw with your finger, pen or mouse.' });
        const cx = cv.getContext('2d');
        let drawing = false, last = null, dirty = false;
        const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
        cv.addEventListener('pointerdown', (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = true; last = pos(e); });
        cv.addEventListener('pointermove', (e) => {
          if (!drawing) return;
          const p = pos(e);
          cx.strokeStyle = st.ink; cx.lineCap = 'round'; cx.lineJoin = 'round';
          cx.lineWidth = 4 + (e.pressure && e.pointerType === 'pen' ? e.pressure * 4 : 1.5);
          cx.beginPath(); cx.moveTo(last[0], last[1]); cx.lineTo(p[0], p[1]); cx.stroke();
          last = p; dirty = true;
        });
        const end = () => { if (drawing && dirty) { st.sig = trimCanvas(cv); refresh(); } drawing = false; };
        cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
        return h('div', { class: 'sig-wrap grid-bg' }, cv, h('div', { class: 'row-gap' },
          h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { cx.clearRect(0, 0, cv.width, cv.height); st.sig = null; dirty = false; refresh(); } }, icon('eraser'), 'Clear'),
          inkPick()));
      }
      function inkPick() {
        return h('span', { class: 'row-gap', role: 'radiogroup', 'aria-label': 'Ink colour' }, [['#14213d', 'Black'], ['#1d4ed8', 'Blue']].map(([v, l]) =>
          h('button', { type: 'button', role: 'radio', class: 'seg-btn ink-btn', 'aria-checked': String(st.ink === v), onclick: () => { st.ink = v; if (st.mode === 'type') typedSig(); drawPicker(); } }, h('span', { class: 'ink-dot', style: { background: v } }), l)));
      }
      function typedSig() {
        if (!st.typed.trim()) { st.sig = null; refresh(); return; }
        const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 300;
        const cx = cv.getContext('2d');
        const fam = st.font === 'script' ? '"Dancing Script", "Brush Script MT", "Segoe Script", cursive' : st.font === 'serif' ? 'Georgia, "Times New Roman", serif' : 'Inter, system-ui, sans-serif';
        cx.font = (st.font === 'script' ? '700 ' : 'italic 600 ') + '130px ' + fam; cx.fillStyle = st.ink; cx.textBaseline = 'middle';
        cx.fillText(st.typed.trim(), 20, 150, 1160);
        st.sig = trimCanvas(cv); refresh();
      }
      const picker = h('div', { class: 'sig-picker' });
      function drawPicker() {
        picker.replaceChildren(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Signature' }, [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']].map(([v, l]) =>
          h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(st.mode === v), onclick: () => { st.mode = v; st.sig = null; drawPicker(); refresh(); } }, l))));
        if (st.mode === 'draw') picker.append(sigPad());
        else if (st.mode === 'type') {
          const inp = h('input', { class: 'input sig-type', id: 'sig-name', placeholder: 'Your name', value: st.typed, autocomplete: 'name', oninput: MAS.debounce((e) => { st.typed = e.target.value; typedSig(); }, 120) });
          picker.append(h('div', { class: 'opt' }, h('label', { class: 'opt-label', for: 'sig-name' }, 'Type your name'), inp),
            h('div', { class: 'row-gap' }, h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Style' }, [['script', 'Handwritten'], ['serif', 'Serif'], ['sans', 'Plain']].map(([v, l]) =>
              h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(st.font === v), onclick: () => { st.font = v; drawPicker(); typedSig(); } }, l))), inkPick()));
          if (document.fonts && document.fonts.load) document.fonts.load('700 40px "Dancing Script"').then(() => { if (st.typed) typedSig(); }).catch(() => {});
        } else {
          picker.append(MAS.dropzone({ types: ['png', 'jpeg', 'webp'], compact: true, button: 'Choose a signature image', onFiles: async (files) => {
            try {
              const img = await IMG().decodeImage({ file: files[0], type: await MAS.classify(files[0]) });
              const cv = IMG().drawImage(img); img.close();
              const cx = cv.getContext('2d');
              const d = cx.getImageData(0, 0, cv.width, cv.height);
              for (let i = 0; i < d.data.length; i += 4) { const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3; if (l > 225) d.data[i + 3] = 0; else if (l > 180) d.data[i + 3] = Math.min(d.data[i + 3], Math.round((225 - l) / 45 * 255)); }
              cx.putImageData(d, 0, 0);
              st.sig = trimCanvas(cv); refresh();
            } catch (e) { MAS.toast(MAS.userMessage(e), 'error'); }
          } }), h('p', { class: 'small muted' }, 'A photo of your signature on white paper works; the white background is removed.'));
        }
      }

      const preview = h('div', { class: 'sign-preview' });
      const optsBox = h('div', { class: 'ws-options' });
      const saveBtn = h('button', { type: 'button', class: 'btn btn--cta btn--lg', onclick: save }, icon('pen-tool'), 'Sign and download');
      const fields = [
        { id: 'pages', type: 'segmented', label: 'Sign', default: 'last', options: [['last', 'Last page'], ['first', 'First page'], ['all', 'Every page'], ['custom', 'Choose pages']] },
        { id: 'custom', type: 'text', label: 'Pages', default: '', placeholder: 'e.g. 1, 3-4', showIf: (o) => o.pages === 'custom' },
        { id: 'position', type: 'select', label: 'Position', default: 'bottom-right', options: [['bottom-right', 'Bottom right'], ['bottom-center', 'Bottom centre'], ['bottom-left', 'Bottom left'], ['center', 'Centre'], ['top-right', 'Top right'], ['top-left', 'Top left']] },
        { id: 'width', type: 'range', label: 'Size', default: 28, min: 8, max: 60, format: (v) => v + '% of page width' },
        { id: 'margin', type: 'range', label: 'Distance from edge', default: 36, min: 0, max: 120, format: (v) => Math.round(v / 2.835) + ' mm' },
      ];
      const onOpt = (f, re) => { if (re) MAS.renderOptions(optsBox, fields, st.opts, onOpt); refresh(); };

      let previewJob = 0;
      async function refresh() {
        saveBtn.disabled = !st.sig;
        if (!pdfDoc) return;
        const job = ++previewJob;
        const idx = st.opts.pages === 'first' ? 1 : st.opts.pages === 'custom' ? ((() => { try { return Core.parsePageList(st.opts.custom || '1', st.total)[0] + 1; } catch (e) { return 1; } })()) : st.total;
        const page = await pdfDoc.getPage(idx);
        const vp1 = page.getViewport({ scale: 1 });
        const r = await MAS.renderPdfPage(pdfDoc, idx, Math.min(2, 520 / vp1.width));
        if (job !== previewJob) { r.canvas.width = 0; return; }
        const W = vp1.width, H = vp1.height;
        r.canvas.className = 'sign-page';
        const wrap = h('div', { class: 'sign-stage' }, r.canvas);
        if (st.sig) {
          const w = W * st.opts.width / 100, hh = w * st.sig.height / st.sig.width, m = Number(st.opts.margin);
          const [v, hz] = st.opts.position === 'center' ? ['middle', 'center'] : st.opts.position.split('-');
          const vx = hz === 'left' ? m : hz === 'right' ? W - m - w : (W - w) / 2;
          const vy = v === 'top' ? H - m - hh : v === 'middle' ? (H - hh) / 2 : m;
          wrap.append(h('img', { class: 'sign-overlay', alt: '', src: st.sig.toDataURL('image/png'), style: { left: (vx / W * 100) + '%', bottom: (vy / H * 100) + '%', width: (w / W * 100) + '%' } }));
        }
        preview.replaceChildren(h('p', { class: 'small muted' }, 'Preview of page ' + idx + ' of ' + st.total), wrap);
      }

      async function save() {
        if (!st.sig) return;
        const pv = MAS.progressView(null); pv.set(null, 'Signing');
        const body = stage.querySelector('.sign-body');
        if (body) body.hidden = true;
        stage.append(pv.el);
        try {
          const PDFLib = await MAS.lib('pdflib');
          const png = new Uint8Array(await (await MAS.canvasToBlob(st.sig, 'image/png')).arrayBuffer());
          const r = await Core.stampImagePdf(PDFLib, st.bytes, { bytes: png, kind: 'png' }, { pages: st.opts.pages === 'custom' ? st.opts.custom : st.opts.pages, position: st.opts.position, width: st.opts.width, margin: Number(st.opts.margin) });
          pv.el.replaceWith(MAS.resultView({ title: 'Your signed PDF is ready', toolId: c.tool.id, next: ['flatten-pdf', 'compress-pdf', 'protect-pdf'],
            summary: ['Signature added to ' + pages(r.count) + '. This is a visible signature image, not a certificate-based digital signature.'],
            outputs: [MAS.makeOutput(r.bytes, Core.outName(st.file.name, 'signed', 'pdf'))],
            onAgain: () => { stage.querySelectorAll('.result').forEach((x) => x.remove()); if (body) body.hidden = false; },
            onReset: () => { st.file = null; draw(); } }));
        } catch (e) { pv.el.replaceWith(MAS.errorView(MAS.userMessage(e))); if (body) body.hidden = false; }
      }

      function draw() {
        if (!st.file) {
          stage.replaceChildren(MAS.dropzone({ types: ['pdf'], big: true, title: 'Drop a PDF to sign', hint: 'PDF up to 200 MB. Nothing is uploaded.', onFiles: load }));
          return;
        }
        drawPicker();
        MAS.renderOptions(optsBox, fields, st.opts, onOpt);
        stage.replaceChildren(h('div', { class: 'sign-body' },
          h('div', { class: 'org-bar' }, h('div', { class: 'org-file' }, icon('file-text'), h('strong', null, st.file.name), h('span', { class: 'muted small' }, ' ' + pages(st.total))),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { st.file = null; draw(); } }, icon('x'), 'Change PDF')),
          h('div', { class: 'sign-grid' }, h('div', { class: 'sign-left' }, h('h2', { class: 'tool-sub' }, '1. Your signature'), picker, h('h2', { class: 'tool-sub' }, '2. Where to put it'), optsBox), preview),
          h('div', { class: 'ws-actions' }, saveBtn)));
        refresh();
      }
      draw();
      MAS.setPageDrop((f) => load(f));
      if (MAS.pending && MAS.pending.slug === c.tool.id) { const f = MAS.pending.files; MAS.pending = null; load(f); }
      return () => { if (pdfDoc) pdfDoc.destroy(); MAS.setPageDrop(null); };
    },
  };

  /* ---------------- Python runner ---------------- */
  const PY_EXAMPLES = [
    ['Beam reactions', '# Simply supported beam with a point load\nL = 6.0      # span, m\nP = 24.0     # load, kN\na = 2.0      # distance of load from left support, m\n\nRb = P * a / L\nRa = P - Rb\nMmax = Ra * a\nprint(f"Ra = {Ra:.2f} kN, Rb = {Rb:.2f} kN")\nprint(f"Maximum moment = {Mmax:.2f} kN·m at x = {a} m")\n'],
    ['Concrete mix by volume', 'import math\n# 1 : 1.5 : 3 mix for 1 m³ of wet concrete (dry volume factor 1.54)\nratio = (1, 1.5, 3)\ndry = 1.54\nparts = sum(ratio)\ncement_m3 = dry * ratio[0] / parts\nbags = cement_m3 * 1440 / 50\nprint(f"Cement: {cement_m3:.3f} m³ ≈ {math.ceil(bags)} bags of 50 kg")\nprint(f"Sand: {dry * ratio[1] / parts:.3f} m³, Stone chips: {dry * ratio[2] / parts:.3f} m³")\n'],
    ['NumPy and a plot (needs internet once)', 'import numpy as np\nimport matplotlib.pyplot as plt\n\nL, w = 6.0, 10.0          # span (m), UDL (kN/m)\nx = np.linspace(0, L, 61)\nM = w * x * (L - x) / 2   # bending moment, kN·m\nprint("Max moment:", M.max().round(2), "kN·m")\nplt.plot(x, M)\nplt.fill_between(x, M, alpha=0.2)\nplt.title("Bending moment diagram")\nplt.xlabel("x (m)"); plt.ylabel("M (kN·m)")\nplt.gca().invert_yaxis()\n'],
    ['Solve equations with SymPy', 'from sympy import symbols, solve, diff, integrate\nx = symbols("x")\nprint(solve(x**2 - 5*x + 6, x))\nprint(diff(x**3 * 4, x))\nprint(integrate(3*x**2, (x, 0, 2)))\n'],
    ['Hello, Python', 'name = "MAS Studio"\nfor i in range(3):\n    print(f"{i + 1}. Hello from {name}!")\n'],
  ];
  MAS.impl['python-runner'] = {
    kind: 'custom',
    limits: ['Python 3.12 with the standard library offline.', 'NumPy, SymPy, pandas, SciPy and Matplotlib download on first import.', 'input() isn’t supported.'],
    mount(root) {
      let worker = null, running = false, ready = false;
      const code = h('textarea', { class: 'input input--mono py-code', id: 'py-code', rows: 14, spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Python code' });
      code.value = PY_EXAMPLES[0][1];
      code.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const s = code.selectionStart; code.setRangeText('    ', s, code.selectionEnd, 'end'); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      });
      const out = h('pre', { class: 'py-out', 'aria-live': 'polite', tabindex: '0' });
      const figs = h('div', { class: 'py-figs' });
      const status = h('p', { class: 'small muted', role: 'status' }, 'Python starts when you press Run.');
      const runBtn = h('button', { type: 'button', class: 'btn btn--cta', onclick: run }, icon('play'), 'Run');
      const stopBtn = h('button', { type: 'button', class: 'btn btn--ghost', disabled: true, onclick: stop }, icon('circle-stop'), 'Stop');
      const ex = h('select', { class: 'input', 'aria-label': 'Examples', onchange: (e) => { if (e.target.value !== '') { code.value = PY_EXAMPLES[+e.target.value][1]; e.target.value = ''; } } },
        h('option', { value: '' }, 'Load an example…'), PY_EXAMPLES.map(([n], i) => h('option', { value: String(i) }, n)));
      const write = (t, cls) => { const s = h('span', { class: cls || '' }, t); out.append(s); out.scrollTop = out.scrollHeight; };
      function makeWorker() {
        worker = new Worker('py-worker.js');
        worker.onmessage = (e) => {
          const { type, data } = e.data || {};
          if (type === 'stdout') write(data);
          else if (type === 'stderr') write(data, 'py-err');
          else if (type === 'status') status.textContent = data;
          else if (type === 'ready') { ready = true; status.textContent = 'Python is ready.'; }
          else if (type === 'done') {
            if (data.repr != null && data.repr !== 'None') write(data.repr + '\n', 'py-repr');
            (data.images || []).forEach((b64) => figs.append(h('img', { src: 'data:image/png;base64,' + b64, alt: 'Plot from your code' })));
            finish('Finished in ' + data.ms + ' ms.');
          } else if (type === 'error') { write(String(data).replace(/^PythonError: /, '') + '\n', 'py-err'); finish('Stopped with an error.'); }
        };
        worker.onerror = () => { write('The Python engine failed to load. Reload the page and try again.\n', 'py-err'); finish('Error.'); };
      }
      function finish(msg) { running = false; runBtn.disabled = false; stopBtn.disabled = true; status.textContent = msg; }
      function run() {
        if (running) return;
        if (!worker) makeWorker();
        out.replaceChildren(); figs.replaceChildren();
        running = true; runBtn.disabled = true; stopBtn.disabled = false;
        status.textContent = ready ? 'Running…' : 'Starting Python…';
        worker.postMessage({ type: 'run', code: code.value, indexURL: new URL('./', location.href).href });
      }
      function stop() { if (worker) { worker.terminate(); worker = null; ready = false; } write('\nStopped.\n', 'py-err'); finish('Stopped. Python restarts on the next run.'); }
      root.append(h('div', { class: 'py' },
        h('div', { class: 'text-col-head' }, h('label', { class: 'opt-label', for: 'py-code' }, 'Code'), ex), code,
        h('div', { class: 'row-gap' }, runBtn, stopBtn, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => MAS.save(new Blob([code.value], { type: 'text/plain' }), 'script.py') }, icon('download'), 'Save .py'),
          h('span', { class: 'small muted' }, 'Ctrl+Enter runs')),
        status, h('h2', { class: 'tool-sub' }, 'Output'), out, figs));
      return () => { if (worker) worker.terminate(); };
    },
  };

  /* ---------------- images ---------------- */
  async function eachImage(ctx, fn) {
    const outs = [];
    for (let k = 0; k < ctx.files.length; k++) {
      ctx.check();
      const f = ctx.files[k];
      ctx.progress(k / ctx.files.length, 'Processing ' + (k + 1) + ' of ' + ctx.files.length);
      const img = await IMG().decodeImage(f);
      try { const r = await fn(f, img); outs.push(...[].concat(r)); } finally { img.close(); }
      await ctx.tick();
    }
    return outs;
  }
  function roundRect(cx, x, y, w, hh, r) {
    r = Math.max(0, Math.min(r, w / 2, hh / 2));
    cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + hh, r); cx.arcTo(x + w, y + hh, x, y + hh, r); cx.arcTo(x, y + hh, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
  }

  MAS.impl['image-border'] = {
    types: RASTER, multiple: true, max: 50, maxMB: 50, action: 'Apply', actionIcon: 'frame', bundleSuffix: 'framed',
    options: [
      { id: 'border', type: 'range', label: 'Border', default: 12, min: 0, max: 120, format: (v) => v + ' px' },
      { id: 'color', type: 'color', label: 'Border colour', default: '#ffffff' },
      { id: 'padding', type: 'range', label: 'Padding', default: 0, min: 0, max: 200, format: (v) => v + ' px' },
      { id: 'pad', type: 'color', label: 'Padding colour', default: '#ffffff', showIf: (o) => o.padding > 0 },
      { id: 'radius', type: 'range', label: 'Rounded corners', default: 24, min: 0, max: 300, format: (v) => v + ' px' },
      { id: 'format', type: 'segmented', label: 'Save as', default: 'png', options: [['png', 'PNG (keeps transparent corners)'], ['jpeg', 'JPG']] },
    ],
    async run(ctx) {
      const o = ctx.opts;
      return eachImage(ctx, async (f, img) => {
        const inner = IMG().drawImage(img);
        const b = Number(o.border), p = Number(o.padding), r = Number(o.radius);
        const W = inner.width + 2 * (b + p), H = inner.height + 2 * (b + p);
        if (W * H > 16e6) throw new UserError('“' + f.file.name + '” would be too large with this border. Resize it first.');
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const cx = cv.getContext('2d');
        if (o.format === 'jpeg') { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H); }
        roundRect(cx, 0, 0, W, H, r); cx.fillStyle = o.color; cx.fill();
        roundRect(cx, b, b, W - 2 * b, H - 2 * b, Math.max(0, r - b)); cx.fillStyle = o.pad; if (p) cx.fill();
        cx.save(); roundRect(cx, b + p, b + p, inner.width, inner.height, Math.max(0, r - b - p)); cx.clip(); cx.drawImage(inner, b + p, b + p); cx.restore();
        inner.width = 0;
        const blob = await IMG().encode(cv, o.format, 0.92);
        cv.width = 0;
        return ctx.out(blob, Core.outName(f.file.name, 'framed', o.format === 'png' ? 'png' : 'jpg'), { note: W + ' × ' + H + ' px' });
      });
    },
  };

  MAS.impl['split-image'] = {
    types: RASTER, multiple: false, maxMB: 50, action: 'Split', actionIcon: 'grid-3x3', bundleSuffix: 'tiles',
    options: [
      { id: 'cols', type: 'number', label: 'Columns', default: 3, min: 1, max: 12 },
      { id: 'rows', type: 'number', label: 'Rows', default: 1, min: 1, max: 12 },
    ],
    validate: (st) => (Number(st.opts.cols) * Number(st.opts.rows) < 2 ? 'Choose at least 2 tiles.' : ''),
    async run(ctx) {
      const cols = Math.max(1, Math.min(12, Math.floor(ctx.opts.cols))), rows = Math.max(1, Math.min(12, Math.floor(ctx.opts.rows)));
      return eachImage(ctx, async (f, img) => {
        const full = IMG().drawImage(img);
        const fmt = f.type === 'png' || f.type === 'webp' ? f.type : 'jpeg';
        const tw = Math.floor(full.width / cols), th = Math.floor(full.height / rows);
        const outs = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
          cv.getContext('2d').drawImage(full, c * tw, r * th, tw, th, 0, 0, tw, th);
          outs.push(ctx.out(await IMG().encode(cv, fmt, 0.92), Core.outName(f.file.name, 'r' + (r + 1) + 'c' + (c + 1), IMG().EXT[fmt]), { note: tw + ' × ' + th + ' px' }));
          cv.width = 0;
        }
        full.width = 0;
        ctx.summary.push(outs.length + ' tiles, in reading order (row by row).');
        return outs;
      });
    },
  };

  const SOCIAL = [['ig-post', 'Instagram post (1080 × 1080)', 1080, 1080], ['ig-portrait', 'Instagram portrait (1080 × 1350)', 1080, 1350], ['story', 'Story or Reel (1080 × 1920)', 1080, 1920],
    ['fb-post', 'Facebook post (1200 × 630)', 1200, 630], ['fb-cover', 'Facebook cover (1640 × 624)', 1640, 624], ['yt-thumb', 'YouTube thumbnail (1280 × 720)', 1280, 720],
    ['yt-banner', 'YouTube banner (2560 × 1440)', 2560, 1440], ['li-post', 'LinkedIn post (1200 × 627)', 1200, 627], ['li-banner', 'LinkedIn banner (1584 × 396)', 1584, 396], ['x-post', 'X post (1600 × 900)', 1600, 900], ['x-header', 'X header (1500 × 500)', 1500, 500]];
  MAS.impl['social-media-resizer'] = {
    types: RASTER, multiple: true, max: 30, maxMB: 50, action: 'Resize', actionIcon: 'share-2', bundleSuffix: 'social',
    options: [
      { id: 'size', type: 'select', label: 'Size', default: 'ig-post', options: SOCIAL.map((s) => [s[0], s[1]]) },
      { id: 'fit', type: 'segmented', label: 'Fit', default: 'cover', options: [['cover', 'Fill and crop'], ['blur', 'Fit with blurred edges'], ['color', 'Fit with colour']] },
      { id: 'bg', type: 'color', label: 'Background', default: '#ffffff', showIf: (o) => o.fit === 'color' },
    ],
    async run(ctx) {
      const s = SOCIAL.find((x) => x[0] === ctx.opts.size);
      const [W, H] = [s[2], s[3]];
      return eachImage(ctx, async (f, img) => {
        const src = IMG().drawImage(img);
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high';
        const cover = Math.max(W / src.width, H / src.height), contain = Math.min(W / src.width, H / src.height);
        const put = (k) => cx.drawImage(src, (W - src.width * k) / 2, (H - src.height * k) / 2, src.width * k, src.height * k);
        if (ctx.opts.fit === 'cover') put(cover);
        else {
          if (ctx.opts.fit === 'blur') {
            const tiny = document.createElement('canvas'); tiny.width = 24; tiny.height = Math.max(1, Math.round(24 * H / W));
            const tc = tiny.getContext('2d'); const k = Math.max(tiny.width / src.width, tiny.height / src.height);
            tc.drawImage(src, (tiny.width - src.width * k) / 2, (tiny.height - src.height * k) / 2, src.width * k, src.height * k);
            cx.drawImage(tiny, 0, 0, W, H); cx.fillStyle = 'rgba(0,0,0,.18)'; cx.fillRect(0, 0, W, H);
          } else { cx.fillStyle = ctx.opts.bg; cx.fillRect(0, 0, W, H); }
          put(contain);
        }
        src.width = 0;
        const blob = await IMG().encode(cv, 'jpeg', 0.9); cv.width = 0;
        return ctx.out(blob, Core.outName(f.file.name, s[0], 'jpg'), { note: W + ' × ' + H + ' px' });
      });
    },
  };

  MAS.impl['meme-generator'] = {
    kind: 'custom',
    mount(root) {
      const st = { img: null, name: 'meme', top: '', bottom: '', size: 10, upper: true, format: 'jpeg' };
      const canvas = h('canvas', { class: 'meme-canvas', 'aria-label': 'Meme preview' });
      const box = h('div', { class: 'meme' });
      function render() {
        if (!st.img) return;
        const maxW = 1600, k = Math.min(1, maxW / st.img.width);
        canvas.width = Math.round(st.img.width * k); canvas.height = Math.round(st.img.height * k);
        const cx = canvas.getContext('2d');
        cx.drawImage(st.img.source, 0, 0, canvas.width, canvas.height);
        const fs = Math.round(canvas.width * st.size / 100);
        cx.font = '900 ' + fs + 'px Impact, "Anton", "Arial Black", "Helvetica Neue", sans-serif';
        cx.textAlign = 'center'; cx.lineJoin = 'round'; cx.fillStyle = '#fff'; cx.strokeStyle = '#000'; cx.lineWidth = Math.max(2, fs / 8);
        const wrap = (t) => {
          const words = t.split(/\s+/).filter(Boolean), lines = [];
          let line = '';
          for (const w of words) { const tr = line ? line + ' ' + w : w; if (cx.measureText(tr).width > canvas.width * 0.94 && line) { lines.push(line); line = w; } else line = tr; }
          if (line) lines.push(line);
          return lines;
        };
        const draw = (t, top) => {
          const lines = wrap(st.upper ? t.toUpperCase() : t);
          lines.forEach((l, i) => {
            const y = top ? fs * 1.05 * (i + 1) : canvas.height - fs * 0.25 - fs * 1.05 * (lines.length - 1 - i);
            cx.strokeText(l, canvas.width / 2, y); cx.fillText(l, canvas.width / 2, y);
          });
        };
        if (st.top) draw(st.top, true);
        if (st.bottom) draw(st.bottom, false);
      }
      function draw() {
        if (!st.img) {
          box.replaceChildren(MAS.dropzone({ types: RASTER, big: true, title: 'Drop a picture', hint: 'JPG, PNG or WebP. Nothing is uploaded.', onFiles: async (f) => {
            try { st.img = await IMG().decodeImage({ file: f[0], type: await MAS.classify(f[0]) }); st.name = Core.baseName(f[0].name); draw(); }
            catch (e) { MAS.toast(MAS.userMessage(e), 'error'); }
          } }));
          return;
        }
        const field = (id, label) => h('div', { class: 'opt opt--wide' }, h('label', { class: 'opt-label', for: 'meme-' + id }, label),
          h('input', { class: 'input', id: 'meme-' + id, value: st[id], oninput: (e) => { st[id] = e.target.value; render(); } }));
        box.replaceChildren(h('div', { class: 'meme-grid' },
          h('div', { class: 'meme-controls' }, field('top', 'Top text'), field('bottom', 'Bottom text'),
            h('div', { class: 'opt' }, h('label', { class: 'opt-label', for: 'meme-size' }, 'Text size'), h('input', { type: 'range', id: 'meme-size', min: 5, max: 18, value: st.size, oninput: (e) => { st.size = +e.target.value; render(); } })),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.upper, onchange: (e) => { st.upper = e.target.checked; render(); } }), h('span', null, 'ALL CAPS')),
            h('div', { class: 'row-gap' },
              h('button', { type: 'button', class: 'btn btn--cta', onclick: async () => MAS.save(await MAS.canvasToBlob(canvas, 'image/jpeg', 0.92), Core.safeFileName(st.name, 'meme') + '-meme.jpg') }, icon('download'), 'Download JPG'),
              h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { if (st.img) st.img.close(); st.img = null; draw(); } }, icon('x'), 'New picture'))),
          h('div', { class: 'meme-preview' }, canvas)));
        render();
      }
      draw();
      root.append(box);
      MAS.setPageDrop(async (f) => { try { if (st.img) st.img.close(); st.img = await IMG().decodeImage({ file: f[0], type: await MAS.classify(f[0]) }); st.name = Core.baseName(f[0].name); draw(); } catch (e) { MAS.toast(MAS.userMessage(e), 'error'); } });
      return () => { if (st.img) st.img.close(); MAS.setPageDrop(null); };
    },
  };

  /* ---------------- text & developer ---------------- */
  MAS.impl['html-entities'] = {
    kind: 'text', mono: true, placeholder: '<p class="note">Tom & Jerry’s “café”</p>',
    actions: [{ id: 'encode', label: 'Encode' }, { id: 'decode', label: 'Decode' }],
    options: [{ id: 'all', type: 'checkbox', label: 'Non-ASCII', checkLabel: 'Also encode non-ASCII characters (é, ক, emoji)', default: false }],
    transform(text, o, action) {
      if (action === 'decode') { const ta = document.createElement('textarea'); ta.innerHTML = text; return { text: ta.value }; }
      return { text: Core.htmlEncode(text, o.all) };
    },
    outputName: () => 'html.txt',
  };

  MAS.impl['text-cleaner'] = {
    kind: 'text', placeholder: 'Paste a list or text with messy lines',
    actions: [{ id: 'clean', label: 'Clean' }],
    options: [
      { id: 'trim', type: 'checkbox', label: 'Spaces', checkLabel: 'Trim spaces at line ends', default: true },
      { id: 'spaces', type: 'checkbox', label: 'Inner spaces', checkLabel: 'Collapse repeated spaces', default: true },
      { id: 'empty', type: 'checkbox', label: 'Empty lines', checkLabel: 'Remove empty lines', default: true },
      { id: 'dedupe', type: 'checkbox', label: 'Duplicates', checkLabel: 'Remove duplicate lines', default: true },
      { id: 'ci', type: 'checkbox', label: 'Letter case', checkLabel: 'Ignore letter case when comparing', default: false },
      { id: 'sort', type: 'select', label: 'Sort', default: 'none', options: [['none', 'Keep order'], ['az', 'A to Z'], ['za', 'Z to A'], ['len', 'Shortest first']] },
      { id: 'reverse', type: 'checkbox', label: 'Order', checkLabel: 'Reverse the order', default: false },
    ],
    transform(text, o) {
      const before = text.replace(/\r\n?/g, '\n').split('\n').length;
      const out = Core.cleanText(text, o);
      const after = out ? out.split('\n').length : 0;
      return { text: out, info: before + ' lines → ' + after + ' lines.' };
    },
    outputName: () => 'cleaned.txt',
  };

  MAS.impl['unicode-to-bijoy'] = {
    kind: 'text', placeholder: 'আমার সোনার বাংলা, আমি তোমায় ভালোবাসি',
    actions: [{ id: 'u2b', label: 'Convert to Bijoy' }],
    transform(text) {
      if (!window.MASBijoy) return { error: 'The converter didn’t load. Reload the page.' };
      const out = window.MASBijoy.toBijoy(text);
      return { text: out, info: 'Paste this where the SutonnyMJ (Bijoy) font is used. Check rare conjuncts after pasting.' };
    },
    outputName: () => 'bijoy.txt',
  };

  MAS.impl['number-base-converter'] = {
    kind: 'custom',
    mount(root) {
      MAS.formTool(root, [
        { id: 'v', type: 'text', label: 'Number', default: '255', wide: true },
        { id: 'base', type: 'segmented', label: 'It’s written in', default: '10', options: [['2', 'Binary'], ['8', 'Octal'], ['10', 'Decimal'], ['16', 'Hex']] },
      ], (o) => {
        const r = Core.numberBases(o.v, Number(o.base));
        if (!r) return h('p', { class: 'muted' }, 'Type a number.');
        return MAS.resultRows([['Binary', r.bin, true], ['Octal', r.oct, true], ['Decimal', r.dec, true], ['Hexadecimal', r.hex, true], ['Bits', String(r.bin.replace('-', '').length)]]);
      });
      return () => {};
    },
  };

  MAS.impl['lorem-ipsum'] = {
    kind: 'custom',
    mount(root) {
      const ta = h('textarea', { class: 'input', rows: 10, readonly: true, 'aria-label': 'Generated text' });
      const opts = { n: 3, unit: 'paragraphs' };
      const gen = () => { ta.value = Core.lorem(opts.n, opts.unit); };
      const box = h('div', { class: 'ws-options' });
      const fields = [{ id: 'n', type: 'number', label: 'How many', default: 3, min: 1, max: 100 }, { id: 'unit', type: 'segmented', label: 'Of', default: 'paragraphs', options: [['paragraphs', 'Paragraphs'], ['sentences', 'Sentences'], ['words', 'Words']] }];
      const onOpt = (f, re) => { if (re) MAS.renderOptions(box, fields, opts, onOpt); gen(); };
      MAS.renderOptions(box, fields, opts, onOpt);
      gen();
      root.append(box, ta, h('div', { class: 'row-gap' }, h('button', { type: 'button', class: 'btn btn--cta', onclick: gen }, icon('refresh-cw'), 'Generate'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => MAS.copy(ta.value) }, icon('copy'), 'Copy')));
      return () => {};
    },
  };

  /* ---------------- files ---------------- */
  MAS.impl['file-info'] = {
    types: ['any'], multiple: true, max: 50, maxMB: 1000, totalMB: 2000, action: 'Inspect', actionIcon: 'file-search', doneTitle: 'File details', noBundle: true,
    async run(ctx) {
      const lines = [];
      const cards = h('div', { class: 'info-cards' });
      for (let k = 0; k < ctx.files.length; k++) {
        ctx.check();
        const f = ctx.files[k];
        ctx.progress(k / ctx.files.length, 'Inspecting ' + f.file.name);
        const rows = [['Name', f.file.name], ['Real type', (MAS.TYPE_LABEL[f.type] || f.type || 'Unknown').split(',')[0] + (f.type ? '' : ' (not recognised)')],
          ['Browser says', f.file.type || '(none)'], ['Size', Core.formatBytes(f.file.size) + ' (' + f.file.size.toLocaleString() + ' bytes)'],
          ['Last modified', f.file.lastModified ? new Date(f.file.lastModified).toLocaleString() : '—']];
        const ext = (f.file.name.split('.').pop() || '').toLowerCase();
        const expected = { pdf: 'pdf', jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', zip: 'zip', docx: 'zip', xlsx: 'zip', pptx: 'zip' }[ext];
        if (expected && f.type && expected !== f.type) rows.push(['Warning', 'The name says .' + ext + ' but the content is ' + (MAS.TYPE_LABEL[f.type] || f.type) + '.']);
        try {
          if (/^(jpeg|png|webp|gif|bmp|avif|heic|svg)$/.test(f.type)) { const img = await IMG().decodeImage(f); rows.push(['Dimensions', img.width + ' × ' + img.height + ' px (' + (img.width * img.height / 1e6).toFixed(1) + ' MP)']); img.close(); }
          if (f.type === 'jpeg') { const o = Core.jpegOrientation(new Uint8Array(await f.file.slice(0, 131072).arrayBuffer())); if (o !== 1) rows.push(['EXIF orientation', String(o) + ' (the photo is stored rotated)']); }
          if (f.type === 'pdf') {
            const PDFLib = await ctx.lib('pdflib');
            const m = await Core.inspectPdf(PDFLib, await ctx.bytes(f));
            rows.push(['Pages', String(m.pages)]);
            ['title', 'author', 'subject', 'creator', 'producer'].forEach((key) => { if (m[key]) rows.push([key[0].toUpperCase() + key.slice(1), m[key]]); });
          }
        } catch (e) { rows.push(['Note', MAS.userMessage(e)]); }
        if (window.crypto && crypto.subtle && f.file.size <= 500 * 1048576) {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.file.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
          rows.push(['SHA-256', hash]);
        }
        cards.append(h('section', { class: 'info-card' }, h('h3', null, f.file.name), MAS.resultRows(rows.map(([a, b]) => [a, b, a === 'SHA-256']))));
        lines.push(rows.map(([a, b]) => a + ': ' + b).join('\n'));
        await ctx.tick();
      }
      return [{ node: cards }, ctx.textOut(lines.join('\n\n'), 'file-report.txt')];
    },
  };
})();
