#!/usr/bin/env node
/**
 * M-03 — Reusable automation runner for the QA Agent.
 *
 * Executes persisted automated Test Cases (Playwright Test, Web + API) through
 * reproducible CLI commands, without requiring an AI model for each step.
 *
 * Flow per run (documented in docs/RUNNER-M03.md):
 *   1. load + validate a suite manifest (automation/manifests/<suite_id>.json);
 *   2. resolve the selected Test Cases and their spec files;
 *   3. start the suite's isolated web server (if declared);
 *   4. run the M-04 pre-flight detector (python) — READY or BLOCKED with causes;
 *   5. run Playwright Test with the selected spec files (custom config);
 *   6. map raw results to Test Case traces and promote evidence;
 *   7. write `execution_trace.json` (execution-trace contract, M-01 valid),
 *      `preflight_record.json` (pre-flight-record, M-01 valid) and
 *      `summary.json` under `<out>`.
 *
 * The runner records status PASS/FAIL/SKIPPED and the evidence; it NEVER
 * classifies a FAIL as an APP_BUG (that is Bug Analyst's responsibility).
 * Exit codes: 0 = all PASS, 1 = any FAIL/SKIPPED, 2 = usage/fatal,
 *             3 = pre-flight BLOCKED (automation not started).
 */

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import {
  basename,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReports, type ReportInput } from './report.js';
import { executeDataVerification, type DataVerificationRequest } from './sqlite-adapter.js';

const HERE = fileURLToPath(new URL('.', import.meta.url)); // <root>/automation/.dist/runner/
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const MANIFESTS_DIR = join(REPO_ROOT, 'automation', 'manifests');
const PREFLIGHT_PY = join(REPO_ROOT, 'qa', 'tools', 'preflight.py');
const VALIDATE_CONTRACTS_PY = join(REPO_ROOT, 'qa', 'tools', 'validate_contracts.py');
const PLAYWRIGHT_CLI = join(REPO_ROOT, 'node_modules', 'playwright', 'cli.js');
const RUNNER_CONFIG = join(REPO_ROOT, 'automation', 'runner', 'config.ts');

const EXIT_OK = 0;
const EXIT_FAILURES = 1;
const EXIT_USAGE = 2;
const EXIT_PREFLIGHT_BLOCKED = 3;

const PLATFORMS = ['web', 'pwa', 'api', 'hybrid', 'native', 'static'];
const ADAPTERS = ['playwright'];

interface TcDef {
  test_case_id: string;
  title: string;
  spec: string;
  test_name: string;
  expected_result: string;
}

interface Manifest {
  suite_id: string;
  app: string;
  platform: string;
  adapter: string;
  description?: string;
  web_server?: { command: string; url: string; timeout_ms?: number };
  requirements: { task?: string; scope?: string; platform?: string; need: Record<string, unknown> };
  test_cases: TcDef[];
  data_verifications?: DataVerificationRequest[];
}

interface PreflightRecord {
  preflight_id?: string;
  result?: string;
  blocked_reasons?: unknown[];
  checks?: unknown[];
}

interface RawAttachment {
  name?: string;
  contentType?: string;
  path?: string;
  body?: string;
}

interface RawAttempt {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  startTime: string;
  duration: number;
  errors: Array<{ message?: string }>;
  attachments: RawAttachment[];
}

interface RawTestDef {
  title?: string;
  expectedStatus?: string;
  results?: RawAttempt[];
}

interface RawSpec {
  title?: string;
  ok?: boolean;
  tests?: RawTestDef[];
}

interface RawSuite {
  title?: string;
  file?: string;
  suites?: RawSuite[];
  specs?: RawSpec[];
}

interface RawReport {
  suites: RawSuite[];
  /**
   * Errors reported by Playwright that are NOT attached to a specific test
   * (e.g. an unhandled rejection, a worker crash or a global hook failure).
   * They make the Playwright process exit non-zero even when every mapped test
   * result is `passed`, so they must not be ignored.
   */
  errors?: Array<{ message?: string }>;
}

interface FlatTest { file: string; title: string; attempt: RawAttempt }

interface RunnerArgs {
  suite?: string;
  manifest?: string;
  tc: string[];
  out?: string;
  noPreflight: boolean;
  python: string;
  autohealStore?: string;
  help: boolean;
}

class FatalError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

// -- helpers ----------------------------------------------------------------//

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function normPath(p: string): string {
  return p.split(sep).join('/');
}

function makeRunId(): string {
  return `R-${new Date().toISOString().replace(/[^A-Za-z0-9]/g, '')}`;
}

function fail(message: string, code: number): never {
  throw new FatalError(message, code);
}

function parseArgs(argv: string[]): RunnerArgs {
  const args: RunnerArgs = { tc: [], noPreflight: false, python: 'python', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--suite':
        args.suite = argv[++i];
        break;
      case '--manifest':
        args.manifest = argv[++i];
        break;
      case '--tc': {
        const list = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        args.tc.push(...list);
        break;
      }
      case '--out':
        args.out = argv[++i];
        break;
      case '--no-preflight':
        args.noPreflight = true;
        break;
      case '--python':
        args.python = argv[++i];
        break;
      case '--autoheal-store':
        args.autohealStore = argv[++i];
        break;
      default:
        fail(`unknown argument: ${a}`, EXIT_USAGE);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`M-03 reusable automation runner

Usage: node automation/.dist/runner/runner.js --suite <suite_id> [options]

Options:
  --suite <id>          Suite id registered in automation/manifests/<id>.json
  --manifest <path>     Load the manifest from an explicit path instead (repo-relative or absolute)
  --tc <a,b>            Run only the given Test Case ids (default: all in the suite)
  --out <dir>           Run output dir (default: automation/.runs/<suite_id>/<run_id>)
  --no-preflight        Debug only: skip the M-04 pre-flight gate
  --python <exe>        Python executable used for the pre-flight detector (default: python)
  --autoheal-store <p>  Persistent auto-healing reuse store (M-05) shared across runs.
                        Default: <out>/autoheal_store.json (per-run, no cross-run reuse)
  -h, --help            Show this help

Exit codes:
  0  all selected Test Cases PASS
  1  at least one FAIL or SKIPPED
  2  usage / fatal (missing suite, invalid manifest, missing spec or report)
  3  pre-flight BLOCKED (automation was not started; traces record the block)`);
}

