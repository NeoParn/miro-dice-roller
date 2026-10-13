// ---- config.js ----
// Deployment settings. SHEET_URL is the Apps Script web-app /exec URL.
// Leave it empty to run without the Google Sheet (characters stay in the browser, no permanent log).
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbx_iNC4Zu05XEd_j8z6hYfjzlnBPddDmed_Gio-f39ozKAtK4-GHPlNqgz3TpO-mYc14w/exec';

// ---- engine.js ----
// Core dice engine. Game-agnostic. Runs in the browser or Node.
//
// A "pool" is an array of dice: { size, face, kept, extra?, exploded?, rerolledFrom?, sign? }
//   kept=false      -> dropped by keep/drop; shown in the log but not counted
//   extra=true      -> added by an explosion
//   exploded=true   -> this die triggered an explosion
//   rerolledFrom=n  -> this die was rerolled; n is the face it showed first

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

/** Roll `count` dice of one size as a pool. */
function makePool(count, size, rng = defaultRng, sign = 1) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ size, face: rollDie(size, rng), kept: true, sign });
  return out;
}

const EXPLODE_LIMIT = 100;

/** Every kept die showing `atLeast` or more adds another die of the same size; extras can explode too. */
function explode(pool, atLeast, rng = defaultRng) {
  const out = [];
  let budget = EXPLODE_LIMIT;
  for (const d of pool) {
    out.push(d);
    if (d.kept === false) continue;
    if (atLeast <= 1) throw new Error(`Exploding on ${atLeast} or more would never stop`);
    let cur = d;
    while (cur.face >= atLeast && cur.face <= cur.size && budget-- > 0) {
      cur.exploded = true;
      const next = { size: cur.size, face: rollDie(cur.size, rng), kept: true, extra: true, sign: cur.sign ?? 1 };
      out.push(next);
      cur = next;
    }
  }
  return out;
}

/** Reroll, once, every kept die showing `atMost` or less. */
function reroll(pool, atMost, rng = defaultRng) {
  for (const d of pool) {
    if (d.kept === false || d.face > atMost) continue;
    d.rerolledFrom = d.face;
    d.face = rollDie(d.size, rng);
  }
  return pool;
}

/** Order kept dice by face; ties keep their original order. */
function rankKept(pool, highestFirst) {
  return pool
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d.kept !== false)
    .sort((a, b) => (highestFirst ? b.d.face - a.d.face : a.d.face - b.d.face) || a.i - b.i)
    .map((x) => x.d);
}

function keepHighest(pool, n) { rankKept(pool, true).slice(n).forEach((d) => (d.kept = false)); return pool; }
function keepLowest(pool, n) { rankKept(pool, false).slice(n).forEach((d) => (d.kept = false)); return pool; }
function dropHighest(pool, n) { rankKept(pool, true).slice(0, n).forEach((d) => (d.kept = false)); return pool; }
function dropLowest(pool, n) { rankKept(pool, false).slice(0, n).forEach((d) => (d.kept = false)); return pool; }

const OPS = /!|(kh|kl|dh|dl)(\d+)/g;

/**
 * Parse a free-form dice expression like "2d6+3", "d8", "4d6kh3", "5d10!", "2d20kl1+4".
 * Suffixes on a dice term: ! (explode on max), khN, klN, dhN, dlN (keep/drop highest/lowest N).
 * Returns { terms: [{ count, size, sign, ops }], modifier }.
 */
