import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSecrets, resolveSecret } from './secrets.js';

describe('loadSecrets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-secrets-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns key-value pairs from a valid .env file', async () => {
    const envFile = join(dir, '.env');
    await writeFile(envFile, 'API_KEY=tok_123\nDATABASE_URL=postgres://localhost/db\n', 'utf8');
    const secrets = loadSecrets(envFile);
    expect(secrets['API_KEY']).toBe('tok_123');
    expect(secrets['DATABASE_URL']).toBe('postgres://localhost/db');
  });

  it('returns {} when the file does not exist', () => {
    const secrets = loadSecrets(join(dir, 'nonexistent.env'));
    expect(secrets).toEqual({});
  });
});

describe('resolveSecret', () => {
  const secrets = { API_KEY: 'tok_abc', DB: 'postgres://localhost' };

  it('resolveSecret(secrets.API_KEY, ...) returns tok_abc', () => {
    expect(resolveSecret('secrets.API_KEY', secrets)).toBe('tok_abc');
  });

  it('resolveSecret(literal, {}) returns literal unchanged', () => {
    expect(resolveSecret('literal-value', {})).toBe('literal-value');
  });

  it('resolveSecret(secrets.MISSING, {}) returns empty string', () => {
    expect(resolveSecret('secrets.MISSING', {})).toBe('');
  });
});
