// ---- config.js ----
// Deployment settings. SHEET_URL is the Apps Script web-app /exec URL.
// Leave it empty to run without the Google Sheet (characters stay in the browser, no permanent log).
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbx_iNC4Zu05XEd_j8z6hYfjzlnBPddDmed_Gio-f39ozKAtK4-GHPlNqgz3TpO-mYc14w/exec';

// ---- engine.js ----
// Core dice engine. Game-agnostic. Runs in the browser or Node.

/** Default random source: crypto when available, Math.random otherwise. */
function defaultRng() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

/** Roll one die of the given size. Returns an integer 1..size. */
function rollDie(size, rng = defaultRng) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`Bad die size: ${size}`);
  return Math.floor(rng() * size) + 1;
}

/** Roll several dice. Returns [{ size, face }]. */
function rollDice(sizes, rng = defaultRng) {
  return sizes.map((size) => ({ size, face: rollDie(size, rng) }));
}

/**
 * Parse a free-form dice expression like "2d6+3", "d8", "3d10-1", "4d6+2d8+1".
 * Returns { terms: [{ count, size }], modifier }.
 */
function parseExpression(text) {
  // Allow spaces only around + and -; anything else with a space is a typo.
  const cleaned = String(text).trim().replace(/\s*([+-])\s*/g, '$1').toLowerCase();
  if (!cleaned) throw new Error('Empty dice expression');
  if (/\s/.test(cleaned)) throw new Error(`Bad dice expression: ${text}`);
  const re = /([+-]?)(\d*)d(\d+)|([+-]\d+)/g;
  let terms = [];
  let modifier = 0;
  let consumed = 0;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index !== consumed) throw new Error(`Bad dice expression: ${text}`);
    consumed = re.lastIndex;
    if (m[3] !== undefined) {
      const sign = m[1] === '-' ? -1 : 1;
      const count = m[2] === '' ? 1 : parseInt(m[2], 10);
      const size = parseInt(m[3], 10);
      if (count < 1 || count > 100) throw new Error(`Bad die count: ${count}`);
      if (size < 1 || size > 1000) throw new Error(`Bad die size: ${size}`);
      terms.push({ count, size, sign });
    } else {
      modifier += parseInt(m[4], 10);
    }
  }
  if (consumed !== cleaned.length || terms.length === 0) {
    throw new Error(`Bad dice expression: ${text}`);
  }
  return { terms, modifier };
}

/** Roll a free-form expression. Returns a RollResult-shaped object. */
function rollExpression(text, rng = defaultRng) {
  const { terms, modifier } = parseExpression(text);
  const dice = [];
  let total = modifier;
  for (const t of terms) {
    for (let i = 0; i < t.count; i++) {
      const face = rollDie(t.size, rng);
      dice.push({ size: t.size, face, sign: t.sign });
      total += t.sign * face;
    }
  }
  return {
    type: 'plain',
    label: String(text).trim(),
    dice,
    modifier,
    total,
  };
}

/**
 * Test helper: an rng that yields exact faces for given die sizes.
 * Usage: const rng = facesFor([[6, 4], [8, 7]]) -> first d6 shows 4, first d8 shows 7.
 * Order must match the order dice are rolled.
 */
function facesFor(pairs) {
  let i = 0;
  return function rng() {
    const p = pairs[i++];
    if (!p) throw new Error('facesFor ran out of faces');
    const [size, face] = p;
    return (face - 1 + 0.5) / size;
  };
}

// ---- games/fabula-ultima.js ----
// Fabula Ultima game config.
// A game config is: { id, name, attributes, dieSizes, rolls: { <rollType>: { label, inputs, resolve } } }
// The UI builds its controls from `inputs`; the engine calls `resolve(values, rng)`.


const ATTRIBUTES = ['DEX', 'INS', 'MIG', 'WLP'];
const DIE_SIZES = [6, 8, 10, 12];
const DAMAGE_TYPES = [
  'physical', 'air', 'bolt', 'dark', 'earth', 'fire', 'ice', 'light', 'poison',
];

