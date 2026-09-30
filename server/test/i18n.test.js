import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every t('…') in the web app should have a Hindi entry in web/src/lib/hi.js with the same {placeholders}.
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/src');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.jsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));

test('every translated string has Hindi', async () => {
  const { default: HI } = await import(path.join(WEB, 'lib/hi.js'));
  const used = new Set();
  for (const f of files(WEB)) {
    if (f.endsWith(`${path.sep}pages${path.sep}Admin.jsx`)) continue; // admin stays English
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:t|tr|tk)\((['"])((?:\\.|(?!\1).)*)\1/g)) used.add(m[2].replace(/\\(['"])/g, '$1'));
  }
  const missing = [...used].filter((k) => k && HI[k] === undefined);
  assert.deepEqual(missing, [], `Add these to web/src/lib/hi.js:\n${missing.join('\n')}`);
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.entries(HI).filter(([k, v]) => ph(k) !== ph(v)).map(([k]) => k);
  assert.deepEqual(bad, [], 'Hindi must keep the same {placeholders}');
});
