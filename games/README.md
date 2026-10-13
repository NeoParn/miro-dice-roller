# Writing a game file

Each game the dice roller knows is one file in this `games` folder. A game file is a fill-in-the-blanks description of the game's characters and rolls. The panel builds its buttons, character sheet, dice tray text and log entries from it.

You don't need to program. You do need to follow the punctuation exactly: quotes around words, commas between items, matching `{ }` and `[ ]`. The quickest route is to copy a file that's close to what you want and change it.

- [fabula-ultima.js](fabula-ultima.js): two attribute dice, crits on doubles, weapons with damage.
- [white-wolf.js](white-wolf.js): a pool of d10s counting successes, exploding 10s, 1s cancelling.
- The d20 example at the end of this guide: one d20 plus a modifier, with advantage and disadvantage.

## Adding a game

1. Open an existing game file on GitHub, click the copy icon (top right of the file), and paste it into a text editor.
2. Change `id` and `name`, then edit the stats and rolls (the sections below explain each part).
3. In the `games` folder on GitHub, click **Add file → Create new file**. Name it after your `id`, for example `my-game.js`, paste your text, and click **Commit changes**.
4. Open [list.js](list.js), click the pencil icon, add your id on its own line (`'my-game',`), and commit.
5. About a minute later, open the panel on a board, click the game name at the top left, and pick your game.

If something is wrong with the file, the game picker shows the problems in plain English and the other games keep working. To fix a file, open it on GitHub, click the pencil icon, edit, and commit again. You can also paste a file into a chat with Claude and ask for it to be checked first.

## The shape of a game file

```js
export default {
  id: 'my-game',            // lowercase letters, numbers, dashes; same as the file name
  name: 'My Game',          // what the panel shows

  stats: [ ... ],           // what goes on a character sheet
  items: { ... },           // optional: weapons, spells, gear with numbers attached
  rolls: [ ... ],           // the roll types, one tab each in the panel
};
```

Text after `//` on a line is a comment; the panel ignores it. A game file must not contain `import` lines.

## Stats

Each stat is one box on the character sheet.

```js
stats: [
  { key: 'DEX', label: 'DEX', type: 'die', options: [6, 8, 10, 12], default: 8 },
  { key: 'Strength', type: 'number', group: 'Attributes', default: 1, min: 0, max: 10 },
],
```

| Field | Meaning |
|---|---|
| `key` | The stat's name, used everywhere else to refer to it. No `=`, `;` or dots. |
| `label` | Optional. What the panel shows, if different from `key`. |
| `type` | `'die'`: the stat is a die size, picked from `options`, shown as d8. `'number'`: the stat is a number. |
| `options` | Die stats only: the sizes it can be. |
| `default` | Value for a new character. |
| `min`, `max` | Number stats only: limits in the editor. |
| `group` | Optional heading. Stats with the same group are shown together, and a stat picker can be limited to one group. |

## Items

Optional. Use this when characters carry things with numbers attached, such as weapons or spells. Every item gets a name plus the fields you list.

```js
items: {
  label: 'Weapons / spells',
  fields: [
    { key: 'damage', label: 'Dmg', type: 'number', default: 0 },
    { key: 'type', label: 'Type', type: 'choice', options: ['physical', 'fire', 'ice'], default: 'physical' },
  ],
},
```

Field types are `'number'`, `'choice'` (needs `options`) and `'text'`.

## Rolls

Each roll becomes a tab in the panel.

```js
{
  id: 'check',                        // unique within this game
  name: 'Check',                      // the tab name
  inputs: [ ... ],                    // the controls the player sets before rolling
  dice: [ ... ],                      // what gets rolled
  steps: [ ... ],                     // optional: explode, reroll, keep or drop dice
  total: 'sum',                       // how dice become a result
  modifier: 'input.mod',              // optional: added to the total
  label: 'Check: {input.attr1} ...',  // optional: how the roll is described in the log
  values: [ ... ],                    // optional: extra results, like HR or damage
  flags: [ ... ],                     // optional: CRIT, FUMBLE, BOTCH and the like
}
```

### Inputs

| `type` | What the player sees | The value it holds |
|---|---|---|
| `'stat'` | Buttons for each stat (a dropdown if there are more than 12). Add `group: 'Abilities'` to show only one group, and `optional: true` to add a "none" choice. | The stat's key, e.g. `'DEX'` |
| `'number'` | A − / + stepper. Use `min`, `max` and `default`. | A number |
| `'toggle'` | A checkbox. Add `resetAfterRoll: true` to untick it after each roll. | On or off (counts as 1 or 0) |
| `'choice'` | A dropdown of `options`. | The chosen option |
| `'item'` | A dropdown of the character's items. | Which item |
| `'text'` | A text box. Add `quick: ['1d6', '2d6']` for one-click buttons. | The text |

