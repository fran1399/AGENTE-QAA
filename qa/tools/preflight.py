#!/usr/bin/env python3
"""Pre-flight capability detector (M-04).

Runs reproducible, **read-only** checks for the conditions a concrete QA
execution needs, and emits a `pre-flight-record` artifact that is validated with
the M-01 contract validator. It never executes Test Cases, never modifies Test
Data and never reveals credential values.

QA Reviewer availability comes from a **declarative operator signal**
(`QAA_QA_REVIEWER_AVAILABLE`); the detector performs **no** automatic reviewer
probe, and a required review without sufficient evidence of availability stays
`BLOCKED`/`UNVERIFIED`.

Usage:
    python qa/tools/preflight.py --requirements <file> [--out <file>] [--json]

Exit codes:
    0  READY
    1  BLOCKED (at least one required condition is not satisfied)
    2  fatal (bad usage, unreadable requirements, or an invalid produced record)

Contract:
    qa/schema/pre-flight-record.schema.json (via qa/schema/index.json)
    See docs/PRE-FLIGHT-CAPABILITIES.md for the requirements format and the
    capability vocabulary.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))

# Make the sibling M-01 validator importable when run as a script or imported.
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from validate_contracts import ContractValidator, ValidatorError  # noqa: E402


class PreflightError(Exception):
    """Fatal usage/requirements error."""


# --------------------------------------------------------------------------- #
# Capability vocabulary (additive; the record contract's `check` enum is coarse)
# --------------------------------------------------------------------------- #
AVAILABLE = "AVAILABLE"
REQUIRES_CONFIGURATION = "REQUIRES_CONFIGURATION"
NOT_INSTALLED = "NOT_INSTALLED"
NOT_REQUIRED = "NOT_REQUIRED"
UNVERIFIED = "UNVERIFIED"

# Probe outcome states for a required target (HTTP probe semantics). They only
# appear when `need.target.browser_fallback: true` is declared: the HTTP probe
# could not confirm functional access, so accessibility is decided by the real
# browser navigation evidence of the execution flow. They never block and never
# present the probe as confirmation of functional accessibility.
PROBE_DENIED = "PROBE_DENIED"
PROBE_INCONCLUSIVE = "PROBE_INCONCLUSIVE"

# HTTP statuses that typically mean the probe was explicitly denied by the
# server (bot protection, auth walls) rather than a broken/unreachable target.
PROBE_DENIED_CODES = (401, 403, 407, 429)

# Map the rich capability_state onto the contract's `status` enum.
STATUS_BY_STATE = {
    AVAILABLE: "OK",
    REQUIRES_CONFIGURATION: "BLOCKED",
    NOT_INSTALLED: "BLOCKED",
    UNVERIFIED: "UNVERIFIED",
    NOT_REQUIRED: "NOT_APPLICABLE",
    PROBE_DENIED: "WARN",
    PROBE_INCONCLUSIVE: "WARN",
}

# Canonical categories allowed by the closed `check` enum in the contract.
CAT_TARGET = "target_accessible"
CAT_CREDENTIALS = "credentials_available"
CAT_TOOLS = "tools_available"
CAT_ADAPTER = "adapter_available"
CAT_TEST_DATA = "test_data_available"
CAT_CONFIG = "config_dependencies"

SUPPORTED_ADAPTERS = {"playwright", "http"}
DEFAULT_BROWSER_INVENTORY = ("chromium", "firefox", "webkit")
REVIEWER_SIGNAL_ENV = "QAA_QA_REVIEWER_AVAILABLE"
RISK_REQUIRING_REVIEWER = {"HIGH", "CRITICAL"}
# The reviewer is an external mechanism the detector cannot invoke. Its
# availability comes from an operator-provided *declarative* signal, never from
# an automatic probe (see docs/PRE-FLIGHT-CAPABILITIES.md). These constants name
# the evidence source recorded on the check.
SOURCE_DECLARATIVE = "declarative_signal"
SOURCE_DIRECT_PROBE = "direct_probe"


@dataclass
class CheckResult:
    capability: str
    category: str
    required: bool
    state: str            # capability_state (rich vocabulary)
    observed_state: str   # actual detected state, even when not required
    status: str           # contract `status` enum
    observed: str
    action: Optional[str] = None
    detail: Optional[str] = None
    availability_source: Optional[str] = None
    evidence: List[Any] = field(default_factory=list)

    def to_json(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "check": self.category,
            "capability": self.capability,
            "status": self.status,
            "required": self.required,
            "capability_state": self.state,
            "observed_state": self.observed_state,
            "observed": self.observed,
            "evidence": list(self.evidence),
        }
        if self.action:
            out["action"] = self.action
        if self.detail:
            out["detail"] = self.detail
        if self.availability_source:
            out["availability_source"] = self.availability_source
        return out


def _parse_version(text: str) -> Optional[Tuple[int, ...]]:
    match = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", text or "")
    if not match:
        return None
    return tuple(int(g) for g in match.groups() if g is not None)


def _slug(text: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", (text or "").strip()).strip("-")
    return slug or "task"


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class Detector:
    """Evaluates the capabilities a concrete task requires."""

    def __init__(self, repo_root: str = REPO_ROOT,
                 environ: Optional[Dict[str, str]] = None,
                 browsers_dir: Optional[str] = None):
        self.repo_root = repo_root
        self.environ = dict(os.environ if environ is None else environ)
        self.browsers_dir = browsers_dir
        self.checks: List[CheckResult] = []

    # -- plumbing ---------------------------------------------------------- #
    def _path(self) -> Optional[str]:
        return self.environ.get("PATH") or self.environ.get("Path")

    def _run_version(self, exe: str, args: Tuple[str, ...] = ("--version",)) -> str:
        try:
            proc = subprocess.run([exe, *args], capture_output=True, text=True,
                                  timeout=10, env=self.environ)
        except (OSError, subprocess.SubprocessError):
            return ""
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        return out.splitlines()[0].strip() if out else ""

    def _add(self, capability: str, category: str, detected: str, required: bool,
             observed: str, action: Optional[str] = None,
             detail: Optional[str] = None, evidence: Optional[List[Any]] = None,
             availability_source: Optional[str] = None) -> None:
        if required:
            state, status = detected, STATUS_BY_STATE[detected]
        else:
            state, status = NOT_REQUIRED, STATUS_BY_STATE[NOT_REQUIRED]
        self.checks.append(CheckResult(
            capability=capability, category=category, required=required,
            state=state, observed_state=detected, status=status,
            observed=observed, action=action, detail=detail,
            availability_source=availability_source,
            evidence=list(evidence or []),
        ))

    def _add_not_required(self, capability: str, category: str, observed: str) -> None:
        self.checks.append(CheckResult(
            capability=capability, category=category, required=False,
            state=NOT_REQUIRED, observed_state=NOT_REQUIRED,
            status=STATUS_BY_STATE[NOT_REQUIRED], observed=observed,
        ))

    # -- individual checks ------------------------------------------------- #
    def _eval_runtime(self, name: str, required: bool,
                      min_version: Optional[List[int]]) -> None:
        capability = f"runtime_{name}"
        exe = shutil.which(name, path=self._path())
        if exe is None and name == "python":
            candidate = sys.executable
            if os.path.basename(candidate).lower().startswith("python"):
                exe = candidate
        if not exe:
            self._add(capability, CAT_CONFIG, NOT_INSTALLED, required,
                      f"'{name}' not found on PATH",
                      action=f"install {name} and expose it on PATH")
            return
        raw = self._run_version(exe)
        version = _parse_version(raw)
        if min_version and (version is None or version < tuple(int(x) for x in min_version)):
            wanted = ".".join(str(x) for x in min_version)
            self._add(capability, CAT_CONFIG, REQUIRES_CONFIGURATION, required,
                      f"{name} {raw or '?'} found at {exe}, below required {wanted}",
                      action=f"install {name} >= {wanted}")
            return
        self._add(capability, CAT_CONFIG, AVAILABLE, required,
                  f"{name} {raw or '?'} ({exe})")

    def _eval_lockfile(self, required: bool) -> None:
        path = os.path.join(self.repo_root, "package-lock.json")
        if os.path.isfile(path):
            self._add("node_lockfile", CAT_CONFIG, AVAILABLE, required,
                      "package-lock.json present (npm ci reproducible)")
        else:
            self._add("node_lockfile", CAT_CONFIG, REQUIRES_CONFIGURATION, required,
                      "package-lock.json missing", action="run npm install to generate the lockfile")

    def _eval_node_package(self, name: str, required: bool) -> None:
        pkg = os.path.join(self.repo_root, "node_modules", *name.split("/"), "package.json")
        if os.path.isfile(pkg):
            version = ""
            try:
                with open(pkg, encoding="utf-8") as fh:
                    version = json.load(fh).get("version", "")
            except (OSError, ValueError):
                version = ""
            self._add(f"node_package_{name}", CAT_CONFIG, AVAILABLE, required,
                      f"{name} {version} installed".strip())
        else:
            self._add(f"node_package_{name}", CAT_CONFIG, NOT_INSTALLED, required,
                      f"{name} not installed under node_modules", action="run npm ci")

    def _eval_playwright(self, required: bool) -> None:
        pkg = os.path.join(self.repo_root, "node_modules", "@playwright", "test", "package.json")
        has_config = any(
            os.path.isfile(os.path.join(self.repo_root, f"playwright.config.{ext}"))
            for ext in ("ts", "js", "mjs", "cjs")
        )
        if not os.path.isfile(pkg):
            self._add("adapter_playwright", CAT_ADAPTER, NOT_INSTALLED, required,
                      "@playwright/test not installed", action="run npm ci")
        elif not has_config:
            self._add("adapter_playwright", CAT_ADAPTER, REQUIRES_CONFIGURATION, required,
                      "@playwright/test installed but playwright.config.* is missing",
                      action="add a playwright.config.ts")
        else:
            self._add("adapter_playwright", CAT_ADAPTER, AVAILABLE, required,
                      "@playwright/test installed and configured")

    def _eval_tool(self, name: str, required: bool) -> None:
        exe = shutil.which(name, path=self._path())
        if exe:
            self._add(f"tool_{name}", CAT_TOOLS, AVAILABLE, required, f"{name} ({exe})")
        else:
            self._add(f"tool_{name}", CAT_TOOLS, NOT_INSTALLED, required,
                      f"'{name}' not found on PATH", action=f"install {name}")

    def _resolve_browsers_dir(self, configured: Optional[str]) -> str:
        if self.browsers_dir:
            return self.browsers_dir
        if configured:
            return configured if os.path.isabs(configured) else os.path.join(self.repo_root, configured)
        env_path = self.environ.get("PLAYWRIGHT_BROWSERS_PATH")
        if env_path and env_path != "0":
            return env_path
        system = platform.system()
        home = os.path.expanduser("~")
        if system == "Windows":
            base = self.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
            return os.path.join(base, "ms-playwright")
        if system == "Darwin":
            return os.path.join(home, "Library", "Caches", "ms-playwright")
        return os.path.join(home, ".cache", "ms-playwright")

    @staticmethod
    def _browser_installed(name: str, browsers_dir: str) -> Tuple[bool, str]:
        if not browsers_dir or not os.path.isdir(browsers_dir):
            return False, f"browsers directory '{browsers_dir}' not found"
        matches = sorted(glob.glob(os.path.join(browsers_dir, f"{name}-*")))
        if not matches:
            return False, f"no '{name}-*' installation in '{browsers_dir}'"
        return True, os.path.basename(matches[-1])

    def _eval_browsers(self, declared: List[str], need: Dict[str, Any]) -> None:
        browsers_dir = self._resolve_browsers_dir(need.get("browsers_dir"))
        order = list(declared) + [b for b in DEFAULT_BROWSER_INVENTORY if b not in declared]
        for name in order:
            required = name in declared
            installed, info = self._browser_installed(name, browsers_dir)
            if installed:
                self._add(f"browser_{name}", CAT_TOOLS, AVAILABLE, required,
                          f"{name} installed ({info}) in '{browsers_dir}'")
            else:
                self._add(f"browser_{name}", CAT_TOOLS, NOT_INSTALLED, required,
                          f"{name} not installed ({info})",
                          action=f"run: npx playwright install {name}")

    def _eval_target(self, cfg: Dict[str, Any]) -> Tuple[str, str, Optional[str]]:
        # HTTP probe semantics (M-04):
        #   - an accepted status (allowed_status, or < ok_status_max and not a
        #     denied code) is a *functional probe confirmation*: AVAILABLE/OK;
        #   - an HTTP 401/403/407/429 is a *denied probe*: it is never presented
        #     as functional accessibility. With `browser_fallback: true` it is
        #     recorded as PROBE_DENIED/WARN (non-blocking, access decided by the
        #     browser navigation evidence); otherwise it is BLOCKED;
        #   - a connection error / timeout is an *inconclusive probe*: with
        #     `browser_fallback: true` it is PROBE_INCONCLUSIVE/WARN; otherwise
        #     BLOCKED;
        #   - any other unexpected status stays BLOCKED in every policy.
        url = cfg.get("url")
        if isinstance(url, str) and url.strip():
            url = url.strip()
            method = str(cfg.get("method", "GET")).upper()
            try:
                timeout = min(max(int(cfg.get("timeout_ms", 3000)), 100), 30000) / 1000.0
            except (TypeError, ValueError):
                timeout = 3.0
            browser_fallback = cfg.get("browser_fallback") is True
            try:
                request = urllib.request.Request(url, method=method)
                try:
                    with urllib.request.urlopen(request, timeout=timeout) as response:
                        code = response.status
                except urllib.error.HTTPError as exc:
                    code = exc.code
            except (urllib.error.URLError, socket.timeout, ValueError, OSError) as exc:
                reason = getattr(exc, "reason", exc)
                if browser_fallback:
                    return (PROBE_INCONCLUSIVE,
                            f"{method} {url} probe inconclusive (no HTTP response): {reason}; "
                            "access to be confirmed by browser execution (browser_fallback)",
                            None)
                return (REQUIRES_CONFIGURATION, f"{method} {url} unreachable: {reason}",
                        "start the application/API or fix the target URL")
            allowed = cfg.get("allowed_status")
            if isinstance(allowed, list) and allowed:
                ok = code in allowed
            else:
                ok = code < int(cfg.get("ok_status_max", 499)) and code not in PROBE_DENIED_CODES
            if ok:
                return AVAILABLE, f"{method} {url} -> HTTP {code}", None
            if code in PROBE_DENIED_CODES:
                if browser_fallback:
                    return (PROBE_DENIED,
                            f"{method} {url} -> HTTP {code}: HTTP probe denied by the server; "
                            "access to be confirmed by browser execution (browser_fallback)",
                            None)
                return (REQUIRES_CONFIGURATION,
                        f"{method} {url} -> HTTP {code}: probe denied by the server "
                        "(not a functional confirmation)",
                        "declare need.target.browser_fallback: true to confirm accessibility "
                        "via the Playwright navigation, or point the target to an accessible URL")
            return (REQUIRES_CONFIGURATION,
                    f"{method} {url} -> HTTP {code} (unexpected status)",
                    "make the target respond with an expected status")
        host = cfg.get("host")
        port = cfg.get("port")
        if host and port:
            try:
                with socket.create_connection((str(host), int(port)), timeout=3):
                    return AVAILABLE, f"TCP {host}:{port} reachable", None
            except OSError as exc:
                return (REQUIRES_CONFIGURATION, f"TCP {host}:{port} unreachable: {exc}",
                        "start the service or fix host/port")
        return (REQUIRES_CONFIGURATION, "target required but not configured",
                "provide target.url or target.host/port")

    def _eval_env(self, capability: str, category: str, name: str, required: bool) -> None:
        present = name in self.environ and str(self.environ.get(name, "")).strip() != ""
        if present:
            # The value is never read, printed or stored: only its presence.
            self._add(capability, category, AVAILABLE, required,
                      f"environment variable '{name}' present (value redacted)")
        else:
            self._add(capability, category, REQUIRES_CONFIGURATION, required,
                      f"environment variable '{name}' not set",
                      action=f"provide environment variable {name}")

    def _load_test_data_record(self, item: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        rel = item.get("file")
        if not isinstance(rel, str) or not rel.strip():
            return None, "no record file provided"
        path = rel if os.path.isabs(rel) else os.path.join(self.repo_root, rel)
        if not os.path.isfile(path):
            return None, f"record file '{rel}' not found"
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as exc:
            return None, f"record file '{rel}' is not valid JSON: {exc}"
        records = data if isinstance(data, list) else [data]
        for record in records:
            if isinstance(record, dict) and str(record.get("data_id")) == str(item.get("data_id")):
                return record, None
        return None, f"data_id '{item.get('data_id')}' not found in '{rel}'"

    def _eval_test_data(self, item: Dict[str, Any], required: bool) -> None:
        data_id = item.get("data_id", "?")
        capability = f"test_data_{data_id}"
        record, error = self._load_test_data_record(item)
        if record is None:
            self._add(capability, CAT_TEST_DATA, REQUIRES_CONFIGURATION, required,
                      f"Test Data '{data_id}': {error}",
                      action="provide and validate the required Test Data")
            return
        state = record.get("state")
        validation = record.get("validation") or {}
        validated = validation.get("validated")
        usable = record.get("usable")
        evidence = validation.get("evidence") or []
        if state == "AVAILABLE" and validated is True and usable is True and len(evidence) >= 1:
            self._add(capability, CAT_TEST_DATA, AVAILABLE, required,
                      f"Test Data '{data_id}' AVAILABLE, validated and usable")
        else:
            self._add(capability, CAT_TEST_DATA, REQUIRES_CONFIGURATION, required,
                      f"Test Data '{data_id}' not usable (state={state}, validated={validated}, "
                      f"usable={usable}, evidence={len(evidence)})",
                      action="obtain/validate the Test Data before execution")

    def _eval_evidence(self, directory: str, required: bool) -> None:
        target = directory if os.path.isabs(directory) else os.path.join(self.repo_root, directory)
        if os.path.isfile(target):
            self._add("evidence_write", CAT_TOOLS, REQUIRES_CONFIGURATION, required,
                      f"'{directory}' is a file, not a directory",
                      action="point evidence_dir to a writable directory")
            return
        if not os.path.isdir(target):
            self._add("evidence_write", CAT_TOOLS, REQUIRES_CONFIGURATION, required,
                      f"evidence directory '{directory}' does not exist",
                      action="create the evidence directory")
            return
        probe = os.path.join(target, f".preflight_write_test_{os.getpid()}.tmp")
        try:
            with open(probe, "w", encoding="utf-8") as fh:
                fh.write("ok")
            os.remove(probe)
        except OSError as exc:
            self._add("evidence_write", CAT_TOOLS, REQUIRES_CONFIGURATION, required,
                      f"evidence directory '{directory}' is not writable: {exc}",
                      action="fix permissions on the evidence directory")
            return
        self._add("evidence_write", CAT_TOOLS, AVAILABLE, required,
                  f"evidence directory '{directory}' is writable")

    def _eval_reviewer(self, cfg: Dict[str, Any], required: bool) -> None:
        # The detector does not probe the reviewer: availability is a declarative
        # operator signal. A config-file mention is not enough, and a positive
        # declaration is identified as declarative, never as an automatic probe.
        risk = cfg.get("risk_level")
        base = f"risk_level={risk}" if risk else "risk_level not given"
        source = SOURCE_DECLARATIVE
        detail = ("Declarative operator signal only; the detector does not probe the QA "
                  "Reviewer. A mandatory review without sufficient evidence of availability "
                  "remains BLOCKED/UNVERIFIED.")
        signal = self.environ.get(REVIEWER_SIGNAL_ENV)
        if signal is None:
            self._add("qa_reviewer", CAT_ADAPTER, UNVERIFIED, required,
                      f"declarative signal {REVIEWER_SIGNAL_ENV} not set "
                      f"(availability not verified; no automatic probe); {base}",
                      action=("declare the QA Reviewer availability through "
                              f"{REVIEWER_SIGNAL_ENV} only after verifying it, or keep the "
                              "review BLOCKED/UNVERIFIED"),
                      detail=detail, availability_source=source)
            return
        value = signal.strip().lower()
        if value in ("1", "true", "yes", "available"):
            self._add("qa_reviewer", CAT_ADAPTER, AVAILABLE, required,
                      f"declarative signal {REVIEWER_SIGNAL_ENV}=1 "
                      f"(operator-declared; not automatically verified); {base}",
                      detail=detail, availability_source=source)
        elif value in ("0", "false", "no", "unavailable"):
            self._add("qa_reviewer", CAT_ADAPTER, REQUIRES_CONFIGURATION, required,
                      f"declarative signal reports the QA Reviewer unavailable "
                      f"({REVIEWER_SIGNAL_ENV}={signal}); {base}",
                      action="provide/enable the QA Reviewer mechanism and update the signal",
                      detail=detail, availability_source=source)
        else:
            self._add("qa_reviewer", CAT_ADAPTER, UNVERIFIED, required,
                      f"unrecognized value for {REVIEWER_SIGNAL_ENV} ('{signal}') "
                      f"(availability not verified; no automatic probe); {base}",
                      action=f"set {REVIEWER_SIGNAL_ENV} to 1/0 after verifying it",
                      detail=detail, availability_source=source)

    def _eval_auto_healing(self, cfg: Optional[Dict[str, Any]]) -> None:
        """M-05 controlled selector auto-healing (adapter capability).

        The engine is bundled with the Playwright adapter
        (automation/runner/healed.ts); its availability is declarative and the
        check validates that the suite correctly declares and configures the
        capability. It never probes the engine: correctness is proven by the
        produced auto-heal-record artifacts (M-01) and by the demo evidence.
        """
        detail = ("The auto-healing engine is bundled with the Playwright adapter "
                  "(automation/runner/healed.ts) and is available at run time. It only "
                  "selects locators: it never changes Expected Results, never converts FAIL "
                  "into PASS and never classifies a Bug. Every attempt is recorded in an "
                  "M-01-valid auto-heal-record artifact.")
        if cfg is None:
            self._add_not_required("auto_healing", CAT_CONFIG,
                                   "no auto-healing required by the task (M-05 opt-in)")
            return
        mode = cfg.get("mode")
        if mode not in ("OFF", "OBSERVE", "HIGH_CONFIDENCE"):
            self._add("auto_healing", CAT_CONFIG, REQUIRES_CONFIGURATION, True,
                      f"auto-healing mode '{mode}' is not OFF|OBSERVE|HIGH_CONFIDENCE",
                      action="declare requirements.need.auto_healing.mode as "
                             "OFF, OBSERVE or HIGH_CONFIDENCE",
                      detail=detail)
            return
        store = cfg.get("store")
        if store is not None and not isinstance(store, str):
            self._add("auto_healing", CAT_CONFIG, REQUIRES_CONFIGURATION, True,
                      "auto-healing store must be a string path",
                      action="set requirements.need.auto_healing.store to a writable path "
                             "(or omit it; default: <out>/autoheal_store.json)",
                      detail=detail)
            return
        if mode == "OFF":
            self._add("auto_healing", CAT_CONFIG, AVAILABLE, False,
                      "auto-healing declared but disabled (mode=OFF); the runner "
                      "executes without recovery and records NOT_ATTEMPTED traceability",
                      detail=detail, availability_source=SOURCE_DECLARATIVE)
        elif mode == "OBSERVE":
            self._add("auto_healing", CAT_CONFIG, AVAILABLE, True,
                      "auto-healing OBSERVE configured: candidates are identified and "
                      "recorded but never used",
                      detail=detail, availability_source=SOURCE_DECLARATIVE)
        else:
            self._add("auto_healing", CAT_CONFIG, AVAILABLE, True,
                      f"auto-healing HIGH_CONFIDENCE configured (store: {store or '<out>/autoheal_store.json'}); "
                      "recovery only applies strict criteria",
                      detail=detail, availability_source=SOURCE_DECLARATIVE)

    # -- orchestration ----------------------------------------------------- #
    def evaluate(self, req: Dict[str, Any]) -> None:
        need = req.get("need") or {}
        runtime = need.get("runtime") or {}

        self._eval_runtime("python", bool(runtime.get("python")), runtime.get("python_min"))
        self._eval_runtime("node", bool(runtime.get("node")), runtime.get("node_min"))
        self._eval_runtime("npm", bool(runtime.get("npm")), runtime.get("npm_min"))

        node_packages = list(need.get("node_packages") or [])
        adapters = list(need.get("adapters") or [])
        lock_required = bool(node_packages) or "playwright" in adapters or bool(runtime.get("node"))
        self._eval_lockfile(lock_required)
        for package in node_packages:
            self._eval_node_package(package, True)
        for adapter in adapters:
            if adapter == "playwright":
                self._eval_playwright(True)
            elif adapter == "http":
                self._add("adapter_http", CAT_ADAPTER, AVAILABLE, True,
                          "stdlib HTTP client available (urllib)")
            else:
                self._add(f"adapter_{adapter}", CAT_ADAPTER, NOT_INSTALLED, True,
                          f"unknown adapter '{adapter}'",
                          action="use a supported adapter id (playwright|http)")

        self._eval_browsers(list(need.get("browsers") or []), need)

        tools = list(need.get("tools") or [])
        if tools:
            for tool in tools:
                self._eval_tool(tool, True)
        else:
            self._add_not_required("tools_required", CAT_TOOLS, "no execution tools required by the task")

        target = need.get("target")
        if isinstance(target, dict) and target:
            state, observed, action = self._eval_target(target)
            detail = None
            if state in (PROBE_DENIED, PROBE_INCONCLUSIVE):
                detail = ("HTTP probe could not confirm functional access; the evidence of the "
                          "real browser navigation (execution flow) decides accessibility. This "
                          "check is a WARN and never stands for a Test Case PASS.")
            self._add("target_access", CAT_TARGET, state, True, observed, action=action, detail=detail)
        else:
            self._add_not_required("target_access", CAT_TARGET, "no target required by the task")

        credentials = list(need.get("credentials") or [])
        if credentials:
            for name in credentials:
                self._eval_env(f"credential_{name}", CAT_CREDENTIALS, name, True)
        else:
            self._add_not_required("credentials_required", CAT_CREDENTIALS,
                                   "no credentials required by the task")

        config = list(need.get("config") or [])
        if config:
            for name in config:
                self._eval_env(f"config_{name}", CAT_CONFIG, name, True)
        else:
            self._add_not_required("config_required", CAT_CONFIG,
                                   "no extra configuration required by the task")

        test_data = list(need.get("test_data") or [])
        if test_data:
            for item in test_data:
                self._eval_test_data(item, True)
        else:
            self._add_not_required("test_data_required", CAT_TEST_DATA,
                                   "no Test Data required by the task")

        self._eval_evidence(need.get("evidence_dir", "qa/evidence"),
                            bool(need.get("requires_evidence", True)))

        reviewer = need.get("qa_reviewer") or {}
        risk = reviewer.get("risk_level")
        required = reviewer.get("required")
        if required is None:
            required = risk in RISK_REQUIRING_REVIEWER
        self._eval_reviewer(reviewer, bool(required))

        self._eval_auto_healing(need.get("auto_healing"))

    def record(self, req: Dict[str, Any]) -> Dict[str, Any]:
        # PROBE_DENIED/PROBE_INCONCLUSIVE appear only under the explicit
        # `browser_fallback` policy: they are honest WARNs (access decided by
        # browser navigation evidence), never block, and never claim probe
        # confirmation. All other non-AVAILABLE required states block.
        pending_browser = (PROBE_DENIED, PROBE_INCONCLUSIVE)
        blocked = [c for c in self.checks if c.required
                   and c.observed_state not in (AVAILABLE,) + pending_browser]
        unverified = any(c.required and c.observed_state == UNVERIFIED for c in self.checks)
        pending = any(c.required and c.observed_state in pending_browser for c in self.checks)
        result = "BLOCKED" if blocked else "READY"
        confidence = "MEDIUM" if (unverified or pending) else "HIGH"

        reasons: List[str] = []
        for check in blocked:
            reason = f"[{check.category}] {check.capability}: {check.observed}"
            if check.action:
                reason += f"; action: {check.action}"
            reasons.append(reason)

        summary = {state: 0 for state in (AVAILABLE, REQUIRES_CONFIGURATION,
                                          NOT_INSTALLED, NOT_REQUIRED, UNVERIFIED,
                                          PROBE_DENIED, PROBE_INCONCLUSIVE)}
        for check in self.checks:
            summary[check.state] += 1

        task = req["task"]
        record: Dict[str, Any] = {
            "preflight_id": f"PF-{_slug(task)}-{_utc_stamp()}",
            "scope": req.get("scope") or task,
            "checks": [check.to_json() for check in self.checks],
            "result": result,
            "confidence": confidence,
            "notes": (f"M-04 pre-flight for '{task}' "
                      f"(platform={req.get('platform', 'n/a')}); {len(self.checks)} checks."),
            "task": task,
            "platform": req.get("platform"),
            "generated_at": _utc_iso(),
            "summary": summary,
            "environment": {"repo_root": self.repo_root, "platform": platform.system()},
        }
        if result == "BLOCKED":
            record["blocked_reasons"] = reasons
        return record


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def validate_requirements(req: Any) -> Dict[str, Any]:
    if not isinstance(req, dict):
        raise PreflightError("requirements must be a JSON object")
    task = req.get("task")
    if not isinstance(task, str) or not task.strip():
        raise PreflightError("requirements.task is required and must be a non-empty string")
    need = req.get("need", {})
    if need is None:
        need = {}
    if not isinstance(need, dict):
        raise PreflightError("requirements.need must be an object")
    for key in ("node_packages", "adapters", "browsers", "tools", "credentials", "config"):
        value = need.get(key, [])
        if value is not None and (not isinstance(value, list) or not all(isinstance(x, str) for x in value)):
            raise PreflightError(f"requirements.need.{key} must be an array of strings")
    if "test_data" in need and not isinstance(need["test_data"], list):
        raise PreflightError("requirements.need.test_data must be an array")
    for key in ("runtime", "target", "qa_reviewer", "auto_healing"):
        if key in need and need[key] is not None and not isinstance(need[key], dict):
            raise PreflightError(f"requirements.need.{key} must be an object")
    auto_healing = need.get("auto_healing")
    if isinstance(auto_healing, dict):
        ah_mode = auto_healing.get("mode")
        if ah_mode not in ("OFF", "OBSERVE", "HIGH_CONFIDENCE"):
            raise PreflightError("requirements.need.auto_healing.mode must be "
                                 "OFF, OBSERVE or HIGH_CONFIDENCE")
        ah_store = auto_healing.get("store")
        if ah_store is not None and not isinstance(ah_store, str):
            raise PreflightError("requirements.need.auto_healing.store must be a string path")
    target = need.get("target")
    if isinstance(target, dict):
        fallback = target.get("browser_fallback")
        if fallback is not None and not isinstance(fallback, bool):
            raise PreflightError("requirements.need.target.browser_fallback must be a boolean")
    req["need"] = need
    return req


def load_requirements(path: Optional[str]) -> Dict[str, Any]:
    if not path:
        raise PreflightError("no requirements file given (--requirements)")
    if not os.path.isfile(path):
        raise PreflightError(f"requirements file not found: {path}")
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        raise PreflightError(f"requirements file is not valid JSON: {exc}")


def run_preflight(requirements: Any, repo_root: str = REPO_ROOT,
                  environ: Optional[Dict[str, str]] = None,
                  browsers_dir: Optional[str] = None) -> Dict[str, Any]:
    req = validate_requirements(requirements)
    detector = Detector(repo_root=repo_root, environ=environ, browsers_dir=browsers_dir)
    detector.evaluate(req)
    return detector.record(req)


def validate_record(record: Dict[str, Any]) -> List[Any]:
    """Validate a produced record against the pre-flight-record contract (M-01)."""
    return ContractValidator().validate_record(record, "pre-flight-record", "<generated>")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _print_human(record: Dict[str, Any]) -> None:
    print(f"Pre-flight {record['preflight_id']}   task={record.get('task', '?')}")
    summary = record.get("summary", {})
    joined = "  ".join(f"{key}={value}" for key, value in summary.items())
    print(f"checks: {len(record['checks'])}   {joined}")
    for check in record["checks"]:
        print(f"  {check['status']:<14} {check.get('capability_state', ''):<24} "
              f"{check['capability']:<28} {check['observed']}")
    if record["result"] == "BLOCKED":
        print("")
        print("BLOCKED reasons:")
        for reason in record.get("blocked_reasons", []):
            print(f"  - {reason}")
    print("")
    print(f"RESULT: {record['result']}")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="preflight.py",
        description="Detect the capabilities a concrete QA task requires (M-04).",
    )
    parser.add_argument("--requirements", help="JSON file describing what the task needs")
    parser.add_argument("--out", help="write the produced pre-flight record to this file")
    parser.add_argument("--json", action="store_true", help="print the record as JSON")
    parser.add_argument("--no-validate", action="store_true",
                        help="skip the M-01 validation of the produced record")
    parser.add_argument("--repo-root", default=REPO_ROOT, help="repository root to inspect")
    parser.add_argument("--browsers-dir", default=None, help="override the Playwright browsers directory")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    try:
        raw = load_requirements(args.requirements)
        record = run_preflight(raw, repo_root=args.repo_root,
                               browsers_dir=args.browsers_dir)
    except (PreflightError, OSError, ValueError) as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2

    if not args.no_validate:
        try:
            findings = validate_record(record)
        except (ValidatorError, OSError, ValueError) as exc:
            print(f"FATAL: contract self-check failed: {exc}", file=sys.stderr)
            return 2
        if findings:
            print("FATAL: generated pre-flight record does not satisfy the "
                  "pre-flight-record contract:", file=sys.stderr)
            for finding in findings:
                print(f"  - {finding.field} [{finding.keyword}] {finding.reason}", file=sys.stderr)
            return 2

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2, ensure_ascii=False)

    if args.json:
        print(json.dumps(record, indent=2, ensure_ascii=False))
    else:
        _print_human(record)
    return 0 if record["result"] == "READY" else 1


if __name__ == "__main__":
    sys.exit(main())
