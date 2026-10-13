// Bundles the modular app into one self-contained HTML file (dist/panel-standalone.html)
// so it can be opened straight from disk. GitHub Pages will serve the modular files as-is.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const mods = ['engine.js', 'games/fabula-ultima.js', 'backend.js', 'app.js'];
const strip = (src) => src
  .replace(/^import\s[^;]*;\s*$/gm, '')
  .replace(/^export default [^;]*;\s*$/gm, '')
  .replace(/^export\s+(?=(const|let|var|function|async function|class)\b)/gm, '');

const bundle = mods.map((m) => `// ---- ${m} ----\n${strip(readFileSync(m, 'utf8'))}`).join('\n');
const html = readFileSync('panel.html', 'utf8').replace(
  /<script type="module">[\s\S]*?<\/script>/,
  `<script type="module">\n${bundle}\nstartApp(document.getElementById('app'), standaloneBackend());\n</script>`,
);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/panel-standalone.html', html);
console.log('wrote dist/panel-standalone.html', html.length, 'bytes');