function loadManifest(args: RunnerArgs): Manifest {
  if (!args.suite) fail('missing required argument: --suite <suite_id>', EXIT_USAGE);
  const file = args.manifest
    ? resolve(REPO_ROOT, args.manifest)
    : join(MANIFESTS_DIR, `${args.suite}.json`);
  if (!existsSync(file)) {
    fail(`suite not found: '${args.suite}' (expected manifest at ${normPath(relative(REPO_ROOT, file))})`, EXIT_USAGE);
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    fail(`invalid JSON in suite manifest '${file}': ${(e as Error).message}`, EXIT_USAGE);
  }
  const errors: string[] = [];
  const suiteId = data.suite_id;
  if (!isStr(suiteId) || suiteId.length === 0) errors.push('suite_id (non-empty string) is required');
  else if (suiteId !== args.suite) errors.push(`suite_id mismatch: manifest declares '${suiteId}' but --suite is '${args.suite}'`);
  if (!isStr(data.app) || data.app.length === 0) errors.push('app (non-empty string) is required');
  if (!isStr(data.platform) || !PLATFORMS.includes(data.platform)) errors.push(`platform must be one of: ${PLATFORMS.join(', ')}`);
  if (data.adapter !== 'playwright') errors.push("adapter must be 'playwright' (M-03 stage)");
  const need = (data.requirements as Record<string, unknown> | undefined)?.need;
  if (!need || typeof need !== 'object' || Array.isArray(need)) errors.push('requirements.need (object) is required');
  const autoHealing = need && typeof need === 'object' ? (need as Record<string, unknown>).auto_healing : undefined;
  if (autoHealing !== undefined) {
    if (typeof autoHealing !== 'object' || Array.isArray(autoHealing)) {
      errors.push('requirements.need.auto_healing (object) is required when declared');
    } else {
      const ah = autoHealing as Record<string, unknown>;
      if (!['OFF', 'OBSERVE', 'HIGH_CONFIDENCE'].includes(String(ah.mode ?? ''))) {
        errors.push(`requirements.need.auto_healing.mode must be OFF|OBSERVE|HIGH_CONFIDENCE (got '${String(ah.mode)}')`);
      }
      if (ah.store !== undefined && !isStr(ah.store)) {
        errors.push('requirements.need.auto_healing.store must be a string path');
      }
    }
  }
  if (!Array.isArray(data.test_cases) || data.test_cases.length === 0) errors.push('test_cases (non-empty array) is required');
  for (const [i, tc] of (data.test_cases as unknown[] | undefined)?.entries() ?? []) {
    const t = tc as Record<string, unknown> | undefined;
    if (!t) { errors.push(`test_cases[${i}] must be an object`); continue; }
    if (!isStr(t.test_case_id) || !/^TC-[\w.-]+$/.test(t.test_case_id)) errors.push(`test_cases[${i}].test_case_id must match ^TC-[\\w.-]+$`);
    if (!isStr(t.title) || t.title.length === 0) errors.push(`test_cases[${i}].title is required`);
    if (!isStr(t.spec) || t.spec.length === 0) errors.push(`test_cases[${i}].spec is required`);
    if (!isStr(t.test_name) || t.test_name.length === 0) errors.push(`test_cases[${i}].test_name is required (exact Playwright test title)`);
    if (!isStr(t.expected_result) || t.expected_result.length === 0) errors.push(`test_cases[${i}].expected_result is required`);
  }
  if (errors.length > 0) {
    fail(`invalid suite manifest '${normPath(relative(REPO_ROOT, file))}': ${errors.join('; ')}`, EXIT_USAGE);
  }
  return data as unknown as Manifest;
}

function selectTestCases(manifest: Manifest, requested: string[]): TcDef[] {
  if (requested.length === 0) return [...manifest.test_cases];
  const byId = new Map(manifest.test_cases.map((tc) => [tc.test_case_id, tc]));
  const missing = requested.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    fail(`unknown test case(s) in suite '${manifest.suite_id}': ${missing.join(', ')}`, EXIT_USAGE);
  }
  return requested.map((id) => byId.get(id)!);
}

// -- external processes ----------------------------------------------------//