function parseExpression(text) {
  // Allow spaces only around + and -; anything else with a space is a typo.
  const cleaned = String(text).trim().replace(/\s*([+-])\s*/g, '$1').toLowerCase();
  if (!cleaned) throw new Error('Empty dice expression');
  if (/\s/.test(cleaned)) throw new Error(`Bad dice expression: ${text}`);
  const re = /([+-]?)(\d*)d(\d+)((?:!|kh\d+|kl\d+|dh\d+|dl\d+)*)|([+-]\d+)/g;
  const terms = [];
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
      const ops = [];
      for (const o of (m[4] || '').matchAll(OPS)) {
        if (o[0] === '!') {
          if (size < 2) throw new Error("Can't explode a d1");
          ops.push({ op: 'explode' });
        } else ops.push({ op: o[1], n: parseInt(o[2], 10) });
      }
      terms.push(ops.length ? { count, size, sign, ops } : { count, size, sign });
    } else {
      modifier += parseInt(m[5], 10);
    }
  }
  if (consumed !== cleaned.length || terms.length === 0) throw new Error(`Bad dice expression: ${text}`);
  return { terms, modifier };
}

/** Apply one parsed op to a pool. */
function applyOp(pool, op, size, rng) {
  switch (op.op) {
    case 'explode': return explode(pool, size, rng);
    case 'kh': return keepHighest(pool, op.n);
    case 'kl': return keepLowest(pool, op.n);
    case 'dh': return dropHighest(pool, op.n);
    case 'dl': return dropLowest(pool, op.n);
    default: throw new Error(`Unknown dice op ${op.op}`);
  }
}

/** Roll a free-form expression. Returns { type, label, dice, modifier, total }. */
function rollExpression(text, rng = defaultRng) {
  const { terms, modifier } = parseExpression(text);
  let dice = [];
  for (const t of terms) {
    let pool = makePool(t.count, t.size, rng, t.sign);
    for (const op of t.ops || []) pool = applyOp(pool, op, t.size, rng);
    dice = dice.concat(pool);
  }
  const total = modifier + dice.filter((d) => d.kept !== false).reduce((s, d) => s + d.sign * d.face, 0);
  return { type: 'plain', label: String(text).trim(), dice, modifier, total };
}

/** Short text for a pool: "d10:10! d10:4 (d10:2) d6:5(r1)". */
function formatDice(dice) {
  return dice.map((d) => {
    let s = `${d.sign === -1 ? '-' : ''}d${d.size}:${d.face}`;
    if (d.exploded) s += '!';
    if (d.rerolledFrom != null) s += `(r${d.rerolledFrom})`;
    return d.kept === false ? `(${s})` : s;
  }).join(' ');
}

/**
 * Test helper: an rng that yields exact faces for given die sizes.
 * Usage: const rng = facesFor([[6, 4], [8, 7]]) -> first d6 shows 4, first d8 shows 7.
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

/** Test helper: deterministic seeded rng (mulberry32). */
function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- rules.js ----
// Rules interpreter: turns a hand-written game file (plain data) into rolls.
// The format is documented in games/README.md. Nothing in here is specific to one game.

const STAT_TYPES = ['die', 'number'];
const INPUT_TYPES = ['stat', 'number', 'choice', 'toggle', 'item', 'text'];
const ITEM_FIELD_TYPES = ['number', 'choice', 'text'];
const STEP_TYPES = ['explode', 'reroll', 'keepHighest', 'keepLowest', 'dropHighest', 'dropLowest'];
const FLAG_CONDITIONS = ['allSame', 'allAtLeast', 'allEqual', 'anyEqual', 'anyAtLeast', 'successes', 'totalAtLeast', 'totalAtMost'];
const ROLL_FIELDS = ['total', 'sum', 'highest', 'lowest', 'count', 'successes', 'ones'];
const ONES_RULES = ['ignore', 'subtract', 'subtract-not-extra'];

class RuleError extends Error {}

// ---------------------------------------------------------------- references

const num = (v) => (v === '' || v == null || v === false ? 0 : v === true ? 1 : Number(v) || 0);

/**
 * Resolve a reference against the roll context.
 *   5 / "5"             a number
 *   "input.KEY"         the value of the roll's input KEY
 *   "stat.KEY"          the character's value for the stat chosen in input KEY
 *   "stats.NAME"        the character's value for the stat named NAME
 *   "item.KEY"          the name of the item chosen in input KEY
 *   "item.KEY.FIELD"    a field of that item
 *   "roll.FIELD"        a result: total, sum, highest, lowest, count, successes, ones
 *   [a, b, c]           the sum of several references
 */
