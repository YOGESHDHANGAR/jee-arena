import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { col, connect } from './db.js';
import { authRouter, readUser } from './auth.js';
import { problemsRouter } from './routes/problems.js';
import { testsRouter } from './routes/tests.js';
import { usersRouter } from './routes/users.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { adminRouter } from './routes/admin.js';
import { commentsRouter } from './routes/comments.js';
import { chaptersRouter } from './routes/chapters.js';
import { reviewsRouter } from './routes/reviews.js';
import { robots, serveIndex, sitemapIndex, sitemapPages, sitemapProblems } from './lib/seo.js';
import { ah, dayKey } from './lib/util.js';
import { ignorable, recordError } from './lib/errors.js';
import { startUsageClock, trackTraffic } from './lib/usage.js';
import rateLimit from 'express-rate-limit';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(trackTraffic); // Admin → Usage & cost: requests and bandwidth (lib/usage.js)
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(cors({ origin: config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '200kb' }));
  app.use(readUser);

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  // Public settings the web app needs at startup (cached by browsers for 5 minutes).
  api.get('/config', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ads: config.ads.client || config.ads.preview ? config.ads : null });
  });
  api.use('/auth', authRouter);
  api.use(commentsRouter); // /problems/:qid/comments, /comments/:id
  api.use('/problems', problemsRouter);
  api.use('/chapters', chaptersRouter);
  api.use('/reviews', reviewsRouter);
  api.use('/tests', testsRouter);
  api.use('/users', usersRouter);
  api.use('/leaderboard', leaderboardRouter);
  api.use('/admin', adminRouter);
  // One count per visit (day + source) for Admin → Growth (web/src/lib/track.js). No personal data.
  const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse/i;
  api.post('/hit', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: false, legacyHeaders: false }), (req, res) => {
    res.status(204).end();
    if (BOTS.test(req.get('user-agent') || '')) return;
    const source = String(req.body?.source || 'direct').toLowerCase().replace(/[^a-z0-9.\-]/g, '').slice(0, 40) || 'direct';
    const day = dayKey();
    col('visits')
      .updateOne({ _id: `${day}|${source}` }, { $set: { day, source }, $inc: { visits: 1, newVisitors: req.body?.new ? 1 : 0 } }, { upsert: true })
      .catch(() => {});
  });

  // Errors from students' browsers (web/src/lib/errors.js). Rate-limited, never fails.
  api.post(
    '/errors',
    rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: false, legacyHeaders: false }),
    (req, res) => {
      const b = req.body || {};
      if (b.message && !ignorable(b.message, b.stack)) {
        recordError({ where: 'web', message: b.message, stack: b.stack, url: b.url, userId: req.user?.id, ua: req.get('user-agent'), extra: b.componentStack ? { componentStack: String(b.componentStack).slice(0, 1500) } : undefined });
      }
      res.status(204).end();
    },
  );
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // AdSense requires /ads.txt on your domain to authorise your publisher ID.
  app.get('/ads.txt', (_req, res) => {
    const pub = config.ads.client.replace(/^ca-/, '');
    if (!pub) return res.status(404).type('text/plain').send('');
    res.type('text/plain').send(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
  });

  // Search engines: sitemap (index + chunks of 40k questions) and robots.txt.
  app.get('/sitemap.xml', ah(sitemapIndex));
  app.get('/sitemap-pages.xml', ah(sitemapPages));
  app.get('/sitemap-problems-:n.xml', ah(sitemapProblems));
  app.get('/robots.txt', robots);

  // Question diagrams copied in by the importer (jee-arena/media). Once they're uploaded to
  // R2/a CDN (npm run media:upload) and MEDIA_BASE_URL is set, old /media links redirect there.
  if (config.mediaBaseUrl) {
    app.use('/media', (req, res) => res.redirect(301, `${config.mediaBaseUrl}${req.path}`));
  } else {
    const media = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../media');
    app.use('/media', express.static(media, { maxAge: '30d', immutable: true, fallthrough: false }));
  }

  // In production the same process serves the built web app: one small server, one bill.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(dist)) {
    // The service worker and manifest must never be cached, or phones keep an old version for a week.
    app.get(['/sw.js', '/manifest.webmanifest'], (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, req.path));
    });
    app.use(express.static(dist, { maxAge: '7d', index: false }));
    // index.html with per-page <title>/description/canonical (see lib/seo.js).
    app.get('*', serveIndex(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      console.error(err);
      recordError({ where: 'server', message: err.message, stack: err.stack, url: req.originalUrl, method: req.method, status, userId: req.user?.id });
    }
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Crashes outside a request also go to Admin → Errors.
  process.on('unhandledRejection', (e) => {
    console.error('Unhandled rejection', e);
    recordError({ where: 'server', message: `Unhandled rejection: ${e?.message || e}`, stack: e?.stack });
  });
  process.on('uncaughtException', (e) => {
    console.error('Uncaught exception', e);
    recordError({ where: 'server', message: `Crash: ${e?.message || e}`, stack: e?.stack }).finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 2000).unref();
  });
  await connect();
  startUsageClock(); // counts awake minutes for Render's free instance hours
  createApp().listen(config.port, () => console.log(`JEE Arena API on http://localhost:${config.port}`));
}
