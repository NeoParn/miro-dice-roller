// Panel UI. Everything game-specific comes from the game file; nothing here knows any one game.
import { defaultRng, formatDice } from './engine.js';
import {
  resolveRoll, summarize, validateGame, defaultInputs, needsCharacter,
  newCharacter, newItem, normalizeCharacter,
} from './rules.js';

/**
 * root    - element to render into
 * backend - standaloneBackend() or miroBackend()
 * games   - { list(): Promise<string[]>, load(id): Promise<game> }
 */
export async function startApp(root, backend, games) {
  const state = {
    user: null,
    game: null,
    gameErrors: [],
    allCharacters: [],
    characters: [],
    character: null,
    rollId: null,
    view: 'roll',          // roll | log | games
    sessionLog: [],
    editing: false,
    draft: null,
    forms: {},             // `${gameId}:${rollId}` -> input values
    notes: {},
    warning: '',
  };
  let errorMsg = '';

  // ---------- helpers ----------
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'value') el.value = v ?? '';
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const statDef = (key) => (state.game.stats || []).find((s) => s.key === key);
  const statLabel = (key) => statDef(key)?.label || key;
  const showStat = (key, v) => (statDef(key)?.type === 'die' ? `d${v}` : String(v ?? '—'));
  const fail = (msg) => { root.replaceChildren(h('div', { class: 'error box' }, msg)); };

  // ---------- data ----------
  state.user = await backend.getUser();
  if (!state.user) {
    await new Promise((done) => {
      const input = h('input', { placeholder: 'Your name (test mode)' });
      const go = async () => { if (input.value.trim()) { state.user = await backend.setUser(input.value.trim()); done(); } };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      root.replaceChildren(h('div', { class: 'char' }, h('div', { class: 'row title' }, 'Who is rolling?'), input,
        h('button', { class: 'primary', onclick: go }, 'Continue')));
      input.focus();
    });
  }
  if (backend.status) state.warning = await backend.status();

  async function loadGame(id) {
    try { state.game = await games.load(id); }
    catch (e) { state.game = null; state.gameErrors = [`Couldn't load games/${id}.js: ${e.message}`]; return false; }
    state.gameErrors = validateGame(state.game);
    if (state.gameErrors.length) return false;
    state.rollId = state.game.rolls[0].id;
    await loadCharacters();
    return true;
  }

  async function loadCharacters(selectId) {
    state.allCharacters = (await backend.loadCharacters(state.user.id)).map(normalizeCharacter);
    state.characters = state.allCharacters.filter((c) => c.game === state.game.id);
    state.character = state.characters.find((c) => c.id === selectId) || state.characters[0] || null;
    state.editing = !state.character && state.game.rolls.some(needsCharacter);
    state.draft = null;
  }

  const boardGame = await backend.getBoardGame();
  if (boardGame) { await loadGame(boardGame); state.view = state.game && !state.gameErrors.length ? 'roll' : 'games'; }
  else state.view = 'games';

  // ---------- render ----------
  function render() {
    const parts = [header()];
    if (state.warning) parts.push(h('div', { class: 'warn' }, state.warning));
    if (state.view === 'games') parts.push(gamePicker());
    else if (state.view === 'log') parts.push(viewTabs(), fullLogView());
    else parts.push(viewTabs(),
      state.editing ? characterEditor() : characterBar(),
      rollTabs(), rollForm(), trayPreview(), sessionLogView());
    root.replaceChildren(...parts);
  }

  function header() {
    return h('div', { class: 'hdr' },
      h('button', { class: 'game linkish', title: 'Change the game for this board',
        onclick: () => { state.view = 'games'; render(); } }, state.game?.name || 'Pick a game', ' ▾'),
      h('span', { class: 'user' }, state.user.name),
      backend.placeTray ? h('button', { class: 'ghost small', title: 'Find or recreate the dice tray on the board',
        onclick: () => backend.placeTray().catch((e) => { errorMsg = e.message; render(); }) }, 'Tray') : null,
    );
  }

  // ---------- game picker ----------
  let pickerCache = null;
  function gamePicker() {
    const box = h('div', { class: 'char' },
      h('div', { class: 'row title' }, 'Which game does this board use?'),
      h('div', { class: 'muted small' }, 'This sets the game for everyone on this board.'));
    if (state.gameErrors.length) {
      box.append(h('div', { class: 'error box' },
        h('b', {}, 'This game file has problems:'),
        h('ul', {}, state.gameErrors.map((e) => h('li', {}, e)))));
    }
    const list = h('div', { class: 'games' }, h('div', { class: 'muted small' }, 'Loading games…'));
    box.append(list);
    (pickerCache ||= (async () => {
      const ids = await games.list();
      return Promise.all(ids.map(async (id) => {
        try { const g = await games.load(id); const errs = validateGame(g); return { id, name: g.name, errs }; }
        catch (e) { return { id, name: id, errs: [`Couldn't load games/${id}.js: ${e.message}`] }; }
      }));
    })()).then((entries) => {
      list.replaceChildren(...entries.map((g) => h('button', {
        class: 'gamebtn' + (state.game?.id === g.id ? ' on' : ''),
        onclick: async () => {
          // A broken file only shows its problems; it never becomes the board's game.
          if (g.errs.length) { state.gameErrors = g.errs; render(); return; }
          await backend.setBoardGame(g.id);
          if (await loadGame(g.id)) state.view = 'roll';
          render();
        },
      }, h('b', {}, g.name), h('small', { class: 'muted' }, `${g.id}.js`), g.errs.length ? h('small', { class: 'error' }, `${g.errs.length} problem(s), click for details`) : null)));
      if (state.game && !state.gameErrors.length) {
        list.append(h('button', { class: 'ghost', onclick: () => { state.view = 'roll'; render(); } }, 'Cancel'));
      }
    }).catch((e) => list.replaceChildren(h('div', { class: 'error' }, `Couldn't load the game list: ${e.message}`)));
    return box;
  }

  // ---------- views ----------
  function viewTabs() {
    return h('div', { class: 'tabs views' },
      h('button', { class: 'tab' + (state.view === 'roll' ? ' on' : ''), onclick: () => { state.view = 'roll'; render(); } }, 'Roll'),
      h('button', { class: 'tab' + (state.view === 'log' ? ' on' : ''), onclick: () => { state.view = 'log'; render(); } },
        `Log${state.sessionLog.length ? ` (${state.sessionLog.length})` : ''}`),
    );
  }

  function logEntry(e) {
    return h('li', { class: e.style || '' },
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
      h('ol', {}, state.sessionLog.map(logEntry)));
  }

  function clearButton() {
    return state.confirmClear
      ? h('button', { class: 'ghost danger', onclick: () => { state.sessionLog = []; state.confirmClear = false; render(); } }, 'Really clear?')
      : h('button', { class: 'ghost', onclick: () => { state.confirmClear = true; render(); setTimeout(() => { state.confirmClear = false; render(); }, 4000); } }, 'Clear');
  }

  // ---------- character ----------
  function itemText(it) {
    const fields = state.game.items?.fields || [];
    const bits = fields.map((f) => it[f.key]).filter((v) => v !== '' && v != null);
    return bits.length ? `${it.name} (${bits.join(' ')})` : it.name;
  }

  function characterBar() {
    if (!state.character) {
      return h('div', { class: 'char' }, h('div', { class: 'row' },
        h('span', { class: 'muted small' }, 'No character yet.'),
        h('button', { class: 'ghost', onclick: () => { state.draft = null; state.editing = true; render(); } }, '+ New character')));
    }
    const sel = h('select', {
      onchange: (e) => { state.character = state.characters.find((c) => c.id === e.target.value); render(); },
    }, state.characters.map((c) => h('option', { value: c.id, selected: c === state.character }, c.name)));
    const st = state.character.stats;
    const pills = (state.game.stats || [])
      .filter((s) => s.type === 'die' || (st[s.key] ?? 0) !== 0)
      .map((s) => h('span', { class: 'pill' }, `${s.label || s.key} ${showStat(s.key, st[s.key])}`));
    return h('div', { class: 'char' },
      h('div', { class: 'row' }, sel, h('button', { class: 'ghost', onclick: () => { state.draft = null; state.editing = true; render(); } }, 'Edit')),
      h('div', { class: 'dice-line' }, pills, state.character.items.map((it) => h('span', { class: 'pill item' }, itemText(it)))));
  }

  function characterEditor() {
    const game = state.game;
    if (!state.draft) state.draft = state.character ? structuredClone(state.character) : newCharacter(game, state.user);
    const draft = state.draft;
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    const statInput = (s) => s.type === 'die'
      ? h('select', { onchange: (e) => (draft.stats[s.key] = +e.target.value) },
        s.options.map((o) => h('option', { value: o, selected: +draft.stats[s.key] === o }, `d${o}`)))
      : h('input', { type: 'number', min: s.min ?? 0, max: s.max ?? 99, value: draft.stats[s.key] ?? 0,
        oninput: (e) => (draft.stats[s.key] = +e.target.value || 0) });

    const groups = [];
    for (const s of game.stats || []) {
      const g = s.group || '';
      let grp = groups.find((x) => x.name === g);
      if (!grp) groups.push(grp = { name: g, stats: [] });
      grp.stats.push(s);
    }

    const itemFieldInput = (it, f) => f.type === 'choice'
      ? h('select', { title: f.label || f.key, onchange: (e) => (it[f.key] = e.target.value) },
        f.options.map((o) => h('option', { value: o, selected: it[f.key] === o }, o)))
      : h('input', { type: f.type === 'number' ? 'number' : 'text', title: f.label || f.key, placeholder: f.label || f.key,
        value: it[f.key], oninput: (e) => (it[f.key] = f.type === 'number' ? +e.target.value || 0 : e.target.value) });

    const save = async () => {
      if (!draft.name.trim()) { errorMsg = 'Give the character a name.'; render(); return; }
      if (/[;]/.test(draft.name) || draft.items.some((it) => /[;()]/.test(it.name))) { errorMsg = 'Names can\'t contain ; or brackets.'; render(); return; }
      draft.items = draft.items.filter((it) => it.name.trim());
      draft.game = game.id;
      errorMsg = '';
      try {
        const saved = await backend.saveCharacter(draft, game);
        await loadCharacters(saved.id);
      } catch (e) { errorMsg = `Couldn't save: ${e.message}`; render(); return; }
      state.editing = false; render();
    };
    // Save sits at the top (sticky) and at the bottom, so it's reachable however short the panel is.
    const actions = () => h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: save }, 'Save'),
      state.character ? h('button', { class: 'ghost', onclick: () => { state.draft = null; errorMsg = ''; state.editing = false; render(); } }, 'Cancel') : null,
      state.character ? h('button', { class: 'ghost', onclick: () => { state.character = null; state.draft = null; state.editing = true; render(); } }, '+ New') : null);

    return h('div', { class: 'char editing' },
      h('div', { class: 'edit-head' },
        h('span', { class: 'title' }, state.character ? 'Edit character' : 'New character'),
        actions()),
      field('Name', h('input', { value: draft.name, placeholder: 'Character name', oninput: (e) => (draft.name = e.target.value) })),
      groups.map((g) => [
        g.name ? h('div', { class: 'lbl' }, g.name) : null,
        h('div', { class: 'statgrid' }, g.stats.map((s) => field(s.label || s.key, statInput(s)))),
      ]),
      game.items ? [
        h('div', { class: 'lbl' }, game.items.label || 'Items'),
        draft.items.map((it, i) => h('div', { class: 'item-row' },
          h('input', { class: 'item-name', value: it.name, placeholder: 'Name', oninput: (e) => (it.name = e.target.value) }),
          (game.items.fields || []).map((f) => itemFieldInput(it, f)),
          h('button', { class: 'ghost', title: 'Remove', onclick: () => { draft.items.splice(i, 1); render(); } }, '✕'))),
        h('button', { class: 'ghost', onclick: () => { draft.items.push(newItem(game)); render(); } }, `+ Add ${String(game.items.label || 'item').toLowerCase()}`),
      ] : null,
      errorMsg ? h('div', { class: 'error' }, errorMsg) : null,
      actions(),
    );
  }

  // ---------- rolling ----------
  function rollTabs() {
    return h('div', { class: 'tabs' }, state.game.rolls.map((r) =>
      h('button', { class: 'tab' + (state.rollId === r.id ? ' on' : ''), onclick: () => { state.rollId = r.id; errorMsg = ''; render(); } }, r.name)));
  }

  const rollDef = () => state.game.rolls.find((r) => r.id === state.rollId);
  function formFor(r) {
    const k = `${state.game.id}:${r.id}`;
    return state.forms[k] ||= defaultInputs(r);
  }

  function inputControl(inp, f) {
    const set = (v) => { f[inp.key] = v; render(); };
    const ch = state.character;
    switch (inp.type) {
      case 'stat': {
        const opts = (state.game.stats || []).filter((s) => !inp.group || s.group === inp.group);
        const valueOf = (s) => (ch ? showStat(s.key, ch.stats[s.key]) : '—');
        const n = opts.length + (inp.optional ? 1 : 0);
        if (n <= 12) {
          const cols = n <= 4 ? n : n % 3 === 0 ? 3 : 4;
          return h('div', { class: 'attrs', style: `grid-template-columns: repeat(${cols}, 1fr)` },
            opts.map((s) => h('button', { class: 'attr' + (f[inp.key] === s.key ? ' on' : ''), onclick: () => set(s.key) },
              h('b', {}, s.label || s.key), h('small', {}, valueOf(s)))),
            inp.optional ? h('button', { class: 'attr' + (!f[inp.key] ? ' on' : ''), onclick: () => set('') }, h('b', {}, 'none'), h('small', {}, '')) : null);
        }
        return h('select', { onchange: (e) => set(e.target.value) },
          inp.optional ? h('option', { value: '', selected: !f[inp.key] }, '— none —') : null,
          opts.map((s) => h('option', { value: s.key, selected: f[inp.key] === s.key }, `${s.label || s.key} (${valueOf(s)})`)));
      }
      case 'number': {
        const min = inp.min ?? -99, max = inp.max ?? 99, def = inp.default ?? 0, v = Number(f[inp.key]) || 0;
        return h('div', { class: 'stepper' },
          h('button', { onclick: () => set(Math.max(min, v - 1)) }, '−'),
          h('span', {}, inp.min !== undefined && inp.min >= 0 ? String(v) : (v > 0 ? '+' : '') + v),
          h('button', { onclick: () => set(Math.min(max, v + 1)) }, '+'),
          v !== def ? h('button', { class: 'ghost', onclick: () => set(def) }, 'reset') : null);
      }
      case 'toggle':
        return h('label', { class: 'toggle' },
          h('input', { type: 'checkbox', checked: !!f[inp.key], onchange: (e) => set(e.target.checked) }),
          h('span', {}, inp.label || inp.key));
      case 'choice':
        return h('select', { onchange: (e) => set(e.target.value) },
          (inp.options || []).map((o) => h('option', { value: o, selected: f[inp.key] === o }, o)));
      case 'item': {
        const items = ch?.items || [];
        if (!items.length) return h('div', { class: 'muted small' }, `None saved. Edit the character to add one.`);
        if (f[inp.key] >= items.length) f[inp.key] = 0;
        return h('select', { onchange: (e) => set(+e.target.value) },
          items.map((it, i) => h('option', { value: i, selected: f[inp.key] === i }, itemText(it))));
      }
      case 'text':
        return [
          h('input', { class: 'expr', value: f[inp.key], placeholder: inp.placeholder || '',
            oninput: (e) => (f[inp.key] = e.target.value), onkeydown: (e) => { if (e.key === 'Enter') doRoll(); } }),
          inp.quick ? h('div', { class: 'quick' }, inp.quick.map((x) => h('button', { class: 'ghost', onclick: () => set(x) }, x))) : null,
        ];
      default: return h('div', { class: 'error' }, `Unknown input type ${inp.type}`);
    }
  }

  function rollForm() {
    const r = rollDef();
    const f = formFor(r);
    if (needsCharacter(r) && !state.character) {
      return h('div', { class: 'form muted' }, 'Save a character first to use this roll.');
    }
    const key = `${state.game.id}:${r.id}`;
    return h('div', { class: 'form' },
      (r.inputs || []).map((inp) => [
        inp.type === 'toggle' ? null : h('div', { class: 'lbl' }, inp.label || inp.key),
        inputControl(inp, f),
      ]),
      h('input', { class: 'note', placeholder: 'Note (optional)', value: state.notes[key] || '', oninput: (e) => (state.notes[key] = e.target.value) }),
      errorMsg ? h('div', { class: 'error' }, errorMsg) : null,
      h('button', { class: 'roll', onclick: doRoll }, 'ROLL'));
  }

  async function doRoll() {
    const r = rollDef();
    const key = `${state.game.id}:${r.id}`;
    let result;
    try { result = resolveRoll(state.game, r.id, formFor(r), state.character, defaultRng); errorMsg = ''; }
    catch (e) { errorMsg = cap(e.message); render(); return; }

    const now = new Date();
    const styles = result.flags.map((x) => x.style);
    const entry = {
      ts: now.toISOString(), local: stamp(now),
      game: state.game.id, player: state.user.name, playerId: state.user.id,
      character: state.character ? state.character.name : '',
      rollName: result.rollName, label: result.label,
      dice: formatDice(result.dice),
      modifier: result.modifier, total: result.total, totalLabel: result.totalLabel,
      values: result.values.map((v) => `${v.label} ${v.text}`).join('; '),
      flags: result.flags.map((x) => x.label).join(' '),
      style: styles.includes('bad') ? 'bad' : styles.includes('good') ? 'good' : '',
      item: result.item || '',
      note: state.notes[key] || '',
      summary: summarize(result),
    };
    state.sessionLog.unshift(entry);
    state.notes[key] = '';
    const f = formFor(r), defaults = defaultInputs(r);
    for (const i of r.inputs || []) if (i.resetAfterRoll) f[i.key] = defaults[i.key];
    render();
    await Promise.all([
      backend.logRoll(entry).catch(() => {}),
      backend.showOnTray(entry).catch((e) => { errorMsg = `Tray: ${e.message}`; render(); }),
    ]);
  }

  function trayPreview() {
    const e = state.sessionLog[0];
    if (!e) return h('div', { class: 'tray empty' }, 'No rolls yet.');
    return h('div', { class: 'tray' + (e.style ? ` is-${e.style}` : '') },
      h('div', { class: 'tray-top' }, h('span', {}, e.character || e.player), h('span', { class: 'time' }, e.local.slice(11))),
      h('div', { class: 'tray-main' },
        h('span', { class: 'big' }, e.total),
        e.totalLabel ? h('span', { class: 'unit' }, e.totalLabel) : null,
        e.flags ? h('span', { class: `flag ${e.style}` }, e.flags) : null),
      h('div', { class: 'tray-sub' }, e.values ? h('span', {}, e.values) : null, h('span', { class: 'faces' }, e.dice)),
      h('div', { class: 'tray-label' }, e.label, e.item ? ` · ${e.item}` : ''));
  }

  function sessionLogView() {
    if (!state.sessionLog.length) return h('div');
    return h('div', { class: 'log' },
      h('div', { class: 'row' },
        h('span', { class: 'lbl' }, 'Recent'),
        h('button', { class: 'ghost', onclick: () => { state.view = 'log'; render(); } }, 'Full log →')),
      h('ol', {}, state.sessionLog.slice(0, 5).map(logEntry)));
  }

  function exportCsv() {
    const cols = ['ts', 'local', 'game', 'player', 'character', 'rollName', 'label', 'dice', 'modifier', 'total', 'values', 'flags', 'item', 'note'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(','), ...[...state.sessionLog].reverse().map((e) => cols.map((c) => esc(e[c])).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `rolls-${stamp(new Date()).replace(/[: ]/g, '-')}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  if (!state.user) return fail('No user.');
  render();
}
