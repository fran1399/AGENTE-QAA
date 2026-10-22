// M-02 adapter tests — JUnit XML export.
//
// The generator is pure (ExecutionReport -> XML), so these tests are unit
// tests: no server, no runner, no external project. XML well-formedness is
// checked with the real browser parser (DOMParser), which also proves that
// escaped text round-trips to the original value.

import { test, expect, type Page } from '@playwright/test';
import {
  escapeXml,
  formatSeconds,
  renderJUnitXml,
} from '../runner/junit';
import type { ExecutionReport, ReportCase } from '../runner/report';

interface ParsedCase {
  name: string | null;
  classname: string | null;
  file: string | null;
  time: string | null;
  failure: { type: string | null; message: string | null; text: string } | null;
  error: { type: string | null; message: string | null; text: string } | null;
  skipped: string | null;
  systemOut: string | null;
}

interface ParsedXml {
  parseError: string | null;
  root: string | null;
  name: string | null;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  suiteTimestamp: string | null;
  properties: Record<string, string>;
  cases: ParsedCase[];
}

async function parseXml(page: Page, xml: string): Promise<ParsedXml> {
  return page.evaluate((src) => {
    const doc = new DOMParser().parseFromString(src, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    const root = doc.documentElement;
    const child = (el: Element, tag: string): Element | null =>
      Array.from(el.children).find((c) => c.tagName === tag) ?? null;
    const num = (el: Element | null, name: string): number => Number(el?.getAttribute(name) ?? 0);

    const suite = root ? child(root, 'testsuite') : null;
    const properties: Record<string, string> = {};
    const propsEl = suite ? child(suite, 'properties') : null;
    if (propsEl) {
      for (const p of Array.from(propsEl.children)) {
        const key = p.getAttribute('name');
        if (key !== null) properties[key] = p.getAttribute('value') ?? '';
      }
    }

    const cases: ParsedCase[] = Array.from(doc.getElementsByTagName('testcase')).map((tc) => {
      const failure = child(tc, 'failure');
      const error = child(tc, 'error');
      const skipped = child(tc, 'skipped');
      const out = child(tc, 'system-out');
      return {
        name: tc.getAttribute('name'),
        classname: tc.getAttribute('classname'),
        file: tc.getAttribute('file'),
        time: tc.getAttribute('time'),
        failure: failure
          ? { type: failure.getAttribute('type'), message: failure.getAttribute('message'), text: failure.textContent ?? '' }
          : null,
        error: error
          ? { type: error.getAttribute('type'), message: error.getAttribute('message'), text: error.textContent ?? '' }
          : null,
        skipped: skipped ? (skipped.getAttribute('message') ?? '') : null,
        systemOut: out ? (out.textContent ?? '') : null,
      };
    });

    return {
      parseError: parserError ? (parserError.textContent ?? 'parse error') : null,
      root: root ? root.tagName : null,
      name: root ? root.getAttribute('name') : null,
      tests: num(root, 'tests'),
      failures: num(root, 'failures'),
      errors: num(root, 'errors'),
      skipped: num(root, 'skipped'),
      suiteTimestamp: suite ? suite.getAttribute('timestamp') : null,
      properties,
      cases,
    };
  }, xml);
}

function reportWith(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    report_id: 'ER-20261022T120000000Z',
    run_id: 'R-20261022T120000000Z',
    suite_id: 'SUITE-unit-junit',
    app: 'demo-qaa',
    platform: 'web',
    started_at: '2026-10-22T12:00:00.000Z',
    ended_at: '2026-10-22T12:00:02.500Z',
    duration_ms: 2500,
    overall_status: 'PASS',
    summary: { selected: 0, executed: 0, passed: 0, failed: 0, errors: 0, blocked: 0, skipped: 0, omitted: 0 },
    cases: [],
    preflight: { result: 'READY' },
    infrastructure_errors: [],
    evidence_index: [],
    generated_at: '2026-10-22T12:00:02.500Z',
    ...overrides,
  };
}

function caseWith(overrides: Partial<ReportCase> = {}): ReportCase {
  return {
    test_case_id: 'TC-UNIT-1',
    title: 'a unit test case',
    status: 'PASS',
    duration_ms: 1234,
    spec: 'automation/specs/demo-web/site.spec.ts',
    evidence: [],
    ...overrides,
  };
}