function runCapture(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => resolvePromise({ code: null, stdout: '', stderr: `spawn error: ${err.message}` }));
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function runPreflight(manifest: Manifest, evidenceDir: string, outDir: string, python: string): Promise<PreflightRecord> {
  const need = { ...manifest.requirements.need, evidence_dir: evidenceDir, requires_evidence: true };
  const reqFile = join(outDir, 'preflight.requirements.json');
  writeFileSync(reqFile, JSON.stringify({
    task: manifest.requirements.task ?? manifest.suite_id,
    scope: manifest.requirements.scope ?? `suite ${manifest.suite_id}`,
    platform: manifest.requirements.platform ?? manifest.platform,
    need,
  }, null, 2), 'utf8');
  const res = await runCapture(python, [PREFLIGHT_PY, '--requirements', reqFile, '--json'], REPO_ROOT);
  if (res.code === null || res.code === 2) {
    fail(`pre-flight fatal (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`, EXIT_USAGE);
  }
  let record: PreflightRecord;
  try {
    record = JSON.parse(res.stdout.trim()) as PreflightRecord;
  } catch {
    fail(`pre-flight produced an unparseable record (exit ${res.code}): ${res.stdout.trim()} ${res.stderr.trim()}`, EXIT_USAGE);
  }
  writeFileSync(join(outDir, 'preflight_record.json'), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

function startServer(cfg: { command: string; url: string; timeout_ms?: number }): Promise<() => void> {
  const parts = cfg.command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) fail(`invalid web_server.command: '${cfg.command}'`, EXIT_USAGE);
  const [cmd, ...cmdArgs] = parts;
  const child = spawn(cmd, cmdArgs, { cwd: REPO_ROOT, stdio: 'ignore', windowsHide: true });
  const stop = (): void => {
    try { child.kill(); } catch { /* already gone */ }
  };
  const deadline = Date.now() + (cfg.timeout_ms ?? 15_000);
  return new Promise((resolvePromise) => {
    const poll = async (): Promise<void> => {
      if (Date.now() > deadline || child.exitCode !== null) {
        stop();
        fail(`web server did not become reachable at ${cfg.url} (command: ${cfg.command})`, EXIT_USAGE);
      }
      try {
        const res = await fetch(cfg.url, { signal: AbortSignal.timeout(2_000) });
        if (res.status < 500) { resolvePromise(stop); return; }
      } catch { /* keep polling */ }
      setTimeout(() => void poll(), 300);
    };
    void poll();
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runPlaywright(
  specFiles: string[],
  outDir: string,
  targetUrl: string,
  autoheal: { mode: string; store: string; runId: string; app: string; suiteId: string },
  testNames: string[],
): Promise<number> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    QAA_TARGET_URL: targetUrl,
    QAA_RUNNER_OUT: outDir,
    QAA_AUTOHEAL_MODE: autoheal.mode,
    QAA_AUTOHEAL_STORE: autoheal.store,
    QAA_AUTOHEAL_OUT: outDir,
    QAA_AUTOHEAL_RUN_ID: autoheal.runId,
    QAA_APP: autoheal.app,
    QAA_SUITE_ID: autoheal.suiteId,
  };
  // Playwright CLI positional args are filters over test files: relative
  // repo-root paths (forward slashes) match the files in the runner config
  // (testDir = <root>/automation). Spawn cwd is the repo root.
  // Selection must also filter at Playwright level: otherwise a spec file with
  // several Test Cases would execute them all, and unselected tests could have
  // side effects (e.g. an M-05 store chain invalidating a verified entry). The
  // exact test titles are passed as an anchored --grep alternation.
  const filters = Array.from(new Set(specFiles.map((f) => normPath(relative(REPO_ROOT, f)))));
  const grep = testNames.map((t) => `${escapeRegExp(t)}$`).join('|');
  const args = ['test', '--config', RUNNER_CONFIG, ...(grep ? ['--grep', grep] : []), ...filters];
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, ...args], { cwd: REPO_ROOT, env, stdio: 'inherit', windowsHide: true });
    child.on('error', (err) => fail(`failed to start Playwright: ${err.message}`, EXIT_USAGE));
    child.on('close', (code) => resolvePromise(code ?? EXIT_USAGE));
  });
}

// -- raw report mapping ----------------------------------------------------//

function flattenReport(raw: RawReport): FlatTest[] {
  const out: FlatTest[] = [];
  const walk = (suite: RawSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const attempts = t.results ?? [];
        const attempt = attempts.length > 0 ? attempts[attempts.length - 1] : undefined;
        if (attempt) out.push({ file: suite.file ?? '', title: spec.title ?? '', attempt });
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of raw.suites ?? []) walk(s);
  return out;
}

function readRawReport(outDir: string): RawReport {
  const file = join(outDir, 'results.raw.json');
  if (!existsSync(file)) fail(`Playwright produced no JSON report at ${normPath(relative(REPO_ROOT, file))} (infrastructure error)`, EXIT_USAGE);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RawReport;
  } catch (e) {
    fail(`cannot parse Playwright JSON report: ${(e as Error).message}`, EXIT_USAGE);
  }
}

function copyAttachment(target: string, outDir: string, evidenceDir: string): string | null {
  if (!existsSync(target)) return null;
  const rel = normPath(relative(REPO_ROOT, outDir));
  const destDir = resolve(evidenceDir);
  const fileName = basename(target);
  const dest = join(destDir, fileName);
  try {
    copyFileSync(target, dest);
    return `${rel}/evidence/${fileName}`;
  } catch {
    return null;
  }
}

