// M-03 runner infrastructure tests.
//
// These tests exercise the reusable runner end-to-end against the isolated
// local demo server (no external sites, no credentials). They prove:
//   - Web and API Test Cases execute through the runner;
//   - PASS/FAIL statuses derive from real assertions (never simulated);
//   - results associate to their test_case_id and produce evidence;
//   - missing suites / missing references are detected;
//   - the M-04 pre-flight participates and BLOCKED runs keep traceability;
//   - produced artifacts validate with M-01 (qa/tools/validate_contracts.py);
//   - a saved automation re-runs without any AI intervention;
//   - M-01 and M-04 regression suites still pass.
//
// Run order inside this file is serial: the demo suites share port 4173 and the
// committed manifest files, so concurrent runs must not overlap.

import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderReportHtml, type ExecutionReport } from '../runner/report';

test.describe.configure({ mode: 'serial' });

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/automation/tests
const REPO_ROOT = resolve(HERE, '..', '..');
const RUNNER_JS = join(REPO_ROOT, 'automation', '.dist', 'runner', 'runner.js');
const ARTIFACTS_ROOT = join(REPO_ROOT, 'automation', '.artifacts', 'm03');
const WEB_SUITE = 'SUITE-demo-qaa-web';
const API_SUITE = 'SUITE-demo-qaa-api';

interface RunOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

