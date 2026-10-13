// M-05 - Controlled selector auto-healing (adapter capability).
//
// This module is part of the Playwright adapter (same layer as support.ts). It
// provides a deterministic, AI-free selector-recovery engine that:
//   - probes the ORIGINAL selector and, when it no longer resolves uniquely,
//     evaluates alternative candidates in a fixed priority order
//     (stable test attributes -> accessible role+name -> labels/placeholders ->
//     visible text/semantic attributes -> DOM context -> other stable attributes);
//   - verifies uniqueness, visibility/state and functional identity for each
//     candidate, and only uses a candidate when it passes STRICT criteria
//     (HIGH_CONFIDENCE mode; OBSERVE mode records but never uses);
//   - reuses previously VERIFIED alternatives from a persistent store without
//     any AI, invalidating (with cause) alternatives that stopped matching;
//   - protects mutations: a recovered mutating action is never re-executed when
//     it cannot be determined whether a previous execution already applied the
//     effect (duplicate guard), and a recovered action is only persisted to the
//     store after its post-verification passes;
//   - NEVER changes Expected Results, NEVER converts FAIL into PASS and NEVER
//     classifies a Bug: the runner and QA Core decide status and
//     classification; this module only selects which locator to use and records
//     every attempt as an `auto-heal-record` (M-01).
//
// Env contract (set by the M-03 runner):
//   QAA_AUTOHEAL_MODE    OFF | OBSERVE | HIGH_CONFIDENCE (default: OFF)
//   QAA_AUTOHEAL_STORE   absolute path of the reusable store (default <out>/autoheal_store.json)
//   QAA_AUTOHEAL_OUT     absolute run output dir (same as QAA_RUNNER_OUT)
//   QAA_AUTOHEAL_RUN_ID  run id (R-...)
//   QAA_APP / QAA_SUITE_ID  context identifiers for the records

