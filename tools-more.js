/*!
 * I HATE PDF — v1.1 developer, Bengali and productivity tools
 */
(function () {
  'use strict';
  const MAS = window.MAS, Core = window.MASCore, h = MAS.h, icon = MAS.icon;
  const UserError = Core.UserError;
  const fmt = (n, d) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d == null ? 4 : d }) : '—');
  const today = () => { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const ymd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
  const bnDigits = (x) => Core.bengaliDigits(String(x), 'to-bengali');

  /* ================= Developer ================= */
  MAS.impl['csv-json'] = {
    kind: 'text', mono: true, placeholder: 'name,age,city\nRahim,24,Dhaka\nKarim,31,Chattogram',
    actions: [{ id: 'to-json', label: 'CSV → JSON' }, { id: 'to-csv', label: 'JSON → CSV' }],
    options: [
      { id: 'header', type: 'checkbox', label: 'Header row', checkLabel: 'First CSV row holds the column names', default: true },
      { id: 'types', type: 'checkbox', label: 'Values', checkLabel: 'Turn numbers and true/false into real values', default: true },
    ],
    transform(text, o, action) {
      if (action === 'to-csv') {
        let v;
        try { v = JSON.parse(text); } catch (e) { return { error: 'This isn’t valid JSON. Paste an array of objects, or switch to CSV → JSON.' }; }
        const csv = Core.jsonToCsv(v);
        return { text: csv, info: (csv.split('\n').length - 1) + ' rows.' };
      }
      const rows = Core.csvToJson(text, { header: o.header, types: o.types });
      return { text: JSON.stringify(rows, null, 2), info: rows.length + ' rows, delimiter “' + (Core.detectDelimiter(text) === '\t' ? 'tab' : Core.detectDelimiter(text)) + '”.' };
    },
    outputName: (a) => (a === 'to-csv' ? 'data.csv' : 'data.json'),
  };

  let yaml = null;
  MAS.lib('jsyaml').then((y) => { yaml = y; }).catch(() => {});
  MAS.impl['json-yaml'] = {
    kind: 'text', mono: true, placeholder: '{"app": "I HATE PDF", "tools": ["merge", "split"]}',
    actions: [{ id: 'to-yaml', label: 'JSON → YAML' }, { id: 'to-json', label: 'YAML → JSON' }],
    transform(text, o, action) {
      if (!yaml) return { error: 'The YAML component is still loading. Try again in a moment.' };
      if (action === 'to-yaml') {
        let v;
        try { v = JSON.parse(text); } catch (e) { return { error: 'This isn’t valid JSON: ' + String(e.message).replace(/^JSON\.parse: /, '') }; }
        return { text: yaml.dump(v, { lineWidth: 100, noRefs: true }) };
      }
      try { return { text: JSON.stringify(yaml.load(text, { schema: yaml.JSON_SCHEMA }), null, 2) }; }
      catch (e) { return { error: 'This isn’t valid YAML' + (e.mark ? ' (line ' + (e.mark.line + 1) + ', column ' + (e.mark.column + 1) + ')' : '') + ': ' + (e.reason || e.message) + '.' }; }
    },
    outputName: (a) => (a === 'to-yaml' ? 'data.yaml' : 'data.json'),
  };

  MAS.impl['jwt-decoder'] = {
    kind: 'text', mono: true, outputLabel: 'Decoded', placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signature',
    actions: [{ id: 'decode', label: 'Decode' }],
    transform(text) {
      const r = Core.jwtDecode(text);
      const when = (s) => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);
      const notes = ['iat', 'nbf', 'exp'].filter((k) => r.payload[k] != null).map((k) => k + ': ' + when(r.payload[k]));
      return { text: '// Header\n' + JSON.stringify(r.header, null, 2) + '\n\n// Payload\n' + JSON.stringify(r.payload, null, 2) + (notes.length ? '\n\n// Times (UTC)\n' + notes.join('\n') : ''),
        info: r.status + '. Signature not verified.' };
    },
    outputName: () => 'jwt.txt',
  };

  MAS.impl['markdown-to-html'] = {
    kind: 'custom',
    mount(root) {
      const ta = h('textarea', { class: 'input input--mono text-input', id: 'md-in', rows: 14, spellcheck: 'true' });
      ta.value = '# Hello from I HATE PDF\n\nWrite **Markdown** on the left, see it here.\n\n- Lists\n- [Links](https://al-shahriar-12.github.io/)\n- `code`\n\n| Tool | Free |\n| --- | --- |\n| Merge PDF | Yes |\n';
      const preview = h('div', { class: 'md-preview', 'aria-live': 'off' });
      let html = '', libs = null;
      async function draw() {
        if (!libs) {
          try { libs = { marked: await MAS.lib('marked'), purify: await MAS.lib('purify') }; }
          catch (e) { preview.replaceChildren(MAS.errorView(MAS.userMessage(e))); return; }
        }
        html = libs.purify.sanitize(libs.marked.parse(ta.value, { gfm: true, breaks: false }), { USE_PROFILES: { html: true } });
        preview.innerHTML = html;
        preview.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
      }
      ta.addEventListener('input', MAS.debounce(draw, 150));
      const page = () => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Document</title>\n<style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#172033}pre,code{background:#f1f3f8;border-radius:6px}pre{padding:12px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #dce2ed;padding:6px 10px}</style></head>\n<body>\n' + html + '\n</body></html>\n';
      root.append(h('div', { class: 'text-grid' },
        h('div', { class: 'text-col' }, h('label', { class: 'opt-label', for: 'md-in' }, 'Markdown'), ta),
        h('div', { class: 'text-col' }, h('span', { class: 'opt-label' }, 'Preview'), preview)),
      h('div', { class: 'row-gap' },
        h('button', { type: 'button', class: 'btn btn--cta', onclick: () => MAS.copy(html) }, icon('copy'), 'Copy HTML'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => MAS.save(new Blob([page()], { type: 'text/html' }), 'document.html') }, icon('download'), 'Download HTML page'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => MAS.save(new Blob([ta.value], { type: 'text/markdown' }), 'document.md') }, icon('download'), 'Save .md')),
      h('p', { class: 'muted small' }, 'The HTML is sanitised, so scripts and unsafe attributes are removed.'));
      draw();
      return () => {};
    },
  };

  /* Regex runs in a throwaway worker with a time limit, so a runaway pattern can’t freeze the page. */
  const REGEX_WORKER = 'onmessage=function(e){var d=e.data;try{var re=new RegExp(d.p,d.f);var out=[];if(d.f.indexOf("g")>-1){var m;var n=0;while((m=re.exec(d.t))!==null&&n<2000){out.push({i:m.index,v:m[0],g:Array.prototype.slice.call(m,1),n:m.groups||null});if(m[0]==="")re.lastIndex++;n++;}}else{var m1=re.exec(d.t);if(m1)out.push({i:m1.index,v:m1[0],g:Array.prototype.slice.call(m1,1),n:m1.groups||null});}var rep=d.r!=null?d.t.replace(re,d.r):null;postMessage({ok:true,m:out,r:rep});}catch(err){postMessage({ok:false,e:String(err.message)});}}';
  function runRegex(p, f, t, r) {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker(URL.createObjectURL(new Blob([REGEX_WORKER], { type: 'text/javascript' }))); }
      catch (e) { // no workers here: run inline
        try { const re = new RegExp(p, f); const m = []; if (f.includes('g')) { let x, n = 0; while ((x = re.exec(t)) && n < 2000) { m.push({ i: x.index, v: x[0], g: x.slice(1), n: x.groups || null }); if (x[0] === '') re.lastIndex++; n++; } } else { const x = re.exec(t); if (x) m.push({ i: x.index, v: x[0], g: x.slice(1), n: x.groups || null }); } resolve({ ok: true, m, r: r != null ? t.replace(re, r) : null }); }
        catch (err) { resolve({ ok: false, e: err.message }); }
        return;
      }
      const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, e: 'The pattern took more than 1.5 seconds, which usually means catastrophic backtracking. Simplify nested quantifiers like (a+)+.' }); }, 1500);
      w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
      w.postMessage({ p, f, t, r });
    });
  }
  MAS.impl['regex-tester'] = {
    kind: 'custom',
    mount(root) {
      const pat = h('input', { class: 'input input--mono', id: 'rx-p', value: '(\\d{2,4})-(\\d{2})', spellcheck: 'false', autocomplete: 'off' });
      const flags = h('input', { class: 'input input--mono rx-flags', id: 'rx-f', value: 'g', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Flags' });
      const text = h('textarea', { class: 'input input--mono', id: 'rx-t', rows: 6, spellcheck: 'false' });
      text.value = 'Deadlines: 2026-10 for phase one, 2027-03 for phase two.';
      const repl = h('input', { class: 'input input--mono', id: 'rx-r', placeholder: 'Optional, e.g. $2/$1', spellcheck: 'false', autocomplete: 'off' });
      const out = h('div', { 'aria-live': 'polite' });
      let seq = 0;
      async function draw() {
        const my = ++seq;
        const f = flags.value.replace(/[^dgimsuyv]/g, '');
        if (!pat.value) { out.replaceChildren(h('p', { class: 'muted' }, 'Type a pattern.')); return; }
        const r = await runRegex(pat.value, f, text.value.slice(0, 200000), repl.value ? repl.value : null);
        if (my !== seq) return;
        if (!r.ok) { out.replaceChildren(h('p', { class: 'text-msg is-error' }, r.e)); return; }
        const marked = h('div', { class: 'rx-marked' });
        let pos = 0;
        r.m.forEach((m) => { if (m.i < pos) return; marked.append(text.value.slice(pos, m.i), h('mark', null, m.v || '∅')); pos = m.i + m.v.length; });
        marked.append(text.value.slice(pos));
        out.replaceChildren(h('p', { class: 'text-msg is-ok' }, r.m.length + (r.m.length === 1 ? ' match' : ' matches') + (r.m.length >= 2000 ? ' (stopped at 2,000)' : '') + '.'), marked,
          r.m.length ? h('ol', { class: 'rx-list' }, r.m.slice(0, 50).map((m) => h('li', null, h('code', null, m.v), m.g.length ? h('span', { class: 'muted small' }, ' groups: ' + m.g.map((g, i) => '$' + (i + 1) + '=' + (g == null ? '∅' : g)).join(', ')) : null))) : null,
          r.r != null ? h('div', null, h('span', { class: 'opt-label' }, 'After replace'), h('pre', { class: 'rx-replaced' }, r.r)) : null);
      }
      const later = MAS.debounce(draw, 150);
      [pat, flags, text, repl].forEach((x) => x.addEventListener('input', later));
      root.append(h('div', { class: 'opts' },
        h('div', { class: 'opt opt--wide' }, h('label', { class: 'opt-label', for: 'rx-p' }, 'Pattern'), h('div', { class: 'rx-row' }, h('span', { class: 'rx-slash' }, '/'), pat, h('span', { class: 'rx-slash' }, '/'), flags)),
        h('div', { class: 'opt opt--wide' }, h('label', { class: 'opt-label', for: 'rx-t' }, 'Test text'), text),
        h('div', { class: 'opt opt--wide' }, h('label', { class: 'opt-label', for: 'rx-r' }, 'Replace with'), repl)), out);
      draw();
      return () => {};
    },
  };

  MAS.impl['text-diff'] = {
    kind: 'custom',
    mount(root) {
      const a = h('textarea', { class: 'input text-input', id: 'df-a', rows: 9, placeholder: 'Original text' });
      const b = h('textarea', { class: 'input text-input', id: 'df-b', rows: 9, placeholder: 'Changed text' });
      a.value = 'The quick brown fox jumps over the lazy dog.\nI HATE PDF is free.';
      b.value = 'The quick red fox jumped over the lazy dog.\nI HATE PDF is completely free.';
      const opts = { mode: 'words' }, optsBox = h('div', { class: 'ws-options ws-options--flat' });
      const fields = [{ id: 'mode', type: 'segmented', label: 'Compare by', default: 'words', options: [['words', 'Words'], ['lines', 'Lines'], ['chars', 'Characters']] }];
      const out = h('div', { 'aria-live': 'polite' });
      async function draw() {
        const Diff = await MAS.lib('diff').catch(() => null);
        if (!Diff) { out.replaceChildren(MAS.errorView('The compare component didn’t load.')); return; }
        if (a.value.length + b.value.length > 400000) { out.replaceChildren(h('p', { class: 'text-msg is-error' }, 'These texts are too long to compare here (400,000 characters in total).')); return; }
        const parts = opts.mode === 'lines' ? Diff.diffLines(a.value, b.value) : opts.mode === 'chars' ? Diff.diffChars(a.value, b.value) : Diff.diffWordsWithSpace(a.value, b.value);
        let add = 0, del = 0;
        const view = h('div', { class: 'diff-view' }, parts.map((p) => { if (p.added) add += p.value.length; if (p.removed) del += p.value.length; return p.added ? h('ins', null, p.value) : p.removed ? h('del', null, p.value) : p.value; }));
        out.replaceChildren(h('p', { class: 'text-msg' }, add || del ? add.toLocaleString() + ' characters added, ' + del.toLocaleString() + ' removed.' : 'The texts are identical.'), view);
      }
      const onOpt = (f, re) => { if (re) MAS.renderOptions(optsBox, fields, opts, onOpt); draw(); };
      MAS.renderOptions(optsBox, fields, opts, onOpt);
      const later = MAS.debounce(draw, 200);
      a.addEventListener('input', later); b.addEventListener('input', later);
      root.append(h('div', { class: 'text-grid' },
        h('div', { class: 'text-col' }, h('label', { class: 'opt-label', for: 'df-a' }, 'Original'), a),
        h('div', { class: 'text-col' }, h('label', { class: 'opt-label', for: 'df-b' }, 'Changed'), b)), optsBox, out);
      draw();
      return () => {};
    },
  };

  MAS.impl['password-generator'] = {
    kind: 'custom',
    mount(root) {
      const SETS = { upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.?/' };
      const AMBIG = /[Il1O0o]/g;
      const list = h('ul', { class: 'pw-list' });
      const info = h('p', { class: 'text-msg' });
      function rand(n) { // unbiased integer in [0, n)
        const lim = Math.floor(0x100000000 / n) * n, b = new Uint32Array(1);
        do { crypto.getRandomValues(b); } while (b[0] >= lim);
        return b[0] % n;
      }
      const tool = MAS.formTool(root, [
        { id: 'length', type: 'range', label: 'Length', default: 16, min: 8, max: 64, format: (v) => v + ' characters' },
        { id: 'upper', type: 'checkbox', label: 'Uppercase', checkLabel: 'A–Z', default: true },
        { id: 'lower', type: 'checkbox', label: 'Lowercase', checkLabel: 'a–z', default: true },
        { id: 'digits', type: 'checkbox', label: 'Numbers', checkLabel: '0–9', default: true },
        { id: 'symbols', type: 'checkbox', label: 'Symbols', checkLabel: '! @ # $ …', default: true },
        { id: 'ambig', type: 'checkbox', label: 'Readability', checkLabel: 'Avoid look-alikes (I l 1 O 0)', default: false },
        { id: 'count', type: 'segmented', label: 'How many', default: '5', options: [['1', '1'], ['5', '5'], ['10', '10']] },
      ], (o) => {
        const chosen = Object.keys(SETS).filter((k) => o[k]);
        if (!chosen.length) throw new UserError('Choose at least one kind of character.');
        const sets = chosen.map((k) => (o.ambig ? SETS[k].replace(AMBIG, '') : SETS[k]));
        const pool = sets.join('');
        const make = () => {
          const chars = sets.map((s) => s[rand(s.length)]); // at least one of each chosen kind
          while (chars.length < o.length) chars.push(pool[rand(pool.length)]);
          for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
          return chars.join('');
        };
        list.replaceChildren(...Array.from({ length: Number(o.count) }, () => { const p = make(); return h('li', null, h('code', null, p), h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'Copy password', onclick: () => MAS.copy(p) }, icon('copy'))); }));
        const bits = Core.passwordEntropy(o.length, pool.length);
        info.textContent = 'About ' + bits + ' bits of entropy: ' + (bits >= 100 ? 'excellent' : bits >= 75 ? 'strong' : bits >= 55 ? 'fair' : 'weak') + '. Generated on your device.';
        info.className = 'text-msg ' + (bits >= 75 ? 'is-ok' : 'is-error');
        return [info, list];
      });
      root.append(h('button', { type: 'button', class: 'btn btn--cta', onclick: tool.update }, icon('refresh-cw'), 'Generate again'));
      return () => {};
    },
  };

  /* ================= Bengali ================= */
  MAS.impl['bijoy-to-unicode'] = {
    kind: 'custom', limits: ['Text of any length, or a .docx Word file up to 30 MB.'],
    mount(root, c) {
      const st = { tab: 'text' };
      const body = h('div');
      let B = null;
      const ready = MAS.lib('bijoy').then((x) => { B = x; }).catch(() => {});
      function draw() {
        body.replaceChildren(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Input' }, [['text', 'Paste text'], ['docx', 'Word file (.docx)']].map(([v, l]) =>
          h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(st.tab === v), onclick: () => { st.tab = v; draw(); } }, l))));
        if (st.tab === 'text') {
          const inp = h('textarea', { class: 'input text-input', id: 'bj-in', rows: 8, placeholder: 'Avgvi †mvbvi evsjv, Avwg †Zvgvq fv‡jvevwm' });
          const outp = h('textarea', { class: 'input text-input bn', id: 'bj-out', rows: 8, readonly: true });
          const msg = h('p', { class: 'text-msg' });
          const run = async () => {
            await ready;
            if (!B) { msg.textContent = 'The converter didn’t load.'; msg.className = 'text-msg is-error'; return; }
            outp.value = inp.value ? B.convertBijoyToUnicode(inp.value) : '';
            msg.textContent = inp.value && !B.looksLikeBijoy(inp.value) ? 'This doesn’t look like Bijoy text, so the result may be unchanged.' : '';
            msg.className = 'text-msg';
          };
          inp.addEventListener('input', MAS.debounce(run, 100));
          body.append(h('div', { class: 'text-grid' },
            h('div', { class: 'text-col' }, h('label', { class: 'opt-label', for: 'bj-in' }, 'Bijoy text'), inp),
            h('div', { class: 'text-col' }, h('div', { class: 'text-col-head' }, h('label', { class: 'opt-label', for: 'bj-out' }, 'Unicode বাংলা'),
              h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => outp.value && MAS.copy(outp.value) }, icon('copy'), 'Copy')), outp)), msg);
        } else {
          const zone = MAS.dropzone({ types: ['zip'], title: 'Drop a Word file here', hint: '.docx files written in SutonnyMJ or other Bijoy fonts. English text is left as it is.', button: 'Choose a .docx file', onFiles: async (files) => {
            const f = files[0];
            if (!/\.docx$/i.test(f.name)) { MAS.toast('Choose a .docx file. Older .doc files must be saved as .docx in Word first.', 'error'); return; }
            if (f.size > 30 * 1048576) { MAS.toast('Choose a file under 30 MB.', 'error'); return; }
            await ready;
            const pv = MAS.progressView(null); pv.set(null, 'Converting ' + f.name);
            body.append(pv.el);
            try {
              const blob = await B.convertDocx(f, { onProgress: (p) => pv.set(p && p.percent != null ? p.percent / 100 : null, 'Converting ' + f.name) });
              pv.el.replaceWith(MAS.resultView({ title: 'Your converted Word file is ready', toolId: c.tool.id, summary: ['Bijoy runs were converted to Unicode and set to a Unicode Bengali font.'],
                outputs: [MAS.makeOutput(blob, Core.baseName(f.name) + '-unicode.docx')] }));
            } catch (e) { pv.el.replaceWith(MAS.errorView('This file couldn’t be converted. It may not be a valid .docx file.')); }
          } });
          body.append(zone);
        }
      }
      draw();
      root.append(body);
      return () => {};
    },
  };

  MAS.impl['bengali-calendar'] = {
    kind: 'custom',
    mount(root) {
      const yr = Core.toBengaliDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()).year;
      const a = h('div');
      MAS.formTool(a, [{ id: 'date', type: 'date', label: 'English date', default: today() }], (o) => {
        const d = ymd(o.date);
        if (!d) throw new UserError('Pick a date.');
        const b = Core.toBengaliDate(d.y, d.m, d.d);
        const bn = bnDigits(b.day) + ' ' + b.monthName + ' ' + bnDigits(b.year) + ' বঙ্গাব্দ';
        return [h('p', { class: 'big-answer bn' }, bn), MAS.resultRows([['বার', b.weekday], ['ঋতু', b.season], ['In English', b.day + ' ' + b.monthNameEn + ' ' + b.year], ['Copy', bn, true]])];
      });
      const bm = h('div');
      MAS.formTool(bm, [
        { id: 'by', type: 'number', label: 'Bengali year (বঙ্গাব্দ)', default: yr, min: 1300, max: 1600 },
        { id: 'bmon', type: 'select', label: 'Month', default: '0', options: Core.BN_MONTHS.map((m, i) => [String(i), m + ' (' + Core.BN_MONTHS_EN[i] + ')']) },
        { id: 'bd', type: 'number', label: 'Day', default: 1, min: 1, max: 31 },
      ], (o) => {
        const g = Core.fromBengaliDate(Math.floor(o.by), Number(o.bmon), Math.floor(o.bd));
        const dt = new Date(Date.UTC(g.y, g.m - 1, g.d));
        return [h('p', { class: 'big-answer' }, dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))];
      });
      root.append(h('h2', { class: 'tool-sub' }, 'English to Bengali'), a, h('h2', { class: 'tool-sub' }, 'Bengali to English'), bm,
        h('p', { class: 'muted small' }, 'Uses Bangladesh’s revised Bengali calendar (2019), where Pohela Boishakh is 14 April and 21 February is 8 Falgun. West Bengal’s calendar can differ by a day.'));
      return () => {};
    },
  };

  MAS.impl['amount-in-words'] = {
    kind: 'custom',
    mount(root) {
      MAS.formTool(root, [
        { id: 'amount', type: 'text', label: 'Amount', default: '125000.50', placeholder: '1,25,000.50 or ১২৫০০০', wide: true },
        { id: 'cur', type: 'checkbox', label: 'Currency', checkLabel: 'Write as Taka (with “Only” / “মাত্র”)', default: true },
      ], (o) => {
        if (!String(o.amount).trim()) return h('p', { class: 'muted' }, 'Type an amount.');
        const en = Core.amountInWords(o.amount, 'en', o.cur), bn = Core.amountInWords(o.amount, 'bn', o.cur);
        const v = Number(String(o.amount).replace(/[,\s]/g, '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)));
        return MAS.resultRows([['In figures', Core.groupBD(v.toFixed(2)), true], ['English', en, true], ['বাংলা', bn, true]], 'kv--wide');
      });
      return () => {};
    },
  };

  /* ================= Productivity and engineering ================= */
  MAS.impl['unit-converter'] = {
    kind: 'custom',
    mount(root) {
      const qs = Object.keys(Core.UNITS);
      const box = h('div');
      let tool;
      const fieldsFor = (q) => {
        const us = Object.keys(Core.UNITS[q].u).map((u) => [u, u]);
        const defs = { length: ['ft', 'm'], area: ['ft²', 'm²'], volume: ['ft³ (cft)', 'm³'], mass: ['lb', 'kg'], force: ['kip', 'kN'], stress: ['ksi', 'MPa (N/mm²)'], moment: ['kip·ft', 'kN·m'], 'unit weight': ['lbf/ft³ (pcf)', 'kN/m³'], 'line load': ['kip/ft (klf)', 'kN/m'], temperature: ['°F', '°C'] }[q];
        return [
          { id: 'q', type: 'select', label: 'Quantity', default: q, options: qs.map((x) => [x, x[0].toUpperCase() + x.slice(1)]) },
          { id: 'v', type: 'number', label: 'Value', default: 1 },
          { id: 'from', type: 'select', label: 'From', default: defs[0], options: us },
          { id: 'to', type: 'select', label: 'To', default: defs[1], options: us },
        ];
      };
      function build(q, v) {
        box.replaceChildren();
        tool = MAS.formTool(box, fieldsFor(q), (o) => {
          if (o.q !== q) { setTimeout(() => build(o.q, o.v), 0); return null; }
          const r = Core.convertUnit(q, o.v, o.from, o.to);
          const all = Object.keys(Core.UNITS[q].u).map((u) => [u, fmt(Core.convertUnit(q, o.v, o.from, u), 6), String(Core.convertUnit(q, o.v, o.from, u))]);
          return [h('p', { class: 'big-answer' }, fmt(Number(o.v), 6) + ' ' + o.from + ' = ' + fmt(r, 6) + ' ' + o.to),
            h('details', { class: 'planned', open: true }, h('summary', null, 'All ' + q + ' units'), MAS.resultRows(all))];
        }, { initial: { v: v == null ? 1 : v } });
      }
      build('force');
      root.append(box, h('p', { class: 'muted small' }, 'Exact definitions are used (for example 1 kip = 4.4482216 kN). Katha and bigha follow the common Bangladesh standard of 720 ft² per katha and 20 katha per bigha; local measures can vary.'));
      return () => {};
    },
  };

  MAS.impl['rebar-weight-calculator'] = {
    kind: 'custom',
    mount(root) {
      const sizes = [6, 8, 10, 12, 16, 20, 22, 25, 28, 32, 36, 40];
      MAS.formTool(root, [
        { id: 'd', type: 'select', label: 'Bar diameter', default: '16', options: sizes.map((s) => [String(s), s + ' mm']) },
        { id: 'len', type: 'number', label: 'Length of one bar', default: 12, min: 0 },
        { id: 'unit', type: 'segmented', label: 'Length unit', default: 'm', options: [['m', 'metres'], ['ft', 'feet']] },
        { id: 'n', type: 'number', label: 'Number of bars', default: 10, min: 0 },
      ], (o) => {
        const d = Number(o.d), L = Number(o.len) * (o.unit === 'ft' ? 0.3048 : 1), n = Math.max(0, Math.floor(Number(o.n) || 0));
        const kgm = Core.rebarKgPerM(d), total = kgm * L * n;
        return [h('p', { class: 'big-answer' }, fmt(total, 2) + ' kg'),
          MAS.resultRows([['Total', fmt(total / 1000, 4) + ' tonnes', true], ['Per bar', fmt(kgm * L, 3) + ' kg'], ['Unit weight', fmt(kgm, 4) + ' kg/m, ' + fmt(kgm * 0.3048, 4) + ' kg/ft'], ['Total length', fmt(L * n, 2) + ' m']]),
          h('details', { class: 'planned' }, h('summary', null, 'Weight table for common sizes'), MAS.resultRows(sizes.map((s) => [s + ' mm', fmt(Core.rebarKgPerM(s), 3) + ' kg/m']))),
          h('p', { class: 'muted small' }, 'Uses the standard rule weight (kg/m) = d² ÷ 162, which assumes steel at about 7,850 kg/m³. Real bars vary within the tolerance of the steel standard.')];
      });
      return () => {};
    },
  };

  MAS.impl['cgpa-calculator'] = {
    kind: 'custom',
    mount(root) {
      const rows = [{ name: '', credit: 3, grade: 'A+' }, { name: '', credit: 3, grade: 'A' }, { name: '', credit: 1.5, grade: 'A-' }];
      const prev = { cgpa: '', credits: '' };
      const list = h('div', { class: 'cg-rows' });
      const out = h('div', { 'aria-live': 'polite' });
      const gradeOpts = Core.UGC_GRADES.map((g) => [g[0], g[0] + ' (' + g[1].toFixed(2) + ')']);
      function calc() {
        const g = Core.cgpa(rows);
        const pc = Number(prev.cgpa), pcr = Number(prev.credits);
        const hasPrev = pc > 0 && pcr > 0 && pc <= 4;
        const all = hasPrev ? (g.points + pc * pcr) / (g.credits + pcr) : null;
        out.replaceChildren(h('p', { class: 'big-answer' }, 'GPA ' + g.cgpa.toFixed(2)),
          MAS.resultRows([['Credits this term', fmt(g.credits, 2)], hasPrev ? ['New CGPA', all.toFixed(2), true] : null, hasPrev ? ['Total credits', fmt(g.credits + pcr, 2)] : null]));
      }
      function draw() {
        list.replaceChildren(...rows.map((r, i) => h('div', { class: 'cg-row' },
          h('input', { class: 'input', 'aria-label': 'Course ' + (i + 1) + ' name', placeholder: 'Course ' + (i + 1), value: r.name, oninput: (e) => { r.name = e.target.value; } }),
          h('input', { class: 'input input--num', type: 'number', min: '0', step: '0.25', 'aria-label': 'Credits for course ' + (i + 1), value: r.credit, oninput: (e) => { r.credit = e.target.value; calc(); } }),
          h('select', { class: 'input', 'aria-label': 'Grade for course ' + (i + 1), onchange: (e) => { r.grade = e.target.value; calc(); } }, gradeOpts.map(([v, l]) => h('option', { value: v, selected: r.grade === v ? true : null }, l))),
          h('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'Remove course ' + (i + 1), disabled: rows.length === 1, onclick: () => { rows.splice(i, 1); draw(); } }, icon('x')))));
        calc();
      }
      draw();
      root.append(h('div', { class: 'cg-head muted small' }, h('span', null, 'Course'), h('span', null, 'Credits'), h('span', null, 'Grade')), list,
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { rows.push({ name: '', credit: 3, grade: 'A' }); draw(); list.lastChild.querySelector('input').focus(); } }, icon('plus'), 'Add course'),
        h('div', { class: 'opts cg-prev' },
          h('div', { class: 'opt' }, h('label', { class: 'opt-label', for: 'cg-pc' }, 'Previous CGPA (optional)'), h('input', { class: 'input', id: 'cg-pc', type: 'number', step: '0.01', min: '0', max: '4', oninput: (e) => { prev.cgpa = e.target.value; calc(); } })),
          h('div', { class: 'opt' }, h('label', { class: 'opt-label', for: 'cg-pcr' }, 'Credits completed before'), h('input', { class: 'input', id: 'cg-pcr', type: 'number', step: '0.5', min: '0', oninput: (e) => { prev.credits = e.target.value; calc(); } }))),
        out, h('p', { class: 'muted small' }, 'Grade points follow the UGC uniform grading system used by Bangladeshi universities (A+ = 4.00 … D = 2.00, F = 0). Check your university’s rules.'));
      return () => {};
    },
  };

  MAS.impl['loan-emi-calculator'] = {
    kind: 'custom',
    mount(root) {
      let last = null;
      MAS.formTool(root, [
        { id: 'p', type: 'number', label: 'Loan amount', default: 500000, min: 0 },
        { id: 'r', type: 'number', label: 'Interest rate (% a year)', default: 9, min: 0 },
        { id: 'n', type: 'number', label: 'Tenure (months)', default: 60, min: 1, max: 600 },
      ], (o) => {
        const e = Core.emi(o.p, o.r, Math.min(600, o.n));
        last = e;
        return [h('p', { class: 'big-answer' }, 'EMI ' + fmt(e.payment, 2)),
          MAS.resultRows([['Total interest', fmt(e.interest, 2), true], ['Total payment', fmt(e.total, 2), true], ['Interest share', fmt(e.interest / e.total * 100, 1) + '%']]),
          h('details', { class: 'planned' }, h('summary', null, 'First 12 months'), h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
            h('thead', null, h('tr', null, ['Month', 'Payment', 'Principal', 'Interest', 'Balance'].map((x) => h('th', null, x)))),
            h('tbody', null, e.rows.slice(0, 12).map((r) => h('tr', null, [r.month, fmt(r.payment, 2), fmt(r.principal, 2), fmt(r.interest, 2), fmt(r.balance, 2)].map((x) => h('td', null, x)))))))),
          h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => {
            const csv = 'Month,Payment,Principal,Interest,Balance\n' + last.rows.map((r) => [r.month, r.payment.toFixed(2), r.principal.toFixed(2), r.interest.toFixed(2), r.balance.toFixed(2)].join(',')).join('\n');
            MAS.save(new Blob([csv], { type: 'text/csv' }), 'emi-schedule.csv');
          } }, icon('download'), 'Download full schedule (CSV)'),
          h('p', { class: 'muted small' }, 'Uses the standard reducing-balance formula. Your bank’s figures can differ slightly because of rounding, fees or day-count rules.')];
      });
      return () => {};
    },
  };

  MAS.impl['age-calculator'] = {
    kind: 'custom',
    mount(root) {
      MAS.formTool(root, [
        { id: 'a', type: 'date', label: 'Start date (birthday)', default: '2000-01-01' },
        { id: 'b', type: 'date', label: 'End date', default: today() },
      ], (o) => {
        let a = ymd(o.a), b = ymd(o.b);
        if (!a || !b) throw new UserError('Pick both dates.');
        let sign = '';
        if (Date.UTC(b.y, b.m - 1, b.d) < Date.UTC(a.y, a.m - 1, a.d)) { [a, b] = [b, a]; sign = 'The end date is before the start date. '; }
        const d = Core.dateDiff(a, b);
        const t = ymd(today());
        let next = new Date(Date.UTC(t.y, a.m - 1, a.d));
        if (next < Date.UTC(t.y, t.m - 1, t.d)) next = new Date(Date.UTC(t.y + 1, a.m - 1, a.d));
        const until = Math.round((next - Date.UTC(t.y, t.m - 1, t.d)) / 86400000);
        return [h('p', { class: 'big-answer' }, d.years + ' years, ' + d.months + ' months, ' + d.days + ' days'),
          MAS.resultRows([sign ? ['Note', sign.trim()] : null, ['Total days', fmt(d.totalDays, 0)], ['Total weeks', fmt(d.weeks, 0) + (d.totalDays % 7 ? ' and ' + (d.totalDays % 7) + ' days' : '')], ['Next anniversary', until === 0 ? 'Today!' : 'in ' + until + ' days']])];
      });
      return () => {};
    },
  };

  MAS.impl['percentage-calculator'] = {
    kind: 'custom',
    mount(root) {
      const blocks = [
        ['What is X% of Y?', [['x', 'X (%)', 15], ['y', 'Y', 2400]], (o) => fmt(o.x / 100 * o.y, 6)],
        ['X is what percent of Y?', [['x', 'X', 360], ['y', 'Y', 2400]], (o) => (o.y ? fmt(o.x / o.y * 100, 6) + '%' : '—')],
        ['Percentage change from X to Y', [['x', 'From X', 2400], ['y', 'To Y', 2760]], (o) => (o.x ? (o.y >= o.x ? '+' : '') + fmt((o.y - o.x) / Math.abs(o.x) * 100, 4) + '%' : '—')],
        ['Increase or decrease Y by X%', [['x', 'X (%)', 10], ['y', 'Y', 2400]], (o) => fmt(o.y * (1 + o.x / 100), 6) + ' (up) or ' + fmt(o.y * (1 - o.x / 100), 6) + ' (down)'],
      ];
      blocks.forEach(([title, fields, f]) => {
        const box = h('section', { class: 'pc-block' }, h('h2', { class: 'tool-sub' }, title));
        MAS.formTool(box, fields.map(([id, label, d]) => ({ id, type: 'number', label, default: d })), (o) => h('p', { class: 'big-answer' }, f({ x: Number(o.x) || 0, y: Number(o.y) || 0 })));
        root.append(box);
      });
      return () => {};
    },
  };
})();
