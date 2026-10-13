// Miro backend: identity from Miro, dice tray as a shared board item,
// characters and the permanent log in the Google Sheet (via Apps Script).
// If SHEET_URL is empty or the sheet is unreachable, characters fall back to this browser.
import { SHEET_URL } from './config.js';

const CHAR_KEY = 'diceRoller.characters';
const TRAY_KEY = 'diceTrayId';
const HIST_KEY = 'diceTrayHistory';
const HIST_N = 9;

// Weapons travel to the sheet as one text cell: "Greatsword +10 physical; Fireball +15 fire"
function weaponsToText(list) {
  return (list || []).map((w) => `${w.name} +${w.damage} ${w.type}`).join('; ');
}
function weaponsFromText(text) {
  return String(text || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s*\+(\d+)\s*(\w+)?$/);
    return m ? { name: m[1].trim(), damage: +m[2], type: m[3] || 'physical' } : { name: s, damage: 0, type: 'physical' };
  });
}

async function sheetGet(params) {
  const url = SHEET_URL + '?' + new URLSearchParams(params);
  const res = await fetch(url, { redirect: 'follow' });
  return res.json();
}
async function sheetPost(body) {
  // text/plain keeps this a "simple" request, so no CORS preflight (Apps Script can't answer one).
  const res = await fetch(SHEET_URL, { method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  return res.json();
}

function loadChars() { try { return JSON.parse(localStorage.getItem(CHAR_KEY)) || []; } catch { return []; } }
function saveChars(list) { try { localStorage.setItem(CHAR_KEY, JSON.stringify(list)); } catch {} }

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function trayLine(e) {
  const flag = e.crit ? ' CRIT' : e.fumble ? ' FUMBLE' : '';
  let s = `${e.local.slice(11)} ${e.character || e.player}: <b>${e.total}</b>`;
  if (e.type !== 'plain') s += ` (HR ${e.hr})`;
  if (e.damage !== '' && e.damage != null) s += ` · ${e.damage} ${e.damageType}`;
  s += ` · ${e.label}${e.weapon ? ' · ' + e.weapon : ''} [${e.dice}]${flag}`;
  return esc(s).replace(/&lt;b&gt;|&lt;\/b&gt;/g, (m) => (m === '&lt;b&gt;' ? '<b>' : '</b>'));
}

function trayContent(e, history) {
  const flag = e.crit ? ' CRIT' : e.fumble ? ' FUMBLE' : '';
  const lines = [
    `<p><b>${esc(e.character || e.player)}</b> rolled <b>${e.total}</b>${flag}</p>`,
  ];
  if (e.type !== 'plain') {
    let l = `HR ${e.hr}`;
    if (e.damage !== '' && e.damage != null) l += ` · ${e.damage} ${esc(e.damageType)}`;
    lines.push(`<p>${l}</p>`);
  }
  lines.push(`<p>${esc(e.label)}${e.weapon ? ' · ' + esc(e.weapon) : ''} [${esc(e.dice)}]</p>`);
  lines.push(`<p>${esc(e.local)}</p>`);
  if (history.length) {
    lines.push('<p>────────────</p>');
    for (const line of history) lines.push(`<p>${line}</p>`);
  }
  return lines.join('');
}

function trayColor(e) {
  return e.crit ? '#d9f2e3' : e.fumble ? '#f8d7d3' : '#fff7e0';
}

export function miroBackend() {
  let trayItem = null;

  async function findTray() {
    if (trayItem) {
      try { await miro.board.getById(trayItem.id); return trayItem; } catch { trayItem = null; }
    }
    const id = await miro.board.getAppData(TRAY_KEY);
    if (id) {
      try { trayItem = await miro.board.getById(id); return trayItem; } catch { /* deleted */ }
    }
    return null;
  }

  async function createTray() {
    const vp = await miro.board.viewport.get();
    const shape = await miro.board.createShape({
      shape: 'round_rectangle',
      content: '<p><b>Dice Tray</b></p><p>Waiting for the first roll…</p>',
      x: vp.x + vp.width / 2,
      y: vp.y + vp.height / 2,
      width: 420,
      height: 420,
      style: {
        fillColor: '#fff7e0', borderColor: '#b8431e', borderWidth: 2,
        fontSize: 12, textAlign: 'left', textAlignVertical: 'top', color: '#1f1d1a',
      },
    });
    await miro.board.setAppData(TRAY_KEY, shape.id);
    trayItem = shape;
    return shape;
  }

  return {
    mode: 'miro',

    async getUser() {
      const u = await miro.board.getUserInfo();
      return { id: String(u.id), name: u.name };
    },

    async loadCharacters(userId) {
      if (SHEET_URL) {
        try {
          const r = await sheetGet({ action: 'characters', ownerId: userId });
          if (r.ok) {
            const list = r.characters.map((c) => ({ ...c, weapons: weaponsFromText(c.weapons) }));
            saveChars(list); // local copy for offline fallback
            return list;
          }
        } catch (e) { console.warn('sheet unreachable, using local copy', e); }
      }
      return loadChars().filter((c) => c.ownerId === userId);
    },

    async saveCharacter(ch) {
      if (SHEET_URL) {
        const r = await sheetPost({ action: 'saveCharacter', character: { ...ch, weapons: weaponsToText(ch.weapons) } });
        if (!r.ok) throw new Error('Sheet refused the save: ' + r.error);
        ch.id = r.character.id;
      }
      const list = loadChars();
      if (!ch.id) ch.id = 'c' + Date.now();
      const i = list.findIndex((c) => c.id === ch.id);
      if (i >= 0) list[i] = ch; else list.push(ch);
      saveChars(list);
      return ch;
    },

    async logRoll(entry) {
      if (!SHEET_URL) return;
      try { await sheetPost({ action: 'log', entry }); }
      catch (e) { console.warn('log failed', e); }
    },

    async showOnTray(entry) {
      let tray = await findTray();
      if (!tray) tray = await createTray();
      let history = [];
      try { history = (await miro.board.getAppData(HIST_KEY)) || []; } catch {}
      tray.content = trayContent(entry, history.slice(0, HIST_N));
      history = [trayLine(entry), ...history].slice(0, HIST_N);
      miro.board.setAppData(HIST_KEY, history).catch(() => {});
      tray.style = { ...tray.style, fillColor: trayColor(entry) };
      await tray.sync();
    },

    // Called from the panel's "Place tray" button: recreate if missing, then zoom to it.
    async placeTray() {
      let tray = await findTray();
      if (!tray) tray = await createTray();
      await miro.board.viewport.zoomTo(tray);
      return tray;
    },
  };
}
