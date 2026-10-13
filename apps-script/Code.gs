// Google Apps Script bound to the "Dice Roller Log" sheet.
// Deploy as a Web app (Execute as: Me, Who has access: Anyone) and paste the
// /exec URL into config.js in the repo.

const LOG_HEADERS = ['ts', 'local', 'player', 'playerId', 'character', 'type', 'label', 'dice',
  'modifier', 'total', 'hr', 'crit', 'fumble', 'damage', 'damageType', 'weapon', 'note'];
const CHAR_HEADERS = ['id', 'ownerId', 'ownerName', 'name', 'DEX', 'INS', 'MIG', 'WLP', 'updated', 'weapons'];

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = (e.parameter.action || 'characters');
  if (action === 'characters') return json({ ok: true, characters: listCharacters(e.parameter.ownerId) });
  if (action === 'ping') return json({ ok: true, now: new Date().toISOString() });
  return json({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad json' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.action === 'log') { appendLog(body.entry); return json({ ok: true }); }
    if (body.action === 'saveCharacter') { const c = upsertCharacter(body.character); return json({ ok: true, character: c }); }
    return json({ ok: false, error: 'unknown action' });
  } finally { lock.releaseLock(); }
}

function appendLog(entry) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Log');
  const row = LOG_HEADERS.map((k) => {
    const v = entry[k];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return v;
  });
  // Keep the two timestamp columns as text so Sheets doesn't reformat them.
  row[0] = "'" + row[0]; row[1] = "'" + row[1];
  sh.appendRow(row);
}

function listCharacters(ownerId) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Characters');
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || String(r[0]).startsWith('example')) continue;
    if (ownerId && String(r[1]) !== String(ownerId)) continue;
    out.push({
      id: String(r[0]), ownerId: String(r[1]), ownerName: String(r[2]), name: String(r[3]),
      dice: { DEX: +r[4] || 8, INS: +r[5] || 8, MIG: +r[6] || 8, WLP: +r[7] || 8 },
      updated: String(r[8]), weapons: String(r[9] || ''),
    });
  }
  return out;
}

function upsertCharacter(c) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Characters');
  const rows = sh.getDataRange().getValues();
  const id = c.id || ('c' + Date.now());
  const line = [id, c.ownerId, c.ownerName, c.name, c.dice.DEX, c.dice.INS, c.dice.MIG, c.dice.WLP,
    "'" + new Date().toISOString(), c.weapons || ''];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sh.getRange(i + 1, 1, 1, line.length).setValues([line]);
      return Object.assign({}, c, { id });
    }
  }
  sh.appendRow(line);
  return Object.assign({}, c, { id });
}