import type { Locator, Page, TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type HealMode = 'OFF' | 'OBSERVE' | 'HIGH_CONFIDENCE';

export type HealStrategy =
  | 'stable_attribute'
  | 'role_name'
  | 'label_placeholder'
  | 'visible_text'
  | 'dom_context'
  | 'other_attribute'
  | 'stored_reuse';

export type HealStatus =
  | 'ORIGINAL_OK'
  | 'RECOVERED'
  | 'REUSED'
  | 'OBSERVED'
  | 'REJECTED'
  | 'AMBIGUOUS'
  | 'STALE'
  | 'NO_CANDIDATE'
  | 'NOT_ATTEMPTED'
  | 'DUPLICATE_PREVENTED';

export type HealConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type HealAction = 'read' | 'click' | 'fill' | 'none';
export type VerificationAfter = 'POST_VERIFICATION_PASS' | 'POST_VERIFICATION_FAIL' | 'NOT_PERFORMED';

/** Functional descriptor the spec declares for the element it expects. */
export interface HealExpected {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  testId?: string[];
  attr?: Record<string, string>;
  within?: string;
}

/** One evaluated candidate. */
export interface HealCandidate {
  selector: string;
  strategy: HealStrategy;
  count: number;
  unique: boolean;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  role?: string;
  identity: boolean;
  reason: string;
  accepted: boolean;
}

/** One recovery attempt (contract `auto-heal-record`, M-01). */
export interface HealAttempt {
  heal_id: string;
  run_id: string;
  suite_id: string;
  app: string;
  test_case_id: string;
  spec: string;
  test_title: string;
  selector_original: string;
  candidates: HealCandidate[];
  selector_used: string | null;
  strategy_used: HealStrategy | null;
  reason_accept: string | null;
  reason_reject: string | null;
  mode: HealMode;
  used_recovery: boolean;
  reused_from_store: boolean;
  verification_after: VerificationAfter;
  status: HealStatus;
  action: HealAction;
  expected: HealExpected;
  url: string;
  evidence: string[];
  confidence: HealConfidence;
  duplicate_prevented: boolean;
  ai_calls: 0;
  duration_ms: number;
  timestamp: string;
}

/** Persistent, reusable, verified recovery entry (machine state, NOT a QA artifact). */
export interface HealStoreEntry {
  entry_id: string;
  app: string;
  suite_id: string;
  test_case_id: string;
  spec: string;
  test_title: string;
  selector_original: string;
  selector_alternative: string;
  strategy: HealStrategy;
  expected: HealExpected;
  verified_in_run: string;
  verified_at: string;
  evidence: string[];
  status: 'VERIFIED' | 'STALE';
  times_verified: number;
  last_invalid_reason?: string;
}

export interface HealStore {
  store_version: number;
  entries: HealStoreEntry[];
}

export interface HealActionOpts {
  mutating?: boolean;
  outcome?: (page: Page) => Promise<boolean>;
  postVerify?: (page: Page) => Promise<boolean>;
  probeTimeoutMs?: number;
}

export interface HealResolveOpts {
  action?: HealAction;
  probeTimeoutMs?: number;
}

export interface HealResolveResult {
  attempt: HealAttempt;
  locator: Locator;
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

function normPath(p: string): string {
  return p.split(sep).join('/');
}

export function repoRel(p: string, repoRoot = process.cwd()): string {
  return normPath(relative(repoRoot, resolve(p)));
}

function escAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cssAttr(key: string, value: string): string {
  return `[${key}="${escAttr(value)}"]`;
}

function roleExpr(role: string, name?: string): string {
  const base = `role=${role}`;
  return name ? `${base}[name="${escAttr(name)}"]` : base;
}

function textExpr(text: string): string {
  return `text="${escAttr(text)}"`;
}

function stableAttrSelectors(hints: string[]): string[] {
  const out: string[] = [];
  for (const h of hints) {
    out.push(cssAttr('data-testid', h), cssAttr('data-test', h), cssAttr('data-qa', h), cssAttr('data-cy', h), cssAttr('id', h));
  }
  return out;
}

/** Parse stable-attribute hints out of a CSS selector (`#id`, `[data-*=v]`, `[id=v]`). */
function hintsFromSelector(selector: string): string[] {
  const hints: string[] = [];
  const idMatch = selector.match(/^#([\w-]+)/);
  if (idMatch) hints.push(idMatch[1]);
  for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy', 'id']) {
    const re = new RegExp(`\\[${attr}\\s*=\\s*["']?([\\w-]+)["']?\\]`);
    const m = selector.match(re);
    if (m) hints.push(m[1]);
  }
  return hints;
}

/** Parse other stable attributes out of the original selector (`[name=..]`, `[aria-label=..]`, ...). */
function attrsFromSelector(selector: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /\[([\w-]+)\s*=\s*["']?([^"'\]]+)["']?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) {
    const [, key, value] = m;
    if (key && !['data-testid', 'data-test', 'data-qa', 'data-cy', 'id'].includes(key)) {
      attrs[key] = value;
    }
  }
  return attrs;
}

/** Effective ARIA-ish role of an element, for functional identity checks. */
async function effectiveRole(loc: Locator): Promise<string | undefined> {
  try {
    return await loc.evaluate((el) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') ?? '';
      if (tag === 'button') return 'button';
      if (tag === 'input') {
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'search') return 'searchbox';
        return 'textbox';
      }
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'img') return 'img';
      if (tag === 'li') return 'listitem';
      return 'generic';
    });
  } catch {
    return undefined;
  }
}

// --------------------------------------------------------------------------- //
// Candidate generation (deterministic, priority-ordered, AI-free)
// --------------------------------------------------------------------------- //

interface Cand {
  expr: string;
  strategy: HealStrategy;
  loc: Locator;
  persistable: boolean;
}

function buildCandidate(page: Page, expr: string, strategy: HealStrategy, persistable: boolean): Cand {
  return { expr, strategy, loc: page.locator(expr), persistable };
}

function generateCandidates(page: Page, selectorOriginal: string, expected: HealExpected): Cand[] {
  const out: Cand[] = [];
  const seen = new Set<string>();
  const push = (c: Cand) => {
    if (seen.has(c.expr)) return;
    seen.add(c.expr);
    out.push(c);
  };

  const hints = [...(expected.testId ?? []), ...hintsFromSelector(selectorOriginal)];
  if (hints.length > 0) {
    for (const sel of stableAttrSelectors([...new Set(hints)])) {
      push(buildCandidate(page, sel, 'stable_attribute', true));
    }
  }

  if (expected.role && expected.name) {
    push(buildCandidate(page, roleExpr(expected.role, expected.name), 'role_name', true));
  }
  if (expected.name) {
    push(buildCandidate(page, cssAttr('aria-label', expected.name), 'role_name', true));
    push(buildCandidate(page, cssAttr('title', expected.name), 'role_name', true));
  }

  if (expected.placeholder) {
    push(buildCandidate(page, cssAttr('placeholder', expected.placeholder), 'label_placeholder', true));
  }
  if (expected.label) {
    const esc = escAttr(expected.label);
    push({ expr: `getByLabel("${esc}")`, strategy: 'label_placeholder', loc: page.getByLabel(expected.label, { exact: true }), persistable: false });
  }

  if (expected.text) {
    push(buildCandidate(page, textExpr(expected.text), 'visible_text', true));
  }

  if (expected.within) {
    for (const base of [...out]) {
      push({ expr: `${expected.within} >> ${base.expr}`, strategy: 'dom_context', loc: page.locator(expected.within).locator(base.loc), persistable: false });
    }
  }

  const attrs = { ...(expected.attr ?? {}), ...attrsFromSelector(selectorOriginal) };
  for (const [key, value] of Object.entries(attrs)) {
    push(buildCandidate(page, cssAttr(key, value), 'other_attribute', true));
  }

  return out;
}