function decodeAssertions(attempt: RawAttempt): Array<{ assertion: string; passed: boolean; detail?: string }> {
  const att = attempt.attachments?.find((a) => a.name === 'assertions.json');
  if (!att?.body) return [];
  try {
    const parsed = JSON.parse(Buffer.from(att.body, 'base64').toString('utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildEvidence(attempt: RawAttempt, evidenceDir: string, outDir: string, tc: TcDef): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const att of attempt.attachments ?? []) {
    if (att.path && existsSync(att.path) && !seen.has(att.path)) {
      seen.add(att.path);
      const rel = copyAttachment(att.path, outDir, evidenceDir);
      if (rel) paths.push(rel);
    }
  }
  const extra = join(evidenceDir, `${tc.test_case_id}_assertions.json`);
  const assertions = decodeAssertions(attempt);
  if (assertions.length > 0) {
    writeFileSync(extra, JSON.stringify(assertions, null, 2), 'utf8');
    paths.push(`${normPath(relative(REPO_ROOT, outDir))}/evidence/${tc.test_case_id}_assertions.json`);
  }
  return paths;
}

function errorText(attempt: RawAttempt): string {
  const text = (attempt.errors ?? []).map((e) => e?.message ?? '').filter(Boolean).join(' | ');
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/**
 * Builds the infrastructure-error message recorded when the Playwright process
 * exits non-zero but no mapped Test Case (or data verification) explains the
 * failure. Only the exit code and the first line of the first global error are
 * included: enough to act on it without dumping unrelated text into the report.
 */
function playwrightFailureMessage(code: number, raw: RawReport): string {
  const first = (raw.errors ?? [])
    .map((e) => (e?.message ?? '').split('\n')[0].trim())
    .filter(Boolean)[0];
  const detail = first ? ` First error: ${first.slice(0, 200)}` : '';
  return `Playwright process exited with code ${code}, but no mapped Test Case recorded FAIL or SKIPPED: ` +
    `the failure is not represented in the consolidated result.${detail}`;
}

function mapTests(
  manifest: Manifest,
  selected: TcDef[],
  raw: RawReport,
  outDir: string,
  runId: string,
): { traces: Record<string, unknown>[]; passed: number; failed: number; skipped: number; unmatched: number } {
  const flat = flattenReport(raw);
  const traces: Record<string, unknown>[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const matchedFiles = new Set<string>();

  for (const tc of selected) {
    const specRel = normPath(tc.spec);
    const specAbs = normPath(resolve(REPO_ROOT, tc.spec));
    const matches = flat.filter((f) => {
      const fileNorm = normPath(f.file);
      return (
        fileNorm === specRel ||
        fileNorm === specAbs ||
        fileNorm.endsWith(specRel) ||
        normPath(resolve(REPO_ROOT, fileNorm)) === specAbs
      );
    });
    const byTitle = matches.filter((f) => f.title === tc.test_name);
    if (byTitle.length === 0) {
      fail(`no automated test matched Test Case '${tc.test_case_id}' (spec ${tc.spec}, test_name '${tc.test_name}')`, EXIT_USAGE);
    }
    if (byTitle.length > 1) {
      fail(`ambiguous match for Test Case '${tc.test_case_id}': ${byTitle.length} tests named '${tc.test_name}'`, EXIT_USAGE);
    }
    const attempt = byTitle[0].attempt;
    matchedFiles.add(byTitle[0].file);
    traces.push(buildTrace(manifest, runId, tc, attempt, outDir));
    if (attempt.status === 'passed') passed += 1;
    else if (attempt.status === 'skipped' || attempt.status === 'interrupted') skipped += 1;
    else failed += 1;
  }
  const unmatched = flat.filter((f) => !matchedFiles.has(f.file)).length;
  return { traces, passed, failed, skipped, unmatched };
}

function buildTrace(manifest: Manifest, runId: string, tc: TcDef, attempt: RawAttempt, outDir: string): Record<string, unknown> {
  const evidenceDir = join(outDir, 'evidence');
  const status = attempt.status === 'passed' ? 'PASS' : (attempt.status === 'skipped' || attempt.status === 'interrupted' ? 'SKIPPED' : 'FAIL');
  const executed = attempt.status !== 'skipped' && attempt.status !== 'interrupted';
  const executionSuccess = attempt.status === 'passed';
  const validationPerformed = executed;
  const assertions = decodeAssertions(attempt);
  const evidence = buildEvidence(attempt, evidenceDir, outDir, tc);
  const startedAt = attempt.startTime || new Date().toISOString();
  const endedAt = new Date(new Date(startedAt).getTime() + (attempt.duration ?? 0)).toISOString();
  const err = status === 'FAIL' ? errorText(attempt) : undefined;

  let resultObtained: string;
  let resultValidated: string | undefined;
  let actualResult: string;
  let notes: string | undefined;

  if (status === 'PASS') {
    resultObtained = `PASS — '${tc.title}' produced the Expected Result`;
    actualResult = `Expected outcome observed; ${assertions.length} assertion(s) recorded`;
    resultValidated = `Validated against Expected Result with ${assertions.length} assertion(s); evidence attached`;
  } else if (status === 'FAIL') {
    resultObtained = `FAIL — ${err || 'assertion/steps failed'}`;
    actualResult = `Expected Result not met; ${assertions.length} assertion(s) recorded, ${assertions.filter((a) => !a.passed).length} failed`;
    resultValidated = 'Validation performed: expected vs observed mismatch recorded (evidence attached). Failure Classification pending (Bug Analyst); FAIL does not imply APP_BUG.';
    notes = 'Status FAIL is execution evidence only; classification (APP_BUG/TEST_DATA/TEST_INFRASTRUCTURE/BLOCKED/INSUFFICIENT_EVIDENCE) is decided later, never by the runner.';
  } else {
    resultObtained = 'SKIPPED — test skipped by the automation, no assertion performed';
    actualResult = 'Not executed';
    notes = 'Skipped tests carry no validation (validation_performed=false).';
  }

  return {
    trace_id: `TR-${runId}-${tc.test_case_id}`,
    context: `${tc.test_case_id} ${tc.title}`,
    tool_requested: `runner:${manifest.suite_id}:${basename(tc.spec)}:${tc.test_name}`,
    tool_executed: `runner:playwright:${tc.spec}`,
    executed,
    execution_success: executionSuccess,
    result_obtained: resultObtained,
    ...(resultValidated ? { result_validated: resultValidated } : {}),
    expected_result: tc.expected_result,
    actual_result: actualResult,
    evidence,
    validation_performed: validationPerformed,
    confidence: status === 'PASS' ? 'HIGH' : (status === 'FAIL' ? 'MEDIUM' : 'LOW'),
    test_case_id: tc.test_case_id,
    title: tc.title,
    status,
    suite_id: manifest.suite_id,
    app: manifest.app,
    platform: manifest.platform,
    spec: tc.spec,
    run_id: runId,
    started_at: startedAt,
    ended_at: endedAt,
    assertions,
    ...(err ? { error: err } : {}),
    ...(notes ? { notes } : {}),
  };
}

function blockedTrace(manifest: Manifest, runId: string, tc: TcDef, causes: unknown[]): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    trace_id: `TR-${runId}-${tc.test_case_id}`,
    context: `${tc.test_case_id} ${tc.title}`,
    tool_requested: `runner:${manifest.suite_id}:${tc.test_case_id}:preflight`,
    tool_executed: `runner:preflight:${manifest.suite_id}`,
    executed: false,
    execution_success: false,
    result_obtained: 'Blocked by pre-flight; automation not executed',
    expected_result: tc.expected_result,
    actual_result: 'Not executed (pre-flight BLOCKED)',
    evidence: [],
    validation_performed: false,
    confidence: 'MEDIUM',
    test_case_id: tc.test_case_id,
    title: tc.title,
    status: 'BLOCKED',
    suite_id: manifest.suite_id,
    app: manifest.app,
    platform: manifest.platform,
    spec: tc.spec,
    run_id: runId,
    started_at: now,
    ended_at: now,
    assertions: [],
    notes: `Pre-flight BLOCKED: ${(causes ?? []).join(' | ')}`,
    block_reason: (causes ?? []).map((c) => String(c)).join(' | '),
  };
}

function traceWrapper(manifest: Manifest, runId: string, traces: Record<string, unknown>[]): Record<string, unknown> {
  return {
    suite_id: manifest.suite_id,
    rule: 'tool_requested -> tool_executed -> execution_success -> result_obtained -> result_validated. Un intento de ejecucion no equivale a ejecucion exitosa, y una ejecucion exitosa no equivale a resultado validado.',
    run_id: runId,
    app: manifest.app,
    platform: manifest.platform,
    traces,
  };
}

function writeSummary(
  outDir: string,
  manifest: Manifest,
  runId: string,
  counts: { selected: number; passed: number; failed: number; errors: number; skipped: number; blocked: number; preflight: string; evidence: number; playwright_exit_code?: number; infrastructure_errors?: number },
  heal?: AutoHealStats,
): void {
  const payload: Record<string, unknown> = {
    run_id: runId,
    suite_id: manifest.suite_id,
    app: manifest.app,
    platform: manifest.platform,
    preflight: counts.preflight,
    selected: counts.selected,
    passed: counts.passed,
    failed: counts.failed,
    errors: counts.errors,
    skipped: counts.skipped,
    blocked: counts.blocked,
    evidence_files: counts.evidence,
    ...(counts.playwright_exit_code !== undefined ? { playwright_exit_code: counts.playwright_exit_code } : {}),
    ...(counts.infrastructure_errors !== undefined ? { infrastructure_errors: counts.infrastructure_errors } : {}),
    generated_at: new Date().toISOString(),
  };
  if (heal && (heal.attempts > 0 || heal.mode !== 'OFF')) {
    payload.auto_healing = {
      mode: heal.mode,
      attempts: heal.attempts,
      recoveries_used: heal.recoveries_used,
      reused: heal.reused,
      duplicate_prevented: heal.duplicate_prevented,
      ai_calls: 0,
    };
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(payload, null, 2), 'utf8');
}

function printResults(traces: Record<string, unknown>[]): void {
  for (const t of traces) {
    console.log(`[${t.status}] ${t.test_case_id} ${t.title} (${t.spec})`);
  }
}

// -- M-02 report generation -------------------------------------------------//

/**
 * Computes the duration of a Test Case from its started_at/ended_at trace
 * timestamps. Returns 0 when either timestamp is missing, unparsable, or when
 * the computed duration would be negative (clock skew). Never invents a value.
 */
function caseDurationMs(startedAt: unknown, endedAt: unknown): number {
  if (typeof startedAt !== 'string' || typeof endedAt !== 'string') return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const delta = end - start;
  if (!Number.isFinite(delta) || delta < 0) return 0;
  return Math.round(delta);
}

function buildReportInput(
  manifest: Manifest,
  runId: string,
  outDir: string,
  startedAt: string,
  overallStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'PARTIAL',
  counts: { selected: number; passed: number; failed: number; errors: number; skipped: number; blocked: number },
  preflightResult: string,
  blockedReasons: string[],
  traces: Record<string, unknown>[],
  infraErrors: string[] = [],
  heal?: AutoHealStats,
): ReportInput {
  const endedAt = new Date().toISOString();
  const omitted = counts.selected - counts.passed - counts.failed - counts.errors - counts.skipped - counts.blocked;

  const cases = traces.map((t) => {
    const tc = t as Record<string, unknown>;
    const evidence = (tc.evidence as string[]) ?? [];
    const autoHealing = tc.auto_healing as Record<string, unknown> | undefined;
    return {
      test_case_id: String(tc.test_case_id ?? ''),
      title: String(tc.title ?? ''),
      status: tc.status as 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED',
      duration_ms: caseDurationMs(tc.started_at, tc.ended_at),
      spec: String(tc.spec ?? ''),
      ...(tc.error ? { error: String(tc.error) } : {}),
      ...(tc.block_reason ? { block_reason: String(tc.block_reason) } : {}),
      evidence,
      ...(autoHealing ? { auto_healing: autoHealing } : {}),
    };
  });

  const evidenceIndex = traces.flatMap((t) => {
    const tc = t as Record<string, unknown>;
    const tcId = String(tc.test_case_id ?? '');
    return ((tc.evidence as string[]) ?? []).map((path) => ({
      path,
      type: 'screenshot' as const,
      test_case_id: tcId,
    }));
  });

  const input: ReportInput = {
    run_id: runId,
    suite_id: manifest.suite_id,
    app: manifest.app,
    platform: manifest.platform,
    started_at: startedAt,
    ended_at: endedAt,
    overall_status: overallStatus,
    summary: {
      selected: counts.selected,
      executed: counts.passed + counts.failed + counts.errors,
      passed: counts.passed,
      failed: counts.failed,
      errors: counts.errors,
      blocked: counts.blocked,
      skipped: counts.skipped,
      omitted: Math.max(0, omitted),
    },
    cases,
    preflight: {
      result: preflightResult as 'READY' | 'BLOCKED' | 'SKIPPED',
      ...(preflightResult === 'BLOCKED' ? { blocked_reasons: blockedReasons } : {}),
    },
    evidence_index: evidenceIndex,
  };

  if (infraErrors.length > 0) {
    input.infrastructure_errors = infraErrors;
  }

  if (heal && (heal.attempts > 0 || heal.mode !== 'OFF')) {
    input.auto_healing = {
      mode: heal.mode as 'OFF' | 'OBSERVE' | 'HIGH_CONFIDENCE',
      attempts: heal.attempts,
      recoveries_used: heal.recoveries_used,
      reused: heal.reused,
      duplicate_prevented: heal.duplicate_prevented,
      ai_calls: 0,
    };
  }

  return input;
}

function writeExecutionReports(
  outDir: string,
  manifest: Manifest,
  runId: string,
  startedAt: string,
  overallStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'PARTIAL',
  counts: { selected: number; passed: number; failed: number; errors: number; skipped: number; blocked: number },
  preflightResult: string,
  blockedReasons: string[],
  traces: Record<string, unknown>[],
  infraErrors: string[] = [],
  heal?: AutoHealStats,
): void {
  const input = buildReportInput(manifest, runId, outDir, startedAt, overallStatus, counts, preflightResult, blockedReasons, traces, infraErrors, heal);
  const { json, html } = generateReports(outDir, input, REPO_ROOT);
  console.log(`reports: ${normPath(relative(REPO_ROOT, json))}`);
  console.log(`reports: ${normPath(relative(REPO_ROOT, html))}`);
}

// -- M-05 auto-healing enrichment ----------------------------------------------//

interface AutoHealStats {
  mode: string;
  attempts: number;
  recoveries_used: number;
  reused: number;
  duplicate_prevented: number;
}

function ehMode(manifest: Manifest): string {
  const ah = manifest.requirements.need.auto_healing as Record<string, unknown> | undefined;
  return String(ah?.mode ?? 'OFF');
}

/**
 * Enriches the execution traces and the run record with the M-05 auto-healing
 * data produced by the adapter. The enrichment is read-only over results: it
 * never changes statuses; it only ADDS traceability. Attempts that do not
 * belong to a selected Test Case are dropped from the record (they are not part
 * of the suite), and every kept attempt is tagged with its test_case_id.
 */
function enrichAutoHealing(outDir: string, manifest: Manifest, selected: TcDef[], traces: Record<string, unknown>[]): AutoHealStats {
  const recordPath = join(outDir, 'autoheal_record.json');
  const mode = ehMode(manifest);
  const stats: AutoHealStats = { mode, attempts: 0, recoveries_used: 0, reused: 0, duplicate_prevented: 0 };
  if (!existsSync(recordPath)) return stats;
  let raw: unknown[];
  try {
    const parsed = JSON.parse(readFileSync(recordPath, 'utf8'));
    raw = Array.isArray(parsed) ? parsed : [];
  } catch {
    return stats; // a corrupt record stays untouched; the raw report still stands
  }
  const byTc = new Map(selected.map((tc) => [tc.test_case_id, tc]));
  const kept: Record<string, unknown>[] = [];
  for (const trace of traces) {
    const tcId = String((trace as Record<string, unknown>).test_case_id ?? '');
    const tc = byTc.get(tcId);
    if (!tc) continue;
    const key = `${normPath(tc.spec)}::${tc.test_name}`;
    const matched = raw.filter((a) => {
      const ar = a as Record<string, unknown>;
      return `${normPath(String(ar.spec ?? ''))}::${String(ar.test_title ?? '')}` === key;
    });
    if (matched.length === 0) continue;
    for (const a of matched) {
      const ar = a as Record<string, unknown>;
      ar.test_case_id = tcId;
      kept.push(ar);
      stats.attempts += 1;
      if (ar.used_recovery === true) stats.recoveries_used += 1;
      if (ar.reused_from_store === true) stats.reused += 1;
      if (ar.duplicate_prevented === true) stats.duplicate_prevented += 1;
    }
    const used = matched.some((a) => (a as Record<string, unknown>).used_recovery === true);
    const traceHeal: Record<string, unknown> = {
      mode,
      attempts: matched.length,
      heal_ids: matched.map((a) => (a as Record<string, unknown>).heal_id).filter((v): v is string => typeof v === 'string'),
      used_recovery: used,
      reused_from_store: matched.some((a) => (a as Record<string, unknown>).reused_from_store === true),
      duplicate_prevented: matched.some((a) => (a as Record<string, unknown>).duplicate_prevented === true),
      record: normPath(relative(REPO_ROOT, recordPath)),
      ai_calls: 0,
    };
    if (used) {
      traceHeal.evidence = matched.flatMap((a) => {
        const ev = (a as Record<string, unknown>).evidence;
        return Array.isArray(ev) ? (ev as string[]) : [];
      });
    }
    (trace as Record<string, unknown>).auto_healing = traceHeal;
    if (used) {
      const recovered = matched.filter((a) => (a as Record<string, unknown>).used_recovery === true).length;
      const note = `Auto-healing (M-05): ${matched.length} attempt(s), ${recovered} selector(s) recovered/reused. ` +
        'Recovery only selects locators: it never changes Expected Results, never converts FAIL into PASS; ' +
        'status stays as produced by the assertions. Classification pending (Bug Analyst).';
      const prev = (trace as Record<string, unknown>).notes as string | undefined;
      (trace as Record<string, unknown>).notes = prev ? `${prev} ${note}` : note;
    }
  }
  if (kept.length > 0 || raw.length > 0) {
    // only attempts of the selected Test Cases remain in the record
    writeFileSync(recordPath, JSON.stringify(kept, null, 2), 'utf8');
  }
  return stats;
}

/** Adds test_case_id provenance to the reuse store entries (machine state, best-effort). */
function enrichStore(storePath: string, selected: TcDef[]): void {
  if (!existsSync(storePath)) return;
  try {
    const store = JSON.parse(readFileSync(storePath, 'utf8')) as { entries?: Array<Record<string, unknown>> };
    if (!Array.isArray(store.entries)) return;
    const byKey = new Map(selected.map((tc) => [`${normPath(tc.spec)}::${tc.test_name}`, tc]));
    let changed = false;
    for (const entry of store.entries) {
      const tc = byKey.get(`${normPath(String(entry.spec ?? ''))}::${String(entry.test_title ?? '')}`);
      if (tc && entry.test_case_id !== tc.test_case_id) {
        entry.test_case_id = tc.test_case_id;
        changed = true;
      }
    }
    if (changed) writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // machine state enrichment is best-effort and never blocks the run
  }
}

function resolveTarget(manifest: Manifest): string {
  const need = manifest.requirements.need as { target?: { url?: string } } | undefined;
  const declared = need?.target?.url;
  const url = declared ?? manifest.web_server?.url ?? process.env.QAA_TARGET_URL ?? '';
  return url.replace(/\/+$/, '');
}

// -- M-06 data verification ------------------------------------------------//

interface DataVerificationTrace {
  verification_id: string;
  description: string;
  status: 'PASS' | 'FAIL' | 'ERROR';
  query: string;
  params?: unknown[];
  rows_returned: number;
  duration_ms: number;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  error?: string;
  evidence: string[];
}

/**
 * Executes all data verification requests declared in the suite manifest.
 * Returns the verification results and a summary count.
 */
function runDataVerifications(
  manifest: Manifest,
  outDir: string,
  runId: string,
): { results: DataVerificationTrace[]; passed: number; failed: number; errors: number } {
  const requests = manifest.data_verifications ?? [];
  const results: DataVerificationTrace[] = [];
  let passed = 0;
  let failed = 0;
  let errors = 0;

  for (const req of requests) {
    console.log(`data verification: ${req.verification_id} — ${req.description}`);
    const result = executeDataVerification(req, REPO_ROOT);

    const trace: DataVerificationTrace = {
      verification_id: result.verification_id,
      description: result.description,
      status: result.status,
      query: result.query,
      params: result.params,
      rows_returned: result.rows_returned,
      duration_ms: result.duration_ms,
      expected: result.expected as unknown as Record<string, unknown>,
      actual: result.actual as Record<string, unknown>,
      ...(result.error ? { error: result.error } : {}),
      evidence: result.evidence,
    };

    results.push(trace);

    if (result.status === 'PASS') {
      passed += 1;
      console.log(`  [PASS] ${req.verification_id}`);
    } else if (result.status === 'FAIL') {
      failed += 1;
      console.log(`  [FAIL] ${req.verification_id}: ${result.error}`);
    } else {
      errors += 1;
      console.log(`  [ERROR] ${req.verification_id}: ${result.error}`);
    }
  }

  // Write data_verification.json (M-01 contract: data-verification)
  if (results.length > 0) {
    writeFileSync(
      join(outDir, 'data_verification.json'),
      JSON.stringify(results, null, 2),
      'utf8',
    );
  }

  return { results, passed, failed, errors };
}

/**
 * Validates a generated artifact against its contract using the canonical M-01
 * validator (qa/tools/validate_contracts.py) — the same gate the QA bundle uses.
 *
 * This replaces a previous partial TypeScript check that reimplemented a weaker
 * subset of the schema and could therefore accept artifacts the contract rejects
 * (e.g. a verification_id without the `DV-` prefix). Delegating keeps a single
 * source of truth: no duplicated schema logic and no lighter runtime gate.
 */
async function validateArtifactM01(
  filePath: string,
  contract: string,
  python: string,
): Promise<{ ok: boolean; detail: string }> {
  const res = await runCapture(
    python,
    [VALIDATE_CONTRACTS_PY, '--contract', contract, '--file', filePath, '--json'],
    REPO_ROOT,
  );
  if (res.code === 0) return { ok: true, detail: '' };
  return { ok: false, detail: (res.stdout || res.stderr || '').trim() };
}

// -- main --------------------------------------------------------------------//

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return EXIT_OK;
  }
  const manifest = loadManifest(args);
  const selected = selectTestCases(manifest, args.tc);
  const runId = makeRunId();
  // Default out lives OUTSIDE qa/ on purpose: the M-01 bundle (`--bundle qa`)
  // must keep discovering only the curated business artifacts. Run
  // dirs are validated individually with `--bundle <out>`.
  const outDir = resolve(args.out ?? join(REPO_ROOT, 'automation', '.runs', manifest.suite_id, runId));
  // M-05: mode from the manifest need (OFF by default). The store defaults to
  // <out>/autoheal_store.json (per-run); --autoheal-store opts into cross-run
  // reuse. OFF never touches the store (M-03 only-writes-under-<out> guarantee).
  const ahNeed = manifest.requirements.need.auto_healing as Record<string, unknown> | undefined;
  const healMode = String(ahNeed?.mode ?? 'OFF');
  const declaredStore = typeof ahNeed?.store === 'string' ? (ahNeed.store as string) : '';
  const healStore = resolve(
    args.autohealStore ?? (declaredStore ? resolve(REPO_ROOT, declaredStore) : join(outDir, 'autoheal_store.json')),
  );
  mkdirSync(join(outDir, 'evidence'), { recursive: true });
  for (const tc of selected) {
    const spec = resolve(REPO_ROOT, tc.spec);
    if (!existsSync(spec)) {
      fail(`test case '${tc.test_case_id}' references a missing spec file: ${tc.spec}`, EXIT_USAGE);
    }
  }

  let stopServer: (() => void) | null = null;
  const startedAt = new Date().toISOString();
  try {
    let targetUrl = resolveTarget(manifest);
    if (manifest.web_server) {
      stopServer = await startServer(manifest.web_server);
      targetUrl = (manifest.web_server.url ?? targetUrl).replace(/\/+$/, '');
    }

    let preflightResult = 'SKIPPED';
    if (args.noPreflight) {
      console.log('pre-flight: SKIPPED (--no-preflight, debug only)');
    } else {
      const record = await runPreflight(manifest, join(outDir, 'evidence'), outDir, args.python);
      preflightResult = record.result ?? '?';
      console.log(`pre-flight: ${preflightResult}`);
      if (preflightResult !== 'READY') {
        const causes = Array.isArray(record.blocked_reasons) ? record.blocked_reasons : [];
        console.error('pre-flight BLOCKED (automation NOT started):');
        for (const c of causes) console.error(`  - ${c}`);
        const traces = selected.map((tc) => blockedTrace(manifest, runId, tc, causes));
        writeFileSync(join(outDir, 'execution_trace.json'), JSON.stringify(traceWrapper(manifest, runId, traces), null, 2), 'utf8');
        writeSummary(outDir, manifest, runId, {
          selected: selected.length, passed: 0, failed: 0, errors: 0, skipped: 0, blocked: selected.length,
          preflight: preflightResult, evidence: 0,
        });
        writeExecutionReports(outDir, manifest, runId, startedAt, 'BLOCKED', {
          selected: selected.length, passed: 0, failed: 0, errors: 0, skipped: 0, blocked: selected.length,
        }, preflightResult, causes.map((c) => String(c)), traces);
        return EXIT_PREFLIGHT_BLOCKED;
      }
    }

    const specFiles = selected.map((tc) => resolve(REPO_ROOT, tc.spec));
    const pwCode = await runPlaywright(specFiles, outDir, targetUrl, {
      mode: healMode, store: healStore, runId, app: manifest.app, suiteId: manifest.suite_id,
    }, selected.map((tc) => tc.test_name));
    const raw = readRawReport(outDir);
    const mapped = mapTests(manifest, selected, raw, outDir, runId);
    if (mapped.unmatched > 0) {
      console.warn(`warning: ${mapped.unmatched} raw test(s) not registered in the suite manifest (ignored)`);
    }
    const traces = mapped.traces;
    const healStats = enrichAutoHealing(outDir, manifest, selected, traces);
    // Only HIGH_CONFIDENCE owns the reuse store. OFF and OBSERVE must not read
    // or write it, so enrichStore() is never invoked for them.
    if (healStats.mode === 'HIGH_CONFIDENCE') {
      enrichStore(healStore, selected);
    }

    // M-06: Execute data verifications declared in the manifest
    const dataVerifications = runDataVerifications(manifest, outDir, runId);
    if (dataVerifications.results.length > 0) {
      console.log(`data verifications: ${dataVerifications.passed} PASS / ${dataVerifications.failed} FAIL / ${dataVerifications.errors} ERROR`);

      // Validate data_verification.json against its M-01 contract using the
      // canonical validator (same rules as the bundle gate; no partial copy).
      const dvPath = join(outDir, 'data_verification.json');
      const dvCheck = await validateArtifactM01(dvPath, 'data-verification', args.python);
      if (!dvCheck.ok) {
        console.error('data_verification.json failed M-01 validation against the data-verification contract');
        if (dvCheck.detail) console.error(dvCheck.detail);
        fail('data_verification.json does not conform to the data-verification contract', EXIT_USAGE);
      }

      // Attach verification results to traces using explicit test_case_id when available
      for (const trace of traces) {
        const tcId = String(trace.test_case_id);
        const related = dataVerifications.results.filter((v) => {
          // Prefer explicit test_case_id from the request
          const req = manifest.data_verifications?.find((r) => r.verification_id === v.verification_id);
          if (req?.test_case_id) {
            return req.test_case_id === tcId;
          }
          // Fallback to text matching only when no explicit link exists
          return v.description.includes(tcId) || v.verification_id.includes(tcId);
        });
        if (related.length > 0) {
          (trace as Record<string, unknown>).data_verifications = related;
        }
      }
    }

    writeFileSync(join(outDir, 'execution_trace.json'), JSON.stringify(traceWrapper(manifest, runId, traces), null, 2), 'utf8');
    printResults(traces);
    // Playwright's process exit code is authoritative: a non-zero code that no
    // mapped FAIL/SKIPPED explains (e.g. a global/unhandled error while every
    // selected Test Case passed) must never be reported as a successful run.
    const testDataFailures = mapped.failed + dataVerifications.failed + dataVerifications.errors;
    const mappedOutcomes = testDataFailures + mapped.skipped;
    const infrastructureErrors: string[] = [];
    if (pwCode !== 0 && mappedOutcomes === 0) {
      infrastructureErrors.push(playwrightFailureMessage(pwCode, raw));
      console.error(`playwright: exit ${pwCode} with no mapped FAIL/SKIPPED — recording an infrastructure error`);
    }
    const evidenceFiles = traces.reduce((n, t) => n + ((t.evidence as string[] | undefined)?.length ?? 0), 0);
    writeSummary(outDir, manifest, runId, {
      selected: selected.length,
      passed: mapped.passed,
      failed: mapped.failed + dataVerifications.failed,
      errors: dataVerifications.errors,
      skipped: mapped.skipped,
      blocked: 0,
      preflight: preflightResult,
      evidence: evidenceFiles,
      playwright_exit_code: pwCode,
      infrastructure_errors: infrastructureErrors.length,
    }, healStats);
    const overallStatus =
      testDataFailures > 0 ? 'FAIL'
        : infrastructureErrors.length > 0 ? 'FAIL'
          : mapped.skipped > 0 ? 'PARTIAL' : 'PASS';
    writeExecutionReports(outDir, manifest, runId, startedAt, overallStatus, {
      selected: selected.length,
      passed: mapped.passed,
      failed: mapped.failed + dataVerifications.failed,
      errors: dataVerifications.errors,
      skipped: mapped.skipped,
      blocked: 0,
    }, preflightResult, [], traces, infrastructureErrors, healStats);
    console.log(`run ${runId}: ${mapped.passed} PASS / ${mapped.failed} FAIL / ${mapped.skipped} SKIPPED (playwright exit ${pwCode})`);
    if (dataVerifications.results.length > 0) {
      console.log(`data verifications: ${dataVerifications.passed} PASS / ${dataVerifications.failed} FAIL / ${dataVerifications.errors} ERROR`);
    }
    if (healStats.attempts > 0 || healStats.mode !== 'OFF') {
      console.log(`auto-healing: mode=${healStats.mode}, attempts=${healStats.attempts}, recoveries_used=${healStats.recoveries_used}, reused=${healStats.reused}, duplicate_prevented=${healStats.duplicate_prevented}, ai_calls=0`);
    }
    return (mappedOutcomes > 0 || infrastructureErrors.length > 0) ? EXIT_FAILURES : EXIT_OK;
  } finally {
    if (stopServer) stopServer();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const e = err as FatalError;
    console.error(`runner error: ${e.message}`);
    process.exitCode = e.exitCode ?? EXIT_USAGE;
  },
);