function lookup(ref, ctx) {
  if (typeof ref === 'number') return ref;
  if (typeof ref === 'boolean') return ref;
  if (Array.isArray(ref)) return ref.reduce((s, r) => s + num(lookup(r, ctx)), 0);
  if (typeof ref !== 'string') throw new RuleError(`can't read reference ${JSON.stringify(ref)}`);
  if (/^-?\d+$/.test(ref)) return Number(ref);
  const [head, a, b] = ref.split('.');
  switch (head) {
    case 'input': return ctx.inputs?.[a] ?? '';
    case 'stat': {
      const key = ctx.inputs?.[a];
      return key ? (ctx.character?.stats?.[key] ?? '') : '';
    }
    case 'stats': return ctx.character?.stats?.[a] ?? '';
    case 'item': {
      const idx = ctx.inputs?.[a];
      const item = ctx.character?.items?.[idx];
      if (!item) return '';
      return b ? (item[b] ?? '') : item.name;
    }
    case 'roll': return ctx.roll?.[a] ?? '';
    default: throw new RuleError(`unknown reference '${ref}'`);
  }
}

/**
 * Fill a text template: "{input.attr1} d{stat.attr1}".
 * A part in [square brackets] is left out when any {placeholder} inside it is empty, 0,
 * or a toggle that is off. A toggle that is on prints nothing but keeps its group.
 */
function fill(template, ctx) {
  if (template == null) return '';
  const val = (ref) => lookup(ref.trim(), ctx);
  const show = (v) => (v === true || v === false || v == null ? '' : String(v));
  const groups = String(template).replace(/\[([^\]]*)\]/g, (_, inner) => {
    const refs = [...inner.matchAll(/\{([^}]*)\}/g)].map((m) => val(m[1]));
    if (refs.some((v) => v === '' || v == null || v === false || v === 0)) return '';
    return inner.replace(/\{([^}]*)\}/g, (_, r) => show(val(r)));
  });
  return groups.replace(/\{([^}]*)\}/g, (_, r) => show(val(r)));
}

// ---------------------------------------------------------------- rolling

function applyStep(pool, step, ctx, rng) {
  const [kind] = Object.keys(step).filter((k) => k !== 'when');
  const arg = step[kind];
  switch (kind) {
    case 'explode': return explode(pool, arg.atLeast === undefined ? maxSize(pool) : num(lookup(arg.atLeast, ctx)), rng);
    case 'reroll': return reroll(pool, num(lookup(arg.atMost, ctx)), rng);
    case 'keepHighest': return keepHighest(pool, num(lookup(arg, ctx)));
    case 'keepLowest': return keepLowest(pool, num(lookup(arg, ctx)));
    case 'dropHighest': return dropHighest(pool, num(lookup(arg, ctx)));
    case 'dropLowest': return dropLowest(pool, num(lookup(arg, ctx)));
    default: throw new RuleError(`unknown step '${kind}'`);
  }
}
const maxSize = (pool) => Math.max(...pool.map((d) => d.size));

function onesCount(kept, rule) {
  if (rule === 'subtract') return kept.filter((d) => d.face === 1).length;
  if (rule === 'subtract-not-extra') return kept.filter((d) => d.face === 1 && !d.extra).length;
  return 0;
}

