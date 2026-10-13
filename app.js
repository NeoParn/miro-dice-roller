// Panel UI. Builds controls from the game config, runs rolls, keeps a session log.
import { defaultRng } from './engine.js';
import { fabulaUltima, summarize, DAMAGE_TYPES, DIE_SIZES, ATTRIBUTES } from './games/fabula-ultima.js';

export async function startApp(root, backend) {
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
