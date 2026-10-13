// Google Apps Script bound to the "Dice Roller Log" sheet. Version 2.
// Deploy as a Web app (Execute as: Me, Who has access: Anyone). The panel checks VERSION on load.
//
// Columns are found by their header text, so you can reorder columns or add your own;
// just don't rename the headers listed below.
//
// The first request after deploying this version updates the sheet from the version-1 layout
// automatically, after saving copies of the old tabs as "Characters (v1 backup)" and "Log (v1 backup)".

const VERSION = 2;

const CHAR_HEADERS = ['Character ID', 'Owner ID (Miro)', 'Owner name', 'Game', 'Character', 'Stats', 'Items', 'Updated (UTC)'];
const CHAR_KEYS =    ['id',           'ownerId',         'ownerName',  'game', 'name',      'stats', 'items', 'updated'];

const LOG_HEADERS = ['Timestamp (UTC)', 'Local time', 'Game', 'Player', 'Player ID', 'Character', 'Roll type', 'Roll',
  'Dice', 'Modifier', 'Total', 'Results', 'Flags', 'Item', 'Note'];
const LOG_KEYS =    ['ts', 'local', 'game', 'player', 'playerId', 'character', 'rollName', 'label',
  'dice', 'modifier', 'total', 'values', 'flags', 'item', 'note'];
const TEXT_KEYS = { ts: true, local: true, dice: true, values: true, label: true };

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { migrateIfNeeded(); return fn(); } finally { lock.releaseLock(); }
}

function doGet(e) {
  const action = e.parameter.action || 'ping';
  return withLock(() => {
    if (action === 'ping') return json({ ok: true, version: VERSION, now: new Date().toISOString() });
    if (action === 'characters') return json({ ok: true, characters: listCharacters(e.parameter.ownerId, e.parameter.game) });
    return json({ ok: false, error: 'unknown action' });
  });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad json' }); }
  return withLock(() => {
    if (body.action === 'log') { appendLog(body.entry || {}); return json({ ok: true }); }
    if (body.action === 'saveCharacter') return json({ ok: true, character: upsertCharacter(body.character || {}) });
    return json({ ok: false, error: 'unknown action' });
  });
}

// ------------------------------------------------------------------ helpers

function sheet(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

/** { headerText: columnIndex0 } for row 1 of a sheet. */
function headerIndex(sh) {
  const last = Math.max(sh.getLastColumn(), 1);
  const row = sh.getRange(1, 1, 1, last).getValues()[0];
  const map = {};
  row.forEach((h, i) => { if (h !== '') map[String(h).trim()] = i; });
  return map;
}

function asText(v) { return v === '' || v == null ? '' : "'" + String(v); }

function rowFrom(obj, headers, keys, width, idx) {
  const row = new Array(width).fill('');
  keys.forEach((k, i) => {
    const col = idx[headers[i]];
    if (col === undefined) return;
    let v = obj[k];
    if (v === undefined || v === null) v = '';
    if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
    row[col] = TEXT_KEYS[k] ? asText(v) : v;
  });
  return row;
}

// ------------------------------------------------------------------ log

function appendLog(entry) {
  const sh = sheet('Log');
  const idx = headerIndex(sh);
  sh.appendRow(rowFrom(entry, LOG_HEADERS, LOG_KEYS, sh.getLastColumn(), idx));
}

// ------------------------------------------------------------------ characters

function listCharacters(ownerId, game) {
  const sh = sheet('Characters');
  const idx = headerIndex(sh);
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const c = {};
    CHAR_KEYS.forEach((k, i) => { const col = idx[CHAR_HEADERS[i]]; c[k] = col === undefined ? '' : String(rows[r][col]); });
    if (!c.id || c.id.indexOf('example') === 0) continue;
    if (ownerId && c.ownerId !== String(ownerId)) continue;
    if (game && c.game && c.game !== game) continue;
    out.push(c);
  }
  return out;
}

function upsertCharacter(c) {
  const sh = sheet('Characters');
  const idx = headerIndex(sh);
  const width = sh.getLastColumn();
  const id = c.id || ('c' + Date.now());
  const obj = Object.assign({}, c, { id: id, updated: new Date().toISOString() });
  const row = rowFrom(obj, CHAR_HEADERS, CHAR_KEYS, width, idx);
  const idCol = idx['Character ID'];
  const rows = sh.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][idCol]) === String(id)) {
      // Only overwrite the panel's own columns; anything else in the row (your notes) stays.
      const merged = rows[r].slice(0, width);
      CHAR_HEADERS.forEach((h) => { if (idx[h] !== undefined) merged[idx[h]] = row[idx[h]]; });
      sh.getRange(r + 1, 1, 1, width).setValues([merged]);
      return { id: id };
    }
  }
  sh.appendRow(row);
  return { id: id };
}

// ------------------------------------------------------------------ one-time update from version 1

function migrateIfNeeded() {
  migrateCharacters();
  migrateLog();
}

/** Version-1 row (Character ID, Owner, Owner name, Character, DEX, INS, MIG, WLP, Updated, Weapons) -> version 2. */
function convertCharRow(r) {
  const stats = ['DEX', 'INS', 'MIG', 'WLP'].map((k, i) => k + '=d' + r[4 + i]).join('; ');
  const items = String(r[9] || '').split(';').map((s) => s.trim()).filter(String).map((s) => {
    const m = s.match(/^(.*?)\s*\+(\d+)\s*(\w+)?$/);
    return m ? m[1].trim() + ' (damage=' + m[2] + ', type=' + (m[3] || 'physical') + ')' : s;
  }).join('; ');
  return [String(r[0]), String(r[1]), String(r[2]), 'fabula-ultima', String(r[3]), stats, items, asText(r[8])];
}

function migrateCharacters() {
  const sh = sheet('Characters');
  const idx = headerIndex(sh);
  if (idx['Stats'] !== undefined || idx['DEX'] === undefined) return;
  sh.copyTo(SpreadsheetApp.getActive()).setName('Characters (v1 backup)');
  const rows = sh.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  sh.clear();
  sh.getRange(1, 1, 1, CHAR_HEADERS.length).setValues([CHAR_HEADERS]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, CHAR_HEADERS.length).setValues(rows.map(convertCharRow));
}

/** Version-1 log row -> version 2. */
function convertLogRow(r) {
  // v1: ts, local, player, playerId, character, type, label, dice, modifier, total, hr, crit, fumble, damage, damageType, weapon, note
  const results = ['HR ' + r[10]];
  if (r[13] !== '' && r[13] != null) results.push('Damage ' + r[13] + ' ' + r[14]);
  const flags = [];
  if (String(r[11]).toUpperCase() === 'TRUE') flags.push('CRIT');
  if (String(r[12]).toUpperCase() === 'TRUE') flags.push('FUMBLE');
  const rollName = { check: 'Check', damage: 'Attack / Damage', plain: 'Any dice' }[r[5]] || r[5];
  if (r[5] === 'plain') results.length = 0;
  return [asText(r[0]), asText(r[1]), 'fabula-ultima', r[2], String(r[3]), r[4], rollName, asText(r[6]),
    asText(r[7]), r[8], r[9], asText(results.join('; ')), flags.join(' '), r[15] || '', r[16] || ''];
}

function migrateLog() {
  const sh = sheet('Log');
  const idx = headerIndex(sh);
  if (idx['Results'] !== undefined || idx['HR'] === undefined) return;
  sh.copyTo(SpreadsheetApp.getActive()).setName('Log (v1 backup)');
  const rows = sh.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  sh.clear();
  sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, LOG_HEADERS.length).setValues(rows.map(convertLogRow));
}
