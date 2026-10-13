// Fabula Ultima game config.
// A game config is: { id, name, attributes, dieSizes, rolls: { <rollType>: { label, inputs, resolve } } }
// The UI builds its controls from `inputs`; the engine calls `resolve(values, rng)`.

import { rollDice, rollExpression } from '../engine.js';

export const ATTRIBUTES = ['DEX', 'INS', 'MIG', 'WLP'];
export const DIE_SIZES = [6, 8, 10, 12];
export const DAMAGE_TYPES = [
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

export const fabulaUltima = {
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
export function summarize(result) {
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

export default fabulaUltima;
