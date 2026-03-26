import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './setup.js';
import { isAdmin, addAdmin, removeAdmin, listAdmins, parseSlackUserId } from '../src/utils/permissions.js';

beforeEach(() => {
  process.env.INITIAL_ADMIN_USER_ID = 'U_INITIAL';
  setupTestDb();
});

describe('isAdmin', () => {
  it('seeds initial admin from env', () => {
    expect(isAdmin('U_INITIAL')).toBe(true);
  });

  it('returns false for non-admin', () => {
    isAdmin('U_INITIAL'); // trigger bootstrap
    expect(isAdmin('U_RANDOM')).toBe(false);
  });
});

describe('addAdmin / removeAdmin', () => {
  it('adds and removes admins', () => {
    isAdmin('U_INITIAL'); // trigger bootstrap
    addAdmin('U_NEW', 'U_INITIAL');
    expect(isAdmin('U_NEW')).toBe(true);

    removeAdmin('U_NEW');
    expect(isAdmin('U_NEW')).toBe(false);
  });

  it('lists all admins', () => {
    isAdmin('U_INITIAL'); // trigger bootstrap
    addAdmin('U_NEW', 'U_INITIAL');
    const admins = listAdmins();
    expect(admins.map(a => a.user_id)).toContain('U_INITIAL');
    expect(admins.map(a => a.user_id)).toContain('U_NEW');
  });
});

describe('parseSlackUserId', () => {
  it('parses <@U12345> format', () => {
    expect(parseSlackUserId('<@U12345ABC>')).toBe('U12345ABC');
  });

  it('parses <@U12345|username> format', () => {
    expect(parseSlackUserId('<@U12345ABC|john>')).toBe('U12345ABC');
  });

  it('returns null for invalid format', () => {
    expect(parseSlackUserId('notauser')).toBeNull();
  });
});
