// M-02 — Execution report generator (JSON + HTML).
//
// Generates a structured JSON report and a human-readable HTML report from
// the same execution data. The HTML is always derived from the JSON (never
// from a separate source), so both formats stay consistent by construction.
//
// The generator is pure: it receives the execution data and returns/writes
// the reports. It never re-runs tests, never invents results, and never
// exposes credentials or environment secrets.

import { existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export interface ReportCase {
  test_case_id: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED';
  duration_ms: number;
  spec: string;
  error?: string;
  block_reason?: string;
  evidence: string[];
  auto_healing?: Record<string, unknown>;
}

export interface ReportSummary {
  selected: number;
  executed: number;
  passed: number;
  failed: number;
  errors: number;
  blocked: number;
  skipped: number;
  omitted: number;
}

export interface ReportPreflight {
  result: 'READY' | 'BLOCKED' | 'SKIPPED';
  blocked_reasons?: string[];
  record_path?: string;
}

export interface ReportAutoHealing {
  mode: 'OFF' | 'OBSERVE' | 'HIGH_CONFIDENCE';
  attempts: number;
  recoveries_used: number;
  reused: number;
  duplicate_prevented: number;
  ai_calls: number;
}

export interface ReportEvidenceIndex {
  path: string;
  type?: string;
  test_case_id?: string;
}

export interface ExecutionReport {
  report_id: string;
  run_id: string;
  suite_id: string;
  app: string;
  platform: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  overall_status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'PARTIAL';
  summary: ReportSummary;
  cases: ReportCase[];
  preflight: ReportPreflight;
  auto_healing?: ReportAutoHealing;
  infrastructure_errors: string[];
  evidence_index: ReportEvidenceIndex[];
  generated_at: string;
}

export interface ReportInput {
  run_id: string;
  suite_id: string;
  app: string;
  platform: string;
  started_at: string;
  ended_at: string;
  overall_status: ExecutionReport['overall_status'];
  summary: ReportSummary;
  cases: ReportCase[];
  preflight: ReportPreflight;
  auto_healing?: ReportAutoHealing;
  infrastructure_errors?: string[];
  evidence_index?: ReportEvidenceIndex[];
}

// --------------------------------------------------------------------------- //
// HTML escaping (XSS prevention)
// --------------------------------------------------------------------------- //

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --------------------------------------------------------------------------- //
// Report-relative evidence links
// --------------------------------------------------------------------------- //
//
// Evidence paths inside the report are expressed relative to the repository
// root (e.g. `automation/.runs/<run>/evidence/x.json`), but report.html is
// written into `outDir` and opened from there. A browser resolves a relative
// href against the document location, so a repo-relative href would point to
// `<outDir>/automation/.runs/...` and 404. This builds a POSIX, percent-encoded
// href relative to the report's own directory: portable across machines and
// safe for names with spaces or non-ASCII characters.

function reportHref(reportDir: string, absolute: string): string {
  const rel = relative(reportDir, absolute);
  return rel.split(sep).map(encodeURIComponent).join('/');
}

// --------------------------------------------------------------------------- //
// Report ID
// --------------------------------------------------------------------------- //

function makeReportId(runId: string): string {
  return `ER-${runId.replace(/^R-/, '')}`;
}

// --------------------------------------------------------------------------- //
// JSON report
// --------------------------------------------------------------------------- //

export function buildReport(input: ReportInput): ExecutionReport {
  const durationMs = new Date(input.ended_at).getTime() - new Date(input.started_at).getTime();
  return {
    report_id: makeReportId(input.run_id),
    run_id: input.run_id,
    suite_id: input.suite_id,
    app: input.app,
    platform: input.platform,
    started_at: input.started_at,
    ended_at: input.ended_at,
    duration_ms: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    overall_status: input.overall_status,
    summary: input.summary,
    cases: input.cases,
    preflight: input.preflight,
    ...(input.auto_healing ? { auto_healing: input.auto_healing } : {}),
    infrastructure_errors: input.infrastructure_errors ?? [],
    evidence_index: input.evidence_index ?? [],
    generated_at: new Date().toISOString(),
  };
}

export function writeReportJson(outDir: string, report: ExecutionReport): string {
  const file = join(outDir, 'report.json');
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

// --------------------------------------------------------------------------- //
// HTML report (generated from the JSON report — single source of truth)
// --------------------------------------------------------------------------- //

function statusColor(status: string): string {
  switch (status) {
    case 'PASS': return '#10b981';
    case 'FAIL': return '#ef4444';
    case 'BLOCKED': return '#f59e0b';
    case 'SKIPPED': return '#6b7280';
    default: return '#6b7280';
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'PASS': return '✓';
    case 'FAIL': return '✗';
    case 'BLOCKED': return '⊘';
    case 'SKIPPED': return '○';
    default: return '?';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function renderReportHtml(report: ExecutionReport, repoRoot: string, outDir: string): string {
  const r = report;
  const s = r.summary;
  const hasInfraErrors = r.infrastructure_errors.length > 0;
  const hasAutoHealing = r.auto_healing !== undefined;
  const hasPreflight = r.preflight.result !== 'SKIPPED';

  const casesRows = r.cases.map((c) => {
    const evLinks = c.evidence.map((ev) => {
      const abs = resolve(repoRoot, ev);
      const exists = existsSync(abs);
      const href = exists ? reportHref(outDir, abs) : '#';
      const label = exists ? ev : `${ev} (missing)`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a>${exists ? '' : ' <span class="missing">(missing)</span>'}</li>`;
    }).join('');
    const errorCell = c.error ? `<td class="error" title="${escapeHtml(c.error)}">${escapeHtml(c.error)}</td>` : '<td>—</td>';
    const blockCell = c.block_reason ? `<td class="error" title="${escapeHtml(c.block_reason)}">${escapeHtml(c.block_reason)}</td>` : '<td>—</td>';
    return `<tr>
      <td class="mono">${escapeHtml(c.test_case_id)}</td>
      <td class="title-cell">${escapeHtml(c.title)}</td>
      <td><span class="badge ${escapeHtml(c.status.toLowerCase())}">${statusIcon(c.status)} ${escapeHtml(c.status)}</span></td>
      <td class="mono">${formatDuration(c.duration_ms)}</td>
      ${errorCell}
      ${blockCell}
      <td>${evLinks ? `<ul class="ev">${evLinks}</ul>` : '—'}</td>
    </tr>`;
  }).join('\n');

  const preflightSection = hasPreflight ? `
  <section class="card-section">
    <h2><span class="section-icon">🛫</span> Verificación previa (pre-flight)</h2>
    <div class="detail-grid">
      <div class="detail-item">
        <span class="detail-label">Resultado</span>
        <span class="badge ${escapeHtml(r.preflight.result.toLowerCase())}">${statusIcon(r.preflight.result)} ${escapeHtml(r.preflight.result)}</span>
      </div>
      ${r.preflight.record_path ? `
      <div class="detail-item">
        <span class="detail-label">Registro</span>
        <a href="${escapeHtml(reportHref(outDir, resolve(repoRoot, r.preflight.record_path)))}" class="link">${escapeHtml(r.preflight.record_path)}</a>
      </div>
      ` : ''}
    </div>
    ${r.preflight.blocked_reasons && r.preflight.blocked_reasons.length > 0 ? `
    <div class="blocked-reasons">
      <span class="detail-label">Motivos del bloqueo</span>
      <ul>${r.preflight.blocked_reasons.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
    </div>
    ` : ''}
    ${r.preflight.result === 'BLOCKED' ? `
    <p class="blocked-hint">La ejecución no se inició: la verificación previa (pre-flight) bloqueó la suite. Resolvé los motivos indicados y volvé a ejecutar.</p>
    ` : ''}
  </section>` : '';

  const autoHealingSection = hasAutoHealing ? `
  <section class="card-section">
    <h2><span class="section-icon">🔄</span> Auto-healing (M-05)</h2>
    <div class="metrics-row">
      <div class="metric"><span class="metric-value">${escapeHtml(r.auto_healing!.mode)}</span><span class="metric-label">Mode</span></div>
      <div class="metric"><span class="metric-value">${r.auto_healing!.attempts}</span><span class="metric-label">Attempts</span></div>
      <div class="metric"><span class="metric-value">${r.auto_healing!.recoveries_used}</span><span class="metric-label">Recoveries Used</span></div>
      <div class="metric"><span class="metric-value">${r.auto_healing!.reused}</span><span class="metric-label">Reused</span></div>
      <div class="metric"><span class="metric-value">${r.auto_healing!.duplicate_prevented}</span><span class="metric-label">Duplicate Prevented</span></div>
      <div class="metric"><span class="metric-value">${r.auto_healing!.ai_calls}</span><span class="metric-label">AI Calls</span></div>
    </div>
  </section>` : '';

  const infraErrorsSection = hasInfraErrors ? `
  <section class="card-section">
    <h2><span class="section-icon">⚠️</span> Infrastructure Errors</h2>
    <ul class="error-list">${r.infrastructure_errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
  </section>` : '';

  const evidenceIndexSection = r.evidence_index.length > 0 ? `
  <section class="card-section">
    <h2><span class="section-icon">📎</span> Evidence Index</h2>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Path</th><th>Type</th><th>Test Case</th></tr></thead>
        <tbody>
          ${r.evidence_index.map((e) => {
            const href = reportHref(outDir, resolve(repoRoot, e.path));
            return `<tr>
            <td class="mono"><a href="${escapeHtml(href)}" class="link">${escapeHtml(e.path)}</a></td>
            <td>${escapeHtml(e.type ?? '—')}</td>
            <td class="mono">${escapeHtml(e.test_case_id ?? '—')}</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Execution Report — ${escapeHtml(r.suite_id)}</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #1e293b;
      --bg-hover: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --border: #334155;
      --accent: #3b82f6;
      --pass: #10b981;
      --fail: #ef4444;
      --blocked: #f59e0b;
      --skipped: #6b7280;
      --shadow: 0 1px 3px rgba(0,0,0,0.3);
      --radius: 0.75rem;
    }
    [data-theme="light"] {
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-card: #ffffff;
      --bg-hover: #f1f5f9;
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      transition: background-color 0.3s ease, color 0.3s ease;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }

    /* Header */
    .header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 1rem 1.5rem; background: var(--bg-card);
      border: 1px solid var(--border); border-radius: var(--radius);
      margin-bottom: 1.5rem; box-shadow: var(--shadow);
      position: sticky; top: 0; z-index: 100;
    }
    .brand { display: flex; align-items: center; gap: 0.75rem; }
    .brand-icon { font-size: 1.5rem; }
    .brand-text { font-weight: 700; font-size: 1.1rem; color: var(--text-primary); }
    .theme-toggle {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.5rem 1rem; background: var(--bg-hover); border: 1px solid var(--border);
      border-radius: var(--radius); cursor: pointer; font-size: 0.875rem;
      color: var(--text-primary); transition: all 0.2s ease;
    }
    .theme-toggle:hover { background: var(--border); }
    .theme-toggle:focus { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* Hero */
    .hero {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 2rem; margin-bottom: 1.5rem;
      box-shadow: var(--shadow);
    }
    .hero-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; }
    .suite-name { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; }
    .run-ref { font-family: 'SF Mono', 'Consolas', monospace; font-size: 0.875rem; color: var(--text-muted); }
    .status-badge {
      display: inline-flex; align-items: center; gap: 0.5rem;
      padding: 0.75rem 1.5rem; border-radius: var(--radius);
      font-weight: 700; font-size: 1.125rem; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .status-badge.pass { background: rgba(16, 185, 129, 0.15); color: var(--pass); border: 1px solid var(--pass); }
    .status-badge.fail { background: rgba(239, 68, 68, 0.15); color: var(--fail); border: 1px solid var(--fail); }
    .status-badge.blocked { background: rgba(245, 158, 11, 0.15); color: var(--blocked); border: 1px solid var(--blocked); }
    .status-badge.skipped { background: rgba(107, 114, 128, 0.15); color: var(--skipped); border: 1px solid var(--skipped); }
    .status-badge.partial { background: rgba(59, 130, 246, 0.15); color: var(--accent); border: 1px solid var(--accent); }
    .meta-row { display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.875rem; color: var(--text-secondary); }
    .meta-item { display: flex; align-items: center; gap: 0.35rem; }
    .meta-label { color: var(--text-muted); }

    /* Summary cards */
    .summary-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem; margin-bottom: 1.5rem;
    }
    .summary-card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1.25rem; box-shadow: var(--shadow);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .summary-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .summary-card .value { font-size: 2.25rem; font-weight: 700; line-height: 1; margin-bottom: 0.5rem; }
    .summary-card .label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .summary-card.total .value { color: var(--accent); }
    .summary-card.pass .value { color: var(--pass); }
    .summary-card.fail .value { color: var(--fail); }
    .summary-card.blocked .value { color: var(--blocked); }
    .summary-card.skipped .value { color: var(--skipped); }
    .summary-card.error .value { color: #f97316; }

    /* Sections */
    .card-section {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1.5rem; margin-bottom: 1.5rem;
      box-shadow: var(--shadow);
    }
    .card-section h2 {
      font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .section-icon { font-size: 1.25rem; }

    /* Table */
    .table-wrapper { overflow-x: auto; border-radius: var(--radius); border: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.875rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: var(--bg-hover); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }
    tr:last-child td { border-bottom: none; }
    tr:hover { background: var(--bg-hover); }
    .mono { font-family: 'SF Mono', 'Consolas', monospace; font-size: 0.8rem; }
    .title-cell { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .error { color: var(--fail); }
    .error[title] { cursor: help; }

    /* Badges */
    .badge {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.35rem 0.75rem; border-radius: 999px;
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.025em; white-space: nowrap;
    }
    .badge.pass { background: rgba(16, 185, 129, 0.15); color: var(--pass); }
    .badge.fail { background: rgba(239, 68, 68, 0.15); color: var(--fail); }
    .badge.blocked { background: rgba(245, 158, 11, 0.15); color: var(--blocked); }
    .badge.skipped { background: rgba(107, 114, 128, 0.15); color: var(--skipped); }

    /* Detail grids */
    .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .detail-item { display: flex; flex-direction: column; gap: 0.35rem; }
    .detail-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .blocked-reasons { margin-top: 1rem; }
    .blocked-reasons ul { margin-top: 0.5rem; padding-left: 1.25rem; }
    .blocked-reasons li { color: var(--fail); font-size: 0.875rem; }
    .blocked-hint { margin-top: 1rem; color: var(--text-secondary); font-size: 0.875rem; }

    /* Metrics */
    .metrics-row { display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .metric { display: flex; flex-direction: column; gap: 0.25rem; }
    .metric-value { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); }
    .metric-label { font-size: 0.75rem; color: var(--text-muted); }

    /* Lists */
    ul.ev { list-style: none; padding: 0; margin: 0; }
    ul.ev li { margin-bottom: 0.25rem; }
    ul.ev li:last-child { margin-bottom: 0; }
    .error-list { list-style: none; padding: 0; }
    .error-list li { padding: 0.5rem 0.75rem; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--fail); margin-bottom: 0.5rem; border-radius: 0.25rem; }

    /* Links */
    .link { color: var(--accent); text-decoration: none; word-break: break-all; }
    .link:hover { text-decoration: underline; }
    .missing { color: var(--blocked); font-size: 0.75rem; }

    /* Footer */
    .footer {
      text-align: center; padding: 1.5rem; color: var(--text-muted);
      font-size: 0.875rem; margin-top: 2rem;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .container { padding: 1rem; }
      .header { flex-direction: column; align-items: flex-start; }
      .hero { padding: 1.5rem; }
      .hero-header { flex-direction: column; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
      .metrics-row { gap: 1rem; }
      .title-cell { max-width: 150px; }
    }
    @media (max-width: 480px) {
      .summary-grid { grid-template-columns: 1fr; }
      .meta-row { flex-direction: column; gap: 0.5rem; }
    }

    /* Print */
    @media print {
      .theme-toggle { display: none; }
      .header { position: static; }
      body { background: white; color: black; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="brand">
        <span class="brand-icon">🧪</span>
        <span class="brand-text">QA Agent</span>
      </div>
      <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle dark/light mode">
        <span id="theme-icon">☀️</span>
        <span id="theme-text">Light mode</span>
      </button>
    </header>

    <div class="hero">
      <div class="hero-header">
        <div>
          <div class="suite-name">${escapeHtml(r.suite_id)}</div>
          <div class="run-ref">${escapeHtml(r.run_id)}</div>
        </div>
        <div class="status-badge ${escapeHtml(r.overall_status.toLowerCase())}">
          ${statusIcon(r.overall_status)} ${escapeHtml(r.overall_status)}
        </div>
      </div>
      <div class="meta-row">
        <div class="meta-item"><span class="meta-label">App:</span> ${escapeHtml(r.app)}</div>
        <div class="meta-item"><span class="meta-label">Platform:</span> ${escapeHtml(r.platform)}</div>
        <div class="meta-item"><span class="meta-label">Started:</span> ${formatDate(r.started_at)}</div>
        <div class="meta-item"><span class="meta-label">Duration:</span> ${formatDuration(r.duration_ms)}</div>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card total"><div class="value">${s.selected}</div><div class="label">Selected</div></div>
      <div class="summary-card pass"><div class="value">${s.passed}</div><div class="label">Passed</div></div>
      <div class="summary-card fail"><div class="value">${s.failed}</div><div class="label">Failed</div></div>
      <div class="summary-card error"><div class="value">${s.errors}</div><div class="label">Errors</div></div>
      <div class="summary-card blocked"><div class="value">${s.blocked}</div><div class="label">Blocked</div></div>
      <div class="summary-card skipped"><div class="value">${s.skipped}</div><div class="label">Skipped</div></div>
      <div class="summary-card total"><div class="value">${s.omitted}</div><div class="label">Omitted</div></div>
    </div>

    <section class="card-section">
      <h2><span class="section-icon">📋</span> Test Cases</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Title</th><th>Status</th><th>Duration</th><th>Error</th><th>Motivo del bloqueo</th><th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${casesRows}
          </tbody>
        </table>
      </div>
    </section>

    ${preflightSection}
    ${autoHealingSection}
    ${infraErrorsSection}
    ${evidenceIndexSection}

    <div class="footer">
      Report ID: <span class="mono">${escapeHtml(r.report_id)}</span> ·
      Generated: ${formatDate(r.generated_at)}
    </div>
  </div>

  <script>
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      const icon = document.getElementById('theme-icon');
      const text = document.getElementById('theme-text');
      if (next === 'light') {
        icon.textContent = '☀️';
        text.textContent = 'Light mode';
      } else {
        icon.textContent = '🌙';
        text.textContent = 'Dark mode';
      }
    }
    // Set default theme
    if (!document.documentElement.getAttribute('data-theme')) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  </script>
</body>
</html>`;
}

export function writeReportHtml(outDir: string, report: ExecutionReport, repoRoot: string): string {
  const file = join(outDir, 'report.html');
  writeFileSync(file, renderReportHtml(report, repoRoot, outDir), 'utf8');
  return file;
}

// --------------------------------------------------------------------------- //
// Convenience: generate both reports from input data
// --------------------------------------------------------------------------- //

export function generateReports(
  outDir: string,
  input: ReportInput,
  repoRoot: string,
): { json: string; html: string; report: ExecutionReport } {
  const report = buildReport(input);
  const jsonPath = writeReportJson(outDir, report);
  const htmlPath = writeReportHtml(outDir, report, repoRoot);
  return { json: jsonPath, html: htmlPath, report };
}
