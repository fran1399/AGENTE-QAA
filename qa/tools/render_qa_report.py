#!/usr/bin/env python3
"""Shared HTML report renderer for AGENTE-QAA.

Canonical, reusable renderer for the QA report hierarchy. The order below is the
single canonical definition in `docs/REPORT-MODES.md` ("Report structure, all
surfaces"); the FAST/DETAIL chat reports follow the same order. Every surface
renders a section only when it has information; never invent data and never
render an empty section just to fill the template:

    executive summary -> metrics -> scope -> pre-flight -> results -> test data ->
    failure classification -> bugs -> risks -> not verified / blocked -> evidence ->
    traceability -> retest -> QA reviewer -> conclusion

Sections are ordered for reading, rendered only when they have data, and the
dense/technical blocks (evidence, traceability, per-failure rationale) are kept
behind native `<details>` disclosures so the report stays readable.

It keeps the AGENTE-QAA visual identity (dark/light theme) and is presentation
only: it never invents data, never turns a FAIL into a PASS and never hides
BLOCKED / NOT VERIFIED. Metrics are derived from the data so the summary can
never contradict the detail:

  - counts are computed from `results`;
  - Maximum Risk is the highest level among `risks` (an explicit, documented
    override is required to show anything lower);
  - confirmed Bugs are the entries of `bugs.confirmed`.

Usage:

    # HTML report from the consolidated model.
    python qa/tools/render_qa_report.py --model <report.model.json> --out <report.html>
    python qa/tools/render_qa_report.py --model ... --out ... --repo-root <dir>

    # FAST chat summary, generated from the SAME model (no separate wording).
    python qa/tools/render_qa_report.py --model <report.model.json> --summary

Model (JSON). Validated against the `qa-report-model` contract
(qa/schema/qa-report-model.schema.json). Every section is optional: omit it (or
leave it empty) and the section is not rendered. Values use the vocabulary of
docs/AGENT-CONTRACTS.md (statuses, failure categories, risk levels, confidence).

{
  "report_model_id": "QRM-...",
  "source_artifacts": [{"path": "...", "contract": "...", "note": "..."}],
  "meta": {
    "title": "...", "app": "...", "platform": "...", "target": "...",
    "scope_summary": "short scope for the header",
    "run_ref": "...", "report_id": "...", "generated_at": "...", "mode": "FAST|DETAIL",
    "status": "PASS|FAIL|PARTIAL|BLOCKED|...", "status_note": "...",
    "max_risk_override": "LOW", "max_risk_override_reason": "..."
  },
  "executive_summary": {
    "tested": "...", "worked": "...", "problems": "...", "unverified": "..."
  },
  "scope": { "in": "...", "out": "..." },
  "preflight": { "result": "READY", "checks": [{"label": "...", "value": "..."}] },
  "results": [
    {"id": "TC-1", "title": "...", "status": "PASS", "confidence": "HIGH", "classification": null}
  ],
  "test_data": [
    {"id": "TD-1", "description": "...", "state": "AVAILABLE", "usable": true, "blocked_tests": [], "note": "..."}
  ],
  "failure_classifications": [
    {"test_id": "TC-1", "classification": "TEST_INFRASTRUCTURE", "outcome": "CAUSE_IDENTIFIED",
     "is_bug": false, "rationale": "..."}
  ],
  "bugs": {
    "confirmed": [{"id": "...", "title": "...", "severity": "...", "priority": "...",
                   "confidence": "...", "evidence": ["..."], "note": "..."}],
    "investigated": [{"id": "...", "title": "...", "outcome": "NOT_A_BUG", "confidence": "..."}]
  },
  "risks": [{"id": "R-1", "title": "...", "level": "MEDIUM", "impact": "...", "probability": "...",
             "priority": "...", "confidence": "...", "note": "..."}],
  "not_verified": ["..."],
  "evidence": [{"path": "automation/.runs/.../shot.png", "label": "...", "type": "screenshot", "note": "..."}],
  "traceability": {"adapter": "playwright-qa", "steps": ["tool_requested", "..."], "note": "..."},
  "retest": [
    {"id": "RT-1", "related_bug_id": "...", "related_test_case_id": "...", "result": "PASS", "fix_status": "FIXED"}
  ],
  "reviewer": {"status": "BLOCKED", "verdict": "NOT EXECUTED", "reason": "...", "impact": "...", "note": "..."},
  "conclusion": ["...", "..."]
}
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
from urllib.parse import quote

RISK_ORDER = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}

STATUS_CLASS = {
    "PASS": "pass",
    "FAIL": "fail",
    "BLOCKED": "blocked",
    "NOT VERIFIED": "nv",
    "SKIPPED": "skipped",
}

CLASSIF_CLASS = {
    "APP_BUG": "app",
    "TEST_DATA": "data",
    "TEST_INFRASTRUCTURE": "infra",
    "BLOCKED": "blocked",
    "INSUFFICIENT_EVIDENCE": "insuf",
}

RISK_CLASS = {"LOW": "low", "MEDIUM": "medium", "HIGH": "high", "CRITICAL": "critical"}

# Directories excluded from distribution (see .gitignore): links work locally only.
LOCAL_ONLY_PREFIXES = ("automation/.runs/", "automation/.artifacts/", "qa/runs/")

CSS = """
  :root {
    --bg-primary: #0b1220;
    --bg-card: #111a2e;
    --bg-soft: #16213a;
    --bg-hover: #1d2b47;
    --text-primary: #f1f5f9;
    --text-secondary: #a9b6cc;
    --text-muted: #74829a;
    --border: #24314d;
    --accent: #5b8cff;
    --pass: #22c55e;
    --fail: #ef4444;
    --blocked: #f59e0b;
    --skipped: #64748b;
    --nv: #94a3b8;
    --shadow: 0 1px 2px rgba(0,0,0,.35), 0 8px 24px -18px rgba(0,0,0,.6);
    --radius: 14px;
  }
  [data-theme="light"] {
    --bg-primary: #f4f6fb;
    --bg-card: #ffffff;
    --bg-soft: #f8fafc;
    --bg-hover: #eef2f9;
    --text-primary: #0f172a;
    --text-secondary: #475569;
    --text-muted: #7c8798;
    --border: #e2e8f0;
    --shadow: 0 1px 2px rgba(15,23,42,.06), 0 10px 30px -22px rgba(15,23,42,.35);
  }
  * { box-sizing: border-box; }
  html { font-size: 16px; -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 1040px; margin: 0 auto; padding: 22px 20px 60px; }

  /* Top bar */
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 2px 20px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: .01em; font-size: 1rem; }
  .brand-mark {
    width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; font-size: 15px;
    background: linear-gradient(135deg, var(--accent), #8b5cf6);
  }
  .theme-toggle {
    display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px;
    background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border);
    border-radius: 999px; cursor: pointer; font-size: .78rem; font-weight: 600;
  }
  .theme-toggle:hover { color: var(--text-primary); border-color: var(--accent); }

  /* Cards */
  .card {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 22px 24px; margin-bottom: 16px; box-shadow: var(--shadow);
  }
  .card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .sec-icon {
    width: 34px; height: 34px; flex: none; border-radius: 10px; background: var(--bg-soft);
    border: 1px solid var(--border); display: grid; place-items: center; font-size: 16px;
  }
  .card-head h2 { font-size: 1.1rem; font-weight: 700; margin: 0; }
  .sec-sub { margin-left: auto; color: var(--text-muted); font-size: .8rem; font-weight: 600; }

  /* Hero */
  .hero {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 26px 28px 24px; margin-bottom: 16px; box-shadow: var(--shadow);
  }
  .hero-top { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
  .eyebrow { font-size: .7rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .hero h1 { font-size: 1.65rem; line-height: 1.2; margin: 7px 0 0; }
  .hero-sub { color: var(--text-secondary); margin-top: 7px; font-size: .95rem; }
  .status-pill {
    flex: none; padding: 11px 18px; border-radius: 12px; font-weight: 800; font-size: .92rem;
    letter-spacing: .05em; white-space: nowrap;
  }
  .status-pill.pass { color: var(--pass); background: color-mix(in srgb, var(--pass) 15%, transparent); border: 1px solid color-mix(in srgb, var(--pass) 45%, transparent); }
  .status-pill.fail { color: var(--fail); background: color-mix(in srgb, var(--fail) 15%, transparent); border: 1px solid color-mix(in srgb, var(--fail) 45%, transparent); }
  .status-pill.partial { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); }
  .status-pill.blocked { color: var(--blocked); background: color-mix(in srgb, var(--blocked) 15%, transparent); border: 1px solid color-mix(in srgb, var(--blocked) 45%, transparent); }
  .status-pill.skipped { color: var(--skipped); background: color-mix(in srgb, var(--skipped) 15%, transparent); border: 1px solid color-mix(in srgb, var(--skipped) 45%, transparent); }
  .hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 20px; }
  .meta-chip { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 11px; padding: 9px 12px; min-width: 0; }
  .meta-k { display: block; font-size: .64rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); }
  .meta-v { display: block; font-size: .83rem; margin-top: 3px; overflow-wrap: anywhere; }

  /* KPI indicators */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .kpi {
    background: var(--bg-soft); border: 1px solid var(--border); border-radius: 12px;
    padding: 13px 14px; border-left: 4px solid var(--border);
  }
  .kpi .v { font-size: 1.85rem; font-weight: 800; line-height: 1; }
  .kpi .l { font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); margin-top: 6px; }
  .kpi.pass { border-left-color: var(--pass); } .kpi.pass .v { color: var(--pass); }
  .kpi.fail { border-left-color: var(--fail); } .kpi.fail .v { color: var(--fail); }
  .kpi.blocked { border-left-color: var(--blocked); } .kpi.blocked .v { color: var(--blocked); }
  .kpi.nv { border-left-color: var(--nv); } .kpi.nv .v { color: var(--text-secondary); }
  .kpi.bug { border-left-color: var(--border); } .kpi.bug .v { color: var(--text-primary); }
  .kpi.risk { border-left-color: var(--blocked); } .kpi.risk .v { color: var(--blocked); font-size: 1.4rem; }
  .kpi.reviewer { border-left-color: var(--blocked); } .kpi.reviewer .v { color: var(--blocked); font-size: 1rem; letter-spacing: .03em; }

  /* Executive summary rows */
  .exec { display: grid; gap: 13px; }
  .exec-row { display: grid; grid-template-columns: 190px 1fr; gap: 16px; align-items: baseline; }
  .exec-k { font-size: .74rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
  .exec-v { font-size: .93rem; color: var(--text-primary); }
  .verdict {
    margin-top: 20px; padding: 14px 16px; border-radius: 11px; font-size: .92rem; color: var(--text-secondary);
    background: color-mix(in srgb, var(--accent) 9%, transparent); border-left: 4px solid var(--accent);
  }
  .verdict strong { color: var(--text-primary); }

  /* Key/value + notes */
  .kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
  .kv-item { border: 1px solid var(--border); border-radius: 11px; padding: 11px 13px; background: var(--bg-soft); }
  .kv-k { font-size: .66rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
  .kv-v { margin-top: 5px; font-size: .88rem; overflow-wrap: anywhere; }
  .prose { color: var(--text-secondary); font-size: .93rem; }
  .prose + .prose { margin-top: 10px; }
  .label-mini { font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); margin: 16px 0 8px; }
  .label-mini:first-child { margin-top: 0; }

  /* Tables */
  .table-wrap { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th, td { padding: 11px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
  th { background: var(--bg-soft); font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: var(--bg-hover); }
  .mono { font-family: "SF Mono", "Consolas", "Liberation Mono", monospace; font-size: .8rem; }
  .nowrap { white-space: nowrap; }
  td.tc-title { min-width: 220px; }

  /* Badges, tags, confidence */
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: .72rem; font-weight: 800; letter-spacing: .03em; white-space: nowrap; }
  .badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .badge.pass { color: var(--pass); background: color-mix(in srgb, var(--pass) 14%, transparent); }
  .badge.fail { color: var(--fail); background: color-mix(in srgb, var(--fail) 15%, transparent); }
  .badge.blocked { color: var(--blocked); background: color-mix(in srgb, var(--blocked) 15%, transparent); }
  .badge.nv { color: var(--text-secondary); background: color-mix(in srgb, var(--nv) 16%, transparent); }
  .badge.ready { color: var(--pass); background: color-mix(in srgb, var(--pass) 15%, transparent); }
  .conf { font-size: .76rem; font-weight: 700; }
  .conf.high { color: var(--pass); } .conf.medium { color: var(--blocked); } .conf.low { color: var(--fail); }
  .tag {
    display: inline-block; font-size: .68rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); white-space: nowrap;
  }
  .tag.infra { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .tag.app { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 50%, transparent); background: color-mix(in srgb, var(--fail) 12%, transparent); }
  .tag.data, .tag.blocked, .tag.insuf { color: var(--blocked); border-color: color-mix(in srgb, var(--blocked) 50%, transparent); background: color-mix(in srgb, var(--blocked) 12%, transparent); }
  .tag.notbug { color: var(--pass); border-color: color-mix(in srgb, var(--pass) 50%, transparent); background: color-mix(in srgb, var(--pass) 12%, transparent); }
  .lvl { font-size: .68rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
  .lvl.low { color: var(--accent); } .lvl.medium { color: var(--blocked); } .lvl.high, .lvl.critical { color: var(--fail); }

  /* Failure classification */
  .fc-item { border: 1px solid var(--border); border-left: 4px solid var(--border); border-radius: 12px; padding: 15px 17px; background: var(--bg-soft); }
  .fc-item + .fc-item { margin-top: 12px; }
  .fc-item.infra { border-left-color: var(--accent); }
  .fc-item.app { border-left-color: var(--fail); }
  .fc-item.insuf, .fc-item.blocked, .fc-item.data { border-left-color: var(--blocked); }
  .fc-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .fc-title { font-weight: 700; font-size: .92rem; }
  .fc-body { color: var(--text-secondary); font-size: .9rem; }

  /* Risks */
  .risk { border: 1px solid var(--border); border-left: 4px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--bg-soft); }
  .risk + .risk { margin-top: 11px; }
  .risk.low { border-left-color: var(--accent); }
  .risk.medium { border-left-color: var(--blocked); }
  .risk.high, .risk.critical { border-left-color: var(--fail); }
  .risk-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .risk-id { font-family: "SF Mono", "Consolas", monospace; font-size: .76rem; color: var(--text-muted); }
  .risk-title { font-weight: 700; }
  .risk-note { color: var(--text-secondary); font-size: .88rem; margin-top: 6px; }
  .risk-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
  .mini-chip { font-size: .68rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; }

  /* Lists */
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .list li { padding: 10px 13px; border: 1px solid var(--border); border-left: 4px solid var(--nv); border-radius: 10px; background: var(--bg-soft); font-size: .9rem; color: var(--text-secondary); }

  /* Evidence */
  .ev-list { display: grid; gap: 10px; }
  .ev-item { border: 1px solid var(--border); border-radius: 11px; padding: 12px 14px; background: var(--bg-soft); }
  .ev-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ev-name { font-weight: 700; }
  .ev-path { font-family: "SF Mono", "Consolas", monospace; font-size: .74rem; color: var(--text-muted); margin-top: 5px; overflow-wrap: anywhere; }
  .ev-note { font-size: .86rem; color: var(--text-secondary); margin-top: 6px; }
  .pill-local { font-size: .66rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }
  .link { color: var(--accent); text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .missing { color: var(--blocked); font-size: .74rem; font-weight: 700; }

  /* Traceability */
  .timeline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .step { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; font-size: .78rem; font-family: "SF Mono", "Consolas", monospace; }
  .arrow { color: var(--text-muted); }

  /* Reviewer callout */
  .callout { border: 1px solid var(--border); border-left: 4px solid var(--blocked); border-radius: 12px; padding: 16px 18px; background: color-mix(in srgb, var(--blocked) 8%, transparent); }
  .callout.accept { border-left-color: var(--pass); background: color-mix(in srgb, var(--pass) 8%, transparent); }
  .callout-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .callout p { margin: 8px 0 0; font-size: .9rem; color: var(--text-secondary); }
  .callout p strong { color: var(--text-primary); }

  /* Disclosures */
  details.disclosure { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-card); margin-bottom: 16px; box-shadow: var(--shadow); overflow: hidden; }
  details.disclosure > summary {
    list-style: none; cursor: pointer; display: flex; align-items: center; gap: 12px;
    padding: 18px 24px; font-weight: 700; font-size: 1.02rem;
  }
  details.disclosure > summary::-webkit-details-marker { display: none; }
  details.disclosure .sec-chev { margin-left: auto; color: var(--text-muted); transition: transform .2s ease; font-size: .8rem; }
  details.disclosure[open] .sec-chev { transform: rotate(180deg); }
  details.disclosure .disclosure-body { padding: 0 24px 22px; }
  details.disclosure .sec-sub { margin-left: 0; }

  /* Inline disclosure, for nested blocks inside a card */
  details.inline-details { border: 1px solid var(--border); border-radius: 11px; background: var(--bg-soft); margin: 14px 0 0; overflow: hidden; }
  details.inline-details > summary {
    list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px;
    padding: 12px 15px; font-weight: 700; font-size: .9rem;
  }
  details.inline-details > summary::-webkit-details-marker { display: none; }
  details.inline-details .sec-chev { margin-left: auto; color: var(--text-muted); transition: transform .2s ease; font-size: .8rem; }
  details.inline-details[open] .sec-chev { transform: rotate(180deg); }
  details.inline-details .inline-body { padding: 0 15px 15px; }

  .footer { text-align: center; color: var(--text-muted); font-size: .76rem; padding: 22px 0 0; }

  @media (max-width: 640px) {
    .container { padding: 16px 14px 48px; }
    .hero { padding: 20px; }
    .hero-top { flex-direction: column; }
    .hero h1 { font-size: 1.35rem; }
    .exec-row { grid-template-columns: 1fr; gap: 3px; }
    .card { padding: 18px; }
    .card-head { gap: 10px; }
    .sec-sub { display: none; }
  }
  @media print {
    .theme-toggle, .sec-chev { display: none; }
    details.disclosure[open] { break-inside: avoid; }
  }
"""

SCRIPT = """
  (function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var root = document.documentElement;
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      document.getElementById('theme-icon').textContent = next === 'light' ? '\\u2600\\uFE0F' : '\\uD83C\\uDF19';
      document.getElementById('theme-text').textContent = next === 'light' ? 'Modo claro' : 'Modo oscuro';
    });
  })();
