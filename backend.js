// Backend adapter. The UI only talks to this interface:
//   getUser() / setUser(name)        -> { id, name }
//   getBoardGame() / setBoardGame(id)
//   loadCharacters(userId)           -> [character]   (all games; the UI filters)
//   saveCharacter(character, game)   -> character
//   logRoll(entry) / showOnTray(entry)
//   status()                         -> warning text or ''
//
// This one is the standalone test version: everything lives in this browser.

const KEY = 'diceRoller.standalone';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

export function standaloneBackend() {
  return {
    mode: 'standalone',

    async getUser() { return load().user || null; },

    async setUser(name) {
      const s = load();
      s.user = { id: 'local-' + name.toLowerCase().replace(/\W+/g, '-'), name };
      save(s);
      return s.user;
    },

    async getBoardGame() { return load().game || null; },
    async setBoardGame(id) { const s = load(); s.game = id; save(s); },

    async loadCharacters(userId) {
      return (load().characters || []).filter((c) => c.ownerId === userId);
    },

    async saveCharacter(ch) {
      const s = load();
      s.characters = s.characters || [];
      if (!ch.id) ch.id = 'c' + Date.now();
      const i = s.characters.findIndex((c) => c.id === ch.id);
      if (i >= 0) s.characters[i] = ch; else s.characters.push(ch);
      save(s);
      return ch;
    },

    async logRoll(entry) {
      const s = load();
      s.log = (s.log || []).concat(entry).slice(-500);
      save(s);
    },

    async showOnTray() {},
    async status() { return ''; },
  };
}
