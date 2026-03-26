import { db } from '../db/database.js';
import { getEnvironment } from './environment.js';
import { getActiveReservation } from './reservation.js';
import type { WaitlistEntry } from '../types.js';

export function joinWaitlist(envName: string, userId: string): void {
  const env = getEnvironment(envName);
  if (!env) throw new Error(`Environment \`${envName}\` not found.`);

  const active = getActiveReservation(env.id);
  if (active && active.user_id === userId) {
    throw new Error(`You already have \`${envName}\` reserved. Release it first.`);
  }

  try {
    db.prepare('INSERT INTO waitlist (env_id, user_id) VALUES (?, ?)').run(env.id, userId);
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`You're already on the waitlist for \`${envName}\`.`);
    }
    throw err;
  }
}

export function leaveWaitlist(envName: string, userId: string): void {
  const env = getEnvironment(envName);
  if (!env) throw new Error(`Environment \`${envName}\` not found.`);

  db.prepare('DELETE FROM waitlist WHERE env_id = ? AND user_id = ?').run(env.id, userId);
}

export function getNextInWaitlist(envId: number): string | undefined {
  const row = db.prepare(
    'SELECT id, user_id FROM waitlist WHERE env_id = ? ORDER BY created_at ASC LIMIT 1'
  ).get(envId) as { id: number; user_id: string } | undefined;

  if (row) {
    db.prepare('DELETE FROM waitlist WHERE id = ?').run(row.id);
    return row.user_id;
  }
  return undefined;
}

export function getWaitlistForEnv(envId: number): WaitlistEntry[] {
  return db.prepare(
    'SELECT * FROM waitlist WHERE env_id = ? ORDER BY created_at ASC'
  ).all(envId) as WaitlistEntry[];
}