// --------------------------------------------------------------------------- //
// Store (persistent, reusable, verified recoveries)
// --------------------------------------------------------------------------- //

function expectedFingerprint(expected: HealExpected): string {
  const subset: Record<string, unknown> = {};
  for (const k of ['role', 'name', 'label', 'placeholder', 'text', 'testId', 'attr', 'within'] as const) {
    if (expected[k] !== undefined) subset[k] = expected[k];
  }
  return JSON.stringify(subset);
}

function storeKey(app: string, selectorOriginal: string, expected: HealExpected): string {
  return `${app}::${selectorOriginal}::${expectedFingerprint(expected)}`;
}

function emptyStore(): HealStore {
  return { store_version: 1, entries: [] };
}

function readStoreFile(storePath: string): HealStore {
  try {
    if (!existsSync(storePath)) return emptyStore();
    const data = JSON.parse(readFileSync(storePath, 'utf8'));
    if (data && Array.isArray(data.entries)) {
      return { store_version: data.store_version ?? 1, entries: data.entries };
    }
  } catch {
    // a corrupt store must not block the run: restart as empty machine state
  }
  return emptyStore();
}

// --------------------------------------------------------------------------- //
// HealedContext: per-test healing session
// --------------------------------------------------------------------------- //

export class HealedContext {
  readonly mode: HealMode;
  readonly runId: string;
  readonly suiteId: string;
  readonly app: string;
  readonly outDir: string;
  readonly storePath: string;
  readonly repoRoot: string;
  readonly page: Page;
  readonly testInfo: TestInfo;
  readonly spec: string;
  readonly testTitle: string;
  readonly attempts: HealAttempt[] = [];
  store: HealStore;
  private seq = 0;
  // Run-scoped uniqueness: seq restarts per test context, so heal_ids need a
  // per-context component to avoid collisions when the record is merged.
  private readonly contextId = randomUUID().slice(0, 8);

  constructor(page: Page, testInfo: TestInfo, opts: { mode?: HealMode; app?: string; suiteId?: string; storePath?: string } = {}) {
    this.page = page;
    this.testInfo = testInfo;
    this.repoRoot = process.cwd();
    const env = process.env;
    this.mode = (opts.mode ?? env.QAA_AUTOHEAL_MODE ?? 'OFF') as HealMode;
    this.runId = env.QAA_AUTOHEAL_RUN_ID ?? `R-${Date.now()}`;
    this.suiteId = opts.suiteId ?? env.QAA_SUITE_ID ?? 'SUITE-unknown';
    this.app = opts.app ?? env.QAA_APP ?? 'app-unknown';
    this.outDir = resolve(env.QAA_AUTOHEAL_OUT ?? env.QAA_RUNNER_OUT ?? join(this.repoRoot, 'automation', '.artifacts', 'runner-out'));
    this.storePath = resolve(opts.storePath ?? env.QAA_AUTOHEAL_STORE ?? join(this.outDir, 'autoheal_store.json'));
    this.spec = repoRel(testInfo.file, this.repoRoot);
    this.testTitle = testInfo.title;
    // Store isolation: only HIGH_CONFIDENCE reads the reuse store. OFF (never
    // touches it) and OBSERVE (never uses it) start from an in-memory empty store
    // and must not read the persistent file.
    this.store = this.mode === 'HIGH_CONFIDENCE' ? readStoreFile(this.storePath) : emptyStore();
  }

