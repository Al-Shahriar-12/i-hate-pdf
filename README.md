# I HATE PDF — by MAS Studio

**Every file. Every tool. One powerful workspace.**

Version 1.1.0. 103 free tools for PDFs, images, AI, Bengali text, developers and engineering, running in the browser. No account, no uploads for local tools, no ads.

Live site (after you deploy): `https://al-shahriar-12.github.io/i-hate-pdf/`

## What’s in 1.1

- **Completely free.** Every tool works with no sign-up and no limits. Planned Pro features are listed on the *Upcoming Pro features* page and are never shown as working.
- **AI with your choice of model** (18 AI tools: chat, chat with PDF, summarizer, rewriter, grammar, translator, email, essays, captions, CV and cover letters, code explainer, meeting notes and more):
  - *On-device model, free and private*: Qwen, Llama, Gemma, Phi or SmolLM run on your own graphics chip with WebGPU (WebLLM). Downloads once (0.4–3.7 GB), then works offline. Nothing you type leaves the device.
  - *Free cloud models*: OpenRouter (models ending in `:free`), Groq and Google Gemini free tiers.
  - *Your own key*: OpenAI, Anthropic, DeepSeek, Mistral, or any OpenAI-compatible server (LM Studio, vLLM, Together…).
  - *Ollama on your computer*: start it with `OLLAMA_ORIGINS=https://al-shahriar-12.github.io ollama serve`.
  - Keys stay in the visitor’s browser and go only to the provider they picked.
- **New tools**: Sign PDF (draw, type or upload), Protect and Unlock PDF (AES-256), OCR in English and Bengali, Crop PDF, Headers and footers, Pages per sheet, Grayscale PDF, Flatten forms, Compare PDFs, PDF to WebP, Python runner (with NumPy, SymPy, pandas, SciPy and Matplotlib on demand), Bijoy ⇄ Unicode (including .docx), Bangla calendar, Amount in words (English and বাংলা), engineering unit converter (kN, kip, ksi, MPa, katha, bigha…), rebar weight, CGPA (UGC scale), EMI, image crop, filters, watermark, border, collage, split, palette, favicon, barcode, meme maker, social media sizes, regex, JWT, CSV ⇄ JSON, YAML ⇄ JSON, Markdown, diff, password generator, HTML entities, number bases, text cleaner, file inspector and more.
- **MAS Studio apps**: Flexure MAS, Frame MAS, BNBC Frame MAS, Beam-Frame MAS and Truss MAS, the how-to video, Chess.MAS as the game section, and a Share button with the author’s message.
- **About** with the developer’s photos and signature.
- **Design**: blueprint grid and section-hatch textures, light, dark and system themes.

## Deploy to GitHub Pages (step by step)

GitHub’s web uploader accepts **at most 100 files at a time** and drops folders, so the site comes as **4 ZIP parts**. Every file belongs at the repository root.

1. Create a **public** repository named **`i-hate-pdf`** under `Al-Shahriar-12` (the links in the pages assume this name).
2. Unzip all four parts on your computer.
3. In the repository, choose **Add file → Upload files**. Select every file from **part 1** (not the folder), then **Commit changes**.
4. Repeat for **part 2**, **part 3** and **part 4**, committing after each. (Part 4 holds the big engines for Python, OCR and on-device AI; the largest file is 10 MB, under GitHub’s 25 MB limit.)
5. Go to **Settings → Pages → Build and deployment**. Source: *Deploy from a branch*. Branch: `main`, folder `/ (root)`. Save.
6. Wait one or two minutes, then open `https://al-shahriar-12.github.io/i-hate-pdf/`.

**Updating later:** upload only the changed files. Change the version in `sw.js` (`ihatepdf-v1.1.0`) on every release so visitors get fresh files.

**Using Git or GitHub Desktop instead:** unzip all four parts into one folder, copy it into the repository folder, commit and push.

## Architecture

- No build step on GitHub: plain scripts loaded with `defer`, so uploading files is the whole deployment.
- `registry.js` + `registry2.js` are the single source of truth for every tool (category, inputs, status, how-to, FAQ, related tools). Navigation, search, counts, the sitemap and 120 SEO pages come from them.
- `core.js`, `core-more.js`, `core2.js`: pure processing functions (PDF operations, page ranges, file sniffing, lossless metadata stripping, Bengali calendar, number words, diff, CSV, colours, units, finance). No DOM, so they run in Node tests too.
- `app.js`: router, theme, search, layout and three reusable tool engines.
- `tools-*.js`: tool implementations. `tools-ai.js` is the **React** (React 18 + htm, no build needed) AI studio with a provider abstraction. `py-worker.js` runs **Python** (Pyodide) in a Web Worker so the page never freezes and Stop always works.
- Heavy engines load only when a tool needs them: pdf-lib (@cantoo fork, adds encryption), PDF.js, Tesseract.js, Pyodide, WebLLM, React.
- `build.py` (Python) generates the site, SEO pages, PWA files, licences and the split ZIPs.

## Security and privacy

- Strict Content-Security-Policy: scripts only from the site itself (hashed inline scripts, WebAssembly allowed, no `eval`). Network requests are allowed so AI providers and Python packages can be reached, and only when the visitor uses those features.
- Files are checked by their content, not their name. Size and count limits are shown and enforced.
- Password tools never bypass protection; Unlock needs the password.
- Sign PDF adds a visible signature image, and says clearly that it is not a certificate-based digital signature.
- No analytics, cookies or trackers.

## Tests

```
npm install
npm test
```

Node’s built-in test runner covers PDF operations (with both pdf-lib and the @cantoo fork), encryption round trips, page ranges, file sniffing, metadata stripping, the Bangla calendar (national days and round trips), amounts in words, Bijoy ⇄ Unicode, units, CGPA, EMI, CSV, JWT, colours and more.

Release checks in headless Chromium: all 120 pages open on a 390 px phone screen with no errors or sideways scrolling, and 38 functional checks pass, including real OCR, AES-256 protect and unlock, Sign PDF, the Python runner, Compare PDFs and the AI studio settings.

## Honest limits

- On-device AI needs WebGPU (Chrome or Edge 113+ on computers, recent Android Chrome). It was tested up to the point of loading; model downloads come from Hugging Face on first use.
- Cloud AI providers change model names over time; type any model name or use **Load models**.
- Python packages beyond the standard library download from jsDelivr the first time they’re imported. `input()` isn’t supported.
- The claude.ai preview can’t run OCR, Python or on-device AI (they need files hosted with the site); it links to the full version instead.
- Office formats (Word, Excel, PowerPoint) need a server and are planned as a Pro feature.

## About

Built by **MAS Studio** (Mohammad Al Shahriar Studio), the studio of MD Al Shahriar, BSc in Civil Engineering, BUET.
GitHub: [Al-Shahriar-12](https://github.com/Al-Shahriar-12) · YouTube: [channel](https://www.youtube.com/channel/UCywFnnFoQ9N071noUAL_m8A)

Third-party licences: `THIRD_PARTY_LICENSES.txt`.
