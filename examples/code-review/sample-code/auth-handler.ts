// sample-code/auth-handler.ts
// Demo file for Mode 1. Contains an obvious security issue for the agent to find.
// DO NOT use this code in production — it is intentionally insecure for demonstration.

import { db } from './db.js';

export async function getUserById(userId: string) {
  // INTENTIONAL DEMO FLAW: SQL injection — user input is interpolated directly.
  const query = `SELECT * FROM users WHERE id = '${userId}'`;
  return db.run(query);
}

export async function loginUser(username: string, password: string) {
  // INTENTIONAL DEMO FLAW: password compared via loose equality after string concat.
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  const user = await db.run(query);
  if (user) {
    return { token: 'session_' + Date.now() };
  }
  return null;
}
