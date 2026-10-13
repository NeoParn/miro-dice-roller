// Builds:
//  - panel.bundle.js: every module concatenated into one file that panel.html loads with a
//    cache-busting ?v= stamp (GitHub Pages caches files for 10 min; this sidesteps that).
//  - dist/panel-standalone.html: single-file version for opening straight from disk.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const strip = (src) => src
  .replace(/^import\s[^;]*;\s*$/gm, '')
  .replace(/^export default [^;]*;\s*$/gm, '')
  .replace(/^export\s+(?=(const|let|var|function|async function|class)\b)/gm, '');

const core = ['engine.js', 'games/fabula-ultima.js', 'backend.js', 'app.js'];
const concat = (mods) => mods.map((m) => `// ---- ${m} ----\n${strip(readFileSync(m, 'utf8'))}`).join('\n');

// Full bundle (ESM) for the Miro panel.
writeFileSync('panel.bundle.js',
  concat(['config.js', ...core, 'backend-miro.js']) + '\nexport { startApp, standaloneBackend, miroBackend };\n');

// Standalone single-file page.
const html = readFileSync('panel.html', 'utf8').replace(
  /<script type="module">[\s\S]*?<\/script>/,
  `<script type="module">\n${concat(core)}\nstartApp(document.getElementById('app'), standaloneBackend());\n</script>`,
);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/panel-standalone.html', html);
console.log('wrote panel.bundle.js and dist/panel-standalone.html');
