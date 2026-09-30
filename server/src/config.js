import { mongoUri } from './lib/mongoUri.js';

const required = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 4000),
  // Local MongoDB in development, MONGO_URI in production (lib/mongoUri.js).
  mongoUri: mongoUri(),
  dbName: required('DB_NAME', 'jee_arena'),
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isProd: process.env.NODE_ENV === 'production',
  // Public address of the site, e.g. https://jeearena.in — used in the sitemap and canonical links.
  // If empty, it's worked out from each request (fine behind Render's proxy).
  siteUrl: (process.env.SITE_URL || '').trim().replace(/\/+$/, ''),
  // Where question pictures are served from once media/ is uploaded to Cloudflare R2 / a CDN
  // (e.g. https://media.jeearena.in). Empty = serve them from the local media/ folder.
  mediaBaseUrl: (process.env.MEDIA_BASE_URL || '').trim().replace(/\/+$/, ''),
  // Google AdSense. Leave ADSENSE_CLIENT empty to show no ads (e.g. before approval).
  ads: {
    client: (process.env.ADSENSE_CLIENT || '').trim(), // ca-pub-XXXXXXXXXXXXXXXX
    slots: {
      rail: (process.env.ADSENSE_SLOT_RAIL || '').trim(), // 160×600, left & right of the page on wide screens
      bottom: (process.env.ADSENSE_SLOT_BOTTOM || '').trim(), // responsive, bottom of the page on phones/small screens
    },
    // ADS_PREVIEW=1 shows labelled grey boxes where ads will go, for checking layout before approval.
    preview: process.env.ADS_PREVIEW === '1',
  },
};

if (config.isProd && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('Set a real JWT_SECRET in production');
}
