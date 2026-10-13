// White Wolf style d10 dice pool. See games/README.md for how this format works.
//
// Pool = Attribute + Ability + extra dice, all d10s.
// Each die at or above the difficulty is a success. 10s explode (roll another d10, which can explode too).
// Each 1 cancels a success. No successes and at least one 1 = BOTCH.
// Spending Willpower adds one success that 1s can't cancel, and prevents a botch.
export default {
  id: 'white-wolf',
  name: 'White Wolf (d10 pool)',

  stats: [
    { key: 'Strength', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Dexterity', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Stamina', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Charisma', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Manipulation', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Appearance', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Perception', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Intelligence', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
    { key: 'Wits', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },

    { key: 'Alertness', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Athletics', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Brawl', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Dodge', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Empathy', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Intimidation', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Streetwise', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Subterfuge', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Drive', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Firearms', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Melee', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Stealth', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Survival', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Academics', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Investigation', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Medicine', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Occult', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },
    { key: 'Science', type: 'number', group: 'Abilities', default: 0, min: 0, max: 10 },

    { key: 'Willpower', type: 'number', group: 'Other', default: 3, min: 0, max: 10 },
  ],

  rolls: [
    {
      id: 'pool',
      name: 'Dice pool',
      inputs: [
        { key: 'attr', label: 'Attribute', type: 'stat', group: 'Attributes', default: 'Dexterity' },
        { key: 'ability', label: 'Ability', type: 'stat', group: 'Abilities', default: 'Athletics', optional: true },
        { key: 'extra', label: 'Extra dice', type: 'number', default: 0, min: -10, max: 10 },
        { key: 'diff', label: 'Difficulty', type: 'number', default: 6, min: 2, max: 10 },
        { key: 'wp', label: 'Spend Willpower (+1 success)', type: 'toggle', resetAfterRoll: true },
      ],
      dice: [
        { count: ['stat.attr', 'stat.ability', 'input.extra'], die: 10 },
      ],
      steps: [
        { explode: { atLeast: 10 } },
      ],
      total: { successes: { atLeast: 'input.diff' }, ones: 'subtract' },
      modifier: 'input.wp',
      label: '{input.attr}[ + {input.ability}][ ({input.extra} extra)], diff {input.diff}[ + Willpower{input.wp}]',
      flags: [
        { label: 'BOTCH', style: 'bad', when: { successes: 0, anyEqual: 1 }, unless: 'input.wp' },
      ],
    },

    {
      id: 'any',
      name: 'Any dice',
      inputs: [
        { key: 'expr', label: 'Dice (e.g. 5d10!)', type: 'text', default: '1d10',
          quick: ['1d10', '2d10', '1d6', '1d20'] },
      ],
      dice: { expression: 'input.expr' },
    },
  ],
};