function checkFlag(when, kept, stats, ctx) {
  const faces = kept.map((d) => d.face);
  for (const [cond, raw] of Object.entries(when || {})) {
    const v = num(lookup(raw, ctx));
    let ok;
    switch (cond) {
      case 'allSame': ok = faces.length >= 2 && faces.every((f) => f === faces[0]) === !!raw; break;
      case 'allAtLeast': ok = faces.length > 0 && faces.every((f) => f >= v); break;
      case 'allEqual': ok = faces.length > 0 && faces.every((f) => f === v); break;
      case 'anyEqual': ok = faces.some((f) => f === v); break;
      case 'anyAtLeast': ok = faces.some((f) => f >= v); break;
      case 'successes': ok = stats.successes === v; break;
      case 'totalAtLeast': ok = stats.total >= v; break;
      case 'totalAtMost': ok = stats.total <= v; break;
      default: throw new RuleError(`unknown flag condition '${cond}'`);
    }
    if (!ok) return false;
  }
  return true;
}

/** Default value for each input of a roll. */
function defaultInputs(roll) {
  const out = {};
  for (const i of roll.inputs || []) {
    if (i.default !== undefined) out[i.key] = i.default;
    else if (i.type === 'toggle') out[i.key] = false;
    else if (i.type === 'number') out[i.key] = 0;
    else if (i.type === 'item') out[i.key] = 0;
    else if (i.type === 'choice') out[i.key] = (i.options || [])[0] ?? '';
    else out[i.key] = '';
  }
  return out;
}

/** Does this roll need a saved character? */
function needsCharacter(roll) {
  const text = JSON.stringify(roll);
  return (roll.inputs || []).some((i) => i.type === 'stat' || i.type === 'item') || /"(stats?|item)\./.test(text);
}

/**
 * Roll one of a game's rolls.
 * Returns { rollId, rollName, label, dice, modifier, modifierShown, total, totalLabel, values, flags, item }.
 */
function resolveRoll(game, rollId, inputs, character, rng = defaultRng) {
  const def = game.rolls.find((r) => r.id === rollId);
  if (!def) throw new RuleError(`no roll called '${rollId}'`);
  const ctx = { inputs: { ...defaultInputs(def), ...inputs }, character };
  for (const i of def.inputs || []) {
    if (i.type === 'item' && !i.optional && !character?.items?.[ctx.inputs[i.key]]) {
      throw new RuleError(`pick a ${String(i.label || 'item').toLowerCase()} first. Edit the character to add one.`);
    }
    if (i.type === 'stat' && !i.optional && !ctx.inputs[i.key]) {
      throw new RuleError(`pick a ${String(i.label || 'stat').toLowerCase()} first.`);
    }
  }

  // 1. dice
  let pool = [];
  let exprMod = 0;
  if (def.dice && !Array.isArray(def.dice) && def.dice.expression !== undefined) {
    const expr = String(lookup(def.dice.expression, ctx) || '');
    const r = rollExpression(expr, rng);
    pool = r.dice; exprMod = r.modifier;
  } else {
    for (const g of def.dice || []) {
      const count = Math.max(0, Math.floor(num(lookup(g.count ?? 1, ctx))));
      const size = num(lookup(g.die, ctx));
      if (!size) throw new RuleError('a die size is empty. Pick a stat, or check the character sheet.');
      pool = pool.concat(makePool(count, size, rng));
    }
  }
  if (!pool.length) throw new RuleError('there are no dice to roll (the pool is 0).');

  // 2. steps
  for (const step of def.steps || []) {
    if (step.when !== undefined && !num(lookup(step.when, ctx))) continue;
    pool = applyStep(pool, step, ctx, rng);
  }

  // 3. totals
  const kept = pool.filter((d) => d.kept !== false);
  const faces = kept.map((d) => d.face);
  const modShown = num(lookup(def.modifier ?? 0, ctx));
  const modifier = modShown + exprMod;
  const stats = {
    count: kept.length,
    sum: kept.reduce((s, d) => s + (d.sign ?? 1) * d.face, 0),
    highest: faces.length ? Math.max(...faces) : 0,
    lowest: faces.length ? Math.min(...faces) : 0,
    successes: 0,
    ones: 0,
  };
  const t = def.total ?? 'sum';
  let total, totalLabel = '';
  if (t === 'sum') total = stats.sum + modifier;
  else if (t === 'highest') total = stats.highest + modifier;
  else if (t === 'lowest') total = stats.lowest + modifier;
  else if (t && t.successes) {
    const target = num(lookup(t.successes.atLeast, ctx));
    stats.successes = kept.filter((d) => d.face >= target).length;
    stats.ones = onesCount(kept, t.ones ?? 'ignore');
    total = Math.max(0, stats.successes - stats.ones) + modifier;
    totalLabel = total === 1 ? 'success' : 'successes';
  } else throw new RuleError(`unknown total ${JSON.stringify(t)}`);
  stats.total = total;
  ctx.roll = stats;

  // 4. values and flags
  const values = (def.values || []).map((v) => {
    const value = lookup(v.value, ctx);
    const suffix = fill(v.suffix, ctx);
    return { label: v.label, value, text: suffix ? `${value} ${suffix}` : String(value) };
  });
  const flags = (def.flags || [])
    .filter((f) => !(f.unless !== undefined && num(lookup(f.unless, ctx))))
    .filter((f) => checkFlag(f.when, kept, stats, ctx))
    .map((f) => ({ label: f.label, style: f.style || 'neutral' }));

  const itemInput = (def.inputs || []).find((i) => i.type === 'item');
  return {
    rollId: def.id,
    rollName: def.name,
    label: def.dice?.expression !== undefined && !def.label ? String(lookup(def.dice.expression, ctx)).trim() : fill(def.label ?? def.name, ctx),
    dice: pool,
    modifier,
    // Success-count rolls describe their bonus in the label, so the summary doesn't repeat it.
    modifierShown: totalLabel ? 0 : def.dice?.expression !== undefined ? modShown : modifier,
    total,
    totalLabel,
    values,
    flags,
    item: itemInput ? lookup(`item.${itemInput.key}`, ctx) : '',
  };
}