test('junit: PASS case maps to a testcase without failure/error/skipped', async ({ page }) => {
  const xml = renderJUnitXml(reportWith({
    cases: [caseWith()],
    summary: { selected: 1, executed: 1, passed: 1, failed: 0, errors: 0, blocked: 0, skipped: 0, omitted: 0 },
  }));

  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);

  const parsed = await parseXml(page, xml);
  expect(parsed.parseError).toBeNull();
  expect(parsed.root).toBe('testsuites');
  expect(parsed.name).toBe('SUITE-unit-junit');
  expect(parsed.tests).toBe(1);
  expect(parsed.failures).toBe(0);
  expect(parsed.errors).toBe(0);
  expect(parsed.skipped).toBe(0);
  expect(parsed.suiteTimestamp).toBe('2026-10-22T12:00:00.000Z');
  expect(parsed.properties.run_id).toBe('R-20261022T120000000Z');
  expect(parsed.properties.overall_status).toBe('PASS');

  const [tc] = parsed.cases;
  expect(tc.classname).toBe('SUITE-unit-junit');
  expect(tc.name).toBe('TC-UNIT-1 a unit test case');
  expect(tc.file).toBe('automation/specs/demo-web/site.spec.ts');
  expect(tc.time).toBe('1.234');
  expect(tc.failure).toBeNull();
  expect(tc.error).toBeNull();
  expect(tc.skipped).toBeNull();
});

test('junit: FAIL maps to <failure type="FAIL"> and never to <error> or a Bug claim', async ({ page }) => {
  const error = 'expect(received).toBe(expected)\n\nExpected: 1\nReceived: 2';
  const xml = renderJUnitXml(reportWith({
    overall_status: 'FAIL',
    cases: [caseWith({
      status: 'FAIL',
      error,
      evidence: ['automation/.runs/x/evidence/TC-UNIT-1_assertions.json'],
    })],
    summary: { selected: 1, executed: 1, passed: 0, failed: 1, errors: 0, blocked: 0, skipped: 0, omitted: 0 },
  }));

  const parsed = await parseXml(page, xml);
  expect(parsed.parseError).toBeNull();
  expect(parsed.failures).toBe(1);
  expect(parsed.errors).toBe(0);

  const [tc] = parsed.cases;
  expect(tc.failure).not.toBeNull();
  expect(tc.failure!.type).toBe('FAIL');
  expect(tc.failure!.message).toBe('expect(received).toBe(expected)');
  expect(tc.failure!.text).toContain('Received: 2');
  expect(tc.error).toBeNull();
  expect(tc.systemOut).toContain('TC-UNIT-1_assertions.json');

  // The export preserves the semantic distinction: FAIL is not an APP_BUG.
  expect(xml).not.toContain('APP_BUG');
  expect(xml).not.toContain('<error');
});

test('junit: execution errors map to <error> on synthetic suite-level cases', async ({ page }) => {
  const xml = renderJUnitXml(reportWith({
    overall_status: 'FAIL',
    cases: [caseWith()],
    summary: { selected: 1, executed: 1, passed: 1, failed: 0, errors: 2, blocked: 0, skipped: 0, omitted: 0 },
    infrastructure_errors: ['Playwright worker crashed before mapping results'],
  }));

  const parsed = await parseXml(page, xml);
  expect(parsed.parseError).toBeNull();
  expect(parsed.tests).toBe(4); // 1 product Test Case + 1 infrastructure + 2 data-verification
  expect(parsed.failures).toBe(0);
  expect(parsed.errors).toBe(3);
  expect(parsed.skipped).toBe(0);

  const errors = parsed.cases.filter((c) => c.error !== null);
  expect(errors).toHaveLength(3);
  expect(errors.map((c) => c.error!.type).sort()).toEqual(['DATA_VERIFICATION', 'DATA_VERIFICATION', 'INFRASTRUCTURE']);
  expect(errors.every((c) => c.classname === 'SUITE-unit-junit.suite-level')).toBe(true);
  expect(errors.every((c) => c.failure === null)).toBe(true);

  const infra = errors.find((c) => c.error!.type === 'INFRASTRUCTURE');
  expect(infra!.error!.message).toBe('Playwright worker crashed before mapping results');
});

test('junit: BLOCKED and SKIPPED map to <skipped> with their message', async ({ page }) => {
  const xml = renderJUnitXml(reportWith({
    overall_status: 'BLOCKED',
    preflight: { result: 'BLOCKED', blocked_reasons: ['chromium not installed'] },
    cases: [
      caseWith({ test_case_id: 'TC-UNIT-B', status: 'BLOCKED', block_reason: 'pre-flight: chromium not installed' }),
      caseWith({ test_case_id: 'TC-UNIT-S', status: 'SKIPPED', duration_ms: 0 }),
    ],
    summary: { selected: 2, executed: 0, passed: 0, failed: 0, errors: 0, blocked: 1, skipped: 1, omitted: 0 },
  }));

  const parsed = await parseXml(page, xml);
  expect(parsed.parseError).toBeNull();
  expect(parsed.tests).toBe(2);
  expect(parsed.failures).toBe(0);
  expect(parsed.errors).toBe(0);
  expect(parsed.skipped).toBe(2);
  expect(parsed.properties['preflight.blocked_reasons']).toBe('chromium not installed');

  const blocked = parsed.cases.find((c) => c.name!.startsWith('TC-UNIT-B'));
  const skipped = parsed.cases.find((c) => c.name!.startsWith('TC-UNIT-S'));
  expect(blocked!.skipped).toBe('BLOCKED: pre-flight: chromium not installed');
  expect(skipped!.skipped).toBe('SKIPPED');
});

