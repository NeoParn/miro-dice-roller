// Backend adapter. The UI only talks to this interface, so swapping the
// standalone version for the Miro + Google Sheet version later touches
// nothing in app.js.
//
// Interface:
//   getUser()                 -> { id, name }
//   loadCharacters(userId)    -> [character]
//   saveCharacter(character)  -> character
//   logRoll(entry)            -> void       (append to the permanent log)
//   showOnTray(entry)         -> void       (update the shared dice tray)
//
// character = { id, ownerId, ownerName, name, dice: {DEX,INS,MIG,WLP}, weaponDamage, damageType }

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

    async getUser() {
      const s = load();
      return s.user || null;   // null -> UI asks for a name, then calls setUser
    },

    async setUser(name) {
      const s = load();
      s.user = { id: 'local-' + name.toLowerCase().replace(/\W+/g, '-'), name };
      save(s);
      return s.user;
    },

    async loadCharacters(userId) {
      const s = load();
      return (s.characters || []).filter((c) => c.ownerId === userId);
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
      s.log = s.log || [];
      s.log.push(entry);
      if (s.log.length > 500) s.log = s.log.slice(-500);
      save(s);
    },

    async showOnTray(entry) {
      // Standalone: nothing shared to update. The in-panel tray preview shows it.
    },
  };
}
