import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './setup.js';
import { createEnvironment } from '../src/services/environment.js';
import { claimEnvironment, releaseEnvironment, extendReservation, addDelegate, removeDelegate, getDelegates } from '../src/services/reservation.js';

beforeEach(() => {
  setupTestDb();
  createEnvironment('dev1', 'U_ADMIN');
});

describe('addDelegate', () => {
  it('adds a delegate to a reservation', () => {
    const r = claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    addDelegate('dev1', 'U_FE_DEV', 'U_DEV1');
    expect(getDelegates(r.id)).toContain('U_FE_DEV');
  });

  it('throws if env not reserved', () => {
    expect(() => addDelegate('dev1', 'U_FE_DEV', 'U_DEV1')).toThrow('not currently reserved');
  });

  it('throws if not the owner (and not admin)', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    expect(() => addDelegate('dev1', 'U_FE_DEV', 'U_DEV2')).toThrow('Only');
  });

  it('allows admin to add delegate', () => {
    const r = claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    addDelegate('dev1', 'U_FE_DEV', 'U_ADMIN', true);
    expect(getDelegates(r.id)).toContain('U_FE_DEV');
  });

  it('throws if delegating to the owner', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    expect(() => addDelegate('dev1', 'U_DEV1', 'U_DEV1')).toThrow('already able');
  });

  it('throws on duplicate delegate', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    addDelegate('dev1', 'U_FE_DEV', 'U_DEV1');
    expect(() => addDelegate('dev1', 'U_FE_DEV', 'U_DEV1')).toThrow('already a delegate');
  });
});

describe('delegate can release/extend', () => {
  it('delegate can release the environment', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    addDelegate('dev1', 'U_FE_DEV', 'U_DEV1');

    // U_FE_DEV releases (not admin, not owner, but delegate)
    releaseEnvironment('dev1', 'U_FE_DEV', false);
    // Should not throw
  });

  it('delegate can extend the reservation', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    addDelegate('dev1', 'U_FE_DEV', 'U_DEV1');

    const extended = extendReservation('dev1', 'U_FE_DEV', 30 * 60 * 1000, false);
    expect(extended).toBeTruthy();
  });

  it('non-delegate non-admin cannot release', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    expect(() => releaseEnvironment('dev1', 'U_RANDOM', false)).toThrow('delegate');
  });
});

describe('removeDelegate', () => {
  it('removes a delegate', () => {
    const r = claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    addDelegate('dev1', 'U_FE_DEV', 'U_DEV1');
    removeDelegate('dev1', 'U_FE_DEV', 'U_DEV1');
    expect(getDelegates(r.id)).not.toContain('U_FE_DEV');
  });

  it('removed delegate cannot release', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    addDelegate('dev1', 'U_FE_DEV', 'U_DEV1');
    removeDelegate('dev1', 'U_FE_DEV', 'U_DEV1');
    expect(() => releaseEnvironment('dev1', 'U_FE_DEV', false)).toThrow('delegate');
  });
});