test('junit: multiple cases keep counters and identifiers from the source report', async ({ page }) => {
  const report = reportWith({
    overall_status: 'PARTIAL',
    cases: [
      caseWith({ test_case_id: 'TC-UNIT-1', status: 'PASS' }),
      caseWith({ test_case_id: 'TC-UNIT-2', status: 'PASS' }),
      caseWith({ test_case_id: 'TC-UNIT-3', status: 'FAIL', error: 'expected true, received false' }),
      caseWith({ test_case_id: 'TC-UNIT-4', status: 'BLOCKED', block_reason: 'missing data' }),
    ],
    summary: { selected: 4, executed: 2, passed: 2, failed: 1, errors: 0, blocked: 1, skipped: 0, omitted: 0 },
  });

  const parsed = await parseXml(page, renderJUnitXml(report));
  expect(parsed.parseError).toBeNull();
  expect(parsed.tests).toBe(4);
  expect(parsed.failures).toBe(1);
  expect(parsed.errors).toBe(0);
  expect(parsed.skipped).toBe(1);

  const ids = parsed.cases.map((c) => c.name!.split(' ')[0]);
  expect(ids).toEqual(['TC-UNIT-1', 'TC-UNIT-2', 'TC-UNIT-3', 'TC-UNIT-4']);
  expect(parsed.cases.filter((c) => c.failure).map((c) => c.name!.split(' ')[0])).toEqual(['TC-UNIT-3']);
  expect(parsed.cases.filter((c) => c.skipped !== null).map((c) => c.name!.split(' ')[0])).toEqual(['TC-UNIT-4']);
});

test('junit: special characters and invalid code points keep the XML well-formed', async ({ page }) => {
  const title = 'A & B \u0001 <tag> "quoted" \'single\' ]]>';
  const error = '\u001b[31mlínea 1\u001b[0m & < > " \' ]]> \u0000\nlínea 2';
  const xml = renderJUnitXml(reportWith({
    cases: [caseWith({
      title,
      status: 'FAIL',
      error,
      evidence: ['automation/.runs/x/evidence/a&b<c>.json'],
    })],
    summary: { selected: 1, executed: 1, passed: 0, failed: 1, errors: 0, blocked: 0, skipped: 0, omitted: 0 },
  }));

  const parsed = await parseXml(page, xml);
  expect(parsed.parseError).toBeNull();

  const [tc] = parsed.cases;
  // Control characters are removed; the rest round-trips exactly.
  expect(tc.name).toBe('TC-UNIT-1 A & B  <tag> "quoted" \'single\' ]]>');
  expect(tc.failure!.message).toBe('línea 1 & < > " \' ]]>');
  expect(tc.failure!.text).toContain('línea 1 & < > " \' ]]>');
  expect(tc.failure!.text).toContain('línea 2');
  expect(tc.failure!.text).not.toContain('\u001b');
  expect(tc.failure!.text).not.toContain('[31m');
  expect(tc.systemOut).toContain('a&b<c>.json');
});

test('junit: an empty execution still produces a valid document', async ({ page }) => {
  const parsed = await parseXml(page, renderJUnitXml(reportWith()));

  expect(parsed.parseError).toBeNull();
  expect(parsed.root).toBe('testsuites');
  expect(parsed.tests).toBe(0);
  expect(parsed.failures).toBe(0);
  expect(parsed.errors).toBe(0);
  expect(parsed.skipped).toBe(0);
  expect(parsed.cases).toHaveLength(0);
});

test('junit: duration and escaping helpers are deterministic', () => {
  expect(formatSeconds(0)).toBe('0.000');
  expect(formatSeconds(-5)).toBe('0.000');
  expect(formatSeconds(Number.NaN)).toBe('0.000');
  expect(formatSeconds(1234)).toBe('1.234');
  expect(formatSeconds(60_000)).toBe('60.000');

  expect(escapeXml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  expect(escapeXml('ok\u0000\u001Fend')).toBe('okend');
});
