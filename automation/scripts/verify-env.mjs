#!/usr/bin/env node
/**
 * Technical environment verification for the automation base.
 *
 * READ-ONLY: it inspects the runtime and the installed packages. It never
 * installs anything and it never touches a real application. Browsers can be
 * prepared separately with `npm run browsers:install`.
 *
 * Exit codes:
 *   0  every check passed
 *   1  one or more checks failed (see the printed detail)
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import process from 'node:process';

const require = createRequire(import.meta.url);
const TARGET_NODE_MAJOR = 24;

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });

function tryRequire(specifier) {
  try {
    return require(specifier);
  } catch {
    return null;
  }
}

// 1) Node.js runtime
const nodeVersion = process.versions.node;
add(
  'node runtime',
  Number(nodeVersion.split('.')[0]) === TARGET_NODE_MAJOR,
  `v${nodeVersion} (target major ${TARGET_NODE_MAJOR}.x)`,
);

// 2) npm (executed through a shell so it works on Windows where npm is npm.cmd)
let npmVersion = 'not found';
try {
  npmVersion = execSync('npm --version', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  /* keep default */
}
add('npm', /^\d+\.\d+\.\d+/.test(npmVersion), npmVersion);

// 3) Playwright Test package
const playwrightPkg = tryRequire('@playwright/test/package.json');
add(
  '@playwright/test installed',
  Boolean(playwrightPkg),
  playwrightPkg ? playwrightPkg.version : 'not installed (run: npm ci)',
);

// 4) Chromium browser binary
const playwright = tryRequire('@playwright/test');
let browserOk = false;
let browserDetail = 'skipped (@playwright/test not installed)';
if (playwright && typeof playwright.chromium?.executablePath === 'function') {
  try {
    const execPath = playwright.chromium.executablePath();
    browserOk = existsSync(execPath);
    browserDetail = `${browserOk ? 'present' : 'missing'} -> ${execPath}`;
  } catch (error) {
    browserDetail = `error: ${error.message}`;
  }
}
add('chromium browser binary', browserOk, browserDetail);

// 5) Lockfile present -> reproducible install via `npm ci`
add(
  'package-lock.json present',
  existsSync(new URL('../../package-lock.json', import.meta.url)),
  'npm ci can reproducibly install the pinned dependency tree',
);

let failed = 0;
for (const check of checks) {
  if (!check.ok) failed += 1;
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(26)} ${check.detail}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