const fmtMod = (n) => (!n ? '' : n > 0 ? ` +${n}` : ` ${n}`);

/** One-line summary used by the log, the tray history and the sheet. */
function summarize(r) {
  let s = `${r.label}${fmtMod(r.modifierShown)} → ${r.total}${r.totalLabel ? ' ' + r.totalLabel : ''}`;
  if (r.values.length) s += ` (${r.values.map((v) => `${v.label} ${v.text}`).join(', ')})`;
  s += ` [${formatDice(r.dice)}]`;
  if (r.flags.length) s += ' ' + r.flags.map((f) => f.label).join(' ');
  return s;
}

// ---------------------------------------------------------------- characters

function newCharacter(game, user) {
  const stats = {};
  for (const s of game.stats || []) stats[s.key] = s.default ?? (s.type === 'die' ? (s.options || [6])[0] : 0);
  return { id: '', ownerId: user.id, ownerName: user.name, game: game.id, name: '', stats, items: [] };
}

function newItem(game) {
  const it = { name: '' };
  for (const f of game.items?.fields || []) it[f.key] = f.default ?? (f.type === 'number' ? 0 : f.type === 'choice' ? (f.options || [])[0] : '');
  return it;
}

/** Older saved characters (Fabula-only format) -> current format. */
function normalizeCharacter(c) {
  if (!c) return c;
  if (!c.stats && c.dice) {
    c = { ...c, stats: c.dice, items: c.weapons || [], game: c.game || 'fabula-ultima' };
    delete c.dice; delete c.weapons;
  }
  c.items = c.items || [];
  c.stats = c.stats || {};
  c.game = c.game || 'fabula-ultima';
  return c;
}

/** "DEX=d8; INS=d10" for the sheet. */
function statsToText(game, stats) {
  return (game.stats || []).map((s) => `${s.key}=${s.type === 'die' ? 'd' : ''}${stats[s.key] ?? ''}`).join('; ');
}
function statsFromText(text) {
  const out = {};
  for (const part of String(text || '').split(';')) {
    const m = part.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const raw = m[2].replace(/^d(?=\d)/i, '');
    out[m[1]] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : m[2];
  }
  return out;
}

