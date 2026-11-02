/* I HATE PDF — Python runner worker. Pyodide 0.26.4 (CPython 3.12 in WebAssembly) runs here, off the page's main thread.
 * The interpreter and standard library load from this site (works offline). Extra packages such as NumPy download
 * from the official Pyodide CDN the first time code imports them, verified against the local lock file's SHA-256 hashes. */
const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let py = null, loading = null;
const post = (type, data) => self.postMessage({ type, data });

async function init(indexURL) {
  if (py) return py;
  if (!loading) loading = (async () => {
    post('status', 'Starting Python (about 13 MB the first time)…');
    importScripts(indexURL + 'pyodide.js');
    const p = await self.loadPyodide({ indexURL });
    if (p._api && p._api.config) p._api.config.indexURL = CDN; // packages come from the CDN; the core stays local
    p.setStdout({ batched: (s) => post('stdout', s + '\n') });
    p.setStderr({ batched: (s) => post('stderr', s + '\n') });
    await p.runPythonAsync('import os, sys\nos.environ["MPLBACKEND"] = "AGG"\nos.makedirs("/home/pyodide", exist_ok=True)\nos.chdir("/home/pyodide")');
    py = p;
    return p;
  })();
  return loading;
}

const FIGS = `
import sys, io, base64
_figs = []
if 'matplotlib.pyplot' in sys.modules:
    import matplotlib.pyplot as _plt
    for _n in _plt.get_fignums():
        _b = io.BytesIO()
        _plt.figure(_n).savefig(_b, format='png', dpi=110, bbox_inches='tight')
        _figs.append(base64.b64encode(_b.getvalue()).decode())
    _plt.close('all')
_figs
`;

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    const p = await init(m.indexURL);
    if (m.type === 'init') { post('ready', true); return; }
    if (m.type === 'run') {
      try {
        await p.loadPackagesFromImports(m.code, { messageCallback: (s) => post('status', s), errorCallback: (s) => post('stderr', s + '\n') });
      } catch (err) {
        post('stderr', 'Couldn’t download a package this code imports. Packages need an internet connection the first time.\n');
      }
      post('status', 'Running…');
      const t0 = performance.now();
      const result = await p.runPythonAsync(m.code);
      let repr = null;
      if (result !== undefined && result !== null) {
        try { repr = String(result.toString ? result.toString() : result); } catch (err) { repr = String(result); }
        if (result && result.destroy) result.destroy();
      }
      const figs = await p.runPythonAsync(FIGS);
      const images = figs && figs.toJs ? figs.toJs() : [];
      if (figs && figs.destroy) figs.destroy();
      post('done', { repr, images, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    post('error', String((err && err.message) || err));
  }
};
