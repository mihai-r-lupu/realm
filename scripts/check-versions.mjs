#!/usr/bin/env node
// Verifies that all in-source version strings match their package's package.json
// version. Exits 1 if any mismatch is detected. Run in CI after install.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf-8');
}

function pkgVersion(relDir) {
  return JSON.parse(read(join(relDir, 'package.json'))).version;
}

// Each entry describes one version location. pattern must capture the version
// string in group 1. All 5 locations are checked explicitly — including the two
// inline strings in server.ts and cli/src/index.ts that do not follow the
// VERSION = '...' pattern and are therefore the most likely to drift.
const CHECKS = [
  {
    label: '@sensigo/realm VERSION constant',
    pkgDir: 'packages/core',
    sourceFile: 'packages/core/src/index.ts',
    pattern: /export const VERSION = '([^']+)'/,
  },
  {
    label: '@sensigo/realm-mcp VERSION constant',
    pkgDir: 'packages/mcp-server',
    sourceFile: 'packages/mcp-server/src/index.ts',
    pattern: /export const VERSION = '([^']+)'/,
  },
  {
    label: '@sensigo/realm-testing VERSION constant',
    pkgDir: 'packages/testing',
    sourceFile: 'packages/testing/src/index.ts',
    pattern: /export const VERSION = '([^']+)'/,
  },
  {
    label: '@sensigo/realm-mcp McpServer constructor version',
    pkgDir: 'packages/mcp-server',
    sourceFile: 'packages/mcp-server/src/server.ts',
    pattern: /version: '([^']+)'/,
  },
  {
    label: '@sensigo/realm-cli Commander .version() call',
    pkgDir: 'packages/cli',
    sourceFile: 'packages/cli/src/index.ts',
    pattern: /\.version\('([^']+)'\)/,
  },
];

let failed = false;

for (const { label, pkgDir, sourceFile, pattern } of CHECKS) {
  const expected = pkgVersion(pkgDir);
  const source = read(sourceFile);
  const match = pattern.exec(source);

  if (!match) {
    console.error(`✗ ${label}: pattern not found in ${sourceFile}`);
    failed = true;
    continue;
  }

  const actual = match[1];
  if (actual !== expected) {
    console.error(
      `✗ ${label}: source has '${actual}', package.json has '${expected}' (${sourceFile})`,
    );
    failed = true;
  } else {
    console.log(`✓ ${label}: ${actual}`);
  }
}

if (failed) {
  console.error('\nVersion mismatch detected. Run the release script to sync all version strings.');
  process.exit(1);
}

console.log('\nAll version strings match.');
