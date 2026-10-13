// Fabula Ultima. See games/README.md for how this format works.
export default {
  id: 'fabula-ultima',
  name: 'Fabula Ultima',

  stats: [
    { key: 'DEX', label: 'DEX', type: 'die', options: [6, 8, 10, 12], default: 8 },
    { key: 'INS', label: 'INS', type: 'die', options: [6, 8, 10, 12], default: 8 },
    { key: 'MIG', label: 'MIG', type: 'die', options: [6, 8, 10, 12], default: 8 },
    { key: 'WLP', label: 'WLP', type: 'die', options: [6, 8, 10, 12], default: 8 },
  ],

  items: {
    label: 'Weapons / spells',
    fields: [
      { key: 'damage', label: 'Dmg', type: 'number', default: 0, min: 0, max: 99 },
      { key: 'type', label: 'Type', type: 'choice', default: 'physical',
        options: ['physical', 'air', 'bolt', 'dark', 'earth', 'fire', 'ice', 'light', 'poison'] },
    ],
  },

  rolls: [
    {
      id: 'check',
      name: 'Check',
      inputs: [
        { key: 'attr1', label: 'Attribute 1', type: 'stat', default: 'DEX' },
        { key: 'attr2', label: 'Attribute 2', type: 'stat', default: 'INS' },
        { key: 'mod', label: 'Modifier', type: 'number', default: 0, min: -10, max: 10 },
      ],
      dice: [
        { die: 'stat.attr1' },
        { die: 'stat.attr2' },
      ],
      total: 'sum',
      modifier: 'input.mod',
      label: 'Check: {input.attr1} d{stat.attr1} + {input.attr2} d{stat.attr2}',
      values: [
        { label: 'HR', value: 'roll.highest' },
      ],
      flags: [
        { label: 'CRIT', style: 'good', when: { allSame: true, allAtLeast: 6 } },
        { label: 'FUMBLE', style: 'bad', when: { allEqual: 1 } },
      ],
    },

    {
      id: 'attack',
      name: 'Attack / Damage',
      inputs: [
        { key: 'attr1', label: 'Attribute 1', type: 'stat', default: 'DEX' },
        { key: 'attr2', label: 'Attribute 2', type: 'stat', default: 'MIG' },
        { key: 'mod', label: 'Accuracy modifier', type: 'number', default: 0, min: -10, max: 10 },
        { key: 'weapon', label: 'Weapon / spell', type: 'item' },
      ],
      dice: [
        { die: 'stat.attr1' },
        { die: 'stat.attr2' },
      ],
      total: 'sum',
      modifier: 'input.mod',
      label: 'Attack: {input.attr1} d{stat.attr1} + {input.attr2} d{stat.attr2}',
      values: [
        { label: 'HR', value: 'roll.highest' },
        { label: 'Damage', value: ['roll.highest', 'item.weapon.damage'], suffix: '{item.weapon.type}' },
      ],
      flags: [
        { label: 'CRIT', style: 'good', when: { allSame: true, allAtLeast: 6 } },
        { label: 'FUMBLE', style: 'bad', when: { allEqual: 1 } },
      ],
    },

    {
      id: 'any',
      name: 'Any dice',
      inputs: [
        { key: 'expr', label: 'Dice (e.g. 2d6+3)', type: 'text', default: '1d6',
          quick: ['1d6', '1d8', '1d10', '1d12', '1d20', '2d6', '1d100'] },
      ],
      dice: { expression: 'input.expr' },
    },
  ],
};
