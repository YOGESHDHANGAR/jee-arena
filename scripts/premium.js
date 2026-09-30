#!/usr/bin/env node
/**
 * Pick which questions are Pro-only.
 *   npm run premium                      # preview for 20% (changes nothing)
 *   npm run premium -- --percent=20 --apply
 *   npm run premium -- --percent=25 --include-pyq --apply
 * Same as Admin → Premium. Questions you marked Pro/free by hand are never changed.
 */
import { connect, close } from '../server/src/db.js';
import { applyPremium } from '../server/src/lib/premium.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
await connect();
const r = await applyPremium({ percent: Number(args.percent ?? 20), includePyq: !!args['include-pyq'], dryRun: !args.apply });
console.log(`${r.dryRun ? 'Preview (nothing changed — add --apply)' : 'Applied'}: ${r.premium.toLocaleString('en-IN')} of ${r.total.toLocaleString('en-IN')} published questions are Pro (${r.actualPercent}%)`);
for (const [s, v] of Object.entries(r.bySubject)) console.log(`  ${s.padEnd(10)} ${String(v.premium).padStart(6)} / ${v.total}`);
console.log(`  would change: ${r.changed.madePremium} → Pro, ${r.changed.madeFree} → free${r.includePyq ? '' : '  (PYQs kept free)'}`);
await close();
