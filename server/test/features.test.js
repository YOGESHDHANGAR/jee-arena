import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { potdSubject } from '../src/lib/potd.js';
import { plainText, questionMeta, injectMeta } from '../src/lib/seo.js';
import { signS3 } from '../../scripts/upload-media.js';

test('problem of the day rotates subjects by day', () => {
  const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map(potdSubject);
  assert.equal(new Set(days.slice(0, 3)).size, 3);
  assert.equal(days[3], days[0]);
  assert.equal(potdSubject('2026-09-29'), potdSubject('2026-09-29'));
});

test('plainText strips maths markup for titles and descriptions', () => {
  assert.equal(plainText('Find $\\frac{a}{b}$ if $x^2 = 4$ {{img:fig1.png}}'), 'Find (a)/(b) if x2 = 4');
  assert.equal(plainText('Moles in $22\\,\\text{g}$ of $\\text{CO}_2$'), 'Moles in 22 g of CO2');
  assert.ok(plainText('word '.repeat(100), 40).length <= 40);
});

test('question meta names the chapter, PYQ and number', () => {
  const m = questionMeta({ qid: 42, subject: 'physics', chapter: 'Rotational Motion', type: 'single', pyq: { exam: 'JEE Main', year: 2023 }, text: 'A disc rolls…', solution: 'x' });
  assert.match(m.title, /^Rotational Motion — JEE Main 2023 PYQ #42 \| JEE Arena$/);
  assert.match(m.description, /step-by-step solution/);
});

test('injectMeta replaces title/description and escapes', () => {
  const html = '<html><head><meta name="description" content="old" /><title>Old</title></head><body></body></html>';
  const out = injectMeta(html, { title: 'A "quoted" <b>', description: 'd & e', canonical: 'https://x.in/problems/1', noindex: true });
  assert.match(out, /<title>A &quot;quoted&quot; &lt;b&gt;<\/title>/);
  assert.match(out, /content="d &amp; e"/);
  assert.match(out, /rel="canonical" href="https:\/\/x.in\/problems\/1"/);
  assert.match(out, /name="robots" content="noindex"/);
  assert.equal((out.match(/<title>/g) || []).length, 1);
});

test('S3 signature v4 matches the AWS reference implementation', () => {
  // Same request signed with the `aws4` npm package gives this signature.
  const h = createHash('sha256').update('hello').digest('hex');
  const s = signS3({
    method: 'PUT',
    url: 'https://acct.r2.cloudflarestorage.com/my-bucket/sub%20dir/hf-eq-physics-image%281%29%20a%2Bb.png',
    headers: { 'content-type': 'image/png' },
    payloadHash: h,
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    now: new Date('2026-09-29T12:34:56.000Z'),
  });
  assert.match(s.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/20260929\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=66924fd2b4de8b06c9f445c02615abe58b9386cd6efdfced55f8675cdbbe1a9a$/);
});
