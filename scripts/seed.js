#!/usr/bin/env node
/**
 * Seeds a handful of sample questions so the app works before the real import.
 * Safe to re-run (matches on source "sample").
 */
import { MongoClient } from 'mongodb';
import { mongoUri } from '../server/src/lib/mongoUri.js';

const uri = mongoUri(); // local unless USE_ATLAS=1
const dbName = process.env.DB_NAME || 'jee_arena';

const S = (subject, chapter, difficulty, type, text, options, answer, solution, pyq) => ({
  subject, chapter, difficulty, type, text,
  options: options ? options.map((t, i) => ({ key: 'ABCD'[i], text: t })) : [],
  answer, solution, pyq, status: 'published',
});

const samples = [
  S('physics', 'Kinematics', 'easy', 'single',
    'A body starts from rest with uniform acceleration $a = 2\\,\\text{m/s}^2$. The distance covered in the first $5\\,\\text{s}$ is:',
    ['10 m', '20 m', '25 m', '50 m'], { keys: ['C'] },
    'Using $s = ut + \\tfrac12 at^2 = 0 + \\tfrac12 (2)(5^2) = 25\\,\\text{m}$.'),
  S('physics', 'Laws of Motion', 'medium', 'single',
    'A block of mass $2\\,\\text{kg}$ rests on a rough surface with $\\mu = 0.5$. The minimum horizontal force needed to move it is ($g = 10\\,\\text{m/s}^2$):',
    ['5 N', '10 N', '15 N', '20 N'], { keys: ['B'] },
    'Limiting friction $f = \\mu mg = 0.5 \\times 2 \\times 10 = 10\\,\\text{N}$.'),
  S('physics', 'Work, Energy and Power', 'medium', 'numerical',
    'A $1\\,\\text{kg}$ ball is dropped from a height of $20\\,\\text{m}$. Its speed (in m/s) just before hitting the ground is ($g=10\\,\\text{m/s}^2$):',
    null, { value: 20 }, '$v = \\sqrt{2gh} = \\sqrt{400} = 20\\,\\text{m/s}$.'),
  S('physics', 'Electrostatics', 'hard', 'multi',
    'For a uniformly charged conducting sphere, which of the following are correct?',
    ['Electric field inside is zero', 'Potential inside is zero', 'Charge resides on the surface', 'Field just outside is $\\sigma/\\varepsilon_0$'],
    { keys: ['A', 'C', 'D'] },
    'Inside a conductor $E=0$ and the potential is constant (equal to the surface value, not zero). Charge sits on the surface and $E = \\sigma/\\varepsilon_0$ just outside.'),
  S('chemistry', 'Mole Concept', 'easy', 'single',
    'The number of moles in $22\\,\\text{g}$ of $\\text{CO}_2$ is:',
    ['0.25', '0.5', '1', '2'], { keys: ['B'] }, 'Molar mass of $\\text{CO}_2 = 44$; $22/44 = 0.5$ mol.'),
  S('chemistry', 'Chemical Bonding', 'medium', 'single',
    'The hybridisation of carbon in $\\text{CH}_4$ is:',
    ['$sp$', '$sp^2$', '$sp^3$', '$sp^3d$'], { keys: ['C'] }, 'Four σ bonds, no lone pairs → $sp^3$.', { exam: 'JEE Main', year: 2022 }),
  S('chemistry', 'Chemical Kinetics', 'medium', 'numerical',
    'A first-order reaction has $k = 0.693\\,\\text{min}^{-1}$. Its half-life in minutes is:',
    null, { value: 1 }, '$t_{1/2} = 0.693/k = 1\\,\\text{min}$.'),
  S('chemistry', 'Thermodynamics', 'hard', 'single',
    'For a spontaneous process at constant $T$ and $P$:',
    ['$\\Delta G > 0$', '$\\Delta G < 0$', '$\\Delta S < 0$ always', '$\\Delta H > 0$ always'], { keys: ['B'] },
    'Spontaneity at constant $T, P$ requires $\\Delta G < 0$.'),
  S('maths', 'Quadratic Equations', 'easy', 'single',
    'The sum of the roots of $x^2 - 5x + 6 = 0$ is:',
    ['-5', '5', '6', '-6'], { keys: ['B'] }, 'Sum of roots $= -b/a = 5$.'),
  S('maths', 'Limits', 'medium', 'single',
    '$\\displaystyle \\lim_{x \\to 0} \\frac{\\sin 3x}{x}$ equals:',
    ['0', '1', '3', '1/3'], { keys: ['C'] }, '$\\frac{\\sin 3x}{x} = 3\\cdot\\frac{\\sin 3x}{3x} \\to 3$.', { exam: 'JEE Main', year: 2021 }),
  S('maths', 'Definite Integration', 'medium', 'numerical',
    'Evaluate $\\displaystyle \\int_0^{2} 3x^2 \\, dx$.',
    null, { value: 8 }, '$[x^3]_0^2 = 8$.'),
  S('maths', 'Probability', 'hard', 'single',
    'Two fair dice are thrown. The probability that the sum is $7$ is:',
    ['$1/6$', '$1/12$', '$5/36$', '$7/36$'], { keys: ['A'] }, '6 favourable outcomes out of 36.'),
].map((q, i) => ({ ...q, source: { name: 'sample', id: String(i + 1) } }));

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const col = db.collection('questions');
await col.createIndex({ qid: 1 }, { unique: true });
await col.createIndex({ 'source.name': 1, 'source.id': 1 }, { unique: true, sparse: true });

let added = 0;
for (const q of samples) {
  const exists = await col.findOne({ 'source.name': 'sample', 'source.id': q.source.id });
  if (exists) continue;
  const c = await db.collection('counters').findOneAndUpdate({ _id: 'qid' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  await col.insertOne({ ...q, qid: c.seq, stats: { attempts: 0, solved: 0 }, createdAt: new Date() });
  added++;
}
console.log(`Seeded ${added} sample questions into ${dbName} (${samples.length - added} already there).`);
await client.close();