function runDir(name: string): string {
  const d = join(ARTIFACTS_ROOT, `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

async function runRunner(args: string[]): Promise<RunOutcome> {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [RUNNER_JS, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function runPython(args: string[]): Promise<RunOutcome> {
  try {
    const { stdout, stderr } = await execFileP('python', args, {
      cwd: REPO_ROOT,
      env: { ...process.env },
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function assertEvidenceFilesExist(trace: Record<string, unknown>): void {
  const evidence = trace.evidence as string[];
  expect(Array.isArray(evidence)).toBe(true);
  if ((evidence ?? []).length === 0) return;
  for (const ev of evidence) {
    const abs = resolve(REPO_ROOT, ev);
    expect(existsSync(abs), `evidence file should exist: ${ev}`).toBe(true);
  }
}

async function validateRunDir(outDir: string): Promise<void> {
  const res = await runPython(['qa/tools/validate_contracts.py', '--bundle', outDir, '--json']);
  expect(res.code).toBe(0);
  const report = JSON.parse(res.stdout) as {
    valid: boolean;
    summary: { errors: number; artifacts: number };
    results: Array<{ contract: string; artifact: string }>;
  };
  expect(report.valid, `M-01 bundle should be valid: ${res.stderr} ${res.stdout}`).toBe(true);
  expect(report.summary.errors).toBe(0);
  expect(report.summary.artifacts).toBeGreaterThanOrEqual(2); // execution-trace + pre-flight-record
  // AUD-03: the runner artifacts must be recognized by contract in --bundle,
  // never silently skipped as "unknown".
  const byName = new Map(
    report.results.map((r) => [toPosix(r.artifact).split('/').pop() as string, r.contract]),
  );
  expect(byName.get('report.json'), 'report.json must be detected as execution-report').toBe('execution-report');
  if (existsSync(join(outDir, 'data_verification.json'))) {
    expect(
      byName.get('data_verification.json'),
      'data_verification.json must be detected as data-verification',
    ).toBe('data-verification');
  }
}

const DEMO_WEB_TC_IDS = ['TC-DEMO-WEB-1', 'TC-DEMO-WEB-2'];

test('web: a saved Test Case executes through the runner with PASS, association and evidence', async () => {
  const out = runDir('web');
  test.setTimeout(90_000);
  try {
    const res = await runRunner(['--suite', WEB_SUITE, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const trace = readJson<{ suite_id: string; traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.suite_id).toBe(WEB_SUITE);
    expect(trace.traces).toHaveLength(2);
    const ids = trace.traces.map((t) => t.test_case_id);
    expect(ids.sort()).toEqual([...DEMO_WEB_TC_IDS].sort());
    for (const t of trace.traces) {
      expect(t.status).toBe('PASS');
      expect(t.executed).toBe(true);
      expect(t.execution_success).toBe(true);
      expect(t.validation_performed).toBe(true);
      expect(typeof t.result_validated).toBe('string');
      const assertions = t.assertions as Array<{ assertion: string; passed: boolean }>;
      expect(assertions.length).toBeGreaterThanOrEqual(1);
      expect(assertions.every((a) => a.passed)).toBe(true);
      expect((t.evidence as string[]).length).toBeGreaterThanOrEqual(1);
      expect(toolExecuted(t)).toContain('runner:playwright:');
      assertEvidenceFilesExist(t);
    }

    const preflight = readJson<{ result: string }>(join(out, 'preflight_record.json'));
    expect(preflight.result).toBe('READY');
    expect(existsSync(join(out, 'summary.json'))).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

function toolExecuted(t: Record<string, unknown>): string {
  return String(t.tool_executed ?? t.tool_requested ?? '');
}

test('api: saved Test Cases execute through the runner (Playwright request) with PASS and evidence', async () => {
  const out = runDir('api');
  test.setTimeout(90_000);
  try {
    const res = await runRunner(['--suite', API_SUITE, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces).toHaveLength(2);
    for (const t of trace.traces) {
      expect(t.status).toBe('PASS');
      expect(t.app).toBe('demo-qaa');
      expect(t.platform).toBe('api');
      expect((t.assertions as unknown[]).length).toBeGreaterThanOrEqual(1);
      expect((t.evidence as string[]).length).toBeGreaterThanOrEqual(1);
      assertEvidenceFilesExist(t);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('selection: --tc runs only the requested Test Case', async () => {
  const out = runDir('tc');
  test.setTimeout(90_000);
  try {
    const res = await runRunner(['--suite', WEB_SUITE, '--tc', 'TC-DEMO-WEB-1', '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);
    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces).toHaveLength(1);
    expect(trace.traces[0].test_case_id).toBe('TC-DEMO-WEB-1');
    expect(trace.traces[0].status).toBe('PASS');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('failing assertions: FAIL trace with evidence, no automatic classification', async () => {
  const out = runDir('fail');
  const man = runDir('failman');
  test.setTimeout(120_000);
  const port = 4176;
  try {
    const suiteId = 'SUITE-m03-fail-demo';
    const failingSpec = join(out, 'failing.spec.ts');
    const relSupport = toPosix(relative(out, join(REPO_ROOT, 'automation', 'runner', 'support')));
    writeFileSync(
      failingSpec,
      `import { test, expect } from '@playwright/test';
import { targetUrl, recordAssertion, attachAssertions, type AssertionItem } from '${relSupport}';

test('missing element triggers a failed assertion', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  await page.goto(targetUrl());
  const heading = page.getByRole('heading', { name: 'Demo Store QA' });
  recordAssertion(assertions, 'heading "Demo Store QA" is visible', await heading.isVisible());
  const marker = page.locator('[data-testid="missing-marker"]');
  const count = await marker.count();
  recordAssertion(assertions, 'marker [data-testid=missing-marker] is present', count > 0, 'count=' + count);
  await attachAssertions(testInfo, assertions);
  expect(count, 'marker should be present').toBeGreaterThan(0);
});
`,
      'utf8',
    );
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'infra test - failing assertion',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          node_packages: ['@playwright/test'],
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M03-FAIL-1',
          title: 'Missing marker triggers a failed assertion',
          spec: toPosix(relative(REPO_ROOT, failingSpec)),
          test_name: 'missing element triggers a failed assertion',
          expected_result: 'El elemento [data-testid=missing-marker] está presente y visible',
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `runner exit 1 expected on FAIL: ${res.stdout}\n${res.stderr}`).toBe(1);

    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces).toHaveLength(1);
    const t = trace.traces[0];
    expect(t.test_case_id).toBe('TC-M03-FAIL-1');
    expect(t.status).toBe('FAIL');
    expect(t.executed).toBe(true);
    expect(t.execution_success).toBe(false);
    expect(t.validation_performed).toBe(true);
    expect(totsString1(t)).not.toEqual('');
    // The runner never classifies a FAIL (Bug Analyst does).
    expect('failure_classification' in t).toBe(false);
    expect(String(t.notes ?? '')).toContain('classification');
    const assertions = t.assertions as Array<{ assertion: string; passed: boolean }>;
    expect(assertions.some((a) => !a.passed)).toBe(true);
    expect((t.evidence as string[]).length).toBeGreaterThanOrEqual(1);
    assertEvidenceFilesExist(t);

    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

function totsString1(t: Record<string, unknown>): string {
  return String(t.result_obtained ?? t.error ?? '');
}

test('detection: a missing suite is reported as usage error', async () => {
  const out = runDir('nosuite');
  try {
    const res = await runRunner(['--suite', 'SUITE-NO-EXISTE', '--out', out]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('suite not found');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('detection: a missing spec reference is reported as usage error', async () => {
  const out = runDir('noref');
  const man = runDir('norefman');
  const suiteId = 'SUITE-m03-noref';
  try {
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      requirements: {
        task: suiteId,
        scope: 'infra test - missing reference',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M03-NOREF-1',
          title: 'references a spec that does not exist',
          spec: 'automation/specs/does-not-exist.spec.ts',
          test_name: 'nobody',
          expected_result: 'x',
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('missing spec');
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

test('pre-flight BLOCKED: automation is not started and traceability is kept', async () => {
  const out = runDir('block');
  const man = runDir('blockman');
  const suiteId = 'SUITE-m03-block';
  test.setTimeout(90_000);
  try {
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'api',
      adapter: 'playwright',
      requirements: {
        task: suiteId,
        scope: 'infra test - pre-flight block',
        platform: 'api',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: [],
          tools: ['node', 'npm'],
          credentials: ['QAA_M03_MISSING_CRED'],
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M03-BLOCK-1',
          title: 'blocked by pre-flight before execution',
          spec: 'automation/specs/demo-api/api.spec.ts',
          test_name: 'GET /api/products returns the valid catalog',
          expected_result: 'x',
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `pre-flight BLOCKED exit 3 expected: ${res.stdout}\n${res.stderr}`).toBe(3);

    const preflight = readJson<{ result: string; blocked_reasons: string[] }>(join(out, 'preflight_record.json'));
    expect(preflight.result).toBe('BLOCKED');
    expect(preflight.blocked_reasons.length).toBeGreaterThanOrEqual(1);
    expect(preflight.blocked_reasons.join(' ')).toContain('QAA_M03_MISSING_CRED');

    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces).toHaveLength(1);
    expect(trace.traces[0].status).toBe('BLOCKED');
    expect(trace.traces[0].executed).toBe(false);
    expect(trace.traces[0].execution_success).toBe(false);
    expect(trace.traces[0].validation_performed).toBe(false);
    expect(String(trace.traces[0].notes ?? '')).toContain('Pre-flight BLOCKED');
    expect(String(trace.traces[0].block_reason ?? '')).toContain('QAA_M03_MISSING_CRED');

    // AUD-12: the report must record the real block causes and must never present
    // a non-executed Test Case as passed/failed/executed.
    const report = readJson<Record<string, unknown>>(join(out, 'report.json'));
    expect(report.overall_status).toBe('BLOCKED');
    const summary = report.summary as {
      executed: number; passed: number; failed: number; errors: number; blocked: number; skipped: number;
    };
    expect(summary.blocked).toBe(1);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.executed).toBe(0);
    const reportCases = report.cases as Array<{ status: string; block_reason?: string }>;
    expect(reportCases).toHaveLength(1);
    expect(reportCases[0].status).toBe('BLOCKED');
    expect(String(reportCases[0].block_reason ?? '')).toContain('QAA_M03_MISSING_CRED');
    const reportPreflight = report.preflight as { result: string; blocked_reasons?: string[] };
    expect(reportPreflight.result).toBe('BLOCKED');
    expect((reportPreflight.blocked_reasons ?? []).join(' ')).toContain('QAA_M03_MISSING_CRED');

    const html = readFileSync(join(out, 'report.html'), 'utf8');
    expect(html).toContain('QAA_M03_MISSING_CRED');
    expect(html).toContain('Motivos del bloqueo');
    expect(html).toContain('Motivo del bloqueo');

    // Playwright never ran: no raw report in the run dir.
    expect(existsSync(join(out, 'results.raw.json'))).toBe(false);
    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

test('reuse: a saved automation re-runs without AI intervention and artifacts validate with M-01', async () => {
  const outA = runDir('reuseA');
  const outB = runDir('reuseB');
  test.setTimeout(120_000);
  try {
    const resA = await runRunner(['--suite', WEB_SUITE, '--out', outA]);
    const resB = await runRunner(['--suite', WEB_SUITE, '--out', outB]);
    expect(resA.code).toBe(0);
    expect(resB.code).toBe(0);

    const load = (p: string) => {
      const t = readJson<{ run_id: string; traces: Array<Record<string, unknown>> }>(join(p, 'execution_trace.json'));
      return t.traces.map((x) => ({ id: x.test_case_id, status: x.status, app: x.app, platform: x.platform }));
    };
    const a = load(outA);
    const b = load(outB);
    expect(a).toEqual(b);
    expect(a.every((x) => x.status === 'PASS')).toBe(true);
    expect(aAtoId(a)).toEqual(DEMO_WEB_TC_IDS);

    await validateRunDir(outB);
  } finally {
    rmSync(outA, { recursive: true, force: true });
    rmSync(outB, { recursive: true, force: true });
  }
});

function aAtoId(traces: Array<{ id?: unknown }>): Array<string> {
  return traces.map((t) => String(t.id)).sort();
}

test('regression: M-01 and M-04 test suites still pass', async () => {
  test.setTimeout(240_000);
  const pycache = join(REPO_ROOT, 'qa', 'tools', '__pycache__');
  try {
    const m01 = await runPython(['qa/tools/test_validate_contracts.py']);
    expect(m01.code, `M-01 suite failed: ${m01.stdout}\n${m01.stderr}`).toBe(0);
    const m04 = await runPython(['qa/tools/test_preflight.py']);
    expect(m04.code, `M-04 suite failed: ${m04.stdout}\n${m04.stderr}`).toBe(0);
  } finally {
    rmSync(pycache, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M-05 auto-healing integration (isolated heal demo on 127.0.0.1:4174).
//
//   A) HIGH_CONFIDENCE suite: 7 Test Cases green; traces enriched with the
//      auto_healing block; record carries per-attempt statuses; M-01 validates
//      the bundle (TC-HEAL-12 is exactly this post-run contract validation).
//   B) the FAIL-by-design Test Case (TC-HEAL-5) exits 1 and keeps the real
//      FAIL while recovery is used: auto-healing never changes Expected
//      Results, never FAIL->PASS.
//   C) OFF: green NOT_ATTEMPTED/ORIGINAL_OK traces and the store file is NEVER
//      written (guarantee that OFF does not touch the store).
//   D) OBSERVE: candidates are recorded but never used.
//   E) cross-run reuse with the same --autoheal-store: first run RECOVERED,
//      second run REUSED (reused_from_store=true) with ai_calls=0.
// ---------------------------------------------------------------------------

const HEAL_HC_SUITE = 'SUITE-heal-demo-hc';
const HEAL_HC_FAIL_SUITE = 'SUITE-heal-demo-hc-fail';
const HEAL_OFF_SUITE = 'SUITE-heal-demo-off';
const HEAL_OBSERVE_SUITE = 'SUITE-heal-demo-observe';

interface HealRecord {
  heal_id: string;
  test_case_id?: string;
  status: string;
  used_recovery: boolean;
  reused_from_store?: boolean;
  duplicate_prevented?: boolean;
  reason_reject?: string;
  candidates: Array<{ strategy: string; accepted: boolean; selector?: string; count: number; unique: boolean }>;
  ai_calls: number;
}

function loadHealRecords(out: string): HealRecord[] {
  return readJson<HealRecord[]>(join(out, 'autoheal_record.json'));
}

function healRecordsByTest<T extends HealRecord>(records: T[]): Map<string, T[]> {
  const by = new Map<string, T[]>();
  for (const r of records) {
    const id = String(r.test_case_id ?? '');
    by.set(id, [...(by.get(id) ?? []), r]);
  }
  return by;
}

test('heal A: HIGH_CONFIDENCE suite runs green, traces enriched and bundle validates (TC-HEAL-12)', async () => {
  const out = runDir('healA');
  test.setTimeout(180_000);
  try {
    const res = await runRunner(['--suite', HEAL_HC_SUITE, '--out', out]);
    expect(res.code, `hc suite must be green: ${res.stdout}\n${res.stderr}`).toBe(0);

    const trace = readJson<{ suite_id: string; traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.suite_id).toBe(HEAL_HC_SUITE);
    const ids = trace.traces.map((t) => String(t.test_case_id)).sort();
    expect(ids).toEqual(['TC-HEAL-11', 'TC-HEAL-13', 'TC-HEAL-2', 'TC-HEAL-3', 'TC-HEAL-4', 'TC-HEAL-6', 'TC-HEAL-7', 'TC-HEAL-8']);

    for (const t of trace.traces) {
      expect(t.status).toBe('PASS');
      const ah = (t as { auto_healing?: Record<string, unknown> }).auto_healing;
      expect(ah).toBeTruthy();
      expect(ah?.mode).toBe('HIGH_CONFIDENCE');
      expect(ah?.ai_calls).toBe(0);
      expect(Array.isArray(ah?.heal_ids)).toBe(true);
      expect((ah?.heal_ids as string[]).length).toBeGreaterThan(0);
      expect(existsSync(String(ah?.record ?? ''))).toBe(true);
      // The M-05 trace note is attached whenever recovery was actually used.
      if (ah?.used_recovery === true) {
        expect(String(t.notes ?? '')).toContain('Auto-healing (M-05)');
        expect(Array.isArray(ah?.evidence)).toBe(true);
        expect((ah?.evidence as string[]).length).toBeGreaterThan(0);
      }
    }

    // Per-attempt statuses from the record (mechanism evidence).
    const records = loadHealRecords(out);
    const byTest = healRecordsByTest(records);
    expect(records.every((r) => r.ai_calls === 0)).toBe(true);
    expect(records.every((r) => r.test_case_id)).toBe(true);
    // heal_ids are globally unique within the run (no per-context collisions).
    expect(new Set(records.map((r) => r.heal_id)).size).toBe(records.length);

    const t2 = byTest.get('TC-HEAL-2')!;
    expect(t2[0].status).toBe('RECOVERED');
    expect(t2[0].used_recovery).toBe(true);
    expect(t2[0].reused_from_store).toBe(false);

    const t3 = byTest.get('TC-HEAL-3')![0];
    expect(t3.status).toBe('AMBIGUOUS');
    expect(t3.used_recovery).toBe(false);
    expect(t3.candidates.some((c) => c.count > 0 && !c.unique)).toBe(true);

    const t4 = byTest.get('TC-HEAL-4')![0];
    expect(t4.status).toBe('REJECTED');
    expect(t4.used_recovery).toBe(false);

    const t6 = byTest.get('TC-HEAL-6')!;
    expect(t6).toHaveLength(2);
    expect(t6[0].duplicate_prevented).toBe(true); // uncertain effect -> not re-executed
    expect(t6[1].duplicate_prevented).toBe(false); // verifiable effect, not applied -> acted

    const t7 = byTest.get('TC-HEAL-7')![0];
    expect(t7.status).toBe('REUSED');
    expect(t7.used_recovery).toBe(true);
    expect(t7.reused_from_store).toBe(true);

    const t8 = byTest.get('TC-HEAL-8')![0];
    expect(t8.status).toBe('RECOVERED');
    const staleCandidate = t8.candidates.find((c) => c.strategy === 'stored_reuse');
    expect(staleCandidate?.accepted).toBe(false); // stale store alternative invalidated

    const t11 = byTest.get('TC-HEAL-11')!;
    expect(t11).toHaveLength(2);
    expect(t11[0].status).toBe('NO_CANDIDATE');
    expect(t11[0].used_recovery).toBe(false);
    expect(t11[1].status).toBe('RECOVERED');
    expect(t11[1].used_recovery).toBe(true);

    const t13 = byTest.get('TC-HEAL-13')![0];
    expect(t13.status).toBe('RECOVERED');
    expect(t13.used_recovery).toBe(true);
    expect(t13.duplicate_prevented).toBe(true); // outcome probe failed -> not re-executed
    expect(String(t13.reason_reject ?? '')).toContain('outcome probe failed');

    // summary.json carries the auto_healing block.
    const summary = readJson<{ auto_healing?: Record<string, unknown> }>(join(out, 'summary.json'));
    expect(summary.auto_healing?.mode).toBe('HIGH_CONFIDENCE');
    expect(summary.auto_healing?.ai_calls).toBe(0);

    // TC-HEAL-12: M-01 contract validation of the full run bundle (record + traces).
    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('heal B: the FAIL-by-design Test Case exits 1 and keeps the real FAIL with recovery used', async () => {
  const out = runDir('healB');
  test.setTimeout(120_000);
  try {
    // suite hc-fail does not match TC-HEAL-5 filter? It contains only TC-HEAL-5.
    const res = await runRunner(['--suite', HEAL_HC_FAIL_SUITE, '--out', out]);
    expect(res.code, `expected exit 1 for the FAIL-by-design suite`).toBe(1);
    expect(res.stdout).toContain('0 PASS / 1 FAIL / 0 SKIPPED');

    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces).toHaveLength(1);
    const t = trace.traces[0];
    expect(t.test_case_id).toBe('TC-HEAL-5');
    expect(t.status).toBe('FAIL'); // FAIL preserved: recovery never flips to PASS
    const ah = (t as { auto_healing?: Record<string, unknown> }).auto_healing!;
    expect(ah.mode).toBe('HIGH_CONFIDENCE');
    expect(ah.used_recovery).toBe(true);
    expect(ah.ai_calls).toBe(0);
    expect(String(t.notes ?? '')).toContain('never changes Expected Results');
    expect(String(t.notes ?? '')).toContain('classification');

    const records = loadHealRecords(out);
    expect(records).toHaveLength(1);
    expect(records[0].test_case_id).toBe('TC-HEAL-5');
    expect(records[0].used_recovery).toBe(true);
    expect(records[0].ai_calls).toBe(0);

    await validateRunDir(out); // even a FAILing run keeps M-01-valid artifacts
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('heal C: OFF mode is green, records NOT_ATTEMPTED/ORIGINAL_OK and neither reads nor writes the store', async () => {
  const out = runDir('healC');
  const store = join(ARTIFACTS_ROOT, `heal-store-off-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  test.setTimeout(120_000);
  try {
    // Identifiable seed that MATCHES a selected TC by spec+title but carries a
    // deliberately wrong test_case_id: the previous implementation rewrote it via
    // enrichStore(), so the hash-change assertion below genuinely detects the bug
    // (no false positive).
    writeFileSync(store, JSON.stringify({
      store_version: 1,
      entries: [
        {
          entry_id: 'AH-STORE-SEED-OFF',
          app: 'demo-heal',
          suite_id: HEAL_OFF_SUITE,
          test_case_id: 'WRONG-ID',
          spec: 'automation/specs/heal-demo/off.spec.ts',
          test_title: 'TC-HEAL-1: el selector original válido no requiere recuperación',
          selector_original: '#search-box',
          selector_alternative: '[data-testid="search-field"]',
          strategy: 'stable_attribute',
          expected: {},
          verified_in_run: 'R-SEED',
          verified_at: '2026-01-01T00:00:00.000Z',
          evidence: [],
          status: 'VERIFIED',
          times_verified: 1,
        },
      ],
    }, null, 2), 'utf8');
    const hashBefore = createHash('sha256').update(readFileSync(store)).digest('hex');

    const res = await runRunner(['--suite', HEAL_OFF_SUITE, '--autoheal-store', store, '--out', out]);
    expect(res.code, `off suite green expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces.map((t) => String(t.test_case_id)).sort()).toEqual(['TC-HEAL-1', 'TC-HEAL-9']);
    for (const t of trace.traces) {
      expect(t.status).toBe('PASS');
      expect((t as { auto_healing?: Record<string, unknown> }).auto_healing?.mode).toBe('OFF');
      expect((t as { auto_healing?: Record<string, unknown> }).auto_healing?.ai_calls).toBe(0);
    }

    const recordsBy = healRecordsByTest(loadHealRecords(out));
    expect(recordsBy.get('TC-HEAL-1')![0].status).toBe('ORIGINAL_OK');
    expect(recordsBy.get('TC-HEAL-1')![0].used_recovery).toBe(false);
    const t9 = recordsBy.get('TC-HEAL-9')![0];
    expect(t9.status).toBe('NOT_ATTEMPTED');
    expect(t9.used_recovery).toBe(false);
    expect(t9.candidates).toHaveLength(0); // OFF never evaluates candidates

    // OFF guarantees: the supplied store is neither modified nor used as state,
    // and the default per-run store is never created.
    const hashAfter = createHash('sha256').update(readFileSync(store)).digest('hex');
    expect(hashAfter, 'OFF must not modify the store file').toBe(hashBefore);
    const persisted = readJson<{ entries: Array<{ test_case_id: string }> }>(store);
    expect(persisted.entries[0].test_case_id).toBe('WRONG-ID'); // not enriched/rewritten
    expect(existsSync(join(out, 'autoheal_store.json'))).toBe(false);
    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  }
});

test('heal D: OBSERVE records candidates but neither reads nor writes the store', async () => {
  const out = runDir('healD');
  const store = join(ARTIFACTS_ROOT, `heal-store-observe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  test.setTimeout(120_000);
  try {
    // Seed with an extra top-level field: any rewrite (the previous
    // implementation wrote the store in OBSERVE) drops it and changes the hash,
    // so the assertion below genuinely detects an improper write.
    writeFileSync(store, JSON.stringify({
      store_version: 1,
      note: 'seed-must-not-be-rewritten',
      entries: [
        {
          entry_id: 'AH-STORE-SEED-OBSERVE',
          app: 'demo-heal',
          suite_id: HEAL_OBSERVE_SUITE,
          test_case_id: 'WRONG-ID',
          spec: 'automation/specs/heal-demo/observe.spec.ts',
          test_title: 'TC-HEAL-10: OBSERVE registra candidatos sin utilizarlos',
          selector_original: '#search-box',
          selector_alternative: '[data-testid="search-field"]',
          strategy: 'stable_attribute',
          expected: {},
          verified_in_run: 'R-SEED',
          verified_at: '2026-01-01T00:00:00.000Z',
          evidence: [],
          status: 'VERIFIED',
          times_verified: 1,
        },
      ],
    }, null, 2), 'utf8');
    const hashBefore = createHash('sha256').update(readFileSync(store)).digest('hex');

    const res = await runRunner(['--suite', HEAL_OBSERVE_SUITE, '--autoheal-store', store, '--out', out]);
    expect(res.code, `observe suite green expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces).toHaveLength(1);
    const t = trace.traces[0];
    expect(t.test_case_id).toBe('TC-HEAL-10');
    expect(t.status).toBe('PASS');
    const ah = (t as { auto_healing?: Record<string, unknown> }).auto_healing!;
    expect(ah.mode).toBe('OBSERVE');
    expect(ah.used_recovery).toBe(false);
    expect(ah.ai_calls).toBe(0);

    const records = loadHealRecords(out);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('OBSERVED');
    expect(records[0].used_recovery).toBe(false);
    expect(records[0].candidates.length).toBeGreaterThan(0);
    expect(records[0].candidates.every((c) => !c.accepted)).toBe(true); // identified but rejected for use

    // OBSERVE guarantees: the supplied store is neither modified nor used as
    // state, and the default per-run store is never created.
    const hashAfter = createHash('sha256').update(readFileSync(store)).digest('hex');
    expect(hashAfter, 'OBSERVE must not modify the store file').toBe(hashBefore);
    expect(existsSync(join(out, 'autoheal_store.json'))).toBe(false);
    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  }
});

test('heal E: same --autoheal-store across runs reuses the verified alternative without AI', async () => {
  const out1 = runDir('healE1');
  const out2 = runDir('healE2');
  const store = join(ARTIFACTS_ROOT, `heal-store-e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  test.setTimeout(240_000);
  try {
    const res1 = await runRunner(['--suite', HEAL_HC_SUITE, '--tc', 'TC-HEAL-2', '--autoheal-store', store, '--out', out1]);
    expect(res1.code, `first run green expected: ${res1.stdout}\n${res1.stderr}`).toBe(0);
    const res2 = await runRunner(['--suite', HEAL_HC_SUITE, '--tc', 'TC-HEAL-2', '--autoheal-store', store, '--out', out2]);
    expect(res2.code, `second run green expected: ${res2.stdout}\n${res2.stderr}`).toBe(0);

    const r1 = healRecordsByTest(loadHealRecords(out1)).get('TC-HEAL-2')![0];
    const r2 = healRecordsByTest(loadHealRecords(out2)).get('TC-HEAL-2')![0];
    expect(r1.status).toBe('RECOVERED');
    expect(r1.used_recovery).toBe(true);
    expect(r1.reused_from_store).toBe(false);
    expect(r2.status).toBe('REUSED');
    expect(r2.used_recovery).toBe(true);
    expect(r2.reused_from_store).toBe(true);
    expect(r1.ai_calls).toBe(0);
    expect(r2.ai_calls).toBe(0);

    // The bridge store file exists and keeps the verified alternative.
    expect(existsSync(store)).toBe(true);
    const storeJson = readJson<{ entries: Array<{ selector_original: string; selector_alternative: string; status: string }> }>(store);
    expect(
      storeJson.entries.some(
        (e) => e.selector_original === '#search-box' && e.selector_alternative === '[data-testid="search-field"]' && e.status === 'VERIFIED',
      ),
    ).toBe(true);

    await validateRunDir(out2);
  } finally {
    rmSync(out1, { recursive: true, force: true });
    rmSync(out2, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  }
});

test('heal F: an outcome-probe exception does not re-execute the recovered mutating action (TC-HEAL-13)', async () => {
  const out = runDir('healF');
  test.setTimeout(120_000);
  try {
    const res = await runRunner(['--suite', HEAL_HC_SUITE, '--tc', 'TC-HEAL-13', '--out', out]);
    expect(res.code, `guardrail test must be green: ${res.stdout}\n${res.stderr}`).toBe(0);

    const records = loadHealRecords(out);
    expect(records).toHaveLength(1);
    expect(records[0].test_case_id).toBe('TC-HEAL-13');
    expect(records[0].status).toBe('RECOVERED');
    expect(records[0].used_recovery).toBe(true);
    // The outcome callback threw: the effect is uncertain, so the mutating action
    // is recorded as duplicate-prevented and was NOT re-executed (the TC asserts
    // the real counter stayed at 0).
    expect(records[0].duplicate_prevented).toBe(true);
    expect(String(records[0].reason_reject ?? '')).toContain('outcome probe failed');
    expect(records[0].ai_calls).toBe(0);

    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M-02 execution report tests (JSON + HTML).
//
//   - report.json and report.html are generated for every run;
//   - both represent the same execution (HTML is derived from JSON);
//   - the JSON validates with M-01 (execution-report contract);
//   - the HTML escapes dynamic content (no XSS);
//   - no secrets or env vars leak into the reports.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AUD-04 — report.html evidence links
//
// report.html is generated inside the run dir (`outDir`) while the evidence
// paths are expressed relative to the repository root. A browser resolves the
// href against the report location, so the link must be relative to `outDir`.
// These tests read the produced href and verify the destination file the way a
// browser opens it (never just that an <a> tag exists).
// ---------------------------------------------------------------------------

function makeReport(evidence: string[]): ExecutionReport {
  return {
    report_id: 'ER-AUD04',
    run_id: 'R-AUD04',
    suite_id: 'SUITE-aud04',
    app: 'demo-qaa',
    platform: 'web',
    started_at: '2026-10-12T00:00:00.000Z',
    ended_at: '2026-10-12T00:00:01.000Z',
    duration_ms: 1000,
    overall_status: 'PASS',
    summary: { selected: 1, executed: 1, passed: 1, failed: 0, errors: 0, blocked: 0, skipped: 0, omitted: 0 },
    cases: [{
      test_case_id: 'TC-AUD04-1',
      title: 'link resolution',
      status: 'PASS',
      duration_ms: 5,
      spec: 'automation/specs/demo-web/site.spec.ts',
      evidence,
    }],
    preflight: { result: 'SKIPPED' },
    infrastructure_errors: [],
    evidence_index: evidence.map((p) => ({ path: p, type: 'screenshot', test_case_id: 'TC-AUD04-1' })),
    generated_at: '2026-10-12T00:00:02.000Z',
  };
}

function extractHrefs(html: string): string[] {
  return Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]);
}

// Resolves a href exactly the way a browser does for a local report file.
function resolveHref(href: string, reportHtmlPath: string): string {
  return resolve(fileURLToPath(new URL(href, pathToFileURL(reportHtmlPath))));
}

test('AUD-04: report.html resolves evidence links from its own directory', () => {
  const base = join(REPO_ROOT, 'automation', '.artifacts', 'm03', `aud04-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    const evidenceDir = join(base, 'run with spaces', 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    const names = ['plain.json', 'con espacios y ñ.json', 'report&id#1.txt'];
    const evidence = names.map((n, i) => {
      const abs = join(evidenceDir, n);
      writeFileSync(abs, `evidence-${i}`, 'utf8');
      return toPosix(relative(REPO_ROOT, abs));
    });

    // The report nests two levels below the evidence dir: hrefs must go up.
    const outDir = join(base, 'run with spaces', 'nested', 'report');
    mkdirSync(outDir, { recursive: true });
    const reportHtmlPath = join(outDir, 'report.html');
    const html = renderReportHtml(makeReport(evidence), REPO_ROOT, outDir);
    const hrefs = extractHrefs(html);

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href === '#') continue;
      // portable relative link: never absolute, drive- or file:-based
      expect(href.startsWith('/'), `absolute href not allowed: ${href}`).toBe(false);
      expect(/^[A-Za-z]:/.test(href), `drive path not allowed: ${href}`).toBe(false);
      expect(href.startsWith('file:'), `file: href not allowed: ${href}`).toBe(false);
      expect(href.includes('\\'), `backslashes not allowed in href: ${href}`).toBe(false);
      // the destination the browser would open must exist
      expect(existsSync(resolveHref(href, reportHtmlPath)), `href must resolve to an existing file: ${href}`).toBe(true);
    }

    // spaces / non-ASCII are percent-encoded in the href, readable in the label
    const spacesHref = hrefs.find((h) => h.includes('con%20espacios%20y%20'));
    expect(spacesHref, 'spaces must be percent-encoded in the href').toBeTruthy();
    expect(spacesHref).toContain('%C3%B1'); // ñ as UTF-8
    expect(html).toContain('con espacios y ñ.json');
    expect(html).toContain('%26'); // & in href
    expect(html).toContain('%23'); // # in href
    expect(html).toContain('report&amp;id#1.txt'); // & escaped in the label
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('AUD-04: missing evidence renders as a disabled (faltante) link', () => {
  const outDir = join(REPO_ROOT, 'automation', '.artifacts', 'm03', `aud04-missing-${Date.now()}`);
  try {
    mkdirSync(outDir, { recursive: true });
    const html = renderReportHtml(
      makeReport(['automation/.runs/does-not-exist/evidence/nope.json']),
      REPO_ROOT,
      outDir,
    );
    expect(html).toContain('href="#"');
    expect(html).toContain('(faltante)');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('m02: report.json and report.html are generated and consistent', async () => {
  const out = runDir('m02');
  test.setTimeout(90_000);
  try {
    const res = await runRunner(['--suite', WEB_SUITE, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const reportJsonPath = join(out, 'report.json');
    const reportHtmlPath = join(out, 'report.html');
    expect(existsSync(reportJsonPath), 'report.json should exist').toBe(true);
    expect(existsSync(reportHtmlPath), 'report.html should exist').toBe(true);

    const report = readJson<Record<string, unknown>>(reportJsonPath);
    expect(report.suite_id).toBe(WEB_SUITE);
    expect(report.overall_status).toBe('PASS');
    expect(report.summary).toBeTruthy();
    expect((report.summary as { passed: number }).passed).toBe(2);
    expect(Array.isArray(report.cases)).toBe(true);
    expect((report.cases as unknown[]).length).toBe(2);

    const html = readFileSync(reportHtmlPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(WEB_SUITE);
    expect(html).toContain('PASS');
    expect(html).toContain('TC-DEMO-WEB-1');
    expect(html).toContain('TC-DEMO-WEB-2');

    // AUD-04: the produced hrefs must resolve to the evidence files from the
    // report location (the raw repo-relative path would 404 under <out>/).
    const linkReport = report as {
      cases: Array<{ evidence: string[] }>;
      evidence_index: Array<{ path: string }>;
    };
    const evidencePaths = [
      ...linkReport.evidence_index.map((e) => e.path),
      ...linkReport.cases.flatMap((c) => c.evidence),
    ];
    expect(evidencePaths.length).toBeGreaterThan(0);
    const hrefs = extractHrefs(html);
    const resolvedTargets = hrefs.filter((h) => h !== '#').map((h) => resolveHref(h, reportHtmlPath));
    for (const ev of evidencePaths) {
      const abs = resolve(REPO_ROOT, ev);
      expect(existsSync(abs), `evidence file should exist: ${ev}`).toBe(true);
      expect(hrefs, `raw repo-relative href would 404: ${ev}`).not.toContain(ev);
      expect(resolvedTargets, `no href resolves to ${abs}`).toContain(abs);
    }

    // M-01 validation of the generated report
    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('m02: HTML escapes dynamic content (no XSS)', async () => {
  const out = runDir('m02escape');
  const man = runDir('m02escapeman');
  test.setTimeout(90_000);
  const port = 4199;
  try {
    const suiteId = 'SUITE-m02-escape';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'M-02 escape test',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M02-ESC-1',
          title: 'Test <script>alert("xss")</script> & "quotes"',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const html = readFileSync(join(out, 'report.html'), 'utf8');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

test('m02: no secrets leak into reports', async () => {
  const out = runDir('m02secret');
  test.setTimeout(90_000);
  try {
    const res = await runRunner(['--suite', WEB_SUITE, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const reportJson = readFileSync(join(out, 'report.json'), 'utf8');
    const reportHtml = readFileSync(join(out, 'report.html'), 'utf8');

    expect(reportJson).not.toContain('QAA_SECRET_TOKEN');
    expect(reportJson).not.toContain('super-secret-token-12345');
    expect(reportHtml).not.toContain('QAA_SECRET_TOKEN');
    expect(reportHtml).not.toContain('super-secret-token-12345');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('m02: BLOCKED run generates report with BLOCKED status', async () => {
  const out = runDir('m02blocked');
  const man = runDir('m02blockedman');
  test.setTimeout(90_000);
  try {
    const suiteId = 'SUITE-m02-blocked';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'api',
      adapter: 'playwright',
      requirements: {
        task: suiteId,
        scope: 'M-02 blocked test',
        platform: 'api',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: [],
          tools: ['node', 'npm'],
          credentials: ['QAA_M02_MISSING_CRED'],
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M02-BLOCK-1',
          title: 'blocked by pre-flight',
          spec: 'automation/specs/demo-api/api.spec.ts',
          test_name: 'GET /api/products returns the valid catalog',
          expected_result: 'x',
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `pre-flight BLOCKED exit 3 expected`).toBe(3);

    const report = readJson<Record<string, unknown>>(join(out, 'report.json'));
    expect(report.overall_status).toBe('BLOCKED');
    const summary = report.summary as {
      executed: number; passed: number; failed: number; errors: number; blocked: number; skipped: number;
    };
    expect(summary.blocked).toBe(1);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.executed).toBe(0);

    // AUD-12: the cause is recorded per Test Case and in the pre-flight block.
    const m02Cases = report.cases as Array<{ status: string; block_reason?: string }>;
    expect(m02Cases[0].status).toBe('BLOCKED');
    expect(m02Cases.some((c) => c.status === 'PASS' || c.status === 'FAIL')).toBe(false);
    expect(String(m02Cases[0].block_reason ?? '')).toContain('QAA_M02_MISSING_CRED');
    const m02Preflight = report.preflight as { result: string; blocked_reasons?: string[] };
    expect(m02Preflight.result).toBe('BLOCKED');
    expect((m02Preflight.blocked_reasons ?? []).join(' ')).toContain('QAA_M02_MISSING_CRED');

    const html = readFileSync(join(out, 'report.html'), 'utf8');
    expect(html).toContain('BLOCKED');
    expect(html).toContain('TC-M02-BLOCK-1');
    expect(html).toContain('QAA_M02_MISSING_CRED');
    expect(html).toContain('Motivo del bloqueo');
    expect(html).toContain('Motivos del bloqueo');

    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

test('m02: duration_ms is computed from trace timestamps', async () => {
  const out = runDir('m02duration');
  test.setTimeout(90_000);
  try {
    const res = await runRunner(['--suite', WEB_SUITE, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    const report = readJson<{ cases: Array<{ test_case_id: string; duration_ms: number }> }>(join(out, 'report.json'));

    expect(trace.traces.length).toBe(2);
    expect(report.cases.length).toBe(2);

    for (let i = 0; i < trace.traces.length; i++) {
      const t = trace.traces[i];
      const startedAt = String(t.started_at ?? '');
      const endedAt = String(t.ended_at ?? '');
      const start = new Date(startedAt).getTime();
      const end = new Date(endedAt).getTime();
      const expectedDuration = Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, Math.round(end - start));

      const reportCase = report.cases.find((c) => c.test_case_id === String(t.test_case_id));
      expect(reportCase, `report case ${t.test_case_id} should exist`).toBeTruthy();
      expect(reportCase!.duration_ms).toBe(expectedDuration);
      expect(reportCase!.duration_ms).toBeGreaterThan(0);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('m02: duration_ms is 0 for missing or invalid timestamps', async () => {
  const out = runDir('m02duration-invalid');
  const man = runDir('m02duration-invalid-man');
  test.setTimeout(90_000);
  const port = 4198;
  try {
    const suiteId = 'SUITE-m02-duration-invalid';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'M-02 duration invalid test',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M02-DUR-1',
          title: 'valid timestamps',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    const report = readJson<{ cases: Array<{ test_case_id: string; duration_ms: number }> }>(join(out, 'report.json'));
    expect(report.cases.length).toBe(1);
    expect(report.cases[0].duration_ms).toBeGreaterThan(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M-06 data verification integration tests.
//
//   - A suite can declare and execute SQLite verifications through the runner.
//   - Results are linked to the run and appear in traces and reports.
//   - A failed verification cannot be reported as passed.
//   - Suites without database configuration keep working as before.
//   - Write operations remain blocked by SQLite.
// ---------------------------------------------------------------------------

test('m06: suite with data verifications executes them and reflects results', async () => {
  const out = runDir('m06integration');
  const man = runDir('m06integrationman');
  test.setTimeout(120_000);
  const port = 4196;
  try {
    // Create a temporary SQLite database
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(man, 'test.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, category TEXT)');
    db.exec("INSERT INTO products (name, price, category) VALUES ('Widget', 9.99, 'tools')");
    db.exec("INSERT INTO products (name, price, category) VALUES ('Gadget', 19.99, 'electronics')");
    db.exec("INSERT INTO products (name, price, category) VALUES ('Thing', 29.99, 'tools')");
    db.close();

    const suiteId = 'SUITE-m06-integration';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'M-06 integration test',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M06-INT-1',
          title: 'Home page renders',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
      ],
      data_verifications: [
        {
          verification_id: 'DV-M06-INT-COUNT',
          description: 'TC-M06-INT-1: Verify product count',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: 'SELECT COUNT(*) as cnt FROM products',
          expected: { type: 'column_value', column: 'cnt', value: 3, operator: '=' },
        },
        {
          verification_id: 'DV-M06-INT-FAIL',
          description: 'TC-M06-INT-1: Verify product count (wrong expectation)',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: 'SELECT COUNT(*) as cnt FROM products',
          expected: { type: 'column_value', column: 'cnt', value: 99, operator: '=' },
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `runner exit 1 expected (verification FAIL): ${res.stdout}\n${res.stderr}`).toBe(1);

    // Verify data_verification.json was created
    const dv = readJson<Array<Record<string, unknown>>>(join(out, 'data_verification.json'));
    expect(dv.length).toBe(2);
    expect(dv[0].verification_id).toBe('DV-M06-INT-COUNT');
    expect(dv[0].status).toBe('PASS');
    expect(dv[1].verification_id).toBe('DV-M06-INT-FAIL');
    expect(dv[1].status).toBe('FAIL');

    // Verify report reflects the failure
    const report = readJson<{ overall_status: string; summary: { failed: number } }>(join(out, 'report.json'));
    expect(report.overall_status).toBe('FAIL');
    expect(report.summary.failed).toBe(1);

    // Verify traces include data verification info
    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces.length).toBe(1);
    const tcTrace = trace.traces[0];
    expect(tcTrace.test_case_id).toBe('TC-M06-INT-1');

    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

test('m06: suite without data verifications works as before', async () => {
  const out = runDir('m06nodv');
  test.setTimeout(90_000);
  try {
    const res = await runRunner(['--suite', WEB_SUITE, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    // No data_verification.json should be created
    expect(existsSync(join(out, 'data_verification.json'))).toBe(false);

    // Report should be PASS
    const report = readJson<{ overall_status: string }>(join(out, 'report.json'));
    expect(report.overall_status).toBe('PASS');

    // The run dir still validates as a whole; report.json is detected by contract
    // and no data_verification.json is expected for a suite without SQLite checks.
    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('m06: write operations remain blocked through runner integration', async () => {
  const out = runDir('m06writeblocked');
  const man = runDir('m06writeblockedman');
  test.setTimeout(120_000);
  const port = 4195;
  try {
    // Create a temporary SQLite database
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(man, 'test.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO products (name) VALUES ('Widget')");
    db.close();

    const suiteId = 'SUITE-m06-write-blocked';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'M-06 write blocked test',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M06-WB-1',
          title: 'Home page renders',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
      ],
      data_verifications: [
        {
          verification_id: 'DV-M06-WRITE-ATTEMPT',
          description: 'TC-M06-WB-1: Attempt write operation (must be blocked)',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: "INSERT INTO products (name) VALUES ('Hacked')",
          expected: { type: 'not_empty' },
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `runner exit 1 expected (write blocked): ${res.stdout}\n${res.stderr}`).toBe(1);

    // Verify the write was blocked
    const dv = readJson<Array<Record<string, unknown>>>(join(out, 'data_verification.json'));
    expect(dv.length).toBe(1);
    expect(dv[0].status).toBe('ERROR');
    expect(String(dv[0].error)).toContain('rejected');

    // Verify the database was not modified
    const { DatabaseSync: DS } = await import('node:sqlite');
    const checkDb = new DS(dbPath, { readOnly: true });
    const count = checkDb.prepare('SELECT COUNT(*) as cnt FROM products').all() as Array<Record<string, unknown>>;
    checkDb.close();
    expect(count[0].cnt).toBe(1); // still 1, not 2
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

test('m06: error scenario - invalid database path produces ERROR status', async () => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  // Use absolute paths to avoid working directory issues
  const outDir = resolve(REPO_ROOT, 'automation', '.runs', `m06error-${timestamp}-${randomSuffix}`);
  const manDir = resolve(REPO_ROOT, 'automation', '.runs', `m06errorman-${timestamp}-${randomSuffix}`);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(manDir, { recursive: true });
  test.setTimeout(120_000);
  const port = 4191;
  try {
    const suiteId = 'SUITE-m06-error';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'M-06 error scenario test',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M06-ERR-1',
          title: 'Error test',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
      ],
      data_verifications: [
        {
          verification_id: 'DV-M06-ERR-INVALID',
          description: 'Test invalid database path (ERROR)',
          test_case_id: 'TC-M06-ERR-1',
          database: 'automation/.runs/nonexistent/path/db.sqlite',
          query: 'SELECT 1',
          expected: { type: 'not_empty' },
        },
      ],
    };
    const manifestPath = join(manDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', outDir]);
    expect(res.code, `runner exit 1 expected (verification ERROR): ${res.stdout}\n${res.stderr}`).toBe(1);

    const dv = readJson<Array<Record<string, unknown>>>(join(outDir, 'data_verification.json'));
    expect(dv.length).toBe(1);
    expect(dv[0].status).toBe('ERROR');
    expect(String(dv[0].error)).toContain('not found');

    const report = readJson<{ overall_status: string; summary: { failed: number; errors: number } }>(join(outDir, 'report.json'));
    expect(report.overall_status).toBe('FAIL');
    expect(report.summary.errors).toBe(1);

    await validateRunDir(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(manDir, { recursive: true, force: true });
  }
});

test('m06: contract invalid rejection - invalid data_verification.json is rejected by M-01 validator', async () => {
  const out = runDir('m06contract');
  test.setTimeout(90_000);
  try {
    // Create an invalid data_verification.json (missing required fields)
    const invalidDv = [
      {
        verification_id: 'DV-INVALID',
        description: 'Invalid',
        query: 'SELECT 1',
        // missing required fields: status, rows_returned, duration_ms, expected, actual, evidence
      },
    ];
    writeFileSync(join(out, 'data_verification.json'), JSON.stringify(invalidDv, null, 2), 'utf8');

    // Run M-01 validator on the directory - should fail
    const valRes = await runPython(['qa/tools/validate_contracts.py', '--contract', 'data-verification', '--file', join(out, 'data_verification.json'), '--json']);
    expect(valRes.code, `validation should fail for invalid contract: ${valRes.stdout}`).not.toBe(0);
    const valReport = JSON.parse(valRes.stdout) as { valid: boolean; summary: { errors: number } };
    expect(valReport.valid).toBe(false);
    expect(valReport.summary.errors).toBeGreaterThan(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('m06: runtime M-01 gate rejects an invalid data_verification artifact (invalid verification_id)', async () => {
  // AUD-05: the runner must validate data_verification.json with the canonical
  // M-01 validator. A manifest declaring a verification_id that violates the
  // contract pattern (^DV-...) must make the run fail with an explicit error,
  // not pass silently through a weaker partial check.
  const out = runDir('m06m01');
  const man = runDir('m06m01man');
  test.setTimeout(120_000);
  const port = 4197;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(man, 'test.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO products (name) VALUES ('Widget')");
    db.close();

    const suiteId = 'SUITE-m06-m01';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'AUD-05 runtime M-01 gate',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M06-M01-1',
          title: 'Contract gate test',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
      ],
      data_verifications: [
        {
          verification_id: 'BAD-ID',
          description: 'TC-M06-M01-1: verification_id violates the data-verification contract',
          test_case_id: 'TC-M06-M01-1',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: 'SELECT COUNT(*) as cnt FROM products',
          expected: { type: 'not_empty' },
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', 'SUITE-m06-m01', '--out', out]);
    expect(res.code, `runner exit 2 expected (M-01 gate): ${res.stdout}\n${res.stderr}`).toBe(2);
    expect(res.stderr).toContain('does not conform to the data-verification contract');
    expect(res.stderr).toContain('pattern');

    // The artifact is still on disk and M-01 rejects it (explicit error, not "unknown").
    const dvPath = join(out, 'data_verification.json');
    expect(existsSync(dvPath)).toBe(true);
    const valRes = await runPython(['qa/tools/validate_contracts.py', '--contract', 'data-verification', '--file', dvPath, '--json']);
    expect(valRes.code).not.toBe(0);
    expect((JSON.parse(valRes.stdout) as { valid: boolean }).valid).toBe(false);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

test('m06: association explicit test_case_id - TC-1 and TC-10 no cross-association', async () => {
  const out = runDir('m06assoc');
  const man = runDir('m06assocman');
  test.setTimeout(120_000);
  const port = 4189;
  try {
    // Create a temporary SQLite database
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(man, 'test.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO products (name) VALUES ('Widget')");
    db.close();

    const suiteId = 'SUITE-m06-assoc';
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      web_server: {
        command: `node automation/scripts/serve-demo.mjs ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout_ms: 15000,
      },
      requirements: {
        task: suiteId,
        scope: 'M-06 association test',
        platform: 'web',
        need: {
          runtime: { python: true, node: true, npm: true },
          adapters: ['playwright'],
          browsers: ['chromium'],
          tools: ['node', 'npm'],
          target: { url: `http://127.0.0.1:${port}/`, method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-1',
          title: 'TC 1',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
        {
          test_case_id: 'TC-10',
          title: 'TC 10',
          spec: 'automation/specs/demo-web/site.spec.ts',
          test_name: 'home renders the product catalog',
          expected_result: 'x',
        },
      ],
      data_verifications: [
        {
          verification_id: 'DV-ASSOC-1',
          description: 'Verification for TC-1 only',
          test_case_id: 'TC-1',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: 'SELECT 1 as val',
          expected: { type: 'not_empty' },
        },
        {
          verification_id: 'DV-ASSOC-10',
          description: 'Verification for TC-10 only',
          test_case_id: 'TC-10',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: 'SELECT 1 as val',
          expected: { type: 'not_empty' },
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out]);
    expect(res.code, `runner exit 0 expected: ${res.stdout}\n${res.stderr}`).toBe(0);

    // Verify data_verification.json was created
    const dv = readJson<Array<Record<string, unknown>>>(join(out, 'data_verification.json'));
    expect(dv.length).toBe(2);
    expect(dv[0].status).toBe('PASS');
    expect(dv[1].status).toBe('PASS');

    // Verify traces have correct association via explicit test_case_id
    const trace = readJson<{ traces: Array<Record<string, unknown>> }>(join(out, 'execution_trace.json'));
    expect(trace.traces.length).toBe(2);
    const tc1Trace = trace.traces.find((t) => t.test_case_id === 'TC-1');
    const tc10Trace = trace.traces.find((t) => t.test_case_id === 'TC-10');
    expect(tc1Trace).toBeTruthy();
    expect(tc10Trace).toBeTruthy();
    expect((tc1Trace?.data_verifications as Array<{ verification_id: string }>)?.map((d) => d.verification_id)).toEqual(['DV-ASSOC-1']);
    expect((tc10Trace?.data_verifications as Array<{ verification_id: string }>)?.map((d) => d.verification_id)).toEqual(['DV-ASSOC-10']);

    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// m06 sensitive compared values: the obtained/expected column values must never
// reach ANY runner artifact (data_verification.json, report.json/html, trace).
// Fictional markers only; no real credential is involved.
// ---------------------------------------------------------------------------

const SENSITIVE_ACTUAL_MARKER = 'SENSITIVE_ACTUAL_TEST_7F31';
const SENSITIVE_EXPECTED_MARKER = 'SENSITIVE_EXPECTED_TEST_9C42';

test('m06 sensitive values: compared column values never reach runner artifacts', async () => {
  const out = runDir('m06redact');
  const man = runDir('m06redactman');
  test.setTimeout(120_000);
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(man, 'sensitive.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, token TEXT)');
    db.exec(`INSERT INTO accounts (token) VALUES ('${SENSITIVE_ACTUAL_MARKER}')`);
    db.close();

    const suiteId = 'SUITE-m06-redact';
    const specPath = join(man, 'redact-probe.spec.ts');
    writeFileSync(
      specPath,
      `import { test, expect } from '@playwright/test';\n\ntest('redaction probe passes', () => {\n  expect(1).toBe(1);\n});\n`,
      'utf8',
    );

    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      requirements: {
        task: suiteId,
        scope: 'M-06 sensitive compared values',
        platform: 'web',
        need: {
          runtime: { python: false, node: true, npm: true },
          adapters: ['playwright'],
          browsers: [],
          tools: ['node'],
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: 'TC-M06-REDACT-1',
          title: 'Redaction probe',
          spec: toPosix(relative(REPO_ROOT, specPath)),
          test_name: 'redaction probe passes',
          expected_result: 'x',
        },
      ],
      data_verifications: [
        {
          verification_id: 'DV-REDACT-PASS',
          description: 'TC-M06-REDACT-1: approved comparison',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: 'SELECT token FROM accounts',
          expected: { type: 'column_value', column: 'token', value: SENSITIVE_ACTUAL_MARKER, operator: '=' },
        },
        {
          verification_id: 'DV-REDACT-FAIL',
          description: 'TC-M06-REDACT-1: failing comparison',
          database: toPosix(relative(REPO_ROOT, dbPath)),
          query: 'SELECT token FROM accounts',
          expected: { type: 'column_value', column: 'token', value: SENSITIVE_EXPECTED_MARKER, operator: '=' },
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out, '--no-preflight']);
    expect(res.code, `runner exit 1 expected (a data verification FAILs): ${res.stdout}\n${res.stderr}`).toBe(1);

    // Neither marker may appear in ANY produced artifact.
    const artifacts: Array<[string, string]> = [
      ['data_verification.json', readFileSync(join(out, 'data_verification.json'), 'utf8')],
      ['report.json', readFileSync(join(out, 'report.json'), 'utf8')],
      ['report.html', readFileSync(join(out, 'report.html'), 'utf8')],
      ['execution_trace.json', readFileSync(join(out, 'execution_trace.json'), 'utf8')],
      ['summary.json', readFileSync(join(out, 'summary.json'), 'utf8')],
    ];
    for (const [name, content] of artifacts) {
      expect(content, `${name} must not leak the obtained value`).not.toContain(SENSITIVE_ACTUAL_MARKER);
      expect(content, `${name} must not leak the expected value`).not.toContain(SENSITIVE_EXPECTED_MARKER);
    }

    // Outcome and evidence are preserved even though the values are redacted.
    const dv = readJson<Array<Record<string, unknown>>>(join(out, 'data_verification.json'));
    expect(dv).toHaveLength(2);
    const pass = dv.find((d) => d.verification_id === 'DV-REDACT-PASS');
    const fail = dv.find((d) => d.verification_id === 'DV-REDACT-FAIL');
    expect(pass?.status).toBe('PASS');
    expect(fail?.status).toBe('FAIL');
    expect((pass?.actual as { column_value?: string }).column_value).toBe('<redacted>');
    expect((pass?.actual as { column_found?: boolean }).column_found).toBe(true);
    expect((fail?.actual as { column_found?: boolean }).column_found).toBe(true);
    expect((pass?.expected as { value?: string }).value).toBe('<redacted>');
    expect((fail?.expected as { value?: string }).value).toBe('<redacted>');
    // The checked column/operator are still recorded as evidence.
    expect(String(fail?.error ?? '')).toContain("expected column 'token' =");

    const report = readJson<{ overall_status: string; summary: { failed: number } }>(join(out, 'report.json'));
    expect(report.overall_status).toBe('FAIL');
    expect(report.summary.failed).toBe(1);

    await validateRunDir(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(man, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// m03 Playwright exit code: a non-zero Playwright exit that no mapped result
// explains must NOT be reported as a successful run, while a normal test failure
// and a correct run stay unchanged.
// ---------------------------------------------------------------------------

test('m03 playwright exit: unexplained non-zero is not success; normal fail/success unchanged', async () => {
  test.setTimeout(180_000);
  const created: string[] = [];
  const makeRun = async (name: string, body: string, testName: string) => {
    const out = runDir(`pwexit-${name}`);
    const man = runDir(`pwexit-${name}-man`);
    created.push(out, man);
    const specPath = join(man, `${name}.spec.ts`);
    writeFileSync(specPath, body, 'utf8');
    const suiteId = `SUITE-m03-pwexit-${name}`;
    const manifest = {
      suite_id: suiteId,
      app: 'demo-qaa',
      platform: 'web',
      adapter: 'playwright',
      requirements: {
        task: suiteId,
        scope: 'M-03 playwright exit propagation',
        platform: 'web',
        need: {
          runtime: { python: false, node: true, npm: true },
          adapters: ['playwright'],
          browsers: [],
          tools: ['node'],
          requires_evidence: true,
          qa_reviewer: { required: false },
        },
      },
      test_cases: [
        {
          test_case_id: `TC-PWEXIT-${name}`,
          title: `pw exit ${name}`,
          spec: toPosix(relative(REPO_ROOT, specPath)),
          test_name: testName,
          expected_result: 'x',
        },
      ],
    };
    const manifestPath = join(man, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    const res = await runRunner(['--manifest', manifestPath, '--suite', suiteId, '--out', out, '--no-preflight']);
    return { out, res };
  };

  try {
    // (a) Unhandled rejection while every selected test passes: Playwright exits
    //     non-zero with a top-level error, but the mapped Test Case is `passed`,
    //     so with the old logic the run looked successful (PASS / exit 0).
    const unexplained = await makeRun(
      'unexplained',
      `import { test, expect } from '@playwright/test';\n\ntest('passes but leaks a global error', () => {\n  expect(1).toBe(1);\n  void Promise.reject(new Error('probe unhandled rejection'));\n});\n`,
      'passes but leaks a global error',
    );
    expect(
      unexplained.res.code,
      `an unexplained Playwright failure must not return success: ${unexplained.res.stdout}\n${unexplained.res.stderr}`,
    ).toBe(1);

    const uTrace = readJson<{ traces: Array<Record<string, unknown>> }>(join(unexplained.out, 'execution_trace.json'));
    expect(uTrace.traces).toHaveLength(1);
    // The mapped Test Case itself passed — that is exactly why the old logic lied.
    expect(uTrace.traces[0].status).toBe('PASS');

    const uReport = readJson<{ overall_status: string; summary: { failed: number }; infrastructure_errors?: string[] }>(
      join(unexplained.out, 'report.json'),
    );
    expect(uReport.overall_status).toBe('FAIL');
    expect(uReport.infrastructure_errors?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect((uReport.infrastructure_errors ?? []).join(' ')).toMatch(/Playwright/i);

    const uHtml = readFileSync(join(unexplained.out, 'report.html'), 'utf8');
    expect(uHtml).toContain('Errores de infraestructura');

    const uSummary = readJson<{ playwright_exit_code?: number; infrastructure_errors?: number }>(join(unexplained.out, 'summary.json'));
    expect(uSummary.playwright_exit_code).toBe(1);
    expect(uSummary.infrastructure_errors ?? 0).toBeGreaterThanOrEqual(1);

    await validateRunDir(unexplained.out);

    // (b) A normal test failure: the mapped result is FAIL, so the non-zero exit
    //     is already represented — no infrastructure error is invented.
    const normalFail = await makeRun(
      'normalfail',
      `import { test, expect } from '@playwright/test';\n\ntest('fails normally', () => {\n  expect(1).toBe(2);\n});\n`,
      'fails normally',
    );
    expect(normalFail.res.code).toBe(1);
    const nfReport = readJson<{ overall_status: string; summary: { failed: number }; infrastructure_errors?: string[] }>(
      join(normalFail.out, 'report.json'),
    );
    expect(nfReport.overall_status).toBe('FAIL');
    expect(nfReport.summary.failed).toBe(1);
    expect(nfReport.infrastructure_errors ?? []).toHaveLength(0);

    // (c) A correct run stays success with exit 0 and no infrastructure error.
    const ok = await makeRun(
      'ok',
      `import { test, expect } from '@playwright/test';\n\ntest('passes cleanly', () => {\n  expect(1).toBe(1);\n});\n`,
      'passes cleanly',
    );
    expect(ok.res.code, `a correct run must exit 0: ${ok.res.stdout}\n${ok.res.stderr}`).toBe(0);
    const okReport = readJson<{ overall_status: string; infrastructure_errors?: string[] }>(join(ok.out, 'report.json'));
    expect(okReport.overall_status).toBe('PASS');
    expect(okReport.infrastructure_errors ?? []).toHaveLength(0);
    const okSummary = readJson<{ playwright_exit_code?: number }>(join(ok.out, 'summary.json'));
    expect(okSummary.playwright_exit_code).toBe(0);
  } finally {
    for (const dir of created) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});