/** "Greatsword (damage=10, type=physical); Fireball (damage=15, type=fire)" for the sheet. */
function itemsToText(game, items) {
  const fields = game.items?.fields || [];
  return (items || []).map((it) => fields.length
    ? `${it.name} (${fields.map((f) => `${f.key}=${it[f.key] ?? ''}`).join(', ')})`
    : it.name).join('; ');
}
function itemsFromText(text) {
  return String(text || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    let m = s.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (m) {
      const it = { name: m[1].trim() };
      for (const kv of m[2].split(',')) {
        const p = kv.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
        if (p) it[p[1]] = /^-?\d+(\.\d+)?$/.test(p[2]) ? Number(p[2]) : p[2];
      }
      return it;
    }
    m = s.match(/^(.*?)\s*\+(\d+)\s*(\w+)?$/); // old "Greatsword +10 physical"
    if (m) return { name: m[1].trim(), damage: Number(m[2]), type: m[3] || 'physical' };
    return { name: s };
  });
}

// ---------------------------------------------------------------- validation

/** Check a game file. Returns a list of plain-English problems (empty = fine). */
function validateGame(game) {
  const errs = [];
  if (!game || typeof game !== 'object') return ['The file does not export a game. It should start with: export default {'];
  if (typeof game.id !== 'string' || !/^[a-z0-9-]+$/.test(game.id)) errs.push("Game 'id' must be lowercase letters, numbers and dashes, like 'my-game'.");
  if (typeof game.name !== 'string' || !game.name) errs.push("Game needs a 'name'.");

  const statKeys = new Set();
  for (const [i, s] of (game.stats || []).entries()) {
    const at = `Stat ${i + 1}${s?.key ? ` '${s.key}'` : ''}`;
    if (!s || typeof s.key !== 'string' || !s.key) { errs.push(`${at}: needs a 'key'.`); continue; }
    if (/[=;.]/.test(s.key)) errs.push(`${at}: the key can't contain = ; or a dot.`);
    if (statKeys.has(s.key)) errs.push(`${at}: the key is used twice.`);
    statKeys.add(s.key);
    if (!STAT_TYPES.includes(s.type)) errs.push(`${at}: type must be one of ${STAT_TYPES.join(', ')}.`);
    if (s.type === 'die' && (!Array.isArray(s.options) || !s.options.every(Number.isInteger))) errs.push(`${at}: a die stat needs 'options', like [6, 8, 10, 12].`);
  }

  const itemFields = new Set(['name']);
  if (game.items) {
    for (const [i, f] of (game.items.fields || []).entries()) {
      const at = `Item field ${i + 1}${f?.key ? ` '${f.key}'` : ''}`;
      if (!f || !f.key) { errs.push(`${at}: needs a 'key'.`); continue; }
      itemFields.add(f.key);
      if (!ITEM_FIELD_TYPES.includes(f.type)) errs.push(`${at}: type must be one of ${ITEM_FIELD_TYPES.join(', ')}.`);
      if (f.type === 'choice' && !Array.isArray(f.options)) errs.push(`${at}: a choice needs 'options'.`);
    }
  }

  if (!Array.isArray(game.rolls) || !game.rolls.length) { errs.push("Game needs at least one roll in 'rolls'."); return errs; }
  const rollIds = new Set();
  for (const [ri, r] of game.rolls.entries()) {
    const at = `Roll '${r?.name || r?.id || ri + 1}'`;
    if (!r || typeof r.id !== 'string' || !r.id) { errs.push(`${at}: needs an 'id'.`); continue; }
    if (rollIds.has(r.id)) errs.push(`${at}: the id '${r.id}' is used twice.`);
    rollIds.add(r.id);
    if (!r.name) errs.push(`${at}: needs a 'name'.`);

    const inputs = new Map();
    for (const [ii, inp] of (r.inputs || []).entries()) {
      const iat = `${at} → input ${ii + 1}${inp?.key ? ` '${inp.key}'` : ''}`;
      if (!inp || !inp.key) { errs.push(`${iat}: needs a 'key'.`); continue; }
      if (inputs.has(inp.key)) errs.push(`${iat}: the key is used twice.`);
      inputs.set(inp.key, inp);
      if (!INPUT_TYPES.includes(inp.type)) { errs.push(`${iat}: unknown type '${inp.type}'. Use one of ${INPUT_TYPES.join(', ')}.`); continue; }
      if (inp.type === 'stat' && inp.default && !statKeys.has(inp.default)) errs.push(`${iat}: default '${inp.default}' isn't one of the game's stats.`);
      if (inp.type === 'stat' && inp.group && !(game.stats || []).some((s) => s.group === inp.group)) errs.push(`${iat}: no stats are in group '${inp.group}'.`);
      if (inp.type === 'choice' && !Array.isArray(inp.options)) errs.push(`${iat}: a choice needs 'options'.`);
      if (inp.type === 'item' && !game.items) errs.push(`${iat}: an item input needs an 'items' section in the game.`);
    }

    const checkRef = (ref, where) => {
      if (typeof ref === 'number' || typeof ref === 'boolean') return;
      if (Array.isArray(ref)) { ref.forEach((x) => checkRef(x, where)); return; }
      if (typeof ref !== 'string') { errs.push(`${at} → ${where}: can't read ${JSON.stringify(ref)}.`); return; }
      if (/^-?\d+$/.test(ref)) return;
      const [head, a, b] = ref.split('.');
      const bad = (msg) => errs.push(`${at} → ${where}: '${ref}' ${msg}`);
      switch (head) {
        case 'input': if (!inputs.has(a)) bad(`— there's no input called '${a}'.`); break;
        case 'stat':
          if (!inputs.has(a)) bad(`— there's no input called '${a}'. To use one fixed stat, write 'stats.${a}'.`);
          else if (inputs.get(a).type !== 'stat') bad(`— input '${a}' isn't a stat picker.`);
          break;
        case 'stats': if (!statKeys.has(a)) bad(`— the game has no stat '${a}'.`); break;
        case 'item':
          if (!inputs.has(a) || inputs.get(a).type !== 'item') bad(`— '${a}' isn't an item input.`);
          else if (b && !itemFields.has(b)) bad(`— items have no field '${b}'.`);
          break;
        case 'roll': if (!ROLL_FIELDS.includes(a)) bad(`— use one of ${ROLL_FIELDS.map((f) => 'roll.' + f).join(', ')}.`); break;
        default: bad(`isn't a reference I know. Start it with input., stat., stats., item. or roll.`);
      }
    };
    const checkTemplate = (tpl, where) => {
      if (tpl == null) return;
      for (const m of String(tpl).matchAll(/\{([^}]*)\}/g)) checkRef(m[1].trim(), where);
    };

    if (r.dice === undefined) errs.push(`${at}: needs 'dice'.`);
    else if (Array.isArray(r.dice)) {
      r.dice.forEach((g, gi) => {
        if (!g || g.die === undefined) errs.push(`${at} → dice group ${gi + 1}: needs 'die'.`);
        else { checkRef(g.die, `dice group ${gi + 1}`); if (g.count !== undefined) checkRef(g.count, `dice group ${gi + 1}`); }
      });
    } else if (r.dice.expression !== undefined) checkRef(r.dice.expression, 'dice');
    else errs.push(`${at}: 'dice' must be a list of dice groups or { expression: ... }.`);

    (r.steps || []).forEach((st, si) => {
      const where = `step ${si + 1}`;
      const kinds = Object.keys(st || {}).filter((k) => k !== 'when');
      if (kinds.length !== 1) { errs.push(`${at} → ${where}: each step needs exactly one of ${STEP_TYPES.join(', ')}.`); return; }
      const [kind] = kinds;
      if (!STEP_TYPES.includes(kind)) { errs.push(`${at} → ${where}: unknown step '${kind}'. Known steps: ${STEP_TYPES.join(', ')}.`); return; }
      if (st.when !== undefined) checkRef(st.when, where);
      const arg = st[kind];
      if (kind === 'explode') {
        if (typeof arg !== 'object' || arg === null) errs.push(`${at} → ${where}: write explode as { atLeast: 10 }.`);
        else if (arg.atLeast !== undefined) { checkRef(arg.atLeast, where); if (typeof arg.atLeast === 'number' && arg.atLeast < 2) errs.push(`${at} → ${where}: exploding on ${arg.atLeast} would never stop.`); }
      } else if (kind === 'reroll') {
        if (typeof arg !== 'object' || arg === null || arg.atMost === undefined) errs.push(`${at} → ${where}: write reroll as { atMost: 1 }.`);
        else checkRef(arg.atMost, where);
      } else checkRef(arg, where);
    });

    const t = r.total ?? 'sum';
    if (typeof t === 'string') { if (!['sum', 'highest', 'lowest'].includes(t)) errs.push(`${at}: total '${t}' isn't known. Use 'sum', 'highest', 'lowest' or { successes: ... }.`); }
    else if (t && t.successes) {
      if (t.successes.atLeast === undefined) errs.push(`${at}: successes needs { atLeast: ... }.`);
      else checkRef(t.successes.atLeast, 'total');
      if (t.ones !== undefined && !ONES_RULES.includes(t.ones)) errs.push(`${at}: ones must be one of ${ONES_RULES.join(', ')}.`);
    } else errs.push(`${at}: total must be 'sum', 'highest', 'lowest' or { successes: ... }.`);

    if (r.modifier !== undefined) checkRef(r.modifier, 'modifier');
    checkTemplate(r.label, 'label');
    (r.values || []).forEach((v, vi) => {
      if (!v || !v.label) errs.push(`${at} → value ${vi + 1}: needs a 'label'.`);
      if (!v || v.value === undefined) errs.push(`${at} → value ${vi + 1}: needs a 'value'.`);
      else checkRef(v.value, `value '${v.label}'`);
      if (v?.suffix) checkTemplate(v.suffix, `value '${v.label}'`);
    });
    (r.flags || []).forEach((f, fi) => {
      const where = `flag ${f?.label ? `'${f.label}'` : fi + 1}`;
      if (!f || !f.label) errs.push(`${at} → ${where}: needs a 'label'.`);
      if (f?.style && !['good', 'bad', 'neutral'].includes(f.style)) errs.push(`${at} → ${where}: style must be good, bad or neutral.`);
      for (const [cond, v] of Object.entries(f?.when || {})) {
        if (!FLAG_CONDITIONS.includes(cond)) errs.push(`${at} → ${where}: unknown condition '${cond}'. Known: ${FLAG_CONDITIONS.join(', ')}.`);
        else checkRef(v, where);
      }
      if (f?.unless !== undefined) checkRef(f.unless, where);
    });
  }
  return errs;
}

// ---- backend.js ----
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

function standaloneBackend() {
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

// ---- app.js ----
// Panel UI. Everything game-specific comes from the game file; nothing here knows any one game.


/**
 * root    - element to render into
 * backend - standaloneBackend() or miroBackend()
 * games   - { list(): Promise<string[]>, load(id): Promise<game> }
 */
async function startApp(root, backend, games) {
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

// ---- backend-miro.js ----
// Miro backend: identity from Miro, dice tray as a shared board item, the board's game
// in board app data, characters and the permanent log in the Google Sheet (via Apps Script).
// If the sheet is unreachable or its script is out of date, characters fall back to this browser.


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

function miroBackend() {
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

export { startApp, standaloneBackend, miroBackend };
