import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syllabusIdFor, syllabusChapters } from '../src/lib/syllabus.js';
import { chemBranch } from '../src/lib/branches.js';
import { allocate } from '../src/lib/builder.js';

test('raw chapter names from the bank map onto standard JEE chapters', () => {
  const cases = [
    ['physics', 'Rain Problem', 'kinematics'],
    ['physics', 'Constraint Motion', 'laws-of-motion'],
    ['physics', 'Torque on Current Carrying Loop in Magnetic', 'magnetic-effects-of-current'],
    ['physics', 'De Broglie Wavelength', 'dual-nature-of-matter'],
    ['physics', 'Adaibaticproces', 'thermodynamics'],
    ['physics', 'Capillary Tube', 'properties-of-solids-and-liquids'],
    ['physics', 'Electromagnetic Induction', 'electromagnetic-induction'],
    ['chemistry', 'The P-Block Elements : Group No. 18 (Noble Gases)', 'p-block-elements'],
    ['chemistry', 'Chemical Kinetics & Radioactivity', 'chemical-kinetics'],
    ['chemistry', 'Isomerism in Coordination Compounds', 'coordination-compounds'],
    ['chemistry', 'Chemistry in Everyday Life & Poc', 'chemistry-in-everyday-life'],
    ['maths', 'Indefinite Integrals', 'indefinite-integration'],
    ['maths', 'Application of Integrals', 'area-under-curves'],
    ['maths', 'Different Products of Vectors and Their Geometrical Applications', 'vector-algebra'],
    ['maths', 'Direction Ratio and Direction Cosines', 'three-dimensional-geometry'],
    ['maths', 'Relation Between Root and Coefficient', 'quadratic-equations'],
  ];
  for (const [s, raw, id] of cases) assert.equal(syllabusIdFor(s, raw), id, `${s}: ${raw}`);
  for (const raw of [null, 'Question Bank', 'Lines and Angles', 'Knowing Our Numbers']) assert.equal(syllabusIdFor('maths', raw), null);
});

test('every rule points at a real chapter, and chemistry branches follow the units', () => {
  for (const s of ['physics', 'chemistry', 'maths']) assert.ok(syllabusChapters(s).length >= 25);
  assert.equal(chemBranch('Hydrogen'), 'inorganic');
  assert.equal(chemBranch('Surface Chemistry'), 'physical');
  assert.equal(chemBranch('Aldol Condensation'), 'organic');
  assert.equal(chemBranch('Question Bank'), null);
});

test('questions are split evenly without over-asking a small section', () => {
  assert.deepEqual(allocate(30, [100, 100, 100]), [10, 10, 10]);
  assert.deepEqual(allocate(30, [100, 4, 100]), [13, 4, 13]);
  assert.deepEqual(allocate(15, [3, 2, 0]), [3, 2, 0]);
  assert.equal(allocate(10, [5, 5, 5]).reduce((a, b) => a + b), 10);
});

import { train, predict, tokens } from '../src/lib/classifier.js';
import { weakChapters } from '../src/lib/analysis.js';

test('the text classifier learns chapters from words and LaTeX', () => {
  assert.ok(tokens('Evaluate $\\int_0^1 x\\,dx$').includes('int'));
  const docs = [];
  for (let i = 0; i < 20; i++) {
    docs.push({ text: `A projectile is thrown at angle ${i} with velocity u; find the range and maximum height`, label: 'kinematics' });
    docs.push({ text: `Two charges q${i} placed apart; find the electric field and potential at the midpoint`, label: 'electrostatics' });
    docs.push({ text: `An ideal gas undergoes an adiabatic process; find work done and change in internal energy ${i}`, label: 'thermodynamics' });
  }
  const m = train(docs, { minDf: 2 });
  assert.equal(predict(m, 'A ball is projected; what is its maximum height and range?').label, 'kinematics');
  assert.equal(predict(m, 'Find the electric potential due to two point charges').label, 'electrostatics');
  assert.equal(predict(m, 'In an adiabatic expansion of a gas the internal energy').label, 'thermodynamics');
  assert.equal(predict(m, 'zzz qqq').label, null);
});

test('weak spots come weakest first: weak, careless, improving, slow', () => {
  const c = (slug, verdict, accuracy) => ({ subject: 'physics', slug, chapter: slug, verdict, accuracy });
  const a = { chapters: [c('a', 'strong', 90), c('b', 'slow', 75), c('c', 'improving', 55), c('d', 'weak', 40), c('e', 'weak', 20), c('f', 'rushed', 35), c('g', null, null)] };
  assert.deepEqual(weakChapters(a).map((x) => x.slug), ['e', 'd', 'f', 'c', 'b']);
});
