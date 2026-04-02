// Secrets loader — reads .env files without modifying process.env.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

/**
 * Loads key=value pairs from a .env file.
 * Returns empty object if the file does not exist — not an error.
 */
export function loadSecrets(envPath?: string): Record<string, string> {
  const filePath = resolve(envPath ?? '.env');
  try {
    const content = readFileSync(filePath, 'utf8');
    return parse(content);
  } catch {
    return {};
  }
}

/**
 * Resolves a 'secrets.KEY_NAME' reference to its value.
 * Strings that do not start with 'secrets.' are returned unchanged.
 *
 * @example
 *   resolveSecret('secrets.API_KEY', { API_KEY: 'tok_123' }) // → 'tok_123'
 *   resolveSecret('literal-value', {})                        // → 'literal-value'
 */
export function resolveSecret(value: string, secrets: Record<string, string>): string {
  if (!value.startsWith('secrets.')) return value;
  const key = value.slice('secrets.'.length);
  return secrets[key] ?? '';
}
