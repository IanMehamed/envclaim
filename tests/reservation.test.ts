import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './setup.js';
import { createEnvironment, getAllEnvironments } from '../src/services/environment.js';
import { claimEnvironment, releaseEnvironment, extendReservation, getActiveReservation, expireOverdueReservations } from '../src/services/reservation.js';
import { db } from '../src/db/database.js';

beforeEach(() => {
  setupTestDb();
  createEnvironment('dev1', 'U_ADMIN');
  createEnvironment('dev2', 'U_ADMIN');
});

describe('claimEnvironment', () => {
  it('creates a reservation', () => {
    const r = claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000, 'testing checkout');
    expect(r.user_id).toBe('U_DEV1');
    expect(r.notes).toBe('testing checkout');
    expect(r.status).toBe('active');
  });

  it('reflects in status board', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    const envs = getAllEnvironments();
    const dev1 = envs.find(e => e.name === 'dev1')!;
    expect(dev1.reserved_by).toBe('U_DEV1');
    expect(dev1.reservation_expires).toBeTruthy();
  });

  it('throws if environment not found', () => {
    expect(() => claimEnvironment('nope', 'U_DEV1', 60000)).toThrow('not found');
  });

  it('throws if already reserved', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    expect(() => claimEnvironment('dev1', 'U_DEV2', 60 * 60 * 1000)).toThrow('already reserved');
  });

  it('allows claiming different environments', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    const r = claimEnvironment('dev2', 'U_DEV1', 60 * 60 * 1000);
    expect(r.status).toBe('active');
  });
});

describe('releaseEnvironment', () => {
  it('releases a reservation', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    releaseEnvironment('dev1', 'U_DEV1');
    const envs = getAllEnvironments();
    expect(envs.find(e => e.name === 'dev1')!.reserved_by).toBeNull();
  });

  it('throws if not reserved', () => {
    expect(() => releaseEnvironment('dev1', 'U_DEV1')).toThrow('not currently reserved');
  });

  it('throws if wrong user (non-admin)', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    expect(() => releaseEnvironment('dev1', 'U_DEV2', false)).toThrow('Only');
  });

  it('allows admin to release any reservation', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    releaseEnvironment('dev1', 'U_ADMIN', true);
    const envs = getAllEnvironments();
    expect(envs.find(e => e.name === 'dev1')!.reserved_by).toBeNull();
  });

  it('allows re-claim after release', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    releaseEnvironment('dev1', 'U_DEV1');
    const r = claimEnvironment('dev1', 'U_DEV2', 60 * 60 * 1000);
    expect(r.user_id).toBe('U_DEV2');
  });
});

describe('extendReservation', () => {
  it('extends the expiration', () => {
    const original = claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    const extended = extendReservation('dev1', 'U_DEV1', 30 * 60 * 1000);
    const originalExpires = new Date(original.expires_at + 'Z').getTime();
    const extendedExpires = new Date(extended.expires_at + 'Z').getTime();
    expect(extendedExpires - originalExpires).toBe(30 * 60 * 1000);
  });

  it('throws if wrong user', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    expect(() => extendReservation('dev1', 'U_DEV2', 30 * 60 * 1000)).toThrow('Only');
  });

  it('throws if not reserved', () => {
    expect(() => extendReservation('dev1', 'U_DEV1', 30 * 60 * 1000)).toThrow('not currently reserved');
  });
});

describe('expireOverdueReservations', () => {
  it('expires reservations past their time', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);

    // Manually set expires_at to the past
    db.prepare("UPDATE reservations SET expires_at = datetime('now', '-1 minute') WHERE status = 'active'").run();

    const expired = expireOverdueReservations();
    expect(expired).toHaveLength(1);
    expect(expired[0].user_id).toBe('U_DEV1');
    expect(expired[0].env_name).toBe('dev1');

    // Environment should be free now
    const envs = getAllEnvironments();
    expect(envs.find(e => e.name === 'dev1')!.reserved_by).toBeNull();
  });

  it('does not expire future reservations', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    const expired = expireOverdueReservations();
    expect(expired).toHaveLength(0);
  });
});
