// M-02 (adapter) — JUnit XML export.
//
// JUnit XML is an *output adapter* over the same ExecutionReport that feeds
// report.json/report.html: every element derives from that single model, so the
// three formats cannot disagree. The generator never re-runs tests, never
// invents a result and never classifies a FAIL as a product defect.
//
// Status mapping (documented in docs/RUNNER-M03.md §5.1):
//   PASS     -> <testcase> with no failure/error/skipped child
//   FAIL     -> <failure type="FAIL">    (real assertion failure, still
//                unclassified: a FAIL is not an APP_BUG)
//   BLOCKED  -> <skipped message="BLOCKED: ...">
//   SKIPPED  -> <skipped>
//   execution errors (infrastructure_errors / summary.errors) -> <error> on a
//                synthetic suite-level testcase, never on a product Test Case.
//
// The file is opt-in (`--junit [path]`) and is not part of the M-01 bundle:
// contract discovery only reads *.json, exactly like report.html.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionReport, ReportCase } from './report.js';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

// Characters XML 1.0 cannot represent (C0 controls except TAB/LF/CR, plus the
// two non-characters). They are removed instead of emitted, because a single
// invalid code point would make the whole document unparsable.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

// Playwright embeds ANSI colour codes in assertion messages. They are not
// meaningful outside a terminal, so they are removed before export (the ESC
// byte itself is already stripped by INVALID_XML_CHARS, which would otherwise
// leave only the raw `[2m`/`[31m` fragments behind).
const ANSI_ESCAPE = /\u001B\[[0-9;]*[A-Za-z]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, '');
}

/** ANSI-free text without XML-invalid code points (safe to trim and compare). */
function sanitize(value: string): string {
  return stripAnsi(value).replace(INVALID_XML_CHARS, '');
}

/** Escapes a value for use in XML text or a quoted attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Formats a duration in milliseconds as JUnit `time` (seconds, 3 decimals). */
export function formatSeconds(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return (safe / 1000).toFixed(3);
}

