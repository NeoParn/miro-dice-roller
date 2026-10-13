// Rules interpreter: turns a hand-written game file (plain data) into rolls.
// The format is documented in games/README.md. Nothing in here is specific to one game.
import {
  defaultRng, makePool, explode, reroll, keepHighest, keepLowest, dropHighest, dropLowest,
  rollExpression, formatDice,
} from './engine.js';

export const STAT_TYPES = ['die', 'number'];
export const INPUT_TYPES = ['stat', 'number', 'choice', 'toggle', 'item', 'text'];
export const ITEM_FIELD_TYPES = ['number', 'choice', 'text'];
export const STEP_TYPES = ['explode', 'reroll', 'keepHighest', 'keepLowest', 'dropHighest', 'dropLowest'];
export const FLAG_CONDITIONS = ['allSame', 'allAtLeast', 'allEqual', 'anyEqual', 'anyAtLeast', 'successes', 'totalAtLeast', 'totalAtMost'];
export const ROLL_FIELDS = ['total', 'sum', 'highest', 'lowest', 'count', 'successes', 'ones'];
export const ONES_RULES = ['ignore', 'subtract', 'subtract-not-extra'];

export class RuleError extends Error {}

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
export function lookup(ref, ctx) {
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
export function fill(template, ctx) {
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
export function defaultInputs(roll) {
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
export function needsCharacter(roll) {
  const text = JSON.stringify(roll);
  return (roll.inputs || []).some((i) => i.type === 'stat' || i.type === 'item') || /"(stats?|item)\./.test(text);
}

/**
 * Roll one of a game's rolls.
 * Returns { rollId, rollName, label, dice, modifier, modifierShown, total, totalLabel, values, flags, item }.
 */
export function resolveRoll(game, rollId, inputs, character, rng = defaultRng) {
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
export function summarize(r) {
  let s = `${r.label}${fmtMod(r.modifierShown)} → ${r.total}${r.totalLabel ? ' ' + r.totalLabel : ''}`;
  if (r.values.length) s += ` (${r.values.map((v) => `${v.label} ${v.text}`).join(', ')})`;
  s += ` [${formatDice(r.dice)}]`;
  if (r.flags.length) s += ' ' + r.flags.map((f) => f.label).join(' ');
  return s;
}

// ---------------------------------------------------------------- characters

export function newCharacter(game, user) {
  const stats = {};
  for (const s of game.stats || []) stats[s.key] = s.default ?? (s.type === 'die' ? (s.options || [6])[0] : 0);
  return { id: '', ownerId: user.id, ownerName: user.name, game: game.id, name: '', stats, items: [] };
}

export function newItem(game) {
  const it = { name: '' };
  for (const f of game.items?.fields || []) it[f.key] = f.default ?? (f.type === 'number' ? 0 : f.type === 'choice' ? (f.options || [])[0] : '');
  return it;
}

/** Older saved characters (Fabula-only format) -> current format. */
export function normalizeCharacter(c) {
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
export function statsToText(game, stats) {
  return (game.stats || []).map((s) => `${s.key}=${s.type === 'die' ? 'd' : ''}${stats[s.key] ?? ''}`).join('; ');
}
export function statsFromText(text) {
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
export function itemsToText(game, items) {
  const fields = game.items?.fields || [];
  return (items || []).map((it) => fields.length
    ? `${it.name} (${fields.map((f) => `${f.key}=${it[f.key] ?? ''}`).join(', ')})`
    : it.name).join('; ');
}
export function itemsFromText(text) {
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
export function validateGame(game) {
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
