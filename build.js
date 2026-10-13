// Builds:
//  - panel.bundle.js: the panel's code concatenated into one file that panel.html loads with a
//    cache-busting ?v= stamp (GitHub Pages caches files for 10 min; this sidesteps that).
//    Game files are NOT bundled: the panel loads games/*.js directly, so new games need no build.
//  - dist/panel-standalone.html: single-file version (games included) for opening straight from disk.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const strip = (src) => src
  .replace(/^import\s[^;]*;\s*$/gm, '')
  .replace(/^export default [^;]*;\s*$/gm, '')
  .replace(/^export\s+(?=(const|let|var|function|async function|class)\b)/gm, '');

const core = ['engine.js', 'rules.js', 'backend.js', 'app.js'];
const concat = (mods) => mods.map((m) => `// ---- ${m} ----\n${strip(readFileSync(m, 'utf8'))}`).join('\n');

writeFileSync('panel.bundle.js',
  concat(['config.js', ...core, 'backend-miro.js']) + '\nexport { startApp, standaloneBackend, miroBackend };\n');

// Standalone: inline every listed game.
const ids = [...readFileSync('games/list.js', 'utf8').matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
const gameSrc = ids.map((id) =>
  readFileSync(`games/${id}.js`, 'utf8').replace(/export default\s*/, `__GAMES[${JSON.stringify(id)}] = `)).join('\n');
const html = readFileSync('panel.html', 'utf8').replace(
  /<script type="module">[\s\S]*?<\/script>/,
  `<script type="module">\n${concat(core)}\nconst __GAMES = {};\n${gameSrc}\n` +
  `startApp(document.getElementById('app'), standaloneBackend(), { list: async () => ${JSON.stringify(ids)}, load: async (id) => { if (!__GAMES[id]) throw new Error('not found'); return __GAMES[id]; } });\n</script>`,
).replace('<script src="https://miro.com/app/static/sdk/v2/miro.js"></script>\n', '');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/panel-standalone.html', html);
console.log(`wrote panel.bundle.js and dist/panel-standalone.html (games: ${ids.join(', ')})`);
