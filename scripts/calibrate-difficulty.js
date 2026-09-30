#!/usr/bin/env node
/**
 * Sets each question's difficulty from how students actually did on it (see server/src/lib/difficulty.js).
 *
 *   npm run calibrate                     # preview
 *   npm run calibrate -- --apply
 *   npm run calibrate -- --min=50 --apply # only questions with 50+ students
 */
import { connect, close } from '../server/src/db.js';
import { calibrateDifficulty } from '../server/src/lib/difficulty.js';

const args = process.argv.slice(2);
const min = Number((args.find((a) => a.startsWith('--min=')) || '').split('=')[1]) || undefined;
await connect();
const r = await calibrateDifficulty({ dryRun: !args.includes('--apply'), minAttempts: min });
console.log(`${r.eligible} questions have ${r.minAttempts}+ students (not counting ones you set by hand).`);
console.log(`${r.dryRun ? 'Would change' : 'Changed'} ${r.changed}:`, r.moves);
if (r.dryRun) console.log('Run with --apply to save.');
await close();
