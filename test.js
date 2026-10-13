// Run: node test.js
import assert from 'node:assert/strict';
import { rollDie, rollDice, parseExpression, rollExpression, facesFor, defaultRng } from './engine.js';
import { fabulaUltima, summarize } from './games/fabula-ultima.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ', name); }
  catch (e) { console.log('FAIL ', name, '\n     ', e.message); process.exitCode = 1; }
}

const check = fabulaUltima.rolls.check.resolve;
const damage = fabulaUltima.rolls.damage.resolve;
const plain = fabulaUltima.rolls.plain.resolve;

// ---------- engine ----------
test('rollDie stays in range for every size', () => {
  for (const size of [4, 6, 8, 10, 12, 20, 100]) {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const f = rollDie(size);
      assert.ok(f >= 1 && f <= size, `d${size} gave ${f}`);
      seen.add(f);
    }
    assert.equal(seen.size, size, `d${size} never showed every face`);
  }
});

test('facesFor yields exact faces', () => {
  const rng = facesFor([[6, 1], [6, 6], [12, 12], [8, 3]]);
  assert.deepEqual(rollDice([6, 6, 12, 8], rng).map((d) => d.face), [1, 6, 12, 3]);
});

test('parseExpression handles common forms', () => {
  assert.deepEqual(parseExpression('2d6+3'), { terms: [{ count: 2, size: 6, sign: 1 }], modifier: 3 });
  assert.deepEqual(parseExpression('d8'), { terms: [{ count: 1, size: 8, sign: 1 }], modifier: 0 });
  assert.deepEqual(parseExpression(' 3D10 - 1 '), { terms: [{ count: 3, size: 10, sign: 1 }], modifier: -1 });
  assert.deepEqual(parseExpression('1d6+1d8+2-1'), {
    terms: [{ count: 1, size: 6, sign: 1 }, { count: 1, size: 8, sign: 1 }], modifier: 1,
  });
});

test('parseExpression rejects junk', () => {
  for (const bad of ['', 'abc', '2d', 'd0', '0d6', '2d6+', '2d6 3', '+3']) {
    assert.throws(() => parseExpression(bad), undefined, `accepted "${bad}"`);
  }
});

test('rollExpression totals correctly', () => {
  const r = rollExpression('2d6+3', facesFor([[6, 4], [6, 5]]));
  assert.equal(r.total, 12);
  assert.equal(r.modifier, 3);
  assert.equal(r.dice.length, 2);
});

// ---------- Fabula Ultima: check ----------
const base = { attr1: 'DEX', die1: 8, attr2: 'INS', die2: 6 };

test('check sums dice plus modifier and reports HR', () => {
  const r = check({ ...base, modifier: 2 }, facesFor([[8, 7], [6, 3]]));
  assert.equal(r.total, 12);
  assert.equal(r.hr, 7);
  assert.equal(r.crit, false);
  assert.equal(r.fumble, false);
});

test('check: doubles of 6+ are a crit', () => {
  for (const f of [6, 7, 8]) {
    const r = check({ ...base, die1: 8, die2: 8 }, facesFor([[8, f], [8, f]]));
    assert.equal(r.crit, true, `double ${f} should crit`);
  }
});

test('check: doubles below 6 are not a crit', () => {
  for (const f of [2, 3, 4, 5]) {
    const r = check({ ...base, die1: 8, die2: 8 }, facesFor([[8, f], [8, f]]));
    assert.equal(r.crit, false, `double ${f} should not crit`);
  }
});

test('check: double 1 is a fumble, not a crit', () => {
  const r = check(base, facesFor([[8, 1], [6, 1]]));
  assert.equal(r.fumble, true);
  assert.equal(r.crit, false);
});

test('check: a single 1 is not a fumble', () => {
  const r = check(base, facesFor([[8, 1], [6, 4]]));
  assert.equal(r.fumble, false);
});

test('check: mismatched high faces are not a crit', () => {
  const r = check({ ...base, die1: 12, die2: 8 }, facesFor([[12, 8], [8, 7]]));
  assert.equal(r.crit, false);
  assert.equal(r.hr, 8);
});

test('check: negative modifier', () => {
  const r = check({ ...base, modifier: -3 }, facesFor([[8, 2], [6, 2]]));
  assert.equal(r.total, 1);
});

test('check: rejects a non-Fabula die size', () => {
  assert.throws(() => check({ ...base, die1: 20 }, facesFor([[20, 1], [6, 1]])));
});

// ---------- Fabula Ultima: damage ----------
test('damage = HR + weapon bonus, with type', () => {
  const r = damage({ ...base, modifier: 1, damageBonus: 6, damageType: 'fire' }, facesFor([[8, 5], [6, 6]]));
  assert.equal(r.total, 12);
  assert.equal(r.hr, 6);
  assert.equal(r.damage, 12);
  assert.equal(r.damageType, 'fire');
});

test('damage: crit still flagged', () => {
  const r = damage({ ...base, die1: 6, die2: 6, damageBonus: 4 }, facesFor([[6, 6], [6, 6]]));
  assert.equal(r.crit, true);
  assert.equal(r.damage, 10);
});

// ---------- plain ----------
test('plain roll through the game config', () => {
  const r = plain({ expression: '3d6', note: 'init' }, facesFor([[6, 1], [6, 2], [6, 3]]));
  assert.equal(r.total, 6);
  assert.equal(r.note, 'init');
});

// ---------- summaries ----------
test('summarize produces readable one-liners', () => {
  const c = check({ ...base, modifier: 1 }, facesFor([[8, 7], [6, 3]]));
  assert.equal(summarize(c), 'Check: DEX d8 + INS d6 +1 → 11 (HR 7) [d8:7 d6:3]');
  const crit = check({ ...base, die1: 8, die2: 8 }, facesFor([[8, 6], [8, 6]]));
  assert.ok(summarize(crit).endsWith('CRIT'));
  const d = damage({ ...base, damageBonus: 8 }, facesFor([[8, 4], [6, 2]]));
  assert.ok(summarize(d).endsWith('· 12 physical'));
});

// ---------- distribution sanity ----------
test('check averages land near expectation over many rolls', () => {
  let sum = 0, crits = 0, fumbles = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const r = check({ ...base, die1: 8, die2: 8 }, defaultRng);
    sum += r.total; if (r.crit) crits++; if (r.fumble) fumbles++;
  }
  const avg = sum / N;
  assert.ok(Math.abs(avg - 9) < 0.15, `avg d8+d8 was ${avg}, expected ~9`);
  // crit on d8+d8: doubles 6,7,8 → 3/64 ≈ 4.7%; fumble 1/64 ≈ 1.6%
  assert.ok(Math.abs(crits / N - 3 / 64) < 0.01, `crit rate ${crits / N}`);
  assert.ok(Math.abs(fumbles / N - 1 / 64) < 0.006, `fumble rate ${fumbles / N}`);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
