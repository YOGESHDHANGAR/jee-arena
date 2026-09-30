import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { col } from './db.js';
import { config } from './config.js';
import { ah, bad, HttpError } from './lib/util.js';
import { DEFAULT_RATING } from './lib/rating.js';

const sign = (u) => jwt.sign({ sub: String(u._id), role: u.role }, config.jwtSecret, { expiresIn: '30d' });

export const publicUser = (u) => ({
  id: String(u._id),
  name: u.name,
  username: u.username,
  email: u.email,
  role: u.role,
  plan: u.plan || 'free',
  rating: u.rating,
  contestsPlayed: u.contestsPlayed || 0,
  solvedCount: u.solvedCount || 0,
  targetYear: u.targetYear || null,
});

/** Attaches req.user ({ id, role }) when a valid token is sent; never fails. */
export function readUser(req, _res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const p = jwt.verify(h.slice(7), config.jwtSecret);
      req.user = { id: p.sub, role: p.role };
    } catch {
      /* invalid/expired token -> treated as anonymous */
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Admins only'));
  next();
}

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

export const authRouter = Router();

authRouter.post(
  '/register',
  limiter,
  ah(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const targetYear = Number(req.body.targetYear) || null;

    if (name.length < 2) throw bad('Enter your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email');
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw bad('Username: 3–20 letters, numbers or _');
    if (password.length < 8) throw bad('Password must be at least 8 characters');

    const exists = await col('users').findOne({ $or: [{ email }, { username }] }, { projection: { email: 1 } });
    if (exists) throw bad(exists.email === email ? 'Email already registered' : 'Username taken');

    const user = {
      name,
      email,
      username,
      targetYear,
      passwordHash: await bcrypt.hash(password, 10),
      role: config.adminEmails.includes(email) ? 'admin' : 'student',
      plan: 'free',
      rating: DEFAULT_RATING,
      contestsPlayed: 0,
      solvedCount: 0,
      solvedBySubject: { physics: 0, chemistry: 0, maths: 0 },
      streak: { current: 0, best: 0, lastDay: null },
      createdAt: new Date(),
    };
    // Where they came from (web/src/lib/track.js) and who invited them, for Admin → Growth.
    const s = req.body.signup && typeof req.body.signup === 'object' ? req.body.signup : null;
    const clean = (v, n = 40) => (typeof v === 'string' ? v.replace(/[^\w.\-/]/g, '').slice(0, n) : null);
    if (s) user.signup = { source: clean(s.source) || 'direct', ref: clean(s.ref, 20), landing: clean(s.landing, 120), firstSeen: s.at ? new Date(s.at) : null };
    let referrer = null;
    if (user.signup?.ref && user.signup.ref !== username) {
      referrer = await col('users').findOne({ username: user.signup.ref.toLowerCase() }, { projection: { _id: 1 } });
      if (referrer) user.referredBy = referrer._id;
    }
    if (user.signup?.firstSeen && Number.isNaN(user.signup.firstSeen.getTime())) user.signup.firstSeen = null;
    const r = await col('users').insertOne(user);
    user._id = r.insertedId;
    if (referrer) await col('users').updateOne({ _id: referrer._id }, { $inc: { referrals: 1 } });
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  limiter,
  ah(async (req, res) => {
    const login = String(req.body.email || '').trim().toLowerCase();
    const user = await col('users').findOne({ $or: [{ email: login }, { username: login }] });
    const ok = user && (await bcrypt.compare(String(req.body.password || ''), user.passwordHash));
    if (!ok) throw new HttpError(401, 'Wrong email/username or password');
    res.json({ token: sign(user), user: publicUser(user) });
  }),
);
