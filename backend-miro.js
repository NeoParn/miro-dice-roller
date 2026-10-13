// Miro backend: identity from Miro, dice tray as a shared board item,
// characters in the browser for now (6b moves them to the Google Sheet).

const CHAR_KEY = 'diceRoller.characters';
const TRAY_KEY = 'diceTrayId';

function loadChars() { try { return JSON.parse(localStorage.getItem(CHAR_KEY)) || []; } catch { return []; } }
function saveChars(list) { try { localStorage.setItem(CHAR_KEY, JSON.stringify(list)); } catch {} }

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function trayContent(e) {
  const flag = e.crit ? ' CRIT' : e.fumble ? ' FUMBLE' : '';
  const lines = [
    `<p><b>${esc(e.character || e.player)}</b> rolled <b>${e.total}</b>${flag}</p>`,
  ];
  if (e.type !== 'plain') {
    let l = `HR ${e.hr}`;
    if (e.damage !== '' && e.damage != null) l += ` · ${e.damage} ${esc(e.damageType)}`;
    lines.push(`<p>${l}</p>`);
  }
  lines.push(`<p>${esc(e.label)}${e.weapon ? ' · ' + esc(e.weapon) : ''}</p>`);
  lines.push(`<p>[${esc(e.dice)}]</p>`);
  lines.push(`<p>${esc(e.local)}</p>`);
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
      width: 320,
      height: 180,
      style: {
        fillColor: '#fff7e0', borderColor: '#b8431e', borderWidth: 2,
        fontSize: 14, textAlign: 'left', textAlignVertical: 'top', color: '#1f1d1a',
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
      return loadChars().filter((c) => c.ownerId === userId);
    },

    async saveCharacter(ch) {
      const list = loadChars();
      if (!ch.id) ch.id = 'c' + Date.now();
      const i = list.findIndex((c) => c.id === ch.id);
      if (i >= 0) list[i] = ch; else list.push(ch);
      saveChars(list);
      return ch;
    },

    async logRoll(entry) {
      // 6b: post to the Google Sheet. Until then, nothing permanent.
    },

    async showOnTray(entry) {
      let tray = await findTray();
      if (!tray) tray = await createTray();
      tray.content = trayContent(entry);
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