  private baseAttempt(selector: string, expected: HealExpected, action: HealAction): HealAttempt & { startedAt: number } {
    this.seq += 1;
    const attempt: HealAttempt = {
      heal_id: `AH-${this.runId}-${this.contextId}-${String(this.seq).padStart(4, '0')}`,
      run_id: this.runId,
      suite_id: this.suiteId,
      app: this.app,
      test_case_id: '',
      spec: this.spec,
      test_title: this.testTitle,
      selector_original: selector,
      candidates: [],
      selector_used: null,
      strategy_used: null,
      reason_accept: null,
      reason_reject: null,
      mode: this.mode,
      used_recovery: false,
      reused_from_store: false,
      verification_after: 'NOT_PERFORMED',
      status: 'ORIGINAL_OK',
      action,
      expected,
      url: this.page.url(),
      evidence: [],
      confidence: 'HIGH',
      duplicate_prevented: false,
      ai_calls: 0,
      duration_ms: 0,
      timestamp: new Date().toISOString(),
    };
    Object.defineProperty(attempt, 'startedAt', { value: Date.now(), writable: true, enumerable: false });
    return attempt as HealAttempt & { startedAt: number };
  }

  private async probeOriginal(loc: Locator, opts: HealResolveOpts): Promise<{ ok: boolean; reason: string }> {
    const probe = opts.probeTimeoutMs ?? 2000;
    try {
      await loc.first().waitFor({ state: 'visible', timeout: probe });
    } catch {
      return { ok: false, reason: 'original selector did not resolve to a visible element within the probe timeout' };
    }
    const count = await loc.count();
    if (count === 0) return { ok: false, reason: 'original selector no longer matches any element' };
    if (count > 1) return { ok: false, reason: `original selector is ambiguous (${count} matches)` };
    const action = opts.action ?? 'read';
    if ((action === 'click' || action === 'fill') && !(await loc.first().isEnabled())) {
      return { ok: false, reason: 'original selector resolves but the element is disabled' };
    }
    if (action === 'fill' && !(await loc.first().isEditable())) {
      return { ok: false, reason: 'original selector resolves but the element is not editable' };
    }
    return { ok: true, reason: 'original selector resolved uniquely with the required state' };
  }