/** Shared logic for any two-attribute Fabula roll. */
function attributeRoll(values, rng) {
  const sizes = [values.die1, values.die2];
  for (const s of sizes) {
    if (!DIE_SIZES.includes(s)) throw new Error(`Bad attribute die: d${s}`);
  }
  const dice = rollDice(sizes, rng);
  const faces = dice.map((d) => d.face);
  const hr = Math.max(...faces);
  const crit = faces[0] === faces[1] && faces[0] >= 6;
  const fumble = faces[0] === 1 && faces[1] === 1;
  return { dice, faces, hr, crit, fumble };
}

const fabulaUltima = {
  id: 'fabula-ultima',
  name: 'Fabula Ultima',
  attributes: ATTRIBUTES,
  dieSizes: DIE_SIZES,

  rolls: {
    check: {
      label: 'Check',
      inputs: [
        { key: 'attr1', label: 'Attribute 1', kind: 'attribute' },
        { key: 'die1', label: 'Die 1', kind: 'dieSize' },
        { key: 'attr2', label: 'Attribute 2', kind: 'attribute' },
        { key: 'die2', label: 'Die 2', kind: 'dieSize' },
        { key: 'modifier', label: 'Modifier', kind: 'int', default: 0, min: -10, max: 10 },
        { key: 'note', label: 'Note', kind: 'text', optional: true },
      ],
      resolve(values, rng) {
        const r = attributeRoll(values, rng);
        const modifier = values.modifier || 0;
        const total = r.faces[0] + r.faces[1] + modifier;
        const attrs = `${values.attr1 || '?'} d${values.die1} + ${values.attr2 || '?'} d${values.die2}`;
        return {
          type: 'check',
          label: `Check: ${attrs}${fmtMod(modifier)}`,
          dice: r.dice,
          modifier,
          total,
          hr: r.hr,
          crit: r.crit,
          fumble: r.fumble,
          note: values.note || '',
        };
      },
    },

    damage: {
      label: 'Attack / Damage',
      inputs: [
        { key: 'attr1', label: 'Attribute 1', kind: 'attribute' },
        { key: 'die1', label: 'Die 1', kind: 'dieSize' },
        { key: 'attr2', label: 'Attribute 2', kind: 'attribute' },
        { key: 'die2', label: 'Die 2', kind: 'dieSize' },
        { key: 'modifier', label: 'Accuracy mod', kind: 'int', default: 0, min: -10, max: 10 },
        { key: 'damageBonus', label: 'Weapon damage', kind: 'int', default: 0, min: 0, max: 99 },
        { key: 'damageType', label: 'Damage type', kind: 'choice', options: DAMAGE_TYPES, default: 'physical' },
        { key: 'note', label: 'Note', kind: 'text', optional: true },
      ],
      resolve(values, rng) {
        const r = attributeRoll(values, rng);
        const modifier = values.modifier || 0;
        const damageBonus = values.damageBonus || 0;
        const total = r.faces[0] + r.faces[1] + modifier;
        const damage = r.hr + damageBonus;
        const attrs = `${values.attr1 || '?'} d${values.die1} + ${values.attr2 || '?'} d${values.die2}`;
        return {
          type: 'damage',
          label: `Attack: ${attrs}${fmtMod(modifier)}`,
          dice: r.dice,
          modifier,
          total,
          hr: r.hr,
          crit: r.crit,
          fumble: r.fumble,
          damage,
          damageBonus,
          damageType: values.damageType || 'physical',
          note: values.note || '',
        };
      },
    },

    plain: {
      label: 'Any dice',
      inputs: [
        { key: 'expression', label: 'Dice (e.g. 2d6+3)', kind: 'text', default: '1d6' },
        { key: 'note', label: 'Note', kind: 'text', optional: true },
      ],
      resolve(values, rng) {
        const r = rollExpression(values.expression, rng);
        return { ...r, note: values.note || '' };
      },
    },
  },
};

function fmtMod(n) {
  if (!n) return '';
  return n > 0 ? ` +${n}` : ` ${n}`;
}