"""


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def esc(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def status_pill(status: str) -> str:
    cls = STATUS_CLASS.get(str(status).upper(), "nv")
    return f'<span class="badge {cls}">{esc(status)}</span>'


def classification_tag(value: str) -> str:
    return f'<span class="tag {CLASSIF_CLASS.get(str(value), "")}">{esc(value)}</span>'


def confidence_span(confidence) -> str:
    if not confidence:
        return "—"
    return f'<span class="conf {str(confidence).strip().lower()}">{esc(confidence)}</span>'


def card(icon: str, title: str, body: str, sub: str = "") -> str:
    sub_html = f'<span class="sec-sub">{esc(sub)}</span>' if sub else ""
    return (
        '\n  <section class="card">\n'
        f'    <div class="card-head"><span class="sec-icon">{esc(icon)}</span><h2>{esc(title)}</h2>{sub_html}</div>\n'
        f'{body}\n'
        '  </section>'
    )


def disclosure(icon: str, title: str, body: str, sub: str = "", open_by_default: bool = False) -> str:
    open_attr = " open" if open_by_default else ""
    sub_html = f'<span class="sec-sub">{esc(sub)}</span>' if sub else ""
    return (
        f'\n  <details class="disclosure"{open_attr}>\n'
        f'    <summary><span class="sec-icon">{esc(icon)}</span><span>{esc(title)}</span>{sub_html}<span class="sec-chev">▾</span></summary>\n'
        f'    <div class="disclosure-body">{body}</div>\n'
        '  </details>'
    )


def derive_metrics(model: dict) -> dict:
    results = model.get("results") or []
    counts = {"PASS": 0, "FAIL": 0, "BLOCKED": 0, "NOT VERIFIED": 0, "SKIPPED": 0}
    for row in results:
        key = str(row.get("status", "")).upper()
        if key in counts:
            counts[key] += 1

    confirmed = (model.get("bugs") or {}).get("confirmed") or []

    risks = model.get("risks") or []
    max_risk = None
    for risk in risks:
        level = str(risk.get("level", "")).upper()
        if level in RISK_ORDER and (max_risk is None or RISK_ORDER[level] > RISK_ORDER[max_risk]):
            max_risk = level

    meta = model.get("meta") or {}
    override = str(meta.get("max_risk_override") or "").upper()
    override_reason = meta.get("max_risk_override_reason")
    override_applied = False
    if override and override_reason and max_risk and RISK_ORDER.get(override, 0) < RISK_ORDER[max_risk]:
        max_risk = override
        override_applied = True

    reviewer = (model.get("reviewer") or {}).get("status") or "NOT EXECUTED"
    # NOT VERIFIED covers both result rows marked NOT VERIFIED and the items listed
    # under the "not verified" section, so the metric matches the detail.
    not_verified_total = counts["NOT VERIFIED"] + len(model.get("not_verified") or [])
    return {
        "counts": counts,
        "not_verified": not_verified_total,
        "confirmed_bugs": len(confirmed),
        "max_risk": max_risk or "—",
        "max_risk_override_applied": override_applied,
        "reviewer": reviewer,
    }


def evidence_link(out_dir: str, repo_root: str, path: str):
    """Return (href, exists, local_only) for a repo-relative evidence path."""
    normalized = str(path).replace("\\", "/")
    abs_path = os.path.abspath(os.path.join(repo_root, normalized))
    rel = os.path.relpath(abs_path, os.path.abspath(out_dir)).replace("\\", "/")
    href = "/".join(quote(part) for part in rel.split("/"))
    exists = os.path.exists(abs_path)
    local_only = normalized.startswith(LOCAL_ONLY_PREFIXES)
    return href, exists, local_only


# --------------------------------------------------------------------------- #
# Sections
# --------------------------------------------------------------------------- #

def render_topbar() -> str:
    return (
        '\n  <div class="topbar">\n'
        '    <div class="brand"><span class="brand-mark">🧪</span><span>AGENTE-QAA</span></div>\n'
        '    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Cambiar tema claro/oscuro">'
        '<span id="theme-icon">🌙</span><span id="theme-text">Modo oscuro</span></button>\n'
        '  </div>'
    )


def render_hero(model: dict) -> str:
    meta = model.get("meta") or {}
    status = str(meta.get("status", ""))
    status_cls = {"PASS": "pass", "FAIL": "fail", "BLOCKED": "blocked", "PARTIAL": "partial", "SKIPPED": "skipped"}.get(
        status.upper(), "partial"
    )
    subtitle = " · ".join(part for part in (meta.get("app"), meta.get("platform")) if part)
    subtitle_html = f'        <div class="hero-sub">{esc(subtitle)}</div>\n' if subtitle else ""
    chips = "".join(
        f'<div class="meta-chip"><span class="meta-k">{esc(label)}</span><span class="meta-v{" mono" if mono else ""}">{esc(value)}</span></div>'
        for label, value, mono in (
            ("Alcance", meta.get("scope_summary"), False),
            ("URL", meta.get("target"), True),
            ("Fecha", meta.get("generated_at"), False),
            ("Modo", meta.get("mode"), False),
        )
        if value
    )
    chips_html = f'    <div class="hero-meta">{chips}</div>\n' if chips else ""
    return (
        '\n  <header class="hero">\n'
        '    <div class="hero-top">\n'
        '      <div>\n'
        '        <span class="eyebrow">Reporte de QA</span>\n'
        f'        <h1>{esc(meta.get("title", "Reporte de QA"))}</h1>\n'
        f'{subtitle_html}'
        '      </div>\n'
        f'      <span class="status-pill {status_cls}">{esc(status)}</span>\n'
        '    </div>\n'
        f'{chips_html}'
        '  </header>'
    )


def render_summary(model: dict, metrics: dict) -> str:
    meta = model.get("meta") or {}
    counts = metrics["counts"]
    kpis = [
        ("pass", counts["PASS"], "PASS"),
        ("fail", counts["FAIL"], "FAIL"),
        ("blocked", counts["BLOCKED"], "BLOCKED"),
        ("nv", metrics["not_verified"], "Sin verificar"),
        ("bug", metrics["confirmed_bugs"], "Bugs confirmados"),
        ("risk", metrics["max_risk"], "Riesgo máximo"),
        ("reviewer", metrics["reviewer"], "QA Reviewer"),
    ]
    kpi_html = "".join(
        f'<div class="kpi {cls}"><div class="v">{esc(value)}</div><div class="l">{esc(label)}</div></div>'
        for cls, value, label in kpis
    )

    data = model.get("executive_summary") or {}
    rows = "".join(
        f'<div class="exec-row"><div class="exec-k">{esc(label)}</div><div class="exec-v">{esc(data[key])}</div></div>'
        for label, key in (
            ("Alcance probado", "tested"),
            ("Qué funcionó", "worked"),
            ("Problemas encontrados", "problems"),
            ("Sin verificar", "unverified"),
        )
        if data.get(key)
    )

    verdict = ""
    if meta.get("status_note"):
        verdict = f'\n    <div class="verdict"><strong>Veredicto.</strong> {esc(meta["status_note"])}</div>'

    body = f'    <div class="kpis">{kpi_html}</div>\n    <div class="exec">{rows}</div>{verdict}'
    return card("🗣️", "Resumen ejecutivo", body)


def render_scope(model: dict) -> str:
    scope = model.get("scope") or {}
    if not scope.get("in") and not scope.get("out"):
        return ""
    parts = []
    if scope.get("in"):
        parts.append(f'    <div class="label-mini">Dentro del alcance</div>\n    <p class="prose">{esc(scope["in"])}</p>')
    if scope.get("out"):
        parts.append(f'    <div class="label-mini">Fuera del alcance (no ejecutado)</div>\n    <p class="prose">{esc(scope["out"])}</p>')
    return card("📌", "Alcance", "\n".join(parts))


def render_preflight(model: dict) -> str:
    pf = model.get("preflight")
    if not pf:
        return ""
    result = str(pf.get("result", ""))
    items = [f'<div class="kv-item"><div class="kv-k">Resultado</div><div class="kv-v"><span class="badge {"ready" if result.upper() == "READY" else "blocked"}">{esc(result)}</span></div></div>']
    for check in pf.get("checks") or []:
        items.append(f'<div class="kv-item"><div class="kv-k">{esc(check.get("label"))}</div><div class="kv-v">{esc(check.get("value"))}</div></div>')
    return card("🛫", "Pre-flight", f'    <div class="kv">{"".join(items)}</div>')


def render_results(model: dict) -> str:
    rows = model.get("results") or []
    if not rows:
        return ""
    body_rows = "".join(
        "<tr>"
        f'<td class="mono nowrap">{esc(row.get("id"))}</td>'
        f'<td>{esc(row.get("title"))}</td>'
        f'<td class="nowrap">{status_pill(row.get("status"))}</td>'
        f'<td class="nowrap">{confidence_span(row.get("confidence"))}</td>'
        f'<td>{classification_tag(row.get("classification")) if row.get("classification") else "—"}</td>'
        "</tr>"
        for row in rows
    )
    table = (
        '    <div class="table-wrap"><table>\n'
        "      <thead><tr><th>ID</th><th>Test Case</th><th>Resultado</th><th>Confianza</th><th>Clasificación</th></tr></thead>\n"
        f"      <tbody>{body_rows}</tbody>\n"
        "    </table></div>"
    )
    return card("🧪", "Resultados por caso", table, sub=f"{len(rows)} Test Cases")


def render_test_data(model: dict) -> str:
    rows = model.get("test_data") or []
    if not rows:
        return ""
    body_rows = "".join(
        "<tr>"
        f'<td class="mono nowrap">{esc(row.get("id"))}</td>'
        f'<td>{esc(row.get("description"))}</td>'
        f'<td class="nowrap">{esc(row.get("state", "—"))}</td>'
        f'<td class="nowrap">{esc("Sí" if row.get("usable") else ("No" if row.get("usable") is False else "—"))}</td>'
        f'<td class="mono">{esc(", ".join(row.get("blocked_tests") or []) or "—")}</td>'
        "</tr>"
        for row in rows
    )
    table = (
        '    <div class="table-wrap"><table>\n'
        "      <thead><tr><th>ID</th><th>Descripción</th><th>Estado</th><th>Utilizable</th><th>Test Cases bloqueados</th></tr></thead>\n"
        f"      <tbody>{body_rows}</tbody>\n"
        "    </table></div>"
    )
    return card("🗃️", "Datos de prueba", table, sub=f"{len(rows)} registro(s)")


def render_failure_classification(model: dict) -> str:
    rows = model.get("failure_classifications") or []
    if not rows:
        return ""
    items = []
    for row in rows:
        classification = str(row.get("classification", ""))
        tags = [classification_tag(classification)]
        if row.get("is_bug") is True:
            tags.append('<span class="tag app">Candidato APP_BUG · sin confirmar</span>')
        elif row.get("is_bug") is False:
            tags.append('<span class="tag notbug">No es Bug</span>')
        outcome = row.get("outcome")
        outcome_html = f'<span class="mini-chip">{esc(outcome)}</span>' if outcome else ""
        items.append(
            f'      <div class="fc-item {CLASSIF_CLASS.get(classification, "")}">\n'
            f'        <div class="fc-head"><span class="mono">{esc(row.get("test_id"))}</span>'
            f'<span class="badge fail">FAIL</span>{"".join(tags)}{outcome_html}</div>\n'
            f'        <p class="fc-body">{esc(row.get("rationale"))}</p>\n'
            "      </div>"
        )
    intro = '    <p class="prose">Ningún FAIL se considera Bug hasta clasificarse. Se separan los fallos de infraestructura de prueba de los posibles defectos de la aplicación.</p>\n'
    return card("🧩", "Clasificación de fallos", intro + f'    <div>{"".join(items)}</div>', sub=f"{len(rows)} FAIL")


def _bug_row(row: dict) -> str:
    return (
        "<tr>"
        f'<td class="mono nowrap">{esc(row.get("id"))}</td>'
        f'<td>{esc(row.get("title"))}</td>'
        f'<td class="nowrap">{esc(row.get("severity", "—"))}</td>'
        f'<td class="nowrap">{esc(row.get("priority", "—"))}</td>'
        f'<td class="nowrap">{confidence_span(row.get("confidence"))}</td>'
        "</tr>"
    )


def render_bugs(model: dict) -> str:
    bugs = model.get("bugs") or {}
    confirmed = bugs.get("confirmed") or []
    investigated = bugs.get("investigated") or []
    if not confirmed and not investigated:
        return ""
    parts = []
    if confirmed:
        parts.append('    <div class="label-mini">Bugs confirmados</div>')
        parts.append(
            '    <div class="table-wrap"><table>\n'
            "      <thead><tr><th>ID</th><th>Título</th><th>Severidad</th><th>Prioridad</th><th>Confianza</th></tr></thead>\n"
            f"      <tbody>{''.join(_bug_row(r) for r in confirmed)}</tbody>\n"
            "    </table></div>"
        )
    else:
        parts.append('    <p class="prose">🟢 No se confirmaron Bugs.</p>')
    if investigated:
        inv_rows = "".join(
            "<tr>"
            f'<td class="mono nowrap">{esc(r.get("id"))}</td>'
            f'<td>{esc(r.get("title"))}</td>'
            f'<td>{esc(r.get("outcome", "—"))}</td>'
            f'<td class="nowrap">{confidence_span(r.get("confidence"))}</td>'
            '</tr>'
            for r in investigated
        )
        inv_table = (
            '    <div class="table-wrap"><table>\n'
            "      <thead><tr><th>ID</th><th>Hallazgo</th><th>Resultado</th><th>Confianza</th></tr></thead>\n"
            f"      <tbody>{inv_rows}</tbody>\n"
            "    </table></div>"
        )
        parts.append(
            '\n    <details class="inline-details">\n'
            f'      <summary><span>Investigados / no confirmados</span><span class="sec-sub">{len(investigated)} hallazgo(s)</span><span class="sec-chev">▾</span></summary>\n'
            f'      <div class="inline-body">{inv_table}</div>\n'
            "    </details>"
        )
    return card("🐞", "Bugs", "\n".join(parts))


def render_risks(model: dict) -> str:
    rows = model.get("risks") or []
    if not rows:
        return ""
    items = []
    for row in rows:
        level = str(row.get("level", "")).upper()
        chips = []
        for label, key in (("Impacto", "impact"), ("Probabilidad", "probability"), ("Prioridad", "priority")):
            if row.get(key):
                chips.append(f'<span class="mini-chip">{esc(label)} {esc(row[key])}</span>')
        items.append(
            f'      <div class="risk {RISK_CLASS.get(level, "low")}">\n'
            f'        <div class="risk-head"><span class="risk-id">{esc(row.get("id"))}</span>'
            f'<span class="risk-title">{esc(row.get("title"))}</span>'
            f'<span class="lvl {RISK_CLASS.get(level, "low")}">Nivel {esc(level)}</span></div>\n'
            f'        <p class="risk-note">{esc(row.get("note"))}</p>\n'
            f'        <div class="risk-chips">{"".join(chips)}</div>\n'
            "      </div>"
        )
    return card("⚠️", "Riesgos", f'    <div>{"".join(items)}</div>', sub=f"{len(rows)} registrado(s)")


def render_not_verified(model: dict) -> str:
    rows = model.get("not_verified") or []
    if not rows:
        return ""
    items = []
    for row in rows:
        if isinstance(row, str):
            items.append(f"      <li>{esc(row)}</li>")
        else:
            text = esc(row.get("item"))
            if row.get("note"):
                text += f' — <span class="prose">{esc(row["note"])}</span>'
            items.append(f"      <li>{text}</li>")
    return card("⚪", "Sin verificar", f'    <ul class="list">{"".join(items)}</ul>', sub=f"{len(rows)} aspecto(s)")


def render_evidence(model: dict, out_dir: str, repo_root: str) -> str:
    rows = model.get("evidence") or []
    if not rows:
        return ""
    any_local = False
    items = []
    for row in rows:
        path = row.get("path", "")
        href, exists, local_only = evidence_link(out_dir, repo_root, path)
        any_local = any_local or local_only
        label = row.get("label") or os.path.basename(str(path))
        if exists:
            name = f'<a class="link" href="{esc(href)}">{esc(label)}</a>'
        else:
            name = f'<span class="ev-name">{esc(label)}</span> <span class="missing">(no disponible)</span>'
        badges = []
        if row.get("type"):
            badges.append(f'<span class="mini-chip">{esc(row["type"])}</span>')
        if local_only:
            badges.append('<span class="pill-local">local</span>')
        note = f'<div class="ev-note">{esc(row.get("note"))}</div>' if row.get("note") else ""
        items.append(
            f'      <div class="ev-item"><div class="ev-top"><span class="ev-name">{name}</span>{"".join(badges)}</div>'
            f'<div class="ev-path">{esc(path)}</div>{note}</div>'
        )
    body = f'    <div class="ev-list">{"".join(items)}</div>'
    if any_local:
        body += (
            '\n    <p class="prose" style="margin-top:14px">Parte de la evidencia vive en directorios locales de corrida '
            "(<code>automation/.runs/</code>, ignorados por git): los enlaces funcionan solo en este workspace y no se "
            "distribuyen con el repositorio.</p>"
        )
    return disclosure("📎", "Evidencia", body, sub=f"{len(rows)} archivo(s)", open_by_default=False)


def render_traceability(model: dict) -> str:
    trace = model.get("traceability") or {}
    sources = model.get("source_artifacts") or []
    if not trace and not sources:
        return ""
    parts = []
    steps = trace.get("steps") or []
    if steps:
        chain = ' <span class="arrow">→</span> '.join(f'<span class="step">{esc(s)}</span>' for s in steps)
        parts.append(f'    <div class="timeline">{chain}</div>')
    if trace.get("adapter"):
        parts.append(f'    <p class="prose" style="margin-top:14px">Adapter: <strong>{esc(trace["adapter"])}</strong>{(" — " + esc(trace["note"])) if trace.get("note") else ""}</p>')
    elif trace.get("note"):
        parts.append(f'    <p class="prose">{esc(trace["note"])}</p>')
    if sources:
        src_items = []
        for src in sources:
            contract = f'<span class="mini-chip">{esc(src["contract"])}</span>' if src.get("contract") else ""
            note = f' — {esc(src["note"])}' if src.get("note") else ""
            src_items.append(
                f'      <li><span class="mono">{esc(src.get("path"))}</span> {contract}{note}</li>'
            )
        parts.append(
            '    <div class="label-mini" style="margin-top:14px">Artefactos de origen</div>\n'
            f'    <ul class="list">{"".join(src_items)}</ul>'
        )
    return disclosure("🧭", "Trazabilidad", "\n".join(parts), open_by_default=False)


def render_retest(model: dict) -> str:
    rows = model.get("retest") or []
    if not rows:
        return ""
    body_rows = "".join(
        "<tr>"
        f'<td class="mono nowrap">{esc(row.get("id"))}</td>'
        f'<td class="mono nowrap">{esc(row.get("related_bug_id") or "—")}</td>'
        f'<td class="mono nowrap">{esc(row.get("related_test_case_id") or "—")}</td>'
        f'<td class="nowrap">{status_pill(row.get("result")) if row.get("result") else "—"}</td>'
        f'<td class="nowrap">{esc(row.get("fix_status") or "—")}</td>'
        "</tr>"
        for row in rows
    )
    table = (
        '    <div class="table-wrap"><table>\n'
        "      <thead><tr><th>ID</th><th>Bug</th><th>Test Case</th><th>Resultado</th><th>Fix</th></tr></thead>\n"
        f"      <tbody>{body_rows}</tbody>\n"
        "    </table></div>"
    )
    return card("🔁", "Retest / Regresión", table, sub=f"{len(rows)} registro(s)")


def render_reviewer(model: dict) -> str:
    reviewer = model.get("reviewer")
    if not reviewer:
        return ""
    status = str(reviewer.get("status", ""))
    cls = "accept" if status.upper() == "ACCEPT" else ""
    head = (
        '    <div class="callout-head">'
        f'<span class="badge {"pass" if status.upper() == "ACCEPT" else "blocked"}">{esc(status)}</span>'
        f'<span class="mono">Veredicto: {esc(reviewer.get("verdict", "—"))}</span>'
        "</div>"
    )
    paras = []
    for key, label in (("reason", "Motivo"), ("impact", "Impacto"), ("note", "Nota")):
        if reviewer.get(key):
            paras.append(f'    <p><strong>{label}:</strong> {esc(reviewer[key])}</p>')
    body = f'    <div class="callout {cls}">\n{head}\n' + "\n".join(paras) + "\n    </div>"
    return card("🔎", "QA Reviewer", body)


def render_conclusion(model: dict) -> str:
    paras = model.get("conclusion") or []
    if isinstance(paras, str):
        paras = [paras]
    if not paras:
        return ""
    body = "\n".join(f'    <p class="prose">{esc(p)}</p>' for p in paras)
    return card("🏁", "Conclusión", body)


# --------------------------------------------------------------------------- #
# Document
# --------------------------------------------------------------------------- #

def render(model: dict, out_path: str, repo_root: str) -> str:
    meta = model.get("meta") or {}
    metrics = derive_metrics(model)
    out_dir = os.path.dirname(os.path.abspath(out_path))

    parts = [
        "<!doctype html>",
        '<html lang="es" data-theme="dark">',
        "<head>",
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        f"<title>{esc(meta.get('title', 'Reporte de QA'))}</title>",
        "<style>",
        CSS,
        "</style>",
        "</head>",
        "<body>",
        '<div class="container">',
        render_topbar(),
        render_hero(model),
        render_summary(model, metrics),
        render_scope(model),
        render_preflight(model),
        render_results(model),
        render_test_data(model),
        render_failure_classification(model),
        render_bugs(model),
        render_risks(model),
        render_not_verified(model),
        render_evidence(model, out_dir, repo_root),
        render_traceability(model),
        render_retest(model),
        render_reviewer(model),
        render_conclusion(model),
        f'\n  <div class="footer">{esc(meta.get("report_id", ""))} · Generado {esc(meta.get("generated_at", ""))} · Run <span class="mono">{esc(meta.get("run_ref", ""))}</span></div>',
        "</div>",
        "<script>",
        SCRIPT,
        "</script>",
        "</body>",
        "</html>",
    ]
    return "\n".join(part for part in parts if part != "")


def render_text_summary(model: dict, metrics: dict, report_path: str | None = None) -> str:
    """FAST chat summary, derived from the SAME model as the HTML report.

    It only formats data that already exists in the model plus the derived
    metrics, so the chat summary can never contradict the report.
    """
    meta = model.get("meta") or {}
    summary = model.get("executive_summary") or {}
    counts = metrics["counts"]
    lines = []
    lines.append(f"Conclusión: {meta.get('status', '—')} — {meta.get('title', 'Reporte de QA')}")
    if meta.get("status_note"):
        lines.append(str(meta["status_note"]))
    lines.append("")
    for key, label in (
        ("tested", "Alcance probado"),
        ("worked", "Qué funcionó"),
        ("problems", "Problemas encontrados"),
        ("unverified", "Sin verificar"),
    ):
        if summary.get(key):
            lines.append(f"- {label}: {summary[key]}")
    target = report_path or summary.get("report")
    if target:
        lines.append(f"- Reporte HTML: {target}")
    lines.append("")
    lines.append(
        f"PASS {counts['PASS']} · FAIL {counts['FAIL']} · BLOCKED {counts['BLOCKED']} · "
        f"NOT VERIFIED {metrics['not_verified']}"
    )
    classifications = []
    for row in model.get("failure_classifications") or []:
        value = row.get("classification")
        if value and value not in classifications:
            classifications.append(value)
    if classifications:
        lines.append("Clasificación de fallos: " + " / ".join(classifications))
    lines.append(f"Bugs confirmados: {metrics['confirmed_bugs']}")
    lines.append(f"Riesgo máximo: {metrics['max_risk']}")
    lines.append(f"QA Reviewer: {metrics['reviewer']}")
    return "\n".join(lines)


def warn_on_contract(model_path: str) -> None:
    """Report `qa-report-model` conformance to stderr. Never blocks rendering and
    never transforms the model: the validator is a gate, not a decision maker."""
    try:
        import validate_contracts as vc  # same directory; optional at runtime
    except Exception:
        return
    try:
        result = vc.ContractValidator().validate_artifact(model_path, contract="qa-report-model")
    except Exception as exc:  # pragma: no cover - defensive
        print(f"WARNING: could not validate {model_path}: {exc}", file=sys.stderr)
        return
    for finding in result.findings:
        print(f"WARNING [{finding.severity}] {finding.field}: {finding.reason}", file=sys.stderr)


def main() -> int:
    # The report carries non-ASCII text; emit UTF-8 regardless of the console codepage.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="Render a QA report model (JSON) into the shared AGENTE-QAA HTML report.")
    parser.add_argument("--model", required=True, help="Path to the report model JSON (contract: qa-report-model).")
    parser.add_argument("--out", help="Path to write the HTML report (required unless --summary is used).")
    parser.add_argument("--summary", action="store_true", help="Print the FAST chat summary derived from the model and exit (no HTML written).")
    parser.add_argument("--repo-root", default=".", help="Repository root used to resolve evidence links (default: current directory).")
    parser.add_argument("--no-validate", action="store_true", help="Skip the best-effort qa-report-model conformance check.")
    args = parser.parse_args()

    with open(args.model, "r", encoding="utf-8") as handle:
        model = json.load(handle)

    if not args.no_validate:
        warn_on_contract(args.model)

    metrics = derive_metrics(model)

    if args.summary:
        print(render_text_summary(model, metrics))
        return 0

    if not args.out:
        parser.error("--out is required to write the HTML report (or use --summary).")

    repo_root = os.path.abspath(args.repo_root)
    out_path = os.path.abspath(args.out)
    document = render(model, out_path, repo_root)

    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(document)

    counts = metrics["counts"]
    print(
        f"Wrote {out_path} ({len(document)} bytes) | "
        f"PASS {counts['PASS']} FAIL {counts['FAIL']} BLOCKED {counts['BLOCKED']} "
        f"NOT_VERIFIED {metrics['not_verified']} | confirmed bugs {metrics['confirmed_bugs']} | "
        f"max risk {metrics['max_risk']} | reviewer {metrics['reviewer']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
