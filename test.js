// Run: node test.js
import assert from 'node:assert/strict';
import {
  rollDie, rollDice, parseExpression, rollExpression, facesFor, seededRng, defaultRng,
  makePool, explode, reroll, keepHighest, keepLowest, dropHighest, dropLowest, formatDice,
} from './engine.js';
import {
  resolveRoll, summarize, validateGame, fill, lookup, statsToText, statsFromText,
  itemsToText, itemsFromText, normalizeCharacter, newCharacter, defaultInputs, needsCharacter,
} from './rules.js';
import fabula from './games/fabula-ultima.js';
import ww from './games/white-wolf.js';
import gameList from './games/list.js';
import { fabulaUltima as legacy } from './test/fabula-legacy.js';
import { readFileSync } from 'node:fs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ', name); }
  catch (e) { console.log('FAIL ', name, '\n     ', e.message); process.exitCode = 1; }
}
const d = (size, ...faces) => faces.map((f) => [size, f]);
const faces = (pool) => pool.map((x) => x.face);

// ================================================================ engine
test('rollDie stays in range for every size', () => {
  for (const size of [4, 6, 8, 10, 12, 20, 100]) {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) { const f = rollDie(size); assert.ok(f >= 1 && f <= size); seen.add(f); }
    assert.equal(seen.size, size);
  }
});

test('facesFor yields exact faces', () => {
  assert.deepEqual(rollDice([6, 6, 12, 8], facesFor([[6, 1], [6, 6], [12, 12], [8, 3]])).map((x) => x.face), [1, 6, 12, 3]);
});

test('parseExpression handles common forms', () => {
  assert.deepEqual(parseExpression('2d6+3'), { terms: [{ count: 2, size: 6, sign: 1 }], modifier: 3 });
  assert.deepEqual(parseExpression('d8'), { terms: [{ count: 1, size: 8, sign: 1 }], modifier: 0 });
  assert.deepEqual(parseExpression(' 3D10 - 1 '), { terms: [{ count: 3, size: 10, sign: 1 }], modifier: -1 });
  assert.deepEqual(parseExpression('4d6kh3'), { terms: [{ count: 4, size: 6, sign: 1, ops: [{ op: 'kh', n: 3 }] }], modifier: 0 });
  assert.deepEqual(parseExpression('5d10!'), { terms: [{ count: 5, size: 10, sign: 1, ops: [{ op: 'explode' }] }], modifier: 0 });
  assert.deepEqual(parseExpression('2d20kl1+4').terms[0].ops, [{ op: 'kl', n: 1 }]);
});

test('parseExpression rejects junk', () => {
  for (const bad of ['', 'abc', '2d', 'd0', '0d6', '2d6+', '2d6 3', '+3', '4d6 kh3', 'd1!', '2d6kx1']) {
    assert.throws(() => parseExpression(bad), undefined, `accepted "${bad}"`);
  }
});

test('rollExpression: plain, keep highest, drop lowest, explode', () => {
  assert.equal(rollExpression('2d6+3', facesFor(d(6, 4, 5))).total, 12);
  const kh = rollExpression('4d6kh3', facesFor(d(6, 1, 5, 3, 6)));
  assert.equal(kh.total, 14);
  assert.equal(kh.dice.filter((x) => x.kept === false).length, 1);
  assert.equal(rollExpression('3d6dl1', facesFor(d(6, 2, 2, 6))).total, 8);
  assert.equal(rollExpression('2d20kl1+4', facesFor(d(20, 15, 3))).total, 7);
  const ex = rollExpression('2d10!', facesFor(d(10, 10, 3, 4)));
  assert.equal(ex.total, 17);
  assert.equal(ex.dice.length, 3);
});

test('explode chains and marks dice', () => {
  const rng = facesFor(d(10, 10, 5, 10, 2));
  const pool = explode(makePool(2, 10, rng), 10, rng);
  assert.deepEqual(faces(pool), [10, 10, 2, 5]);
  assert.deepEqual(pool.map((x) => !!x.extra), [false, true, true, false]);
  assert.deepEqual(pool.map((x) => !!x.exploded), [true, true, false, false]);
});

test('explode has a safety limit', () => {
  const pool = explode(makePool(1, 10, () => 0.99), 10, () => 0.99);
  assert.ok(pool.length <= 102);
});

test('reroll replaces low dice once and remembers the first face', () => {
  const rng = facesFor(d(6, 1, 4, 1));
  const pool = reroll(makePool(2, 6, rng), 1, rng);
  assert.deepEqual(faces(pool), [1, 4]); // rerolled 1 came up 1 again; only once
  assert.equal(pool[0].rerolledFrom, 1);
});