/** One-line summary of a result, used for the dice tray and the log. */
function summarize(result) {
  const faces = result.dice.map((d) => `d${d.size}:${d.face}`).join(' ');
  if (result.type === 'check') {
    const flag = result.crit ? ' CRIT' : result.fumble ? ' FUMBLE' : '';
    return `${result.label} → ${result.total} (HR ${result.hr}) [${faces}]${flag}`;
  }
  if (result.type === 'damage') {
    const flag = result.crit ? ' CRIT' : result.fumble ? ' FUMBLE' : '';
    return `${result.label} → ${result.total} (HR ${result.hr}) [${faces}]${flag} · ${result.damage} ${result.damageType}`;
  }
  return `${result.label} → ${result.total} [${faces}]`;
}


// ---- backend.js ----
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

function standaloneBackend() {
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

// ---- app.js ----
// Panel UI. Builds controls from the game config, runs rolls, keeps a session log.


async function startApp(root, backend) {
  const game = fabulaUltima;
  const state = {
    user: null,
    characters: [],
    character: null,
    rollType: 'check',
    view: 'roll',
    sessionLog: [],
    editing: false,
  };

  // ---------- helpers ----------
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  function newCharacter() {
    return {
      id: '', ownerId: state.user.id, ownerName: state.user.name, name: '',
      dice: { DEX: 8, INS: 8, MIG: 8, WLP: 8 }, weapons: [],
    };
  }
  // Older saves had a single weaponDamage/damageType; fold them into weapons[].
  function normalize(c) {
    if (!c.weapons) c.weapons = c.weaponDamage ? [{ name: 'Weapon', damage: c.weaponDamage, type: c.damageType || 'physical' }] : [];
    delete c.weaponDamage; delete c.damageType;
    return c;
  }
  let errorMsg = '';

  // ---------- data ----------
  state.user = await backend.getUser();
  if (!state.user) {
    await new Promise((done) => {
      const input = h('input', { placeholder: 'Your name (test mode)', autofocus: true });
      const go = async () => { if (input.value.trim()) { state.user = await backend.setUser(input.value.trim()); done(); } };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      root.replaceChildren(h('div', { class: 'char' }, h('div', { class: 'row title' }, 'Who is rolling?'), input,
        h('button', { class: 'primary', onclick: go }, 'Continue')));
      input.focus();
    });
  }
  state.characters = (await backend.loadCharacters(state.user.id)).map(normalize);
  state.character = state.characters[0] || null;
  if (!state.character) state.editing = true;

  // ---------- roll form state ----------
  const form = {
    check: { attr1: 'DEX', attr2: 'INS', modifier: 0, note: '' },
    damage: { attr1: 'DEX', attr2: 'MIG', modifier: 0, note: '', weapon: 0 },
    plain: { expression: '1d6', note: '' },
  };

  // ---------- render ----------
  function render() {
    if (state.view === 'log') {
      root.replaceChildren(header(), viewTabs(), fullLogView());
      return;
    }
    root.replaceChildren(
      header(),
      viewTabs(),
      state.editing ? characterEditor() : characterBar(),
      rollTypeTabs(),
      rollForm(),
      trayPreview(),
      sessionLogView(),
    );
  }

  function viewTabs() {
    return h('div', { class: 'tabs views' },
      h('button', { class: 'tab' + (state.view === 'roll' ? ' on' : ''), onclick: () => { state.view = 'roll'; render(); } }, 'Roll'),
      h('button', { class: 'tab' + (state.view === 'log' ? ' on' : ''), onclick: () => { state.view = 'log'; render(); } },
        `Log${state.sessionLog.length ? ` (${state.sessionLog.length})` : ''}`),
    );
  }

  function logEntry(e) {
    return h('li', { class: e.crit ? 'crit' : e.fumble ? 'fumble' : '' },
      h('div', {}, h('b', {}, e.character || e.player), ' ', e.summary),
      h('div', { class: 'time' }, e.local),
      e.note ? h('div', { class: 'lognote' }, e.note) : null);
  }

  function fullLogView() {
    if (!state.sessionLog.length) return h('div', { class: 'tray empty' }, 'No rolls this session yet.');
    return h('div', { class: 'log full' },
      h('div', { class: 'row' },
        h('span', { class: 'lbl' }, 'Your rolls this session'),
        h('button', { class: 'ghost', onclick: exportCsv }, 'CSV'),
        clearButton()),
      h('ol', {}, state.sessionLog.map(logEntry)),
    );
  }

  function clearButton() {
    return state.confirmClear
      ? h('button', { class: 'ghost danger', onclick: () => { state.sessionLog = []; state.confirmClear = false; render(); } }, 'Really clear?')
      : h('button', { class: 'ghost', onclick: () => { state.confirmClear = true; render(); setTimeout(() => { state.confirmClear = false; render(); }, 4000); } }, 'Clear');
  }

  function header() {
    return h('div', { class: 'hdr' },
      h('span', { class: 'game' }, game.name),
      h('span', { class: 'user' }, state.user.name),
      backend.placeTray ? h('button', { class: 'ghost small', title: 'Find or recreate the dice tray on the board',
        onclick: () => backend.placeTray().catch((e) => { errorMsg = e.message; render(); }) }, 'Tray') : null,
    );
  }

  function characterBar() {
    const sel = h('select', {
      onchange: (e) => { state.character = state.characters.find((c) => c.id === e.target.value); render(); },
    }, state.characters.map((c) => h('option', { value: c.id, selected: c === state.character }, c.name)));
    const d = state.character.dice;
    return h('div', { class: 'char' },
      h('div', { class: 'row' }, sel, h('button', { class: 'ghost', onclick: () => { state.draft = null; state.editing = true; render(); } }, 'Edit')),
      h('div', { class: 'dice-line' },
        ATTRIBUTES.map((a) => h('span', { class: 'pill' }, `${a} d${d[a]}`)),
        state.character.weapons.map((w) => h('span', { class: 'pill' }, `${w.name} +${w.damage} ${w.type}`)),
      ),
    );
  }

  function characterEditor() {
    if (!state.draft) state.draft = state.character ? structuredClone(state.character) : newCharacter();
    const draft = state.draft;
    const redrawEditor = () => render();
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    const dieSel = (attr) => h('select', { onchange: (e) => (draft.dice[attr] = +e.target.value) },
      DIE_SIZES.map((s) => h('option', { value: s, selected: draft.dice[attr] === s }, `d${s}`)));
    return h('div', { class: 'char editing' },
      h('div', { class: 'row title' }, state.character ? 'Edit character' : 'New character'),
      field('Name', h('input', { value: draft.name, placeholder: 'Character name', oninput: (e) => (draft.name = e.target.value) })),
      h('div', { class: 'grid4' }, ATTRIBUTES.map((a) => field(a, dieSel(a)))),
      h('div', { class: 'lbl' }, 'Weapons / spells'),
      ...draft.weapons.map((w, i) => h('div', { class: 'weapon-row' },
        h('input', { value: w.name, placeholder: 'Name', oninput: (e) => (w.name = e.target.value) }),
        h('input', { type: 'number', min: 0, max: 99, value: w.damage, title: 'Damage bonus', oninput: (e) => (w.damage = +e.target.value || 0) }),
        h('select', { onchange: (e) => (w.type = e.target.value) },
          DAMAGE_TYPES.map((t) => h('option', { value: t, selected: w.type === t }, t))),
        h('button', { class: 'ghost', title: 'Remove', onclick: () => { draft.weapons.splice(i, 1); redrawEditor(); } }, '✕'),
      )),
      h('button', { class: 'ghost', onclick: () => { draft.weapons.push({ name: '', damage: 0, type: 'physical' }); redrawEditor(); } }, '+ Add weapon / spell'),
      errorMsg ? h('div', { class: 'error' }, errorMsg) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: async () => {
          if (!draft.name.trim()) { errorMsg = 'Give the character a name.'; render(); return; }
          draft.weapons = draft.weapons.filter((w) => w.name.trim());
          errorMsg = '';
          const saved = await backend.saveCharacter(draft);
          state.characters = (await backend.loadCharacters(state.user.id)).map(normalize);
          state.character = state.characters.find((c) => c.id === saved.id) || normalize(saved);
          state.draft = null; state.editing = false; render();
        } }, 'Save'),
        state.character ? h('button', { class: 'ghost', onclick: () => { state.draft = null; errorMsg = ''; state.editing = false; render(); } }, 'Cancel') : null,
        state.character ? h('button', { class: 'ghost', onclick: () => { state.character = null; state.draft = null; state.editing = true; render(); } }, '+ New') : null,
      ),
    );
  }

  function rollTypeTabs() {
    return h('div', { class: 'tabs' },
      Object.entries(game.rolls).map(([key, r]) =>
        h('button', { class: 'tab' + (state.rollType === key ? ' on' : ''), onclick: () => { state.rollType = key; render(); } }, r.label)));
  }

  function attrPicker(fkey, which) {
    const f = form[fkey];
    const dice = state.character?.dice || {};
    return h('div', { class: 'attrs' }, ATTRIBUTES.map((a) =>
      h('button', { class: 'attr' + (f[which] === a ? ' on' : ''), onclick: () => { f[which] = a; render(); } },
        h('b', {}, a), h('small', {}, dice[a] ? `d${dice[a]}` : '—'))));
  }

  function modStepper(f) {
    return h('div', { class: 'stepper' },
      h('button', { onclick: () => { f.modifier = Math.max(-10, f.modifier - 1); render(); } }, '−'),
      h('span', {}, (f.modifier > 0 ? '+' : '') + f.modifier),
      h('button', { onclick: () => { f.modifier = Math.min(10, f.modifier + 1); render(); } }, '+'),
      f.modifier ? h('button', { class: 'ghost', onclick: () => { f.modifier = 0; render(); } }, 'reset') : null,
    );
  }

  function noteField(f) {
    return h('input', { class: 'note', placeholder: 'Note (optional)', value: f.note, oninput: (e) => (f.note = e.target.value) });
  }

  function rollForm() {
    const type = state.rollType;
    const f = form[type];
    const needsChar = type !== 'plain';
    if (needsChar && !state.character) {
      return h('div', { class: 'form muted' }, 'Save a character first to use attribute rolls.');
    }
    const body = [];
    if (type === 'check' || type === 'damage') {
      body.push(h('div', { class: 'lbl' }, 'Attribute 1'), attrPicker(type, 'attr1'));
      body.push(h('div', { class: 'lbl' }, 'Attribute 2'), attrPicker(type, 'attr2'));
      body.push(h('div', { class: 'lbl' }, type === 'damage' ? 'Accuracy modifier' : 'Modifier'), modStepper(f));
      if (type === 'damage') {
        const ws = state.character.weapons;
        body.push(h('div', { class: 'lbl' }, 'Weapon / spell'));
        if (!ws.length) body.push(h('div', { class: 'muted small' }, 'No weapons saved. Edit the character to add one.'));
        else {
          if (f.weapon >= ws.length) f.weapon = 0;
          body.push(h('select', { onchange: (e) => { f.weapon = +e.target.value; render(); } },
            ws.map((w, i) => h('option', { value: i, selected: f.weapon === i }, `${w.name} — HR +${w.damage} ${w.type}`))));
        }
      }
    } else {
      body.push(h('div', { class: 'lbl' }, 'Dice'),
        h('input', { class: 'expr', value: f.expression, placeholder: '2d6+3', oninput: (e) => (f.expression = e.target.value),
          onkeydown: (e) => { if (e.key === 'Enter') doRoll(); } }),
        h('div', { class: 'quick' }, ['1d6', '1d8', '1d10', '1d12', '1d20', '2d6', '1d100'].map((x) =>
          h('button', { class: 'ghost', onclick: () => { f.expression = x; render(); } }, x))));
    }
    body.push(noteField(f));
    if (errorMsg) body.push(h('div', { class: 'error' }, errorMsg));
    body.push(h('button', { class: 'roll', onclick: doRoll }, 'ROLL'));
    return h('div', { class: 'form' }, body);
  }

  async function doRoll() {
    const type = state.rollType;
    const f = form[type];
    const c = state.character;
    let values;
    if (type === 'plain') values = { expression: f.expression, note: f.note };
    else values = {
      attr1: f.attr1, die1: c.dice[f.attr1], attr2: f.attr2, die2: c.dice[f.attr2],
      modifier: f.modifier, note: f.note,
    };
    if (type === 'damage') {
      const w = c.weapons[f.weapon];
      if (!w) { errorMsg = 'Add a weapon or spell to the character first.'; render(); return; }
      values.damageBonus = w.damage; values.damageType = w.type; values.weaponName = w.name;
    }
    let result;
    try { result = game.rolls[type].resolve(values, defaultRng); errorMsg = ''; }
    catch (e) { errorMsg = e.message; render(); return; }

    const now = new Date();
    const entry = {
      ts: now.toISOString(), local: stamp(now),
      game: game.id, player: state.user.name, playerId: state.user.id,
      character: c ? c.name : '', type, label: result.label,
      dice: result.dice.map((d) => `d${d.size}:${d.face}`).join(' '),
      modifier: result.modifier, total: result.total,
      hr: result.hr ?? '', crit: !!result.crit, fumble: !!result.fumble,
      damage: result.damage ?? '', damageType: result.damageType ?? '', weapon: values.weaponName || '',
      note: result.note || '', summary: summarize(result),
    };
    state.sessionLog.unshift(entry);
    f.note = '';
    render();
    await Promise.all([backend.logRoll(entry), backend.showOnTray(entry)]);
  }

  function trayPreview() {
    const e = state.sessionLog[0];
    if (!e) return h('div', { class: 'tray empty' }, 'No rolls yet.');
    const flag = e.crit ? h('span', { class: 'flag crit' }, 'CRIT') : e.fumble ? h('span', { class: 'flag fumble' }, 'FUMBLE') : null;
    return h('div', { class: 'tray' + (e.crit ? ' is-crit' : e.fumble ? ' is-fumble' : '') },
      h('div', { class: 'tray-top' }, h('span', {}, `${e.character || e.player}`), h('span', { class: 'time' }, e.local.slice(11))),
      h('div', { class: 'tray-main' }, h('span', { class: 'big' }, e.total), flag),
      h('div', { class: 'tray-sub' },
        e.type !== 'plain' ? h('span', {}, `HR ${e.hr}`) : null,
        e.damage !== '' ? h('span', {}, `${e.damage} ${e.damageType}`) : null,
        h('span', { class: 'faces' }, e.dice)),
      h('div', { class: 'tray-label' }, e.label, e.weapon ? ` · ${e.weapon}` : ''),
    );
  }

  function sessionLogView() {
    if (!state.sessionLog.length) return h('div');
    return h('div', { class: 'log' },
      h('div', { class: 'row' },
        h('span', { class: 'lbl' }, 'Recent'),
        h('button', { class: 'ghost', onclick: () => { state.view = 'log'; render(); } }, 'Full log →')),
      h('ol', {}, state.sessionLog.slice(0, 5).map(logEntry)),
    );
  }

  function exportCsv() {
    const cols = ['ts', 'local', 'player', 'character', 'type', 'label', 'dice', 'modifier', 'total', 'hr', 'crit', 'fumble', 'damage', 'damageType', 'weapon', 'note'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(','), ...[...state.sessionLog].reverse().map((e) => cols.map((c) => esc(e[c])).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `rolls-${stamp(new Date()).replace(/[: ]/g, '-')}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  render();
}

// ---- backend-miro.js ----
// Miro backend: identity from Miro, dice tray as a shared board item,
// characters and the permanent log in the Google Sheet (via Apps Script).
// If SHEET_URL is empty or the sheet is unreachable, characters fall back to this browser.

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

function miroBackend() {
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

export { startApp, standaloneBackend, miroBackend };
