import { db } from '../db/database.js';
import type { Environment, EnvironmentWithStatus } from '../types.js';

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-_\/]*[a-zA-Z0-9]$/;
const MAX_NAME_LENGTH = 50;

export function createEnvironment(name: string, createdBy: string): Environment {
  if (name.length < 2 || name.length > MAX_NAME_LENGTH) {
    throw new Error(`Environment name must be between 2 and ${MAX_NAME_LENGTH} characters.`);
  }
  if (!NAME_REGEX.test(name)) {
    throw new Error('Environment name can only contain letters, numbers, hyphens, underscores, and slashes.');
  }

  try {
    const result = db.prepare(
      'INSERT INTO environments (name, created_by) VALUES (?, ?)'
    ).run(name, createdBy);
    return db.prepare('SELECT * FROM environments WHERE id = ?').get(result.lastInsertRowid) as Environment;
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Environment \`${name}\` already exists.`);
    }
    throw err;
  }
}

export function deleteEnvironment(name: string): void {
  const result = db.prepare('DELETE FROM environments WHERE name = ?').run(name);
  if (result.changes === 0) {
    throw new Error(`Environment \`${name}\` not found.`);
  }
}

export function getEnvironment(name: string): Environment | undefined {
  return db.prepare('SELECT * FROM environments WHERE name = ?').get(name) as Environment | undefined;
}

export function getEnvironmentById(id: number): Environment | undefined {
  return db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as Environment | undefined;
}

export function getAllEnvironments(): EnvironmentWithStatus[] {
  const rows = db.prepare(`
    SELECT
      e.id, e.name, e.created_by, e.created_at,
      r.user_id AS reserved_by,
      r.id AS reservation_id,
      r.started_at AS reservation_started,
      r.expires_at AS reservation_expires,
      r.notes,
      (SELECT COUNT(*) FROM waitlist w WHERE w.env_id = e.id) AS waitlist_count
    FROM environments e
    LEFT JOIN reservations r ON r.env_id = e.id AND r.status = 'active'
    ORDER BY e.name
  `).all() as (Omit<EnvironmentWithStatus, 'delegates' | 'waitlist_users'> & { reservation_id: number | null })[];

  return rows.map(row => {
    const delegates = row.reservation_id
      ? (db.prepare('SELECT user_id FROM reservation_delegates WHERE reservation_id = ?').all(row.reservation_id) as { user_id: string }[]).map(d => d.user_id)
      : [];
    const waitlist_users = (db.prepare('SELECT user_id FROM waitlist WHERE env_id = ? ORDER BY created_at ASC').all(row.id) as { user_id: string }[]).map(w => w.user_id);
    return { ...row, delegates, waitlist_users };
  });
}

export function listEnvironmentNames(): string[] {
  return (db.prepare('SELECT name FROM environments ORDER BY name').all() as { name: string }[])
    .map(r => r.name);
}
