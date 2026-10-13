// Core dice engine. Game-agnostic. Runs in the browser or Node.
//
// A "pool" is an array of dice: { size, face, kept, extra?, exploded?, rerolledFrom?, sign? }
//   kept=false      -> dropped by keep/drop; shown in the log but not counted
//   extra=true      -> added by an explosion
//   exploded=true   -> this die triggered an explosion
//   rerolledFrom=n  -> this die was rerolled; n is the face it showed first

/** Default random source: crypto when available, Math.random otherwise. */
export function defaultRng() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

/** Roll one die of the given size. Returns an integer 1..size. */
export function rollDie(size, rng = defaultRng) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`Bad die size: ${size}`);
  return Math.floor(rng() * size) + 1;
}

/** Roll several dice. Returns [{ size, face }]. */
export function rollDice(sizes, rng = defaultRng) {
  return sizes.map((size) => ({ size, face: rollDie(size, rng) }));
}

/** Roll `count` dice of one size as a pool. */
export function makePool(count, size, rng = defaultRng, sign = 1) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ size, face: rollDie(size, rng), kept: true, sign });
  return out;
}

const EXPLODE_LIMIT = 100;

/** Every kept die showing `atLeast` or more adds another die of the same size; extras can explode too. */
export function explode(pool, atLeast, rng = defaultRng) {
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
export function reroll(pool, atMost, rng = defaultRng) {
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

export function keepHighest(pool, n) { rankKept(pool, true).slice(n).forEach((d) => (d.kept = false)); return pool; }
export function keepLowest(pool, n) { rankKept(pool, false).slice(n).forEach((d) => (d.kept = false)); return pool; }
export function dropHighest(pool, n) { rankKept(pool, true).slice(0, n).forEach((d) => (d.kept = false)); return pool; }
export function dropLowest(pool, n) { rankKept(pool, false).slice(0, n).forEach((d) => (d.kept = false)); return pool; }

const OPS = /!|(kh|kl|dh|dl)(\d+)/g;

/**
 * Parse a free-form dice expression like "2d6+3", "d8", "4d6kh3", "5d10!", "2d20kl1+4".
 * Suffixes on a dice term: ! (explode on max), khN, klN, dhN, dlN (keep/drop highest/lowest N).
 * Returns { terms: [{ count, size, sign, ops }], modifier }.
 */
export function parseExpression(text) {
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
export function rollExpression(text, rng = defaultRng) {
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
export function formatDice(dice) {
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
export function facesFor(pairs) {
  let i = 0;
  return function rng() {
    const p = pairs[i++];
    if (!p) throw new Error('facesFor ran out of faces');
    const [size, face] = p;
    return (face - 1 + 0.5) / size;
  };
}

/** Test helper: deterministic seeded rng (mulberry32). */
export function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
