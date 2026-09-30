#!/usr/bin/env node
/**
 * Finds copies of the same question imported from different sources.
 *
 *   npm run duplicates                  # compute fingerprints, print how many duplicate groups exist
 *   npm run duplicates -- --auto        # preview: merge every exact group whose copies agree on the answer
 *   npm run duplicates -- --auto --apply
 *
 * Merging keeps the best copy (published, with solution, PYQ-tagged, most used) and hides the rest
 * with duplicateOf=<kept number>. Nothing is deleted. Groups whose answer keys disagree are left for
 * you in Admin → Duplicates.
 */
import { connect, close } from '../server/src/db.js';
import { autoMerge, duplicateGroups, scanFingerprints } from '../server/src/lib/duplicates.js';

const args = new Set(process.argv.slice(2));
await connect();
process.stdout.write('Fingerprinting questions… ');
const s = await scanFingerprints({ onProgress: (p) => process.stdout.write(`\rFingerprinting questions… ${p.done.toLocaleString('en-IN')}/${p.total.toLocaleString('en-IN')}`) });
console.log(`\rFingerprinted ${s.done.toLocaleString('en-IN')} questions (${s.changed.toLocaleString('en-IN')} updated).`);

for (const mode of ['exact', 'text']) {
  const g = await duplicateGroups(mode);
  const extra = g.reduce((n, x) => n + x.qids.length - 1, 0);
  console.log(`${mode === 'exact' ? 'Exact duplicates (text + options)' : 'Same question text'}: ${g.length.toLocaleString('en-IN')} groups, ${extra.toLocaleString('en-IN')} extra copies`);
}

if (args.has('--auto')) {
  const r = await autoMerge({ dryRun: !args.has('--apply') });
  console.log(`${r.dryRun ? 'Would merge' : 'Merged'} ${r.merged} groups (hiding ${r.hidden} copies). ${r.conflicts} groups disagree on the answer — review them in Admin → Duplicates.`);
  if (r.dryRun) console.log('Run again with --apply to do it.');
}
await close();
