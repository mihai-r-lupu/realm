import { describe, it, expect } from 'vitest';
import { VERSION } from './index.js';

describe('cli', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
