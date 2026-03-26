import { db } from '../db/database.js';
import { getEnvironment } from './environment.js';
import { nowPlusDuration } from '../utils/time.js';
import type { Reservation, ReservationWithEnv } from '../types.js';

function isDelegate(reservationId: number, userId: string): boolean {
  const row = db.prepare(
    'SELECT id FROM reservation_delegates WHERE reservation_id = ? AND user_id = ?'
  ).get(reservationId, userId);
  return !!row;
}

function canManage(reservation: { id: number; user_id: string }, userId: string, userIsAdmin: boolean): boolean {
  return reservation.user_id === userId || userIsAdmin || isDelegate(reservation.id, userId);
}

export function addDelegate(envName: string, delegateUserId: string, requestedBy: string, requestedByIsAdmin: boolean = false): void {
  const env = getEnvironment(envName);
  if (!env) throw new Error(`Environment \`${envName}\` not found.`);

  const active = db.prepare(
    'SELECT id, user_id FROM reservations WHERE env_id = ? AND status = ?'
  ).get(env.id, 'active') as { id: number; user_id: string } | undefined;

  if (!active) throw new Error(`Environment \`${envName}\` is not currently reserved.`);

  if (active.user_id !== requestedBy && !requestedByIsAdmin) {
    throw new Error(`Only <@${active.user_id}> or an admin can add delegates.`);
  }

  if (delegateUserId === active.user_id) {
    throw new Error('The reservation owner is already able to manage it.');
  }

  try {
    db.prepare('INSERT INTO reservation_delegates (reservation_id, user_id) VALUES (?, ?)').run(active.id, delegateUserId);
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`<@${delegateUserId}> is already a delegate for \`${envName}\`.`);
    }
    throw err;
  }
}

export function removeDelegate(envName: string, delegateUserId: string, requestedBy: string, requestedByIsAdmin: boolean = false): void {
  const env = getEnvironment(envName);
  if (!env) throw new Error(`Environment \`${envName}\` not found.`);

  const active = db.prepare(
    'SELECT id, user_id FROM reservations WHERE env_id = ? AND status = ?'
  ).get(env.id, 'active') as { id: number; user_id: string } | undefined;

  if (!active) throw new Error(`Environment \`${envName}\` is not currently reserved.`);

  if (active.user_id !== requestedBy && !requestedByIsAdmin) {
    throw new Error(`Only <@${active.user_id}> or an admin can remove delegates.`);
  }

  db.prepare('DELETE FROM reservation_delegates WHERE reservation_id = ? AND user_id = ?').run(active.id, delegateUserId);
}

export function getDelegates(reservationId: number): string[] {
  return (db.prepare('SELECT user_id FROM reservation_delegates WHERE reservation_id = ?').all(reservationId) as { user_id: string }[])
    .map(r => r.user_id);
}

export function claimEnvironment(
  envName: string,
  userId: string,
  durationMs: number,
  notes?: string
): Reservation {
  const env = getEnvironment(envName);
  if (!env) throw new Error(`Environment \`${envName}\` not found.`);

  const active = db.prepare(
    'SELECT id, user_id FROM reservations WHERE env_id = ? AND status = ?'
  ).get(env.id, 'active') as { id: number; user_id: string } | undefined;

  if (active) {
    throw new Error(`Environment \`${envName}\` is already reserved by <@${active.user_id}>.`);
  }

  const expiresAt = nowPlusDuration(durationMs);
  const result = db.prepare(
    'INSERT INTO reservations (env_id, user_id, expires_at, notes) VALUES (?, ?, ?, ?)'
  ).run(env.id, userId, expiresAt, notes || null);

  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.lastInsertRowid) as Reservation;
}

export function releaseEnvironment(envName: string, userId: string, isAdmin: boolean = false): void {
  const env = getEnvironment(envName);
  if (!env) throw new Error(`Environment \`${envName}\` not found.`);

  const active = db.prepare(
    'SELECT id, user_id FROM reservations WHERE env_id = ? AND status = ?'
  ).get(env.id, 'active') as { id: number; user_id: string } | undefined;

  if (!active) {
    throw new Error(`Environment \`${envName}\` is not currently reserved.`);
  }

  if (!canManage(active, userId, isAdmin)) {
    throw new Error(`Only <@${active.user_id}>, a delegate, or an admin can release this environment.`);
  }

  db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run('released', active.id);
}

export function extendReservation(
  envName: string,
  userId: string,
  additionalMs: number,
  isAdmin: boolean = false
): Reservation {
  const env = getEnvironment(envName);
  if (!env) throw new Error(`Environment \`${envName}\` not found.`);

  const active = db.prepare(
    'SELECT * FROM reservations WHERE env_id = ? AND status = ?'
  ).get(env.id, 'active') as Reservation | undefined;

  if (!active) {
    throw new Error(`Environment \`${envName}\` is not currently reserved.`);
  }

  if (!canManage(active, userId, isAdmin)) {
    throw new Error(`Only <@${active.user_id}>, a delegate, or an admin can extend this reservation.`);
  }

  const currentExpires = new Date(active.expires_at + 'Z').getTime();
  const newExpires = new Date(currentExpires + additionalMs).toISOString().replace(/\.\d{3}Z$/, '');

  db.prepare('UPDATE reservations SET expires_at = ? WHERE id = ?').run(newExpires, active.id);
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(active.id) as Reservation;
}

export function expireOverdueReservations(): ReservationWithEnv[] {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const overdue = db.prepare(`
    SELECT r.*, e.name AS env_name
    FROM reservations r
    JOIN environments e ON e.id = r.env_id
    WHERE r.status = 'active' AND r.expires_at <= ?
  `).all(now) as ReservationWithEnv[];

  if (overdue.length > 0) {
    const ids = overdue.map(r => r.id);
    db.prepare(
      `UPDATE reservations SET status = 'expired' WHERE id IN (${ids.map(() => '?').join(',')})`
    ).run(...ids);
  }

  return overdue;
}

export function getExpiringReservations(thresholdMs: number): ReservationWithEnv[] {
  const threshold = new Date(Date.now() + thresholdMs).toISOString().replace(/\.\d{3}Z$/, '');
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  return db.prepare(`
    SELECT r.*, e.name AS env_name
    FROM reservations r
    JOIN environments e ON e.id = r.env_id
    WHERE r.status = 'active' AND r.expires_at <= ? AND r.expires_at > ?
  `).all(threshold, now) as ReservationWithEnv[];
}

export function getActiveReservation(envId: number): Reservation | undefined {
  return db.prepare(
    'SELECT * FROM reservations WHERE env_id = ? AND status = ?'
  ).get(envId, 'active') as Reservation | undefined;
}