test('keep / drop highest and lowest, ties stable', () => {
  const mk = () => makePool(5, 6, facesFor(d(6, 3, 6, 1, 6, 2)));
  const kept = (p) => p.map((x) => (x.kept === false ? '-' : x.face)).join('');
  assert.equal(kept(keepHighest(mk(), 2)), '-6-6-');
  assert.equal(kept(keepLowest(mk(), 2)), '--1-2');
  assert.equal(kept(dropHighest(mk(), 1)), '3-162');
  assert.equal(kept(dropLowest(mk(), 2)), '36-6-');
});

test('formatDice marks explosions, drops and rerolls', () => {
  const pool = [
    { size: 10, face: 10, kept: true, exploded: true },
    { size: 10, face: 3, kept: false },
    { size: 6, face: 5, kept: true, rerolledFrom: 1 },
  ];
  assert.equal(formatDice(pool), 'd10:10! (d10:3) d6:5(r1)');
});

// ================================================================ Fabula
const brixus = { name: 'Brixus', stats: { DEX: 8, INS: 6, MIG: 10, WLP: 8 },
  items: [{ name: 'Greatsword', damage: 10, type: 'physical' }, { name: 'Fireball', damage: 6, type: 'fire' }] };
const fcheck = (inputs, rng, ch = brixus) => resolveRoll(fabula, 'check', inputs, ch, rng);
const flagNames = (r) => r.flags.map((f) => f.label);

test('Fabula check: sum + modifier, HR', () => {
  const r = fcheck({ attr1: 'DEX', attr2: 'INS', mod: 2 }, facesFor([[8, 7], [6, 3]]));
  assert.equal(r.total, 12);
  assert.equal(r.values[0].value, 7);
  assert.deepEqual(flagNames(r), []);
});

test('Fabula: doubles of 6+ crit, lower doubles do not', () => {
  const ch = { ...brixus, stats: { ...brixus.stats, MIG: 8 } };
  for (const f of [6, 7, 8]) assert.deepEqual(flagNames(fcheck({ attr1: 'DEX', attr2: 'MIG' }, facesFor([[8, f], [8, f]]), ch)), ['CRIT']);
  for (const f of [2, 3, 4, 5]) assert.deepEqual(flagNames(fcheck({ attr1: 'DEX', attr2: 'MIG' }, facesFor([[8, f], [8, f]]), ch)), []);
});

test('Fabula: double 1 fumbles, a single 1 does not', () => {
  assert.deepEqual(flagNames(fcheck({ attr1: 'DEX', attr2: 'INS' }, facesFor([[8, 1], [6, 1]]))), ['FUMBLE']);
  assert.deepEqual(flagNames(fcheck({ attr1: 'DEX', attr2: 'INS' }, facesFor([[8, 1], [6, 4]]))), []);
});

test('Fabula: mismatched high faces are not a crit; negative modifier', () => {
  const r = fcheck({ attr1: 'MIG', attr2: 'DEX' }, facesFor([[10, 8], [8, 7]]));
  assert.deepEqual(flagNames(r), []);
  assert.equal(fcheck({ attr1: 'DEX', attr2: 'INS', mod: -3 }, facesFor([[8, 2], [6, 2]])).total, 1);
});

test('Fabula attack: damage = HR + weapon, with type', () => {
  const r = resolveRoll(fabula, 'attack', { attr1: 'DEX', attr2: 'INS', mod: 1, weapon: 1 }, brixus, facesFor([[8, 5], [6, 6]]));
  assert.equal(r.total, 12);
  assert.equal(r.values[1].text, '12 fire');
  assert.equal(r.item, 'Fireball');
});

test('Fabula attack without a weapon gives a clear error', () => {
  assert.throws(() => resolveRoll(fabula, 'attack', {}, { ...brixus, items: [] }, defaultRng), /weapon \/ spell first/);
});

test('Fabula summaries read like before', () => {
  const r = fcheck({ attr1: 'DEX', attr2: 'INS', mod: 1 }, facesFor([[8, 7], [6, 3]]));
  assert.equal(summarize(r), 'Check: DEX d8 + INS d6 +1 → 11 (HR 7) [d8:7 d6:3]');
  const a = resolveRoll(fabula, 'attack', { attr1: 'DEX', attr2: 'INS', weapon: 0 }, brixus, facesFor([[8, 4], [6, 2]]));
  assert.equal(summarize(a), 'Attack: DEX d8 + INS d6 → 6 (HR 4, Damage 14 physical) [d8:4 d6:2]');
  const p = resolveRoll(fabula, 'any', { expr: '2d6+3' }, null, facesFor(d(6, 4, 5)));
  assert.equal(summarize(p), '2d6+3 → 12 [d6:4 d6:5]');
});