function firstLine(text: string, max = 500): string {
  const line = sanitize(text).split(/\r?\n/, 1)[0].trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function attr(name: string, value: string | undefined): string {
  return value === undefined ? '' : ` ${name}="${escapeXml(value)}"`;
}

function property(name: string, value: string): string {
  return `      <property name="${escapeXml(name)}" value="${escapeXml(value)}"/>`;
}

/** Suite-level execution errors, represented as synthetic (non-product) cases. */
interface SuiteErrorCase {
  name: string;
  classname: string;
  type: string;
  message: string;
}

function suiteErrorCases(report: ExecutionReport): SuiteErrorCase[] {
  const classname = `${report.suite_id}.suite-level`;
  const out: SuiteErrorCase[] = [];

  for (let i = 0; i < report.infrastructure_errors.length; i += 1) {
    out.push({
      name: `INFRASTRUCTURE-ERROR-${i + 1}`,
      classname,
      type: 'INFRASTRUCTURE',
      message: report.infrastructure_errors[i] || 'Infrastructure error (no message recorded)',
    });
  }

  // summary.errors counts data-verification errors. The execution report keeps
  // the count but not the verification ids, so one explicit synthetic case per
  // counted error keeps JUnit counters equal to the original summary.
  for (let i = 0; i < report.summary.errors; i += 1) {
    out.push({
      name: `DATA-VERIFICATION-ERROR-${i + 1}`,
      classname,
      type: 'DATA_VERIFICATION',
      message: `Data verification error ${i + 1} of ${report.summary.errors}; details in data_verification.json`,
    });
  }

  return out;
}

function autoHealingLine(c: ReportCase): string {
  if (!c.auto_healing) return '';
  try {
    return `auto_healing: ${JSON.stringify(c.auto_healing)}`;
  } catch {
    return '';
  }
}

/** Evidence and auto-healing context, emitted only when the model carries it. */
function systemOut(c: ReportCase): string {
  const parts: string[] = [];
  if (c.evidence.length > 0) {
    parts.push(`evidence:\n${c.evidence.map((e) => `- ${e}`).join('\n')}`);
  }
  const heal = autoHealingLine(c);
  if (heal) parts.push(heal);
  return parts.join('\n');
}

function failureBody(c: ReportCase): string {
  const details: string[] = [];
  if (c.error) details.push(sanitize(c.error).trim());
  if (c.block_reason) details.push(`block_reason: ${sanitize(c.block_reason)}`);
  return details.join('\n\n') || c.title;
}

function renderCase(report: ExecutionReport, c: ReportCase): string {
  const name = `${c.test_case_id} ${c.title}`.trim();
  const lines = [
    `    <testcase classname="${escapeXml(report.suite_id)}" name="${escapeXml(name)}"${attr('file', c.spec || undefined)} time="${formatSeconds(c.duration_ms)}">`,
  ];

  if (c.status === 'FAIL') {
    const message = firstLine(c.error ?? c.title) || 'FAIL';
    lines.push(`      <failure type="FAIL" message="${escapeXml(message)}">${escapeXml(failureBody(c))}</failure>`);
  } else if (c.status === 'BLOCKED') {
    const reason = stripAnsi(c.block_reason ?? 'blocked by pre-flight');
    lines.push(`      <skipped message="${escapeXml(`BLOCKED: ${reason}`)}"/>`);
  } else if (c.status === 'SKIPPED') {
    const message = firstLine(c.error ?? 'SKIPPED') || 'SKIPPED';
    lines.push(`      <skipped message="${escapeXml(message)}"/>`);
  }

  const extra = systemOut(c);
  if (extra) lines.push(`      <system-out>${escapeXml(extra)}</system-out>`);

  lines.push('    </testcase>');
  return lines.join('\n');
}

function renderErrorCase(e: SuiteErrorCase): string {
  return `    <testcase classname="${escapeXml(e.classname)}" name="${escapeXml(e.name)}" time="0.000">
      <error type="${escapeXml(e.type)}" message="${escapeXml(firstLine(e.message))}">${escapeXml(e.message)}</error>
    </testcase>`;
}

function suiteProperties(report: ExecutionReport): string[] {
  const props: string[] = [
    property('run_id', report.run_id),
    property('report_id', report.report_id),
    property('suite_id', report.suite_id),
    property('app', report.app),
    property('platform', report.platform),
    property('overall_status', report.overall_status),
    property('preflight', report.preflight.result),
  ];
  if (report.auto_healing) {
    props.push(
      property('auto_healing.mode', report.auto_healing.mode),
      property('auto_healing.attempts', String(report.auto_healing.attempts)),
      property('auto_healing.recoveries_used', String(report.auto_healing.recoveries_used)),
      property('auto_healing.reused', String(report.auto_healing.reused)),
      property('auto_healing.duplicate_prevented', String(report.auto_healing.duplicate_prevented)),
      property('auto_healing.ai_calls', String(report.auto_healing.ai_calls)),
    );
  }
  if (report.preflight.blocked_reasons && report.preflight.blocked_reasons.length > 0) {
    props.push(property('preflight.blocked_reasons', report.preflight.blocked_reasons.join(' | ')));
  }
  return props;
}

/**
 * Renders a JUnit XML document from an ExecutionReport. Pure: no IO, no clock,
 * no environment. Counters are derived from the same data the report exposes.
 */
export function renderJUnitXml(report: ExecutionReport): string {
  const errorCases = suiteErrorCases(report);
  const failures = report.cases.filter((c) => c.status === 'FAIL').length;
  const skipped = report.cases.filter((c) => c.status === 'BLOCKED' || c.status === 'SKIPPED').length;
  const tests = report.cases.length + errorCases.length;
  const time = formatSeconds(report.duration_ms);

  const lines: string[] = [
    XML_DECLARATION,
    `<testsuites name="${escapeXml(report.suite_id)}" tests="${tests}" failures="${failures}" errors="${errorCases.length}" skipped="${skipped}" time="${time}">`,
    `  <testsuite name="${escapeXml(report.suite_id)}" tests="${tests}" failures="${failures}" errors="${errorCases.length}" skipped="${skipped}" time="${time}" timestamp="${escapeXml(report.started_at)}">`,
    '    <properties>',
    ...suiteProperties(report),
    '    </properties>',
  ];

  for (const c of report.cases) lines.push(renderCase(report, c));
  for (const e of errorCases) lines.push(renderErrorCase(e));

  lines.push('  </testsuite>', '</testsuites>', '');
  return lines.join('\n');
}

/** Writes the JUnit XML document, creating parent directories when needed. */
export function writeJUnitXml(file: string, report: ExecutionReport): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderJUnitXml(report), 'utf8');
  return file;
}