  /**
   * DOM-path fingerprint of the matched element (tag + id + classes per
   * ancestor). Used to prove two accepted candidate selectors resolve to the
   * SAME element: same element is NOT an ambiguity.
   */
  private async elementFingerprint(loc: Locator): Promise<string> {
    try {
      return await loc.evaluate((el) => {
        const path: string[] = [];
        // The element is provided by the page context (DOM), which is not part
        // of the ES2023 lib used by the runner build, so navigate it via a
        // minimal structural interface instead of the DOM `Element` type.
        interface DomEl { nodeType: number; tagName: string; id: string; classList: Iterable<string>; parentElement: DomEl | null; }
        let current: DomEl | null = el as unknown as DomEl;
        while (current && current.nodeType === 1) {
          const classes = Array.from(current.classList).map((c) => `.${c}`).join('');
          path.unshift(`${current.tagName.toLowerCase()}${current.id ? `#${current.id}` : ''}${classes}`);
          current = current.parentElement;
        }
        return path.join(' > ');
      });
    } catch {
      return '';
    }
  }

  /** Functional identity check (strict; see top-of-file documentation). */
  private async identityOk(loc: Locator, expr: string, strategy: HealStrategy, expected: HealExpected): Promise<boolean> {
    if (strategy === 'role_name' || strategy === 'label_placeholder' || strategy === 'visible_text') {
      return true; // the strategy itself binds the identity (engine selector / placeholder CSS)
    }
    if (strategy === 'stable_attribute' && expected.testId?.some((h) => expr.includes(`"${h}"`))) {
      return true; // the declared test attribute IS the identity evidence
    }
    if (strategy === 'other_attribute' && Object.keys(expected.attr ?? {}).length > 0) {
      return true; // declared stable attributes are identity evidence
    }
    if (expected.role) return true; // role was already matched by the caller
    try {
      const got = await loc.evaluate((el) => ({
        aria: el.getAttribute?.('aria-label') ?? undefined,
        title: el.getAttribute?.('title') ?? undefined,
        placeholder: el.getAttribute?.('placeholder') ?? undefined,
        text: (el.textContent ?? '').trim() || undefined,
        id: el.id || undefined,
      }));
      const matched: string[] = [];
      if (expected.name && got.aria === expected.name) matched.push('name(aria)');
      if (expected.name && got.title === expected.name) matched.push('name(title)');
      if (expected.name && got.text === expected.name) matched.push('name(text)');
      if (expected.placeholder && got.placeholder === expected.placeholder) matched.push('placeholder');
      if (expected.text && got.text === expected.text) matched.push('text');
      if (expected.testId && got.id && expected.testId.includes(got.id)) matched.push('id');
      return matched.length > 0;
    } catch {
      return false;
    }
  }

  private async evaluateCandidate(loc: Locator, expr: string, strategy: HealStrategy, expected: HealExpected, action: HealAction): Promise<HealCandidate> {
    let count = 0;
    try {
      count = await loc.count();
    } catch {
      count = 0;
    }
    const c: HealCandidate = {
      selector: expr,
      strategy,
      count,
      unique: count === 1,
      visible: false,
      enabled: false,
      editable: false,
      identity: false,
      reason: '',
      accepted: false,
    };
    if (count !== 1) {
      c.reason = count === 0 ? 'no element matches' : `not unique (${count} matches)`;
      return c;
    }
    const el = loc.first();
    c.visible = await el.isVisible().catch(() => false);
    c.enabled = await el.isEnabled().catch(() => false);
    c.editable = await el.isEditable().catch(() => false);
    const role = await effectiveRole(el);
    c.role = role ?? 'generic';
    c.identity = await this.identityOk(el, expr, strategy, expected);

    const reasons: string[] = [];
    if (!c.visible) reasons.push('not visible');
    if (action === 'click' && !c.enabled) reasons.push('not enabled');
    if (action === 'fill' && !c.editable) reasons.push('not editable');
    if (expected.role && role !== expected.role) reasons.push(`role mismatch (expected ${expected.role}, got ${role})`);
    if (!c.identity) reasons.push('functional identity not verified (no matching name/label/placeholder/text/test-attribute evidence)');
    c.accepted = c.unique && c.visible && reasons.length === 0;
    c.reason = c.accepted
      ? `unique match (count=1), state ok, identity verified (role=${role})`
      : reasons.join('; ');
    return c;
  }

  private async captureEvidence(attempt: HealAttempt): Promise<void> {
    try {
      const dir = join(this.outDir, 'evidence', 'autoheal');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${attempt.heal_id}.png`);
      await this.page.screenshot({ path: file });
      attempt.evidence.push(repoRel(file, this.repoRoot));
    } catch {
      // screenshots are best-effort evidence; a failure never changes the outcome
    }
  }

  private static readonly RECOVERY_PATH_STATUSES: ReadonlySet<string> = new Set([
    'RECOVERED', 'REUSED', 'OBSERVED', 'REJECTED', 'AMBIGUOUS', 'STALE', 'NO_CANDIDATE',
  ]);

  /**
   * Resolves a locator for `selector` with M-05 recovery. The returned locator
   * is the ORIGINAL one for non-used statuses (so the test continues with the
   * real DOM), and the recovered/reused candidate for RECOVERED/REUSED.
   */
  async resolve(selector: string, expected: HealExpected, opts: HealResolveOpts = {}): Promise<HealResolveResult> {
    const action = opts.action ?? 'read';
    const attempt = this.baseAttempt(selector, expected, action);
    const original = this.page.locator(selector);

    const probe = await this.probeOriginal(original, opts);
    if (probe.ok) {
      attempt.status = 'ORIGINAL_OK';
      attempt.reason_accept = probe.reason;
      attempt.confidence = 'HIGH';
      attempt.duration_ms = Date.now() - attempt.startedAt;
      this.attempts.push(attempt);
      return { attempt, locator: original };
    }
    attempt.reason_reject = probe.reason;

    if (this.mode === 'OFF') {
      attempt.status = 'NOT_ATTEMPTED';
      attempt.reason_reject =
        `${probe.reason}; auto-healing is OFF and no recovery was attempted (mode=OFF). ` +
        'The original selector was left unchanged and the test continues against the real DOM.';
      attempt.confidence = 'HIGH';
      attempt.duration_ms = Date.now() - attempt.startedAt;
      this.attempts.push(attempt);
      return { attempt, locator: original };
    }

    // Store reuse is a recovery action: it only applies in HIGH_CONFIDENCE.
    // OBSERVE identifies candidates but NEVER uses any of them (store included).
    if (this.mode === 'HIGH_CONFIDENCE') {
      const key = storeKey(this.app, selector, expected);
      const entry = this.store.entries.find((e) => e.status === 'VERIFIED' && storeKey(e.app, e.selector_original, e.expected) === key);
      if (entry) {
        const cand = await this.evaluateCandidate(
          this.page.locator(entry.selector_alternative), entry.selector_alternative, 'stored_reuse', expected, action);
        if (cand.accepted) {
          attempt.candidates = [cand];
          attempt.status = 'REUSED';
          attempt.used_recovery = true;
          attempt.reused_from_store = true;
          attempt.selector_used = entry.selector_alternative;
          attempt.strategy_used = 'stored_reuse';
          attempt.reason_accept =
            `stored alternative '${entry.selector_alternative}' re-validated in the current context and still matches ` +
            `the expected element (store entry ${entry.entry_id})`;
          attempt.confidence = 'MEDIUM';
          entry.times_verified += 1;
          await this.captureEvidence(attempt);
          attempt.duration_ms = Date.now() - attempt.startedAt;
          this.attempts.push(attempt);
          return { attempt, locator: this.page.locator(entry.selector_alternative) };
        }
        // The stored alternative stopped matching: invalidate it WITH cause.
        entry.status = 'STALE';
        entry.last_invalid_reason = cand.reason;
        attempt.candidates.push({ ...cand, strategy: 'stored_reuse' });
        attempt.reason_reject = `stored alternative '${entry.selector_alternative}' is no longer valid: ${cand.reason}`;
      }
    }

    // 2) Candidate pipeline in the documented priority order.
    const generated: Cand[] = generateCandidates(this.page, selector, expected);
    for (const cand of generated) {
      attempt.candidates.push(await this.evaluateCandidate(cand.loc, cand.expr, cand.strategy, expected, action));
    }
    // Strict criteria + DOM-identity deduplication: several selectors that
    // resolve to the SAME unique element are NOT an ambiguity; different
    // elements ARE. Dedupe by element fingerprint before counting.
    const strict: HealCandidate[] = [];
    {
      const seen = new Set<string>();
      for (const c of attempt.candidates.filter((x) => x.accepted)) {
        const cand = generated.find((g) => g.expr === c.selector);
        let fp = '';
        if (cand) {
          fp = await this.elementFingerprint(cand.loc);
        }
        // Failure proofing: if the fingerprint cannot be computed, fall back to
        // the selector string (different selectors -> different elements). This
        // errs toward "refuse recovery", never toward using a wrong element.
        if (!fp) fp = `sel:${c.selector}`;
        if (seen.has(fp)) continue;
        seen.add(fp);
        strict.push(c);
      }
    }

    if (this.mode === 'OBSERVE') {
      attempt.status = 'OBSERVED';
      // `accepted` means "accepted for use". OBSERVE identifies candidates but
      // never uses them, so every recorded candidate stays not accepted for use
      // even when it would pass the strict criteria (the reason keeps that trace).
      for (const c of attempt.candidates) {
        if (c.accepted) {
          c.reason = `${c.reason}; identified but NOT accepted for use (OBSERVE observes only)`;
        }
        c.accepted = false;
      }
      attempt.reason_reject =
        `${probe.reason}; OBSERVE mode identified ${strict.length} candidate(s) that would pass the strict ` +
        'criteria but NONE was used (observation only; the test continues with the original selector ' +
        'and the real result is preserved).';
      attempt.confidence = 'HIGH';
      await this.captureEvidence(attempt);
      attempt.duration_ms = Date.now() - attempt.startedAt;
      this.attempts.push(attempt);
      return { attempt, locator: original };
    }

    if (strict.length === 1) {
      const c = strict[0];
      attempt.status = 'RECOVERED';
      attempt.used_recovery = true;
      attempt.selector_used = c.selector;
      attempt.strategy_used = c.strategy;
      attempt.reason_accept = `${c.selector} (strategy ${c.strategy}): ${c.reason}`;
      attempt.confidence = 'MEDIUM'; // upgraded to HIGH after post-verification
      await this.captureEvidence(attempt);
      attempt.duration_ms = Date.now() - attempt.startedAt;
      this.attempts.push(attempt);
      return { attempt, locator: this.page.locator(c.selector) };
    }

    if (strict.length > 1) {
      attempt.status = 'AMBIGUOUS';
      attempt.reason_reject =
        `${strict.length} candidates passed the strict criteria; a unique, unambiguous candidate is required ` +
        '(auto-recovery rejected; the test continues with the original selector).';
      attempt.confidence = 'HIGH';
    } else {
      const withMatches = attempt.candidates.filter((c) => c.count > 0);
      const anyUnique = attempt.candidates.some((c) => c.unique);
      if (withMatches.length > 0 && !anyUnique) {
        attempt.status = 'AMBIGUOUS';
        attempt.reason_reject =
          `${withMatches.length} candidate(s) matched the element descriptor but none was unique ` +
          '(multiple DOM elements with the same identity evidence; auto-recovery rejected).';
      } else if (anyUnique) {
        attempt.status = 'REJECTED';
        attempt.reason_reject =
          'a unique candidate was found but it does not pass the strict identity/state criteria: ' +
          attempt.candidates.filter((c) => c.unique).map((c) => c.reason).join(' | ');
      } else {
        attempt.status = 'NO_CANDIDATE';
        attempt.reason_reject =
          'no functional candidate could be identified with sufficient identity evidence ' +
          '(recovery rejected; the test continues with the original selector).';
      }
      attempt.confidence = 'HIGH';
    }
    await this.captureEvidence(attempt);
    attempt.duration_ms = Date.now() - attempt.startedAt;
    this.attempts.push(attempt);
    return { attempt, locator: original };
  }

  /** Mechanism inspection: resolves and records WITHOUT acting (no dispatch). */
  async inspect(selector: string, expected: HealExpected, opts: HealResolveOpts = {}): Promise<HealResolveResult> {
    return this.resolve(selector, expected, { ...opts, action: opts.action ?? 'read' });
  }

  private upsertStoreEntry(attempt: HealAttempt, selectorUsed: string, strategy: HealStrategy): void {
    const key = storeKey(this.app, attempt.selector_original, attempt.expected);
    const existing = this.store.entries.find(
      (e) => storeKey(e.app, e.selector_original, e.expected) === key && e.selector_alternative === selectorUsed);
    if (existing) {
      existing.status = 'VERIFIED';
      existing.times_verified += 1;
      existing.verified_in_run = this.runId;
      existing.verified_at = attempt.timestamp;
      existing.evidence = attempt.evidence.slice();
      existing.expected = attempt.expected;
      existing.strategy = strategy;
      return;
    }
    this.store.entries.push({
      entry_id: `AH-STORE-${randomUUID().slice(0, 8)}`,
      app: this.app,
      suite_id: this.suiteId,
      test_case_id: '',
      spec: this.spec,
      test_title: this.testTitle,
      selector_original: attempt.selector_original,
      selector_alternative: selectorUsed,
      strategy,
      expected: attempt.expected,
      verified_in_run: this.runId,
      verified_at: attempt.timestamp,
      evidence: attempt.evidence.slice(),
      status: 'VERIFIED',
      times_verified: 1,
    });
  }

  private async guardedAct(r: HealResolveResult, opts: HealActionOpts, act: () => Promise<void>): Promise<void> {
    const a = r.attempt;
    if (a.status === 'ORIGINAL_OK') {
      await act();
      return;
    }
    if (a.status !== 'RECOVERED' && a.status !== 'REUSED') {
      return; // non-used statuses never dispatch
    }
    if (!opts.mutating) {
      await act();
      return;
    }
    // Mutation protection: never re-execute a recovered mutating action when we
    // cannot determine whether a previous execution already applied the effect.
    if (opts.outcome) {
      let applied: boolean | undefined;
      try {
        applied = await opts.outcome(this.page);
      } catch {
        // The outcome probe failed: whether a previous execution already applied
        // the effect cannot be determined. The mutating action is therefore
        // treated as UNCERTAIN and is NOT re-executed (guardrail: never risk a
        // duplicate side effect when the result is unknown).
        applied = undefined;
      }
      if (applied === true) {
        a.duplicate_prevented = true;
        a.reason_reject =
          'recovered selector resolved but the effect of the mutating action was already applied; ' +
          'the action was NOT re-executed (duplicate protection).';
        return;
      }
      if (applied === undefined) {
        a.duplicate_prevented = true;
        a.reason_reject =
          'recovered selector resolved but whether the mutating action already applied its effect could not ' +
          'be determined (outcome probe failed); the mutating action was NOT re-executed (duplicate protection; ' +
          'the attempt stays traceable and the real Test Case result is preserved).';
        return;
      }
      await act();
      return;
    }
    a.duplicate_prevented = true;
    a.reason_reject =
      'recovered selector resolved but whether a previous execution already applied the effect cannot be ' +
      'determined; the mutating action was NOT re-executed (duplicate protection; Expected Results are ' +
      'verified by the test assertions and this attempt is recorded for classification).';
  }

  private async finishAttempt(r: HealResolveResult, opts: HealActionOpts, acted: boolean): Promise<void> {
    const a = r.attempt;
    if (a.status === 'ORIGINAL_OK' || (a.status === 'RECOVERED' || a.status === 'REUSED') && acted) {
      if (opts.postVerify && (a.status === 'RECOVERED' || a.status === 'REUSED')) {
        let ok = false;
        try {
          ok = await opts.postVerify(this.page);
        } catch {
          ok = false;
        }
        a.verification_after = ok ? 'POST_VERIFICATION_PASS' : 'POST_VERIFICATION_FAIL';
        if (ok && a.selector_used && a.strategy_used) {
          a.confidence = 'HIGH';
          this.upsertStoreEntry(a, a.selector_used, a.strategy_used);
        }
      } else if (a.status === 'RECOVERED' || a.status === 'REUSED') {
        a.verification_after = 'NOT_PERFORMED';
        // Only VERIFIED recoveries are persisted; unverified recoveries stay in the run record.
      }
    }
    a.duration_ms = Date.now() - ((a as HealAttempt & { startedAt?: number }).startedAt ?? Date.now());
  }

  /** Clicks the (possibly recovered) element. Mutating actions are guarded. */
  async click(selector: string, expected: HealExpected, opts: HealActionOpts = {}): Promise<HealAttempt> {
    const r = await this.resolve(selector, expected, { action: 'click', probeTimeoutMs: opts.probeTimeoutMs });
    let acted = false;
    await this.guardedAct(r, opts, async () => {
      await r.locator.click();
      acted = true;
    });
    await this.finishAttempt(r, opts, acted);
    return r.attempt;
  }

  /** Fills the (possibly recovered) input. Filling is mutating by default. */
  async fill(selector: string, value: string, expected: HealExpected, opts: HealActionOpts = {}): Promise<HealAttempt> {
    const r = await this.resolve(selector, expected, { action: 'fill', probeTimeoutMs: opts.probeTimeoutMs });
    let acted = false;
    await this.guardedAct(r, { ...opts, mutating: opts.mutating ?? true }, async () => {
      await r.locator.fill(value);
      acted = true;
    });
    await this.finishAttempt(r, opts, acted);
    return r.attempt;
  }

  /** Flushes the run record and the reuse store to disk. Call once per test. */
  finish(): void {
    try {
      const file = join(this.outDir, 'autoheal_record.json');
      let existing: unknown[] = [];
      if (existsSync(file)) {
        try {
          const data = JSON.parse(readFileSync(file, 'utf8'));
          if (Array.isArray(data)) existing = data;
        } catch {
          existing = [];
        }
      }
      const ids = new Set(this.attempts.map((a) => a.heal_id));
      const merged = [...existing.filter((e) => !(e && typeof e === 'object' && 'heal_id' in e && ids.has((e as HealAttempt).heal_id))), ...this.attempts];
      mkdirSync(this.outDir, { recursive: true });
      writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
    } catch {
      // an unwritable record must never crash the test; the runner reports the artifact state
    }
    if (this.mode !== 'HIGH_CONFIDENCE') return; // only HIGH_CONFIDENCE writes the store (OFF/OBSERVE never touch it)
    try {
      const onDisk = readStoreFile(this.storePath);
      const mergedEntries = [...onDisk.entries];
      for (const entry of this.store.entries) {
        const idx = mergedEntries.findIndex((e) => e.entry_id === entry.entry_id);
        if (idx >= 0) {
          // preserve entries created by other processes/tests not loaded here
          mergedEntries[idx] = { ...mergedEntries[idx], ...entry };
        } else {
          const clash = mergedEntries.findIndex(
            (e) => storeKey(e.app, e.selector_original, e.expected) === storeKey(entry.app, entry.selector_original, entry.expected)
              && e.selector_alternative === entry.selector_alternative && e.status === 'VERIFIED');
          if (clash >= 0) {
            mergedEntries[clash] = { ...mergedEntries[clash], ...entry };
          } else {
            mergedEntries.push(entry);
          }
        }
      }
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify({ store_version: 1, entries: mergedEntries }, null, 2), 'utf8');
    } catch {
      // a corrupt store must never crash the test
    }
  }
}

/** Creates a per-test healed context bound to the current env (M-05). */
export function healed(page: Page, testInfo: TestInfo, opts?: { mode?: HealMode; app?: string; suiteId?: string; storePath?: string }): HealedContext {
  return new HealedContext(page, testInfo, opts);
}