Every input needs a `key` (unique within the roll) and should have a `label`.

### References

Anywhere a roll needs a number or a piece of text, you can write a reference:

| Write | You get |
|---|---|
| `5` | The number 5 |
| `'input.mod'` | The value of the input with key `mod` |
| `'stat.attr1'` | The character's value for the stat **picked in** input `attr1` |
| `'stats.Willpower'` | The character's value for the stat **named** `Willpower` |
| `'item.weapon'` | The name of the item picked in input `weapon` |
| `'item.weapon.damage'` | The `damage` field of that item |
| `'roll.highest'` | A result: `total`, `sum`, `highest`, `lowest`, `count` (dice kept), `successes`, `ones` |
| `['stat.attr', 'stat.ability', 'input.extra']` | All of those added together |

`stat.` (singular) means "whichever stat the player picked"; `stats.` (plural) means "this particular stat". Mixing them up is the most common mistake, and the checker will point it out.

### Dice

A list of dice groups. Each group has a `die` (the size) and an optional `count` (default 1). Both can be references.

```js
dice: [ { die: 'stat.attr1' }, { die: 'stat.attr2' } ],                      // one die per picked stat (Fabula)
dice: [ { count: ['stat.attr', 'stat.ability', 'input.extra'], die: 10 } ],   // a pool of d10s (White Wolf)
dice: [ { count: 2, die: 20 } ],                                              // 2d20
```

For a "type any dice" roll, use an expression instead:

```js
dice: { expression: 'input.expr' },
```

An expression is standard dice notation with no spaces between a die and its suffix: `2d6+3`, `d20`, `3d6-1d4`, plus these suffixes:

| Suffix | Meaning | Example |
|---|---|---|
| `!` | Explode: every max roll adds another die | `5d10!` |
| `khN` / `klN` | Keep the highest / lowest N | `4d6kh3`, `2d20kl1` |
| `dhN` / `dlN` | Drop the highest / lowest N | `3d6dl1` |

### Steps

Steps change the dice after they're rolled, in the order you list them. Dropped dice still show in the log, in brackets, but don't count.

| Step | Meaning |
|---|---|
| `{ explode: { atLeast: 10 } }` | Each die showing 10 or more adds another die of the same size; the new die can explode too. Leave out `atLeast` to explode on the die's maximum. |
| `{ reroll: { atMost: 1 } }` | Reroll, once, each die showing 1 or less. |
| `{ keepHighest: 1 }` | Keep only the highest N dice. |
| `{ keepLowest: 1 }` | Keep only the lowest N dice. |
| `{ dropHighest: 1 }` | Drop the highest N dice. |
| `{ dropLowest: 1 }` | Drop the lowest N dice. |

Add `when: 'input.something'` to a step to run it only when that input is on (or non-zero):

```js
steps: [ { keepHighest: 1, when: 'input.advantage' } ],
```

The number in a step can be a reference too: `{ keepHighest: 'input.keep' }`.

### Total

| `total` | Result |
|---|---|
| `'sum'` (the default) | Kept dice added up, plus `modifier` |
| `'highest'` / `'lowest'` | The single highest / lowest kept die, plus `modifier` |
| `{ successes: { atLeast: 'input.diff' } }` | The number of kept dice at or above the target, plus `modifier` |

A successes total can also set `ones`:

- `ones: 'subtract'`: each 1 cancels a success, including 1s on dice added by explosions.
- `ones: 'subtract-not-extra'`: same, but 1s on exploded extra dice don't cancel.
- `ones: 'ignore'` (the default): 1s do nothing.

The result never drops below 0 from cancelling. `modifier` is added after cancelling, so it works as automatic successes. For success rolls the summary doesn't print the modifier, so mention it in the `label` instead.

### Label

How the roll is described in the log, the tray and the sheet. Put references in `{curly braces}`:

```js
label: 'Check: {input.attr1} d{stat.attr1} + {input.attr2} d{stat.attr2}',
```

Wrap a part in `[square brackets]` to leave it out when a reference inside it is empty, 0, or a toggle that's off. A toggle that's on prints nothing itself but keeps its bracketed part:

```js
label: '{input.attr}[ + {input.ability}][ ({input.extra} extra)], diff {input.diff}[ + Willpower{input.wp}]',
// "Dexterity + Athletics, diff 6"   or   "Dexterity (2 extra), diff 7 + Willpower"
```

Without a label, the roll's `name` is used (or, for expression rolls, the expression itself). For rolls that aren't success counts, a non-zero modifier is added automatically: `Check: DEX d8 + INS d6 +1`.

