/*!
 * I HATE PDF — registry additions for v1.1 (on top of registry.js)
 * env: 'pages' = needs engine files hosted with the site (GitHub Pages); not available inside the claude.ai preview.
 */
(function (root) {
  'use strict';
  const R = root.MAS_REGISTRY;
  const T = (o) => Object.assign({ status: 'implemented', where: 'local', also: [], accepts: [], related: [], faq: [], how: [] }, o);
  const S = (a, b, c) => [a, b, c].filter(Boolean);
  const byId = (id) => R.tools.find((t) => t.id === id);

  const add = [
    T({ id: 'flatten-pdf', name: 'Flatten PDF form', cat: 'pdf', icon: 'layers-3', accepts: ['pdf'], desc: 'Lock filled-in form fields into the page so they can’t be edited.', kw: 'flatten form fields lock fillable',
      how: S('Add a filled-in PDF form.', 'Select Flatten.', 'Download the locked PDF.'), related: ['sign-pdf', 'compress-pdf'] }),
    T({ id: 'pdf-to-webp', name: 'PDF to WebP', cat: 'pdf', also: ['convert'], icon: 'image', accepts: ['pdf'], impl: 'pdf-to-webp', desc: 'Save PDF pages as small, sharp WebP images.', kw: 'pdf to webp image export',
      how: S('Add a PDF.', 'Pick pages and resolution.', 'Download the images.'), related: ['pdf-to-jpg', 'pdf-to-png'] }),
    T({ id: 'compare-pdf', name: 'Compare PDFs', cat: 'pdf', icon: 'git-compare', accepts: ['pdf'], desc: 'See which lines of text changed between two versions of a PDF.', kw: 'compare diff difference versions changes',
      how: S('Add the old and the new PDF.', 'Select Compare.', 'Review added and removed lines.'), related: ['text-diff', 'pdf-to-text'] }),
    T({ id: 'image-border', name: 'Border and rounded corners', cat: 'image', also: ['design'], icon: 'frame', accepts: ['jpeg', 'png', 'webp', 'bmp', 'avif', 'heic'], desc: 'Add a border, padding or rounded corners to images.', kw: 'border padding frame round corners radius',
      how: S('Add images.', 'Set border, padding and corner radius.', 'Download as PNG or JPG.'), related: ['image-collage', 'watermark-image'] }),
    T({ id: 'split-image', name: 'Split image', cat: 'image', icon: 'grid-3x3', accepts: ['jpeg', 'png', 'webp', 'bmp', 'avif', 'heic'], desc: 'Cut an image into a grid of tiles, for carousels and puzzles.', kw: 'split slice tiles grid instagram carousel cut',
      how: S('Add an image.', 'Choose rows and columns.', 'Download the tiles as a ZIP.'), related: ['image-collage', 'crop-image'] }),
    T({ id: 'svg-to-png', name: 'SVG to PNG', cat: 'image', also: ['convert'], icon: 'shapes', impl: 'convert-image', preset: { format: 'png' }, accepts: ['svg'], desc: 'Turn SVG graphics into sharp PNG images at 1×, 2× or 4× size.', kw: 'svg to png vector rasterize export',
      how: S('Add SVG files.', 'Pick a size.', 'Download the PNG files.'), related: ['convert-image', 'favicon-generator'] }),
    T({ id: 'meme-generator', name: 'Meme maker', cat: 'design', also: ['image'], icon: 'laugh', kind: 'custom', accepts: ['jpeg', 'png', 'webp', 'bmp', 'avif', 'heic'], desc: 'Add classic top and bottom meme text to any picture.', kw: 'meme caption funny text on image',
      how: S('Add a picture.', 'Type the top and bottom text.', 'Download the meme.'), related: ['watermark-image', 'social-media-resizer'] }),
    T({ id: 'social-media-resizer', name: 'Social media resizer', cat: 'image', also: ['design'], icon: 'share-2', accepts: ['jpeg', 'png', 'webp', 'bmp', 'avif', 'heic'], desc: 'Resize images for Facebook, Instagram, YouTube, LinkedIn and X.', kw: 'instagram post story facebook cover youtube thumbnail linkedin twitter x size',
      how: S('Add images.', 'Pick a platform size and fit.', 'Download the resized images.'), related: ['crop-image', 'compress-image'] }),
    T({ id: 'html-entities', name: 'HTML entities', cat: 'developer', icon: 'code-xml', kind: 'text', accepts: ['text'], desc: 'Escape text for HTML, or turn entities like &amp;amp; back into characters.', kw: 'html entities escape unescape encode decode amp lt gt',
      how: S('Paste text.', 'Choose Encode or Decode.', 'Copy the result.'), related: ['url-encoder', 'markdown-editor'] }),
    T({ id: 'number-base-converter', name: 'Number base converter', cat: 'developer', icon: 'hash', kind: 'custom', desc: 'Convert between binary, octal, decimal and hexadecimal, any size.', kw: 'binary hex octal decimal base convert',
      how: S('Type a number.', 'Pick its base.', 'Copy the other bases.'), related: ['color-converter'] }),
    T({ id: 'python-runner', name: 'Python runner', cat: 'developer', icon: 'square-terminal', kind: 'custom', requires: 'python', desc: 'Run Python 3 in your browser, with NumPy, SymPy, pandas and Matplotlib on demand.', kw: 'python run code online compiler interpreter pyodide offline engineering calculation',
      how: S('Write or paste Python code.', 'Select Run.', 'Read the output below.'),
      faq: [['Can I use NumPy and Matplotlib?', 'Yes. The standard library works offline. NumPy, SymPy, pandas, SciPy and Matplotlib download from the jsDelivr CDN the first time your code imports them. input() isn’t supported; set values in code instead.'], ['Is my code sent anywhere?', 'No. Python runs in your browser using WebAssembly.']], related: ['json-formatter'] }),
    T({ id: 'lorem-ipsum', name: 'Lorem ipsum generator', cat: 'text', also: ['design'], icon: 'pilcrow', kind: 'custom', desc: 'Generate placeholder paragraphs, sentences or words.', kw: 'lorem ipsum dummy placeholder text filler',
      how: S('Choose how much.', 'Generate.', 'Copy the text.'), related: ['word-counter'] }),
    T({ id: 'text-cleaner', name: 'Text cleaner', cat: 'text', icon: 'list-filter', kind: 'text', accepts: ['text'], desc: 'Remove duplicate or empty lines, trim spaces and sort lines.', kw: 'remove duplicates sort lines trim whitespace clean list dedupe',
      how: S('Paste text.', 'Tick the clean-up steps.', 'Copy the result.'), related: ['case-converter', 'text-diff'] }),
    T({ id: 'unicode-to-bijoy', name: 'Unicode to Bijoy', cat: 'bengali', also: ['text', 'convert'], icon: 'languages', kind: 'text', accepts: ['text'], 
      desc: 'Convert Unicode Bengali into Bijoy (SutonnyMJ) text for older software.', kw: 'unicode to bijoy sutonnymj ansi bangla',
      how: S('Paste Unicode Bengali.', 'Copy the Bijoy text.', 'Paste it where a SutonnyMJ font is used.'), related: ['bijoy-to-unicode'] }),
    T({ id: 'file-info', name: 'File inspector', cat: 'files', icon: 'file-search', accepts: ['any'], desc: 'See a file’s real type, size, dimensions, page count and SHA-256.', kw: 'file info type mime detect inspect metadata checksum',
      how: S('Add files.', 'Read the details.'), related: ['hash-generator', 'remove-image-metadata'] }),
  ];

  // ---------- AI tools (work with any provider the user picks) ----------
  const AI = (id, name, icon, desc, kw, how) => T({ id, name, cat: 'ai', icon, kind: 'custom', where: 'ai', requires: 'ai', impl: 'ai-studio', desc, kw, how: how || S('Fill in the details.', 'Pick an AI model, or use the default.', 'Copy, edit or download the result.'), related: ['ai-chat', 'ai-rewriter'] });
  const ai = [
        AI('ai-summarizer', 'AI summarizer', 'pilcrow', 'Summarize long text or a PDF into a few clear sentences or bullet points.', 'summarize summary tldr key points'),
    AI('ai-rewriter', 'AI rewriter', 'pen-line', 'Paraphrase text in a new tone: formal, friendly, persuasive or simpler.', 'paraphrase rewrite reword tone changer'),
    AI('ai-grammar', 'Grammar fixer', 'spell-check', 'Fix grammar, spelling and punctuation, and see what changed.', 'grammar spelling proofread correct punctuation'),
    AI('ai-translator', 'AI translator', 'languages', 'Translate between English, Bengali and many other languages, naturally.', 'translate translation bangla english অনুবাদ'),
    AI('ai-email-writer', 'Email writer', 'mail', 'Draft a clear email or reply from a few notes.', 'email writer reply draft professional'),
    AI('ai-essay-outliner', 'Essay and report outliner', 'list-tree', 'Turn a topic into a structured outline for an essay, report or thesis chapter.', 'essay outline report structure assignment thesis'),
    AI('ai-social-caption', 'Social media captions', 'megaphone', 'Write captions and hashtags for Facebook, Instagram, LinkedIn and X.', 'caption hashtags social media post linkedin'),
    AI('ai-cover-letter', 'CV and cover letter helper', 'briefcase', 'Write a tailored cover letter or improve CV bullet points for a job.', 'cover letter resume cv job application'),
    AI('ai-code-explainer', 'Code explainer', 'code', 'Explain what a piece of code does, line by line, and spot likely bugs.', 'explain code bug programming python javascript'),
    AI('ai-meeting-notes', 'Meeting notes organizer', 'notebook-pen', 'Turn messy notes into decisions, action items and a summary.', 'meeting notes minutes action items'),
    AI('ai-simplifier', 'Explain simply', 'lightbulb', 'Rewrite complex text so a student or beginner can understand it.', 'simplify explain like eli5 easy language'),
    AI('ai-faq-generator', 'FAQ generator', 'circle-help', 'Create clear questions and answers from a product, service or document.', 'faq questions answers generator'),
    AI('ai-name-ideas', 'Name ideas', 'wand-sparkles', 'Brainstorm names for a business, product, channel or project.', 'business name generator brand ideas'),
    AI('ai-youtube-script', 'YouTube script', 'clapperboard', 'Plan a video with a hook, sections and a call to action.', 'youtube script video plan hook'),
    AI('ai-product-description', 'Product description', 'shopping-bag', 'Write a product description that’s clear and persuasive.', 'product description ecommerce copywriting'),
  ];
  // Existing AI tools now run on the multi-provider AI studio
  ['ai-document-assistant', 'ai-chat', 'ai-writer'].forEach((id) => { const t = byId(id); if (t) { t.impl = 'ai-studio'; delete t.requires; t.requires = 'ai'; } });
  Object.assign(byId('ai-document-assistant'), { name: 'Chat with PDF', desc: 'Ask questions about a PDF or long text, or have it summarized and translated, with the AI model you choose.' });
  Object.assign(byId('ai-chat'), { desc: 'Chat with the AI you choose: a free on-device model, free cloud models, or your own API key.', icon: 'bot' });
  byId('ai-chat').kw += ' chatgpt alternative deepseek mistral openai anthropic free ai webllm';
  ['ai-document-assistant', 'ai-chat', 'ai-writer'].forEach((id) => {
    byId(id).faq = [['Which AI does it use?', 'The one you pick: a free model that runs on your own device, free cloud models through OpenRouter, Groq or Gemini, your own OpenAI, Anthropic, DeepSeek or Mistral key, or Ollama on your computer.'],
      ['Where does my text go?', 'Only to the provider you pick, directly from your browser. On-device and Ollama models keep everything on your machine. API keys stay in this browser and are never sent to MAS Studio.']];
  });

  Object.assign(byId('sign-pdf'), { how: ['Add a PDF.', 'Draw, type or upload your signature.', 'Choose the pages and position, then select Sign and download.'], related: ['flatten-pdf', 'protect-pdf', 'add-page-numbers'] });
  R.tools.push(...add, ...ai);

  // Unicode to Bijoy and the Python runner are no longer "upcoming"
  R.upcoming = R.upcoming.filter((u) => !/Unicode to Bijoy/.test(u.title));
  R.upcoming.forEach((u) => { if (u.title === 'Python lab') { u.title = 'Python lab, offline packages'; u.text = 'Today’s Python runner fetches NumPy, pandas, SymPy and Matplotlib from a CDN on first use. Pro will bundle them for fully offline engineering work.'; } });
  R.upcoming.push({ v: 'v1.3', title: 'Bigger on-device AI', text: 'Larger, smarter models that run on your own GPU, plus voice input and reading answers aloud.' });
  R.roadmap = R.roadmap.filter((r) => !/Unicode to Bijoy|Compare text|Lorem|HTML entit|Number base|Python/i.test(r.name));
  // the share message is built from R.masApps in app.js, so new apps (like Truss MAS) appear in it automatically
})(typeof window !== 'undefined' ? window : globalThis);
