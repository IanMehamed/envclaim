import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './setup.js';
import { createEnvironment } from '../src/services/environment.js';
import { claimEnvironment, releaseEnvironment } from '../src/services/reservation.js';
import { joinWaitlist, getNextInWaitlist, getWaitlistForEnv } from '../src/services/waitlist.js';
import { getAllEnvironments } from '../src/services/environment.js';

beforeEach(() => {
  setupTestDb();
  createEnvironment('dev1', 'U_ADMIN');
});

describe('joinWaitlist', () => {
  it('adds user to waitlist', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    joinWaitlist('dev1', 'U_DEV2');

    const envs = getAllEnvironments();
    expect(envs.find(e => e.name === 'dev1')!.waitlist_count).toBe(1);
  });

  it('throws on duplicate entry', () => {
    joinWaitlist('dev1', 'U_DEV2');
    expect(() => joinWaitlist('dev1', 'U_DEV2')).toThrow('already on the waitlist');
  });

  it('throws if env not found', () => {
    expect(() => joinWaitlist('nope', 'U_DEV2')).toThrow('not found');
  });

  it('prevents reservation holder from joining their own waitlist', () => {
    claimEnvironment('dev1', 'U_DEV1', 60 * 60 * 1000);
    expect(() => joinWaitlist('dev1', 'U_DEV1')).toThrow('already have');
  });
});

describe('getNextInWaitlist', () => {
  it('returns first user in FIFO order and removes them', () => {
    const env = createEnvironment('dev2', 'U_ADMIN');
    joinWaitlist('dev2', 'U_DEV1');
    joinWaitlist('dev2', 'U_DEV2');
    joinWaitlist('dev2', 'U_DEV3');

    expect(getNextInWaitlist(env.id)).toBe('U_DEV1');
    expect(getNextInWaitlist(env.id)).toBe('U_DEV2');
    expect(getNextInWaitlist(env.id)).toBe('U_DEV3');
    expect(getNextInWaitlist(env.id)).toBeUndefined();
  });
});

describe('getWaitlistForEnv', () => {
  it('returns all entries ordered by time', () => {
    const env = createEnvironment('dev3', 'U_ADMIN');
    joinWaitlist('dev3', 'U_DEV1');
    joinWaitlist('dev3', 'U_DEV2');

    const list = getWaitlistForEnv(env.id);
    expect(list).toHaveLength(2);
    expect(list[0].user_id).toBe('U_DEV1');
    expect(list[1].user_id).toBe('U_DEV2');
  });
});