test('Fabula matches the old version on 6000 seeded rolls', () => {
  const sizes = [6, 8, 10, 12];
  const attrs = ['DEX', 'INS', 'MIG', 'WLP'];
  const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];
  const choose = seededRng(7);
  for (let i = 0; i < 6000; i++) {
    const stats = Object.fromEntries(attrs.map((a) => [a, pick(choose, sizes)]));
    const a1 = pick(choose, attrs), a2 = pick(choose, attrs);
    const mod = Math.floor(choose() * 9) - 4, dmg = Math.floor(choose() * 20);
    const kind = i % 2 ? 'damage' : 'check';
    const seed = 1000 + i;
    const old = legacy.rolls[kind].resolve(
      { attr1: a1, die1: stats[a1], attr2: a2, die2: stats[a2], modifier: mod, damageBonus: dmg, damageType: 'ice' }, seededRng(seed));
    const ch = { stats, items: [{ name: 'W', damage: dmg, type: 'ice' }] };
    const neu = resolveRoll(fabula, kind === 'check' ? 'check' : 'attack', { attr1: a1, attr2: a2, mod, weapon: 0 }, ch, seededRng(seed));
    assert.equal(neu.total, old.total, `total, roll ${i}`);
    assert.equal(neu.values[0].value, old.hr, `HR, roll ${i}`);
    assert.equal(flagNames(neu).includes('CRIT'), old.crit, `crit, roll ${i}`);
    assert.equal(flagNames(neu).includes('FUMBLE'), old.fumble, `fumble, roll ${i}`);
    if (kind === 'damage') assert.equal(neu.values[1].value, old.damage, `damage, roll ${i}`);
  }
});

test('Fabula crit and fumble rates land near 3/64 and 1/64 on d8+d8', () => {
  const ch = { stats: { DEX: 8, INS: 8, MIG: 8, WLP: 8 }, items: [] };
  let crits = 0, fumbles = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const f = flagNames(resolveRoll(fabula, 'check', { attr1: 'DEX', attr2: 'INS' }, ch));
    if (f.includes('CRIT')) crits++; if (f.includes('FUMBLE')) fumbles++;
  }
  assert.ok(Math.abs(crits / N - 3 / 64) < 0.01, `crit rate ${crits / N}`);
  assert.ok(Math.abs(fumbles / N - 1 / 64) < 0.006, `fumble rate ${fumbles / N}`);
});

// ================================================================ White Wolf
const vamp = { name: 'Lucita', stats: { Dexterity: 3, Athletics: 2, Wits: 2, Willpower: 4 }, items: [] };
const pool = (inputs, rng, ch = vamp) => resolveRoll(ww, 'pool', { attr: 'Dexterity', ability: 'Athletics', ...inputs }, ch, rng);

test('WW: successes at difficulty, 1s cancel', () => {
  const r = pool({}, facesFor(d(10, 7, 3, 6, 1, 9)));
  assert.equal(r.dice.length, 5);
  assert.equal(r.total, 2);
  assert.equal(r.totalLabel, 'successes');
  assert.deepEqual(flagNames(r), []);
});

test('WW: 10s explode and the extra dice count', () => {
  const r = pool({}, facesFor(d(10, 10, 4, 2, 8, 5, 7)));
  assert.equal(r.dice.length, 6);
  assert.equal(r.total, 3);
  assert.equal(formatDice(r.dice), 'd10:10! d10:7 d10:4 d10:2 d10:8 d10:5');
});

test('WW: explosions chain, and a 1 on an extra die still cancels', () => {
  const r = pool({}, facesFor(d(10, 10, 4, 2, 3, 5, 10, 1)));
  assert.equal(formatDice(r.dice), 'd10:10! d10:10! d10:1 d10:4 d10:2 d10:3 d10:5');
  assert.equal(r.total, 1); // 10, 10 = 2 successes, minus the 1 on the second extra die
});

test('WW: difficulty is variable', () => {
  assert.equal(pool({ diff: 8 }, facesFor(d(10, 7, 8, 9, 2, 3))).total, 2);
  assert.equal(pool({ diff: 4 }, facesFor(d(10, 7, 8, 9, 2, 4))).total, 4);
});

