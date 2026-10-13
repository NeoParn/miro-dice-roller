// Miro backend: identity from Miro, dice tray as a shared board item, the board's game
// in board app data, characters and the permanent log in the Google Sheet (via Apps Script).
// If the sheet is unreachable or its script is out of date, characters fall back to this browser.
import { SHEET_URL } from './config.js';
import { statsToText, statsFromText, itemsToText, itemsFromText } from './rules.js';

const CHAR_KEY = 'diceRoller.characters';
const TRAY_KEY = 'diceTrayId';
const HIST_KEY = 'diceTrayHistory';
const GAME_KEY = 'diceGame';
const HIST_N = 9;
const SCRIPT_VERSION = 2;

async function sheetGet(params) {
  const res = await fetch(SHEET_URL + '?' + new URLSearchParams(params), { redirect: 'follow' });
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

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function trayLine(e) {
  let s = `${esc(e.local.slice(11))} ${esc(e.character || e.player)}: <b>${esc(e.total)}</b>`;
  if (e.totalLabel) s += ` ${esc(e.totalLabel)}`;
  if (e.values) s += ` (${esc(e.values)})`;
  s += ` · ${esc(e.label)}${e.item ? ' · ' + esc(e.item) : ''} [${esc(e.dice)}]`;
  if (e.flags) s += ` <b>${esc(e.flags)}</b>`;
  return s;
}

function trayContent(e, history) {
  const lines = [
    `<p><b>${esc(e.character || e.player)}</b> rolled <b>${esc(e.total)}</b>${e.totalLabel ? ' ' + esc(e.totalLabel) : ''}${e.flags ? ' <b>' + esc(e.flags) + '</b>' : ''}</p>`,
  ];
  if (e.values) lines.push(`<p>${esc(e.values)}</p>`);
  lines.push(`<p>${esc(e.label)}${e.item ? ' · ' + esc(e.item) : ''} [${esc(e.dice)}]</p>`);
  lines.push(`<p>${esc(e.local)}</p>`);
  if (history.length) {
    lines.push('<p>────────────</p>');
    for (const line of history) lines.push(`<p>${line}</p>`);
  }
  return lines.join('');
}

const trayColor = (e) => (e.style === 'good' ? '#d9f2e3' : e.style === 'bad' ? '#f8d7d3' : '#fff7e0');

export function miroBackend() {
  let trayItem = null;
  let sheetCheck = null;

  // Is the sheet reachable and running the current script?
  function sheetReady() {
    if (!SHEET_URL) return Promise.resolve(false);
    return (sheetCheck ||= sheetGet({ action: 'ping' })
      .then((r) => r && r.ok && r.version === SCRIPT_VERSION)
      .catch(() => false));
  }

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

    async status() {
      if (!SHEET_URL) return '';
      return (await sheetReady())
        ? ''
        : "Can't reach the current Google Sheet script. Characters are saved in this browser only and rolls aren't logged to the sheet.";
    },

    async getBoardGame() {
      const id = await miro.board.getAppData(GAME_KEY);
      if (id) return id;
      // Boards that used the roller before games were selectable were Fabula boards.
      if (await miro.board.getAppData(TRAY_KEY)) {
        await miro.board.setAppData(GAME_KEY, 'fabula-ultima');
        return 'fabula-ultima';
      }
      return null;
    },

    async setBoardGame(id) { await miro.board.setAppData(GAME_KEY, id); },

    async loadCharacters(userId) {
      if (await sheetReady()) {
        try {
          const r = await sheetGet({ action: 'characters', ownerId: userId });
          if (r.ok) {
            const list = r.characters.map((c) => ({
              id: c.id, ownerId: c.ownerId, ownerName: c.ownerName, game: c.game || 'fabula-ultima', name: c.name,
              stats: statsFromText(c.stats), items: itemsFromText(c.items),
            }));
            saveChars(list); // local copy for offline fallback
            return list;
          }
        } catch (e) { console.warn('sheet unreachable, using local copy', e); }
      }
      return loadChars().filter((c) => c.ownerId === userId);
    },

    async saveCharacter(ch, game) {
      if (await sheetReady()) {
        const r = await sheetPost({ action: 'saveCharacter', character: {
          id: ch.id, ownerId: ch.ownerId, ownerName: ch.ownerName, game: game.id, name: ch.name,
          stats: statsToText(game, ch.stats), items: itemsToText(game, ch.items),
        } });
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
      if (!(await sheetReady())) return;
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

    // Called from the panel's "Tray" button: recreate if missing, then zoom to it.
    async placeTray() {
      let tray = await findTray();
      if (!tray) tray = await createTray();
      await miro.board.viewport.zoomTo(tray);
      return tray;
    },
  };
}
