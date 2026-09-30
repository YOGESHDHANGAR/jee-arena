#!/usr/bin/env node
// Usage: npm run make-admin -- <username-or-email> [--pro]
import { MongoClient } from 'mongodb';

const who = process.argv[2]?.toLowerCase();
if (!who) {
  console.error('Usage: npm run make-admin -- <username-or-email> [--pro]');
  process.exit(1);
}
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');
await client.connect();
const set = { role: 'admin' };
if (process.argv.includes('--pro')) set.plan = 'pro';
const r = await client
  .db(process.env.DB_NAME || 'jee_arena')
  .collection('users')
  .updateOne({ $or: [{ username: who }, { email: who }] }, { $set: set });
console.log(r.matchedCount ? `${who} is now an admin. Log out and back in.` : `No user "${who}" — register first.`);
await client.close();