test('WW: botch is no successes plus a 1; cancelled successes are just a failure', () => {
  const b = pool({}, facesFor(d(10, 2, 1, 3, 4, 5)));
  assert.equal(b.total, 0);
  assert.deepEqual(flagNames(b), ['BOTCH']);
  const f = pool({}, facesFor(d(10, 7, 1, 3, 4, 5)));
  assert.equal(f.total, 0);
  assert.deepEqual(flagNames(f), []);
});

test('WW: Willpower adds a success and prevents the botch', () => {
  const r = pool({ wp: true }, facesFor(d(10, 2, 1, 3, 4, 5)));
  assert.equal(r.total, 1);
  assert.deepEqual(flagNames(r), []);
});

test('WW: extra dice and an empty ability change the pool', () => {
  assert.equal(pool({ extra: 2 }, facesFor(d(10, 1, 1, 1, 1, 1, 1, 1))).dice.length, 7);
  assert.equal(pool({ ability: '' }, facesFor(d(10, 6, 6, 6))).dice.length, 3);
  assert.throws(() => pool({ extra: -10 }, defaultRng), /no dice to roll/);
});

test('WW: labels leave out what is empty', () => {
  const rng = () => 0.5;
  assert.equal(pool({}, rng).label, 'Dexterity + Athletics, diff 6');
  assert.equal(pool({ extra: 2, diff: 7 }, rng).label, 'Dexterity + Athletics (2 extra), diff 7');
  assert.equal(pool({ ability: '', wp: true }, rng).label, 'Dexterity, diff 6 + Willpower');
});

test('WW: "subtract-not-extra" variant ignores 1s on extra dice', () => {
  const g = structuredClone(ww);
  g.rolls[0].total.ones = 'subtract-not-extra';
  const r = resolveRoll(g, 'pool', { attr: 'Dexterity', ability: 'Athletics' }, vamp, facesFor(d(10, 10, 4, 2, 3, 5, 10, 1)));
  assert.equal(r.total, 2);
});

test('WW: explosions always stop', () => {
  for (let i = 0; i < 3000; i++) pool({ extra: 5 }, seededRng(i));
});

// ================================================================ generic steps
const testGame = {
  id: 'test-game', name: 'Test',
  rolls: [{
    id: 'adv', name: 'Advantage',
    inputs: [{ key: 'adv', label: 'Advantage', type: 'toggle' }, { key: 'mod', type: 'number' }],
    dice: [{ count: 2, die: 20 }],
    steps: [{ keepHighest: 1, when: 'input.adv' }, { keepLowest: 1 }],
    modifier: 'input.mod',
    total: 'sum',
    flags: [{ label: 'NAT 20', style: 'good', when: { anyEqual: 20 } }],
  }],
};

test('steps run in order and "when" switches them on and off', () => {
  assert.deepEqual(validateGame(testGame), []);
  const on = resolveRoll(testGame, 'adv', { adv: true, mod: 3 }, null, facesFor(d(20, 5, 20)));
  assert.equal(on.total, 23);
  assert.deepEqual(flagNames(on), ['NAT 20']);
  const off = resolveRoll(testGame, 'adv', { adv: false }, null, facesFor(d(20, 5, 20)));
  assert.equal(off.total, 5); // only keepLowest ran
});

test('a dropped die does not trigger flags', () => {
  const r = resolveRoll(testGame, 'adv', { adv: false }, null, facesFor(d(20, 5, 20)));
  assert.deepEqual(flagNames(r), []);
});

// ================================================================ templates, refs, text formats
test('fill and lookup', () => {
  const ctx = { inputs: { a: 'DEX', n: 0, t: true, f: false }, character: { stats: { DEX: 8 } } };
  assert.equal(fill('{input.a} d{stat.a}', ctx), 'DEX d8');
  assert.equal(fill('x[ +{input.n}]', ctx), 'x');
  assert.equal(fill('x[ on{input.t}][ off{input.f}]', ctx), 'x on');
  assert.equal(lookup(['stats.DEX', 2, 'input.n'], ctx), 10);
  assert.throws(() => lookup('nope.x', ctx), /unknown reference/);
});

