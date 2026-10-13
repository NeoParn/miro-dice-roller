// Runs apps-script/Code.gs against a fake spreadsheet. Run: node test/apps-script.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fakeSheet(name, rows) {
  const sh = {
    name, data: rows.map((r) => r.slice()),
    getLastColumn: () => Math.max(0, ...sh.data.map((r) => r.length)),
    getLastRow: () => sh.data.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.data[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { (sh.data[r - 1 + i] ||= [])[c - 1 + j] = store(v); })); return { setFontWeight() {} }; },
    }),
    getDataRange: () => sh.getRange(1, 1, sh.data.length, sh.getLastColumn()),
    clear: () => { sh.data = []; },
    appendRow: (row) => { sh.data.push(row.map(store)); },
    copyTo: (ss) => { const c = fakeSheet('copy', sh.data); ss.sheets.push(c); return { setName: (n) => { c.name = n; } }; },
  };
  return sh;
}
// Sheets stores "'text" as text without the apostrophe.
const store = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);

const v1chars = [
  ['Character ID', 'Owner ID (Miro)', 'Owner name', 'Character', 'DEX', 'INS', 'MIG', 'WLP', 'Updated (UTC)', 'Weapons / spells (Name +dmg type; Name +dmg type)'],
  ['example-1', 'example', 'Example player', 'Example character (delete this row)', 8, 8, 10, 6, '2026-10-13', 'Greatsword +10 physical; Fireball +15 fire'],
  ['c1', '345', 'Sean Bowles', 'Bob', 8, 10, 8, 6, '2026-10-13T18:32:16.288Z', 'Sword +5 physical'],
];
const v1log = [
  ['Timestamp (UTC)', 'Local time', 'Player', 'Player ID', 'Character', 'Roll type', 'Roll', 'Dice', 'Modifier', 'Total', 'HR', 'Crit', 'Fumble', 'Damage', 'Damage type', 'Weapon', 'Note'],
  ['2026-10-13T18:32:33.332Z', '2026-10-13 14:32:33', 'Sean Bowles', '345', 'Bob', 'check', 'Check: DEX d8 + INS d8', 'd8:6 d8:6', 0, 12, 6, 'TRUE', 'FALSE'],
  ['2026-10-13T18:32:35.440Z', '2026-10-13 14:32:35', 'Sean Bowles', '345', 'Bob', 'damage', 'Attack: DEX d8 + MIG d8', 'd8:4 d8:2', 0, 6, 4, 'FALSE', 'FALSE', 9, 'physical', 'Sword', 'test'],
];

const ss = { sheets: [fakeSheet('Characters', v1chars), fakeSheet('Log', v1log)] };
ss.getSheetByName = (n) => ss.sheets.find((s) => s.name === n);
const ctx = {
  SpreadsheetApp: { getActive: () => ss },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
  Date, JSON, String, Object, Array, Math,
};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('ok   ', name); } catch (e) { console.log('FAIL ', name, '\n     ', e.message); process.exitCode = 1; } };

test('ping reports version 2 and migrates on first request', () => {
  const r = ctx.doGet({ parameter: { action: 'ping' } });
  assert.equal(r.version, 2);
  assert.ok(ss.getSheetByName('Characters (v1 backup)'));
  assert.ok(ss.getSheetByName('Log (v1 backup)'));
});

test('characters converted to the v2 layout', () => {
  const sh = ss.getSheetByName('Characters');
  assert.deepEqual(sh.data[0], ['Character ID', 'Owner ID (Miro)', 'Owner name', 'Game', 'Character', 'Stats', 'Items', 'Updated (UTC)']);
  assert.deepEqual(sh.data[2], ['c1', '345', 'Sean Bowles', 'fabula-ultima', 'Bob', 'DEX=d8; INS=d10; MIG=d8; WLP=d6', 'Sword (damage=5, type=physical)', '2026-10-13T18:32:16.288Z']);
});

test('log converted to the v2 layout', () => {
  const sh = ss.getSheetByName('Log');
  assert.equal(sh.data[0][11], 'Results');
  assert.deepEqual(sh.data[1], ['2026-10-13T18:32:33.332Z', '2026-10-13 14:32:33', 'fabula-ultima', 'Sean Bowles', '345', 'Bob', 'Check', 'Check: DEX d8 + INS d8', 'd8:6 d8:6', 0, 12, 'HR 6', 'CRIT', '', '']);
  assert.deepEqual(sh.data[2].slice(6), ['Attack / Damage', 'Attack: DEX d8 + MIG d8', 'd8:4 d8:2', 0, 6, 'HR 4; Damage 9 physical', '', 'Sword', 'test']);
});

test('second request does not migrate again', () => {
  ctx.doGet({ parameter: { action: 'ping' } });
  assert.equal(ss.sheets.filter((s) => s.name.includes('backup')).length, 2);
});

test('list characters skips the example row and filters by owner and game', () => {
  const r = ctx.doGet({ parameter: { action: 'characters', ownerId: '345' } });
  assert.equal(r.characters.length, 1);
  assert.equal(r.characters[0].stats, 'DEX=d8; INS=d10; MIG=d8; WLP=d6');
  assert.equal(ctx.doGet({ parameter: { action: 'characters', ownerId: '345', game: 'white-wolf' } }).characters.length, 0);
});

test('save updates in place, keeps extra columns, and appends new characters', () => {
  const sh = ss.getSheetByName('Characters');
  sh.data[0][8] = 'My notes'; sh.data[2][8] = 'keep me';
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  post({ action: 'saveCharacter', character: { id: 'c1', ownerId: '345', ownerName: 'Sean Bowles', game: 'fabula-ultima', name: 'Bob', stats: 'DEX=d12; INS=d10; MIG=d8; WLP=d6', items: '' } });
  assert.equal(sh.data[2][5], 'DEX=d12; INS=d10; MIG=d8; WLP=d6');
  assert.equal(sh.data[2][8], 'keep me');
  const r = post({ action: 'saveCharacter', character: { ownerId: '345', ownerName: 'Sean Bowles', game: 'white-wolf', name: 'Lucita', stats: 'Dexterity=3', items: '' } });
  assert.ok(r.character.id.startsWith('c'));
  assert.equal(sh.data.length, 4);
  assert.equal(sh.data[3][3], 'white-wolf');
});

test('log rows land under the right headers', () => {
  const sh = ss.getSheetByName('Log');
  ctx.doPost({ postData: { contents: JSON.stringify({ action: 'log', entry: {
    ts: '2026-10-13T20:00:00.000Z', local: '2026-10-13 16:00:00', game: 'white-wolf', player: 'Sean', playerId: '345',
    character: 'Lucita', rollName: 'Dice pool', label: 'Dexterity + Athletics, diff 6', dice: 'd10:10! d10:7 d10:1',
    modifier: 0, total: 1, values: '', flags: 'BOTCH', item: '', note: 'jump', summary: 'ignored' } }) } });
  const last = sh.data[sh.data.length - 1];
  assert.equal(last[2], 'white-wolf');
  assert.equal(last[8], 'd10:10! d10:7 d10:1');
  assert.equal(last[12], 'BOTCH');
  assert.equal(last[14], 'jump');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