### Values

Extra results shown next to the total:

```js
values: [
  { label: 'HR', value: 'roll.highest' },
  { label: 'Damage', value: ['roll.highest', 'item.weapon.damage'], suffix: '{item.weapon.type}' },
],
```

`suffix` is text shown after the number and works like a label. This example gives "HR 7, Damage 17 fire".

### Flags

Flags are the shouted words: CRIT, FUMBLE, BOTCH, NAT 20. A flag shows when **all** of its conditions are true. `style: 'good'` colors the tray green and `'bad'` colors it red.

```js
flags: [
  { label: 'CRIT', style: 'good', when: { allSame: true, allAtLeast: 6 } },
  { label: 'BOTCH', style: 'bad', when: { successes: 0, anyEqual: 1 }, unless: 'input.wp' },
],
```

| Condition | True when |
|---|---|
| `allSame: true` | Every kept die shows the same face (needs at least two dice) |
| `allAtLeast: N` | Every kept die is N or higher |
| `allEqual: N` | Every kept die shows N |
| `anyEqual: N` | At least one kept die shows N |
| `anyAtLeast: N` | At least one kept die is N or higher |
| `successes: N` | The count of successes, before 1s cancel, is exactly N |
| `totalAtLeast: N` / `totalAtMost: N` | The final total is at least / at most N |

`unless: 'input.something'` hides the flag when that input is on. N can be a reference.

## Example: d20 plus modifier, with advantage

```js
export default {
  id: 'd20-basic',
  name: 'd20 + modifier',

  stats: [
    { key: 'STR', type: 'number', default: 0, min: -5, max: 10 },
    { key: 'DEX', type: 'number', default: 0, min: -5, max: 10 },
    { key: 'WIS', type: 'number', default: 0, min: -5, max: 10 },
  ],

  rolls: [
    {
      id: 'check',
      name: 'Check',
      inputs: [
        { key: 'stat', label: 'Stat', type: 'stat', default: 'STR' },
        { key: 'bonus', label: 'Bonus', type: 'number', default: 0, min: -10, max: 10 },
        { key: 'adv', label: 'Advantage', type: 'toggle', resetAfterRoll: true },
        { key: 'dis', label: 'Disadvantage', type: 'toggle', resetAfterRoll: true },
      ],
      dice: [ { count: [1, 'input.adv', 'input.dis'], die: 20 } ],   // 1 die, or 2 with a box ticked
      steps: [
        { keepHighest: 1, when: 'input.adv' },
        { keepLowest: 1, when: 'input.dis' },
      ],
      total: 'sum',
      modifier: ['stat.stat', 'input.bonus'],
      label: '{input.stat} check[ with advantage{input.adv}][ with disadvantage{input.dis}]',
      flags: [
        { label: 'NAT 20', style: 'good', when: { allEqual: 20 } },
        { label: 'NAT 1', style: 'bad', when: { allEqual: 1 } },
      ],
    },
    {
      id: 'any',
      name: 'Any dice',
      inputs: [ { key: 'expr', label: 'Dice', type: 'text', default: '1d20', quick: ['1d20', '1d6', '2d6', '1d8'] } ],
      dice: { expression: 'input.expr' },
    },
  ],
};
```

A toggle counts as 1 when ticked, so the dice count is 1 normally and 2 with advantage or disadvantage; the step then keeps the right die.

## When something goes wrong

| What you see | Usually means |
|---|---|
| `Couldn't load games/my-game.js: Unexpected token` (or `Unexpected identifier`) | A punctuation slip: a missing comma between items, a missing quote, or an extra or missing bracket. Check the lines you changed most recently. |
| `Couldn't load games/my-game.js: Failed to fetch` | The file name doesn't match the id in `list.js`, or the upload hasn't finished yet (wait a minute). |
| `'stat.Dexterity' — there's no input called 'Dexterity'` | Use `stats.Dexterity` for a fixed stat; `stat.` is for the stat a player picked. |
| `there's no input called 'extras'` | A typo in a reference, or the input's `key` is spelled differently. |
| `unknown step`, `unknown condition`, `unknown type` | A typo in a step, condition or input type. The message lists the valid names. |
| `Can't roll: there are no dice to roll` | The pool added up to 0, often a stat left at 0 or a big negative modifier. |
| `Can't roll: pick a weapon / spell first` | The roll uses an item input and the character has no items. |

## What the format can't do yet

These need new building blocks, so ask Claude to add one:

- Opposed rolls between two players
- Choosing which dice count after seeing them
- Cards, tokens or other non-dice randomizers
- Results looked up on a table (for example, "11–15 means partial success")

Once a building block is added, every game can use it.
