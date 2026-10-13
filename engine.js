// Core dice engine. Game-agnostic. Runs in the browser or Node.

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

/**
 * Parse a free-form dice expression like "2d6+3", "d8", "3d10-1", "4d6+2d8+1".
 * Returns { terms: [{ count, size }], modifier }.
 */
export function parseExpression(text) {
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
export function rollExpression(text, rng = defaultRng) {
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
export function facesFor(pairs) {
  let i = 0;
  return function rng() {
    const p = pairs[i++];
    if (!p) throw new Error('facesFor ran out of faces');
    const [size, face] = p;
    return (face - 1 + 0.5) / size;
  };
}