test('stats and items round-trip through the sheet text', () => {
  const t = statsToText(fabula, brixus.stats);
  assert.equal(t, 'DEX=d8; INS=d6; MIG=d10; WLP=d8');
  assert.deepEqual(statsFromText(t), brixus.stats);
  const it = itemsToText(fabula, brixus.items);
  assert.equal(it, 'Greatsword (damage=10, type=physical); Fireball (damage=6, type=fire)');
  assert.deepEqual(itemsFromText(it), brixus.items);
  assert.deepEqual(itemsFromText('Greatsword +10 physical; Fireball +15 fire'),
    [{ name: 'Greatsword', damage: 10, type: 'physical' }, { name: 'Fireball', damage: 15, type: 'fire' }]);
  assert.deepEqual(statsFromText(statsToText(ww, vamp.stats)).Dexterity, 3);
});

test('old saved characters convert', () => {
  const c = normalizeCharacter({ id: 'c1', name: 'Old', dice: { DEX: 10, INS: 8, MIG: 6, WLP: 8 }, weapons: [{ name: 'Axe', damage: 4, type: 'physical' }] });
  assert.equal(c.game, 'fabula-ultima');
  assert.equal(c.stats.DEX, 10);
  assert.equal(c.items[0].name, 'Axe');
});

test('new characters and default inputs come from the game', () => {
  const c = newCharacter(ww, { id: 'u', name: 'Sean' });
  assert.equal(c.stats.Willpower, 3);
  assert.equal(c.stats.Brawl, 0);
  assert.deepEqual(defaultInputs(ww.rolls[0]), { attr: 'Dexterity', ability: 'Athletics', extra: 0, diff: 6, wp: false });
  assert.equal(needsCharacter(ww.rolls[0]), true);
  assert.equal(needsCharacter(ww.rolls[1]), false);
});

// ================================================================ validation
test('every listed game file passes the checker', () => {
  for (const id of gameList) {
    const src = readFileSync(`./games/${id}.js`, 'utf8');
    assert.ok(!/^\s*import\s/m.test(src), `${id}.js must not import anything`);
  }
  assert.deepEqual(validateGame(fabula), []);
  assert.deepEqual(validateGame(ww), []);
  assert.deepEqual(gameList, ['fabula-ultima', 'white-wolf']);
});

test('the checker explains mistakes in plain English', () => {
  const bad = structuredClone(ww);
  bad.id = 'Bad Id';
  bad.rolls[0].steps = [{ explod: { atLeast: 10 } }, { explode: { atLeast: 1 } }];
  bad.rolls[0].dice[0].count = ['stat.Dexterity', 'input.extras'];
  bad.rolls[0].inputs.push({ key: 'x', type: 'slider' });
  bad.rolls[0].flags[0].when.succeses = 0;
  bad.rolls[0].total.ones = 'cancel';
  bad.rolls[1].total = 'average';
  const errs = validateGame(bad).join('\n');
  for (const want of [
    "Game 'id' must be lowercase",
    "unknown step 'explod'",
    'exploding on 1 would never stop',
    "'stat.Dexterity' — there's no input called 'Dexterity'. To use one fixed stat, write 'stats.Dexterity'.",
    "'input.extras' — there's no input called 'extras'.",
    "unknown type 'slider'",
    "unknown condition 'succeses'",
    'ones must be one of',
    "total 'average' isn't known",
  ]) assert.ok(errs.includes(want), `missing: ${want}\n---\n${errs}`);
});

// ================================================================ the guide's example works
const readme = readFileSync('./games/README.md', 'utf8');
const exampleSrc = readme.match(/```js\n(export default \{\n  id: 'd20-basic'[\s\S]*?)```/)[1];
const d20 = (await import('data:text/javascript,' + encodeURIComponent(exampleSrc))).default;

test("the guide's d20 example passes the checker and rolls right", () => {
  assert.deepEqual(validateGame(d20), []);
  const hero = { stats: { STR: 3, DEX: 1, WIS: 0 }, items: [] };
  const plain = resolveRoll(d20, 'check', { stat: 'STR', bonus: 2 }, hero, facesFor(d(20, 11)));
  assert.equal(plain.dice.length, 1);
  assert.equal(plain.total, 16);
  assert.equal(plain.label, 'STR check');
  const adv = resolveRoll(d20, 'check', { stat: 'STR', adv: true }, hero, facesFor(d(20, 4, 20)));
  assert.equal(adv.total, 23);
  assert.equal(adv.label, 'STR check with advantage');
  assert.deepEqual(flagNames(adv), ['NAT 20']);
  const dis = resolveRoll(d20, 'check', { stat: 'STR', dis: true }, hero, facesFor(d(20, 4, 20)));
  assert.equal(dis.total, 7);
  assert.deepEqual(flagNames(dis), []);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
