import fs from 'node:fs';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { config } from '../config.js';
import { practiceFilter, SUBJECTS } from './util.js';
import { chapterDetail, subjectUnits } from './chapters.js';
import { isNarrowerName, syllabusChapter } from './syllabus.js';

/**
 * Search-engine support for a single-page app:
 *  - serveIndex: index.html with the right <title>, description, canonical and Open Graph tags
 *    for /problems/:n and /test/:id, so Google (and WhatsApp/Telegram link previews) see a
 *    real title per page instead of the same one everywhere.
 *  - sitemap.xml (+ chunks) and robots.txt.
 */

const SITE = 'JEE Arena';
const DEFAULT_TITLE = 'JEE Arena — practise, compete, rank';
const DEFAULT_DESC = 'Practise JEE Main & Advanced questions, take timed contests and mock tests, and see your All-India rank.';
const SUBJECT_LABEL = { physics: 'Physics', chemistry: 'Chemistry', maths: 'Maths' };
const TYPE_LABEL = { single: 'MCQ', multi: 'multi-correct', numerical: 'numerical' };

// Pages that are private or useless in search results.
const NOINDEX = [/^\/admin/, /^\/login/, /^\/register/, /^\/practice/, /^\/test\/[^/]+\/(take|result)/, /^\/u\//];

export const siteUrl = (req) => (config.siteUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain one-line text from question markup (no $…$, tags or LaTeX commands). Mirrors web/src/lib/hooks.js. */
export function plainText(text = '', max = 155) {
  const s = String(text)
    .replace(/\{\{(img|mol):[^}]*\}\}|!\[[^\]]*\]\([^)]*\)|<img[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\(?:left|right|displaystyle|mathrm|text|mathbf|operatorname)\b/g, '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\(sqrt)\{([^{}]*)\}/g, '√($2)')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[$^_{}\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
}

/** Title + description for a question page. Exported for tests. */
export function questionMeta(q) {
  const pyq = q.pyq?.year ? `${q.pyq.exam || 'JEE'} ${q.pyq.year}${q.pyq.shift ? ` ${q.pyq.shift}` : ''} PYQ` : null;
  const title = `${q.chapter}${q.topic ? ` (${q.topic})` : ''} — ${pyq || `JEE ${SUBJECT_LABEL[q.subject] || ''} question`} #${q.qid} | ${SITE}`;
  const lead = q.premium ? plainText(q.text, 60) : plainText(q.text, 120);
  const description = `${lead} ${SUBJECT_LABEL[q.subject] || ''} ${TYPE_LABEL[q.type] || ''} question${pyq ? ` from ${pyq}` : ''} with answer${q.solution ? ' and step-by-step solution' : ''}. Practise free on ${SITE}.`
    .replace(/\s+/g, ' ')
    .trim();
  return { title, description };
}

let indexCache = { path: null, mtime: 0, html: '' };
function readIndex(file) {
  const { mtimeMs } = fs.statSync(file);
  if (indexCache.path !== file || indexCache.mtime !== mtimeMs) indexCache = { path: file, mtime: mtimeMs, html: fs.readFileSync(file, 'utf8') };
  return indexCache.html;
}

/** Puts page-specific tags into index.html. `meta`: { title, description, canonical, noindex, image, type }. */
export function injectMeta(html, meta, extraHead = '') {
  const body = meta.body ? `<div id="root">${meta.body}</div>` : null;
  const title = meta.title || DEFAULT_TITLE;
  const description = meta.description || DEFAULT_DESC;
  const tags = [
    meta.canonical && `<link rel="canonical" href="${esc(meta.canonical)}" />`,
    meta.noindex && '<meta name="robots" content="noindex" />',
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:type" content="${meta.type || 'website'}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    meta.canonical && `<meta property="og:url" content="${esc(meta.canonical)}" />`,
    '<meta name="twitter:card" content="summary" />',
    extraHead,
  ].filter(Boolean).join('\n    ');
  const out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}" />`)
    .replace('</head>', `    ${tags}\n  </head>`);
  // Plain-HTML version of the page inside #root: search engines and link previews read it without
  // running JavaScript; React replaces it as soon as the app starts.
  return body ? out.replace('<div id="root"></div>', body) : out;
}

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const breadcrumbs = (base, items) =>
  ld({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${base}${path}` })),
  });

async function metaFor(req) {
  const base = siteUrl(req);
  const path = req.path.replace(/\/+$/, '') || '/';
  const canonical = `${base}${path === '/' ? '/' : path}`;
  if (NOINDEX.some((re) => re.test(path))) return { canonical, noindex: true };

  const pm = path.match(/^\/problems\/(\d+)$/);
  if (pm) {
    const q = await col('questions').findOne(
      { qid: Number(pm[1]), ...practiceFilter() },
      { projection: { qid: 1, subject: 1, chapter: 1, chapterId: 1, topic: 1, type: 1, pyq: 1, text: 1, options: 1, solution: 1, premium: 1 } },
    );
    if (!q) return { status: 404, title: `Question not found | ${SITE}`, noindex: true };
    // Name and link the standard chapter ("Kinematics"), keeping a narrower source name as the topic ("Rain Problem").
    const std = syllabusChapter(q.subject, q.chapterId);
    if (std) {
      if (!q.topic && q.chapter && isNarrowerName(q.chapter, std.name)) q.topic = q.chapter;
      q.chapter = std.name;
    } else q.chapter = `JEE ${SUBJECT_LABEL[q.subject] || ''}`.trim();
    const chPath = std ? `/${q.subject}/${std.id}` : `/${q.subject}`;
    const opts = q.premium ? [] : (q.options || []).map((o) => `<li>${esc(o.key)}. ${esc(plainText(o.text, 200))}</li>`);
    return {
      ...questionMeta(q),
      canonical,
      type: 'article',
      head: breadcrumbs(base, [['Home', '/'], [SUBJECT_LABEL[q.subject], `/${q.subject}`], [q.chapter, chPath], [`Question ${q.qid}`, path]]),
      body: `<main class="page"><p><a href="/">JEE Arena</a> › <a href="/${q.subject}">${SUBJECT_LABEL[q.subject]}</a> › <a href="${chPath}">${esc(q.chapter)}</a></p>`
        + `<h1>${esc(q.chapter)} — question ${q.qid}${q.pyq?.year ? ` (${esc(q.pyq.exam || 'JEE')} ${q.pyq.year})` : ''}</h1>`
        + `<p>${esc(plainText(q.text, q.premium ? 80 : 600))}</p>${opts.length ? `<ol>${opts.join('')}</ol>` : ''}`
        + `<p><a href="${chPath}">More ${esc(q.chapter)} questions</a></p></main>`,
    };
  }

  const sm = path.match(/^\/(physics|chemistry|maths)(?:\/([a-z0-9-]+))?$/);
  if (sm) {
    const [, subject, slug] = sm;
    const label = SUBJECT_LABEL[subject];
    if (!slug) {
      const { units } = await subjectUnits(subject);
      const n = units.reduce((a, u) => a + u.chapters.filter((c) => c.count).length, 0);
      return {
        title: `JEE ${label} chapter-wise questions & PYQs | ${SITE}`,
        description: `Chapter-wise JEE Main & Advanced ${label} questions and previous-year questions (${n} chapters) with instant checking and solutions.`,
        canonical,
        head: breadcrumbs(base, [['Home', '/'], [label, path]]),
        body: `<main class="page"><h1>JEE ${label}: chapter-wise questions</h1>${units
          .filter((u) => u.count)
          .map((u) => `<h2>${esc(u.name)}</h2><ul>${u.chapters
            .filter((c) => c.count)
            .map((c) => `<li><a href="/${subject}/${c.slug}">${esc(c.chapter)}</a> — ${c.count} questions${c.pyqCount ? `, ${c.pyqCount} PYQs` : ''}</li>`)
            .join('')}</ul>`)
          .join('')}</main>`,
      };
    }
    const d = await chapterDetail(subject, slug);
    if (d?.redirect) return { redirect: d.redirect }; // old raw-name URL -> its standard chapter
    if (!d || !d.total) return { status: 404, title: `Chapter not found | ${SITE}`, noindex: true };
    const yrs = d.pyqByYear.map((y) => y.year);
    const range = yrs.length ? (yrs.length > 1 ? `${Math.min(...yrs)}–${Math.max(...yrs)}` : `${yrs[0]}`) : '';
    const qs = [...d.questions.recentPyq, ...d.questions.popular, ...d.questions.starter].filter((q, i, a) => a.findIndex((x) => x.qid === q.qid) === i);
    return {
      title: `${d.chapter} JEE questions${d.pyqCount ? ` & PYQs (${range})` : ''} — ${label} | ${SITE}`,
      description: `${d.total} ${d.chapter} questions for JEE Main & Advanced${d.pyqCount ? `, including ${d.pyqCount} previous-year questions from ${range}` : ''}. Instant answer checking${d.withSolution ? ' and step-by-step solutions' : ''}. Free practice on ${SITE}.`,
      canonical,
      head: breadcrumbs(base, [['Home', '/'], [label, `/${subject}`], [d.chapter, path]]),
      body: `<main class="page"><p><a href="/">JEE Arena</a> › <a href="/${subject}">${label}</a></p><h1>${esc(d.chapter)} — JEE Main &amp; Advanced questions</h1>`
        + `<p>${d.total} practice questions${d.pyqCount ? `, ${d.pyqCount} PYQs (${range})` : ''}.</p><ul>${qs
          .map((q) => `<li><a href="/problems/${q.qid}">${esc(plainText(q.preview, 140))}</a>${q.pyq?.year ? ` (${esc(q.pyq.exam || 'JEE')} ${q.pyq.year})` : ''}</li>`)
          .join('')}</ul><p>More ${label} chapters: ${d.related.map((c) => `<a href="/${subject}/${c.slug}">${esc(c.chapter)}</a>`).join(', ')}</p></main>`,
    };
  }

  const tm = path.match(/^\/test\/([^/]+)$/);
  if (tm) {
    const id = decodeURIComponent(tm[1]);
    const t = await col('tests').findOne(
      { $or: [{ _id: ObjectId.isValid(id) ? new ObjectId(id) : null }, { slug: id }] },
      { projection: { kind: 1, title: 1, description: 1, questionIds: 1, durationMin: 1, hidden: 1, slug: 1 } },
    );
    if (!t || t.kind === 'practice') return { status: t ? 200 : 404, noindex: true, canonical };
    const what = t.kind === 'contest' ? 'JEE contest' : 'JEE mock test';
    return {
      title: `${t.title} — ${what} | ${SITE}`,
      description: t.description || `${t.questionIds.length}-question ${what} with real JEE marking, ${t.durationMin} minutes, and All-India rank. Free on ${SITE}.`,
      canonical: `${base}/test/${encodeURIComponent(t.slug || String(t._id))}`,
      noindex: !!t.hidden,
    };
  }

  const fixed = {
    '/': {},
    '/problems': { title: `JEE Main & Advanced practice questions with solutions | ${SITE}`, description: 'Thousands of Physics, Chemistry and Maths questions for JEE, filterable by chapter, difficulty and PYQ year, with instant checking and solutions.' },
    '/contests': { title: `Weekly JEE contests | ${SITE}`, description: 'Timed JEE contests with +4/−1 marking, live leaderboards and an All-India rating.' },
    '/mocks': { title: `Free JEE Main mock tests | ${SITE}`, description: 'Full-length JEE Main mock tests in an exam-style interface with All-India rank and subject-wise analysis.' },
    '/leaderboard': { title: `JEE Arena rankings | ${SITE}` },
    '/pro': { title: `JEE Arena Pro | ${SITE}` },
    '/privacy': { title: `Privacy policy | ${SITE}` },
  }[path];
  if (fixed) return { ...fixed, canonical };
  return { canonical };
}

/** Express handler: the SPA's index.html with page-specific meta tags. */
export function serveIndex(indexFile) {
  return async (req, res, next) => {
    try {
      const html = readIndex(indexFile);
      let meta;
      try {
        meta = await metaFor(req);
      } catch (e) {
        console.error('SEO meta failed', e);
        meta = {};
      }
      // Tells the web app where question pictures live (see MEDIA_BASE_URL).
      if (meta.redirect) return res.redirect(301, meta.redirect);
      const boot = `<script>window.__JA__=${JSON.stringify({ mediaBase: config.mediaBaseUrl || '/media' }).replace(/</g, '\\u003c')}</script>`;
      res.status(meta.status || 200).set('Cache-Control', 'no-cache').type('html').send(injectMeta(html, meta, `${boot}${meta.head || ''}`));
    } catch (e) {
      next(e);
    }
  };
}

// ---------------------------------------------------------------- sitemap

const PER_FILE = 40000; // Google allows 50,000 URLs per sitemap file
let qCache = { at: 0, rows: [] };
async function sitemapQuestions() {
  if (Date.now() - qCache.at > 60 * 60 * 1000) {
    // Free questions only: Pro pages show a locked teaser, which isn't worth sending search traffic to.
    const rows = await col('questions')
      .find({ ...practiceFilter(), premium: { $ne: true } }, { projection: { _id: 0, qid: 1, updatedAt: 1, createdAt: 1 } })
      .sort({ qid: 1 })
      .toArray();
    qCache = { at: Date.now(), rows };
  }
  return qCache.rows;
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const urlTag = (loc, lastmod) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
const xml = (res, body) => res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`);

export async function sitemapIndex(req, res) {
  const base = siteUrl(req);
  const n = Math.max(1, Math.ceil((await sitemapQuestions()).length / PER_FILE));
  const files = ['sitemap-pages.xml', ...Array.from({ length: n }, (_, i) => `sitemap-problems-${i + 1}.xml`)];
  xml(res, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map((f) => `<sitemap><loc>${base}/${f}</loc></sitemap>`).join('\n')}\n</sitemapindex>`);
}

export async function sitemapPages(req, res) {
  const base = siteUrl(req);
  const tests = await col('tests')
    .find({ kind: { $in: ['contest', 'mock'] }, hidden: { $ne: true } }, { projection: { slug: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(5000)
    .toArray();
  // Standard chapters that have questions (old raw-name URLs 301 to these, so they aren't listed).
  const chapterUrls = (
    await Promise.all(
      SUBJECTS.map(async (s) => [
        urlTag(`${base}/${s}`),
        ...(await subjectUnits(s)).units.flatMap((u) => u.chapters.filter((c) => c.count).map((c) => urlTag(`${base}/${s}/${c.slug}`))),
      ]),
    )
  ).flat();
  const urls = [
    ...['/', '/problems', '/contests', '/mocks', '/leaderboard', '/pro', '/privacy'].map((p) => urlTag(`${base}${p}`)),
    ...chapterUrls,
    ...tests.map((t) => urlTag(`${base}/test/${encodeURIComponent(t.slug || String(t._id))}`, day(t.createdAt))),
  ];
  xml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}

export async function sitemapProblems(req, res) {
  const base = siteUrl(req);
  const i = Number(req.params.n) - 1;
  const rows = (await sitemapQuestions()).slice(i * PER_FILE, (i + 1) * PER_FILE);
  if (!rows.length || i < 0) return res.status(404).type('text/plain').send('Not found');
  xml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map((q) => urlTag(`${base}/problems/${q.qid}`, day(q.updatedAt || q.createdAt))).join('\n')}\n</urlset>`);
}

export function robots(req, res) {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Disallow: /api/',
      'Disallow: /admin',
      'Disallow: /practice',
      'Disallow: /test/*/take',
      'Disallow: /test/*/result',
      'Allow: /',
      '',
      `Sitemap: ${siteUrl(req)}/sitemap.xml`,
      '',
    ].join('\n'),
  );
}
