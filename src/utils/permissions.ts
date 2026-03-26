import { db } from '../db/database.js';
import type { Admin } from '../types.js';

let bootstrapped = false;

function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  const count = (db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number }).count;
  if (count === 0) {
    const initialAdmin = process.env.INITIAL_ADMIN_USER_ID;
    if (initialAdmin) {
      db.prepare('INSERT INTO admins (user_id, added_by) VALUES (?, ?)').run(initialAdmin, 'system');
      console.log(`Initial admin seeded: ${initialAdmin}`);
    }
  }
}

export function isAdmin(userId: string): boolean {
  bootstrap();
  const row = db.prepare('SELECT id FROM admins WHERE user_id = ?').get(userId);
  return !!row;
}

export function addAdmin(userId: string, addedBy: string): void {
  db.prepare('INSERT OR IGNORE INTO admins (user_id, added_by) VALUES (?, ?)').run(userId, addedBy);
}

export function removeAdmin(userId: string): boolean {
  const result = db.prepare('DELETE FROM admins WHERE user_id = ?').run(userId);
  return result.changes > 0;
}

export function listAdmins(): Admin[] {
  return db.prepare('SELECT * FROM admins ORDER BY added_at').all() as Admin[];
}

/** Reset bootstrap flag — for tests only */
export function resetBootstrap(): void {
  bootstrapped = false;
}

export function parseSlackUserId(text: string): string | null {
  const match = text.match(/<@(U[A-Z0-9]+)(?:\|[^>]*)?>/);
  return match ? match[1] : null;
}
