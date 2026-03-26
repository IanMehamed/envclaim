import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './setup.js';
import { createEnvironment, deleteEnvironment, getEnvironment, getAllEnvironments, listEnvironmentNames } from '../src/services/environment.js';

beforeEach(() => {
  setupTestDb();
});

describe('createEnvironment', () => {
  it('creates an environment', () => {
    const env = createEnvironment('dev1/ms-oms', 'U_ADMIN');
    expect(env.name).toBe('dev1/ms-oms');
    expect(env.created_by).toBe('U_ADMIN');
    expect(env.id).toBeGreaterThan(0);
  });

  it('throws on duplicate name', () => {
    createEnvironment('dev1', 'U_ADMIN');
    expect(() => createEnvironment('dev1', 'U_ADMIN')).toThrow('already exists');
  });

  it('rejects invalid names', () => {
    expect(() => createEnvironment('a', 'U_ADMIN')).toThrow('between 2 and');
    expect(() => createEnvironment('bad name!', 'U_ADMIN')).toThrow('can only contain');
  });

  it('allows hyphens, underscores, slashes', () => {
    const env = createEnvironment('staging/ms-ims_v2', 'U_ADMIN');
    expect(env.name).toBe('staging/ms-ims_v2');
  });
});

describe('deleteEnvironment', () => {
  it('deletes an existing environment', () => {
    createEnvironment('dev1', 'U_ADMIN');
    deleteEnvironment('dev1');
    expect(getEnvironment('dev1')).toBeUndefined();
  });

  it('throws on non-existent environment', () => {
    expect(() => deleteEnvironment('nope')).toThrow('not found');
  });
});

describe('getAllEnvironments', () => {
  it('returns all environments with status', () => {
    createEnvironment('dev1', 'U_ADMIN');
    createEnvironment('dev2', 'U_ADMIN');
    const envs = getAllEnvironments();
    expect(envs).toHaveLength(2);
    expect(envs[0].reserved_by).toBeNull();
    expect(envs[0].waitlist_count).toBe(0);
  });
});

describe('listEnvironmentNames', () => {
  it('returns sorted names', () => {
    createEnvironment('staging', 'U_ADMIN');
    createEnvironment('dev1', 'U_ADMIN');
    expect(listEnvironmentNames()).toEqual(['dev1', 'staging']);
  });
});
