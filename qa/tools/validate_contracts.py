#!/usr/bin/env python3
"""QA contract validator (M-01).

Validates QA artifacts in qa/ against the JSON Schemas in qa/schema/, using a
self-contained subset of JSON Schema (Draft 2020-12). No third-party
dependencies: it only needs Python 3 (the runtime available in this project).

Before validating artifacts it self-checks every schema: a schema that uses a
standard JSON Schema keyword the engine does not implement, or an invalid
`type` name, aborts startup with an explicit error (D1), so no artifact can be
reported VALID under a rule that was not actually evaluated.

The validator is read-only. It never rewrites, fixes, reclassifies or
transforms an artifact: an invalid FAIL stays a FAIL, a NON-confirmed Bug is
never promoted, and a verdict is never turned into ACCEPT.

Usage:
    python qa/tools/validate_contracts.py --list
    python qa/tools/validate_contracts.py --contract test-case --file qa/tests/dcshoes_tc.json
    python qa/tools/validate_contracts.py --bundle qa/
    python qa/tools/validate_contracts.py --bundle qa/ --json
    python qa/tools/validate_contracts.py --bundle qa/ --check-evidence

Exit codes:
    0  all artifacts valid (warnings allowed)
    1  at least one validation error
    2  fatal usage/IO error
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_DIR = os.path.normpath(os.path.join(HERE, "..", "schema"))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
INDEX_FILE = os.path.join(SCHEMA_DIR, "index.json")

# Directories that must never be treated as QA artifacts during discovery.
DISCOVERY_EXCLUDE_DIRS = {"schema", "tools", "__pycache__", ".git", "node_modules"}
DISCOVERY_EXCLUDE_FILES = {"index.json"}


class ValidatorError(Exception):
    """Fatal configuration/usage error."""


# --------------------------------------------------------------------------- #
# Findings
# --------------------------------------------------------------------------- #
@dataclass
class Finding:
    contract: str
    artifact: str
    path: str          # JSON Pointer-ish location, e.g. /test_cases/2/confidence
    field: str         # Human location, e.g. test_cases[2].confidence
    keyword: str       # Schema keyword or QA rule that failed
    reason: str        # Human explanation
    severity: str = "error"   # "error" | "warning"

    def to_dict(self) -> Dict[str, str]:
        return {
            "contract": self.contract,
            "artifact": self.artifact,
            "path": self.path,
            "field": self.field,
            "keyword": self.keyword,
            "reason": self.reason,
            "severity": self.severity,
        }


@dataclass
class ArtifactResult:
    contract: str
    artifact: str
    findings: List[Finding] = field(default_factory=list)
    record_count: int = 0
    record_items: List[Tuple[str, Dict[str, Any]]] = field(default_factory=list)

    @property
    def errors(self) -> List[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> List[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def valid(self) -> bool:
        return len(self.errors) == 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "contract": self.contract,
            "artifact": self.artifact,
            "status": "valid" if self.valid else "invalid",
            "records": self.record_count,
            "errors": [f.to_dict() for f in self.errors],
            "warnings": [f.to_dict() for f in self.warnings],
        }


@dataclass
class BundleResult:
    results: List[ArtifactResult] = field(default_factory=list)
    reference_findings: List[Finding] = field(default_factory=list)

    @property
    def all_findings(self) -> List[Finding]:
        out: List[Finding] = []
        for r in self.results:
            out.extend(r.findings)
        out.extend(self.reference_findings)
        return out

    @property
    def errors(self) -> List[Finding]:
        return [f for f in self.all_findings if f.severity == "error"]

    @property
    def warnings(self) -> List[Finding]:
        return [f for f in self.all_findings if f.severity == "warning"]

    @property
    def valid(self) -> bool:
        return len(self.errors) == 0

    def summary(self) -> Dict[str, int]:
        return {
            "artifacts": len(self.results),
            "records": sum(r.record_count for r in self.results),
            "errors": len(self.errors),
            "warnings": len(self.warnings),
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "summary": self.summary(),
            "results": [r.to_dict() for r in self.results],
            "reference_findings": [f.to_dict() for f in self.reference_findings],
        }


# --------------------------------------------------------------------------- #
# JSON helpers
# --------------------------------------------------------------------------- #
def _escape_token(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _json_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _matches_type(value: Any, expected: Any) -> bool:
    if isinstance(expected, list):
        return any(_matches_type(value, t) for t in expected)
    return {
        "null": value is None,
        "boolean": isinstance(value, bool),
        "string": isinstance(value, str),
        "number": _is_number(value),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "array": isinstance(value, list),
        "object": isinstance(value, dict),
    }.get(expected, False)


def _jequal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_number(a) and _is_number(b):
        return a == b
    if isinstance(a, (list, dict)) or isinstance(b, (list, dict)):
        try:
            return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
        except (TypeError, ValueError):
            return a == b
    return a == b and type(a) is type(b)


def _join_field(base: str, token: str) -> str:
    if base == "$":
        return token
    return f"{base}.{token}"


def _pointer_to_field(pointer: str) -> str:
    """Convert a JSON pointer like /test_cases/0/confidence to test_cases[0].confidence."""
    field = "$"
    for raw in pointer.strip("/").split("/"):
        if raw == "":
            continue
        token = raw.replace("~1", "/").replace("~0", "~")
        if token.isdigit():
            field = f"{field}[{token}]" if field != "$" else f"[{token}]"
        else:
            field = token if field == "$" else f"{field}.{token}"
    return field


# --------------------------------------------------------------------------- #
# Schema self-check (D1): supported vocabulary
# --------------------------------------------------------------------------- #
# Validation keywords actually implemented by the engine's _walk(). If a schema
# uses any other *standard* JSON Schema validation keyword, the rule would be
# silently skipped, so the self-check rejects the schema instead.
SUPPORTED_VALIDATION_KEYWORDS = {
    "$ref", "type", "const", "enum",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "minLength", "maxLength", "pattern",
    "minItems", "maxItems", "uniqueItems", "items",
    "minProperties", "maxProperties", "required",
    "properties", "additionalProperties",
    "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
}

# Annotation keywords carry no validation semantics: safe to ignore.
ALLOWED_ANNOTATION_KEYWORDS = {
    "$schema", "$id", "$vocabulary", "$comment",
    "title", "description", "default", "deprecated", "readOnly",
    "writeOnly", "examples",
}

# Container/shape keywords whose values are themselves schemas.
SCHEMA_MAP_KEYWORDS = {"properties", "$defs"}        # object: name -> schema
SCHEMA_LIST_KEYWORDS = {"allOf", "anyOf", "oneOf"}   # array of schemas
SCHEMA_SINGLE_KEYWORDS = {"not", "if", "then", "else"}  # a single schema

# Standard JSON Schema keywords this engine does NOT implement. Using them
# would silence a rule, so they are rejected explicitly (D1). Kept separate from
# custom extensions below so a genuine standard constraint is never confused
# with an intentional, namespaced extension.
UNSUPPORTED_STANDARD_KEYWORDS = {
    "patternProperties", "propertyNames", "contains", "minContains", "maxContains",
    "prefixItems", "unevaluatedProperties", "unevaluatedItems",
    "dependentSchemas", "dependentRequired", "dependencies",
    "multipleOf", "format",
    "contentEncoding", "contentMediaType", "contentSchema",
    "$dynamicRef", "$dynamicAnchor", "$recursiveRef", "$recursiveAnchor",
    "$anchor",
    "definitions",
}

# Custom extensions must be namespaced with this prefix. Any other unknown key
# at a schema position is treated as an error (likely a typo or an unsupported
# rule), never silently ignored.
EXTENSION_PREFIX = "x-"

# JSON types the engine recognises in a "type" keyword (single or combined).
ALLOWED_TYPE_NAMES = {"null", "boolean", "object", "array", "number", "string", "integer"}


@dataclass
class SchemaIssue:
    """A problem inside a *schema* (not an artifact)."""

    schema: str     # schema document name
    location: str   # JSON Pointer within the schema, e.g. /properties/status
    keyword: str    # offending keyword
    reason: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "schema": self.schema,
            "location": self.location,
            "keyword": self.keyword,
            "reason": self.reason,
        }

    def __str__(self) -> str:
        return f"{self.schema} {self.location or '/'} [{self.keyword}] {self.reason}"


def _check_type_keyword(value: Any, schema_name: str, location: str) -> List["SchemaIssue"]:
    issues: List[SchemaIssue] = []
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        if not value:
            issues.append(SchemaIssue(schema_name, location, "type",
                                      "'type' array must not be empty"))
            return issues
        if not all(isinstance(v, str) for v in value):
            issues.append(SchemaIssue(schema_name, location, "type",
                                      "'type' array items must be strings"))
            return issues
        values = value
    else:
        issues.append(SchemaIssue(schema_name, location, "type",
                                  "'type' must be a string or an array of strings"))
        return issues
    for name in values:
        if name not in ALLOWED_TYPE_NAMES:
            allowed = ", ".join(sorted(ALLOWED_TYPE_NAMES))
            issues.append(SchemaIssue(
                schema_name, location, "type",
                f"unknown JSON Schema type '{name}'; allowed: {allowed}"))
    return issues


def _verify_schema_node(node: Any, schema_name: str, location: str,
                        issues: List["SchemaIssue"]) -> None:
    if not isinstance(node, dict):
        issues.append(SchemaIssue(
            schema_name, location, "schema",
            f"schema node must be an object, got {_json_type_name(node)}"))
        return
    for key, value in node.items():
        child = f"{location}/{_escape_token(key)}"
        if key in SCHEMA_MAP_KEYWORDS:
            if not isinstance(value, dict):
                issues.append(SchemaIssue(
                    schema_name, child, key,
                    f"'{key}' must be an object mapping names to schemas"))
                continue
            for name, sub in value.items():
                _verify_schema_node(sub, schema_name, f"{child}/{_escape_token(name)}", issues)
        elif key in SCHEMA_LIST_KEYWORDS:
            if not isinstance(value, list) or not value:
                issues.append(SchemaIssue(
                    schema_name, child, key,
                    f"'{key}' must be a non-empty array of schemas"))
                continue
            for i, sub in enumerate(value):
                _verify_schema_node(sub, schema_name, f"{child}/{i}", issues)
        elif key == "items":
            if isinstance(value, list):
                issues.append(SchemaIssue(
                    schema_name, child, "items",
                    "tuple form (array) for 'items' is not supported; "
                    "prefixItems is not implemented"))
            elif not isinstance(value, dict):
                issues.append(SchemaIssue(
                    schema_name, child, "items", "'items' must be a schema object"))
            else:
                _verify_schema_node(value, schema_name, child, issues)
        elif key == "additionalProperties":
            if isinstance(value, bool):
                continue
            if isinstance(value, dict):
                _verify_schema_node(value, schema_name, child, issues)
            else:
                issues.append(SchemaIssue(
                    schema_name, child, "additionalProperties",
                    "'additionalProperties' must be a boolean or a schema object"))
        elif key in SCHEMA_SINGLE_KEYWORDS:
            if not isinstance(value, dict):
                issues.append(SchemaIssue(
                    schema_name, child, key, f"'{key}' must be a schema object"))
            else:
                _verify_schema_node(value, schema_name, child, issues)
        elif key == "type":
            issues.extend(_check_type_keyword(value, schema_name, child))
        elif key in SUPPORTED_VALIDATION_KEYWORDS:
            # Scalar constraint already implemented by the engine.
            continue
        elif key in ALLOWED_ANNOTATION_KEYWORDS:
            continue
        elif key in UNSUPPORTED_STANDARD_KEYWORDS:
            issues.append(SchemaIssue(
                schema_name, child, key,
                f"standard JSON Schema keyword '{key}' is not implemented by "
                "this validator; it cannot be silently ignored"))
        elif isinstance(key, str) and key.startswith(EXTENSION_PREFIX):
            # Explicit, documented custom extension: intentionally ignored.
            continue
        else:
            issues.append(SchemaIssue(
                schema_name, child, str(key),
                f"unknown schema keyword '{key}'; custom extensions must use "
                f"the '{EXTENSION_PREFIX}' prefix"))


def verify_schema(schema: Any, schema_name: str = "<schema>") -> List[SchemaIssue]:
    """Return the list of self-check issues for one schema document."""
    issues: List[SchemaIssue] = []
    _verify_schema_node(schema, schema_name, "", issues)
    return issues


# --------------------------------------------------------------------------- #
# Schema store
# --------------------------------------------------------------------------- #
class SchemaStore:
    def __init__(self, schema_dir: str = SCHEMA_DIR):
        self.schema_dir = schema_dir
        self.index = self._load_json(INDEX_FILE)
        self.docs: Dict[str, Any] = {}
        for name in os.listdir(schema_dir):
            if name.endswith(".schema.json"):
                self.docs[name] = self._load_json(os.path.join(schema_dir, name))

    @staticmethod
    def _load_json(path: str) -> Any:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    @property
    def contracts(self) -> Dict[str, Any]:
        return self.index.get("contracts", {})

    @property
    def hints(self) -> Dict[str, str]:
        return self.index.get("artifact_hints", {})

    @property
    def wrapper_hints(self) -> Dict[str, str]:
        return self.index.get("wrapper_hints", {})

    @property
    def references(self) -> List[Dict[str, Any]]:
        return self.index.get("references", [])

    def doc(self, name: str) -> Any:
        if name not in self.docs:
            raise ValidatorError(f"schema document not found: {name}")
        return self.docs[name]

    def verify(self) -> List[SchemaIssue]:
        """Self-check every loaded schema against the supported vocabulary (D1)."""
        issues: List[SchemaIssue] = []
        for name in sorted(self.docs):
            issues.extend(verify_schema(self.docs[name], name))
        return issues

    def resolve(self, ref: str, base_name: str) -> Tuple[Any, str]:
        if ref.startswith("#"):
            return self.doc(base_name), ref[1:]
        if "#" in ref:
            name, _, fragment = ref.partition("#")
            return self.doc(name), fragment
        if ref in self.docs:
            return self.doc(ref), ""
        raise ValidatorError(f"cannot resolve $ref '{ref}' (base {base_name})")

    def pointer(self, doc: Any, pointer: str) -> Any:
        if pointer in ("", "/"):
            return doc
        current = doc
        for raw in pointer.lstrip("/").split("/"):
            token = raw.replace("~1", "/").replace("~0", "~")
            if isinstance(current, list):
                current = current[int(token)]
            else:
                current = current[token]
        return current


# --------------------------------------------------------------------------- #
# Validator engine (JSON Schema subset)
# --------------------------------------------------------------------------- #
class Validator:
    def __init__(self, store: SchemaStore):
        self.store = store

    def validate(self, instance: Any, schema: Dict[str, Any], base_name: str,
                 contract: str, artifact: str,
                 path: str = "", field: str = "$") -> List[Finding]:
        out: List[Finding] = []
        self._walk(instance, schema, base_name, contract, artifact, path, field, out)
        return out

    # -- internal ---------------------------------------------------------- #
    def _err(self, out, contract, artifact, path, field, keyword, reason):
        out.append(Finding(contract, artifact, path, field, keyword, reason))

    def _is_valid(self, instance, schema, base_name) -> bool:
        tmp: List[Finding] = []
        self._walk(instance, schema, base_name, "?", "?", "", "$", tmp)
        return len(tmp) == 0

    def _walk(self, inst, schema, base_name, contract, artifact,
              path, field, out) -> None:
        if not isinstance(schema, dict):
            return

        if "$ref" in schema:
            ref_doc, pointer = self.store.resolve(schema["$ref"], base_name)
            target = self.store.pointer(ref_doc, pointer)
            ref_name = schema["$ref"].partition("#")[0] or base_name
            self._walk(inst, target, ref_name, contract, artifact, path, field, out)

        if "type" in schema and not _matches_type(inst, schema["type"]):
            expected = schema["type"]
            self._err(out, contract, artifact, path, field, "type",
                      f"expected type {expected}, got {_json_type_name(inst)}")
            return

        if "const" in schema and not _jequal(inst, schema["const"]):
            self._err(out, contract, artifact, path, field, "const",
                      f"expected constant value {json.dumps(schema['const'])}, got {json.dumps(inst)}")

        if "enum" in schema and not any(_jequal(inst, option) for option in schema["enum"]):
            self._err(out, contract, artifact, path, field, "enum",
                      f"{json.dumps(inst)} is not one of {json.dumps(schema['enum'])}")

        if _is_number(inst):
            if "minimum" in schema and inst < schema["minimum"]:
                self._err(out, contract, artifact, path, field, "minimum",
                          f"{inst} is less than minimum {schema['minimum']}")
            if "maximum" in schema and inst > schema["maximum"]:
                self._err(out, contract, artifact, path, field, "maximum",
                          f"{inst} is greater than maximum {schema['maximum']}")
            if "exclusiveMinimum" in schema and inst <= schema["exclusiveMinimum"]:
                self._err(out, contract, artifact, path, field, "exclusiveMinimum",
                          f"{inst} must be greater than {schema['exclusiveMinimum']}")
            if "exclusiveMaximum" in schema and inst >= schema["exclusiveMaximum"]:
                self._err(out, contract, artifact, path, field, "exclusiveMaximum",
                          f"{inst} must be less than {schema['exclusiveMaximum']}")

        if isinstance(inst, str):
            if "minLength" in schema and len(inst) < schema["minLength"]:
                self._err(out, contract, artifact, path, field, "minLength",
                          f"string is shorter than minLength {schema['minLength']}")
            if "maxLength" in schema and len(inst) > schema["maxLength"]:
                self._err(out, contract, artifact, path, field, "maxLength",
                          f"string is longer than maxLength {schema['maxLength']}")
            if "pattern" in schema and not re.search(schema["pattern"], inst):
                self._err(out, contract, artifact, path, field, "pattern",
                          f"{json.dumps(inst)} does not match pattern {schema['pattern']}")

        if isinstance(inst, list):
            if "minItems" in schema and len(inst) < schema["minItems"]:
                self._err(out, contract, artifact, path, field, "minItems",
                          f"array has {len(inst)} items, expected at least {schema['minItems']}")
            if "maxItems" in schema and len(inst) > schema["maxItems"]:
                self._err(out, contract, artifact, path, field, "maxItems",
                          f"array has {len(inst)} items, expected at most {schema['maxItems']}")
            if schema.get("uniqueItems"):
                seen = []
                for i, item in enumerate(inst):
                    if any(_jequal(item, s) for s in seen):
                        self._err(out, contract, artifact, f"{path}/{i}", f"{field}[{i}]",
                                  "uniqueItems", "duplicate array item")
                    seen.append(item)
            items = schema.get("items")
            if isinstance(items, dict):
                for i, item in enumerate(inst):
                    self._walk(item, items, base_name, contract, artifact,
                               f"{path}/{i}", f"{field}[{i}]", out)

        if isinstance(inst, dict):
            props = schema.get("properties", {})
            if "minProperties" in schema and len(inst) < schema["minProperties"]:
                self._err(out, contract, artifact, path, field, "minProperties",
                          f"object has {len(inst)} properties, expected at least {schema['minProperties']}")
            if "maxProperties" in schema and len(inst) > schema["maxProperties"]:
                self._err(out, contract, artifact, path, field, "maxProperties",
                          f"object has {len(inst)} properties, expected at most {schema['maxProperties']}")
            for req in schema.get("required", []):
                if req not in inst:
                    self._err(out, contract, artifact, f"{path}/{_escape_token(req)}",
                              _join_field(field, req), "required",
                              f"required property '{req}' is missing")
            for key, subschema in props.items():
                if key in inst:
                    self._walk(inst[key], subschema, base_name, contract, artifact,
                               f"{path}/{_escape_token(key)}", _join_field(field, key), out)
            if "additionalProperties" in schema:
                ap = schema["additionalProperties"]
                for key, value in inst.items():
                    if key in props:
                        continue
                    if ap is False:
                        self._err(out, contract, artifact, f"{path}/{_escape_token(key)}",
                                  _join_field(field, key), "additionalProperties",
                                  f"unexpected property '{key}'")
                    elif isinstance(ap, dict):
                        self._walk(value, ap, base_name, contract, artifact,
                                   f"{path}/{_escape_token(key)}", _join_field(field, key), out)

        for sub in schema.get("allOf", []):
            self._walk(inst, sub, base_name, contract, artifact, path, field, out)

        if "anyOf" in schema:
            if not any(self._is_valid(inst, sub, base_name) for sub in schema["anyOf"]):
                self._err(out, contract, artifact, path, field, "anyOf",
                          "value does not satisfy any of the alternatives in anyOf")

        if "oneOf" in schema:
            matches = sum(1 for sub in schema["oneOf"] if self._is_valid(inst, sub, base_name))
            if matches != 1:
                self._err(out, contract, artifact, path, field, "oneOf",
                          f"value matches {matches} of the oneOf schemas (expected exactly 1)")

        if "not" in schema and self._is_valid(inst, schema["not"], base_name):
            self._err(out, contract, artifact, path, field, "not",
                      "value must not match the 'not' schema")

        if "if" in schema:
            if self._is_valid(inst, schema["if"], base_name):
                if "then" in schema:
                    self._walk(inst, schema["then"], base_name, contract, artifact, path, field, out)
            elif "else" in schema:
                self._walk(inst, schema["else"], base_name, contract, artifact, path, field, out)


# --------------------------------------------------------------------------- #
# Artifact loading / contract detection
# --------------------------------------------------------------------------- #
def _read_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def detect_contract(data: Any, store: SchemaStore) -> Optional[str]:
    if isinstance(data, dict):
        for key, contract in store.wrapper_hints.items():
            if key in data and isinstance(data[key], list):
                return contract
        for key, contract in store.hints.items():
            if key in data:
                return contract
        return None
    if isinstance(data, list) and data and isinstance(data[0], dict):
        for key, contract in store.hints.items():
            if key in data[0]:
                return contract
    return None


def extract_records(data: Any, contract: str, store: SchemaStore,
                    artifact: str) -> Tuple[List[Tuple[str, Dict[str, Any]]], List[Finding]]:
    cfg = store.contracts[contract]
    shape = cfg.get("shape", "record")
    findings: List[Finding] = []
    items: List[Tuple[str, Dict[str, Any]]] = []

    if shape == "wrapper":
        records_key = cfg["records_key"]
        if not isinstance(data, dict):
            findings.append(Finding(contract, artifact, "", "$", "shape",
                                    f"expected a wrapper object with '{records_key}', got {_json_type_name(data)}"))
            return items, findings
        for req in cfg.get("wrapper_required", []):
            if req not in data:
                findings.append(Finding(contract, artifact, f"/{_escape_token(req)}", req,
                                        "wrapper_required", f"wrapper is missing required key '{req}'"))
        records = data.get(records_key)
        if not isinstance(records, list):
            findings.append(Finding(contract, artifact, f"/{_escape_token(records_key)}", records_key,
                                    "shape", f"'{records_key}' must be an array"))
            return items, findings
        for i, rec in enumerate(records):
            items.append((f"/{_escape_token(records_key)}/{i}", rec))
        return items, findings

    if shape in ("record-or-array", "array"):
        if isinstance(data, list):
            for i, rec in enumerate(data):
                items.append((f"/{i}", rec))
        else:
            items.append(("", data))
        return items, findings

    # single record
    items.append(("", data))
    return items, findings


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
class ContractValidator:
    def __init__(self, schema_dir: str = SCHEMA_DIR, repo_root: str = REPO_ROOT):
        self.store = SchemaStore(schema_dir)
        self.schema_issues = self.store.verify()
        if self.schema_issues:
            details = "\n".join(f"  - {issue}" for issue in self.schema_issues)
            raise ValidatorError(
                "schema self-check failed (unsupported or invalid keywords, D1):\n"
                + details)
        self.validator = Validator(self.store)
        self.repo_root = repo_root

    def list_contracts(self) -> List[str]:
        return sorted(self.store.contracts)

    def validate_record(self, record: Any, contract: str,
                        artifact: str = "<inline>") -> List[Finding]:
        cfg = self.store.contracts.get(contract)
        if cfg is None:
            raise ValidatorError(f"unknown contract '{contract}'")
        schema = self.store.doc(cfg["schema"])
        return self.validator.validate(record, schema, cfg["schema"], contract, artifact)

    def validate_artifact(self, path: str, contract: Optional[str] = None) -> ArtifactResult:
        data = _read_json(path)
        artifact = path
        if contract is None:
            contract = detect_contract(data, self.store)
            if contract is None:
                return ArtifactResult(
                    contract="unknown", artifact=artifact,
                    findings=[Finding("unknown", artifact, "", "$", "detect",
                                      "could not determine the contract for this artifact", "warning")],
                )
        if contract not in self.store.contracts:
            raise ValidatorError(f"unknown contract '{contract}' for artifact {path}")

        result = ArtifactResult(contract=contract, artifact=artifact)
        items, findings = extract_records(data, contract, self.store, artifact)
        result.findings.extend(findings)
        result.record_count = len(items)
        result.record_items = items
        for base_path, record in items:
            result.findings.extend(self._validate_one(record, contract, artifact, base_path))
        return result

    def _validate_one(self, record: Any, contract: str, artifact: str,
                      base_path: str) -> List[Finding]:
        cfg = self.store.contracts[contract]
        schema = self.store.doc(cfg["schema"])
        field = _pointer_to_field(base_path)
        return self.validator.validate(record, schema, cfg["schema"],
                                       contract, artifact, base_path, field)

    def validate_bundle(self, paths: List[str], check_evidence: bool = False) -> BundleResult:
        bundle = BundleResult()
        files: List[str] = []
        for p in paths:
            if os.path.isdir(p):
                files.extend(self._discover(p))
            else:
                files.append(p)
        files = sorted(dict.fromkeys(files))

        collected: Dict[str, List[Tuple[str, str, Dict[str, Any]]]] = {}
        for path in files:
            try:
                result = self.validate_artifact(path)
            except (OSError, ValueError) as exc:
                bundle.results.append(ArtifactResult(
                    contract="unknown", artifact=path,
                    findings=[Finding("unknown", path, "", "$", "load",
                                      f"could not read/parse artifact: {exc}", "warning")],
                ))
                continue
            bundle.results.append(result)
            if result.contract in self.store.contracts:
                for base_path, record in result.record_items:
                    collected.setdefault(result.contract, []).append(
                        (result.artifact, base_path, record))

        bundle.reference_findings.extend(self._check_references(collected))
        if check_evidence:
            bundle.reference_findings.extend(self._check_evidence(collected))
        return bundle

    def _discover(self, directory: str) -> List[str]:
        found: List[str] = []
        for root, dirs, names in os.walk(directory):
            dirs[:] = [d for d in dirs if d not in DISCOVERY_EXCLUDE_DIRS]
            for name in names:
                if not name.endswith(".json"):
                    continue
                if name.endswith(".schema.json") or name in DISCOVERY_EXCLUDE_FILES:
                    continue
                found.append(os.path.join(root, name))
        return found

    def _check_references(self, collected: Dict[str, List[Tuple[str, str, Dict[str, Any]]]]
                          ) -> List[Finding]:
        # Every known contract gets a (possibly empty) id set: if the target
        # contract is absent from the bundle, any reference to it is dangling.
        id_index: Dict[str, set] = {name: set() for name in self.store.contracts}
        for contract, items in collected.items():
            id_key = self.store.contracts[contract].get("id_key")
            for _artifact, _base, record in items:
                if id_key and isinstance(record, dict) and record.get(id_key) is not None:
                    id_index[contract].add(str(record[id_key]))

        findings: List[Finding] = []
        for rule in self.store.references:
            from_contract = rule["from"]
            to_contract = rule["to"]
            rel_path = rule["path"]
            if from_contract not in collected:
                continue
            for artifact, base_path, record in collected.get(from_contract, []):
                for value in self._extract_values(record, rel_path):
                    if not isinstance(value, str) or value == "":
                        continue
                    if value not in id_index[to_contract]:
                        rel_tokens = rel_path.rstrip("[]").replace(".", "/")
                        findings.append(Finding(
                            from_contract, artifact,
                            f"{base_path}/{rel_tokens}",
                            _pointer_to_field(f"{base_path}/{rel_tokens}"),
                            "reference",
                            f"'{value}' does not resolve to any {to_contract} id",
                        ))
        return findings

    @staticmethod
    def _extract_values(record: Any, rel_path: str) -> List[Any]:
        if not isinstance(record, dict):
            return []
        singular = rel_path.endswith("[]")
        key_path = rel_path[:-2] if singular else rel_path
        current: Any = record
        for token in key_path.split("."):
            if isinstance(current, dict) and token in current:
                current = current[token]
            else:
                return []
        if singular:
            return list(current) if isinstance(current, list) else []
        if current in (None, "", []):
            return []
        return [current]

    def _check_evidence(self, collected: Dict[str, List[Tuple[str, str, Dict[str, Any]]]]
                        ) -> List[Finding]:
        findings: List[Finding] = []
        seen = set()
        for contract, items in collected.items():
            for artifact, base_path, record in items:
                for ref in self._iter_evidence(record):
                    candidate = self._evidence_path(ref)
                    if not candidate:
                        continue
                    key = (artifact, candidate)
                    if key in seen:
                        continue
                    seen.add(key)
                    if not os.path.exists(os.path.join(self.repo_root, candidate)):
                        findings.append(Finding(
                            contract, artifact, base_path, base_path or "$",
                            "evidence_exists",
                            f"referenced evidence path does not exist: {candidate}",
                            "warning",
                        ))
        return findings

    @staticmethod
    def _iter_evidence(node: Any):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("evidence", "evidence_refs", "evidence_references") and isinstance(value, list):
                    for item in value:
                        if isinstance(item, str):
                            yield item
                        elif isinstance(item, dict) and isinstance(item.get("path"), str):
                            yield item["path"]
                else:
                    yield from ContractValidator._iter_evidence(value)
        elif isinstance(node, list):
            for item in node:
                yield from ContractValidator._iter_evidence(item)

    @staticmethod
    def _evidence_path(reference: str) -> Optional[str]:
        token = reference.strip()
        token = re.split(r"\s+\(", token)[0].strip()
        if not token:
            return None
        lower = token.lower()
        if lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".json",
                           ".txt", ".log", ".md", ".html", ".har", ".zip")):
            return token.replace("\\", "/")
        if token.startswith(("qa/", "tests/", "./")):
            return token.replace("\\", "/")
        return None


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _print_human(bundle: BundleResult) -> None:
    summary = bundle.summary()
    print("QA contract validation")
    print(f"schema dir: {os.path.relpath(SCHEMA_DIR, REPO_ROOT).replace(os.sep, '/')}")
    print(f"artifacts: {summary['artifacts']}   records: {summary['records']}   "
          f"errors: {summary['errors']}   warnings: {summary['warnings']}")
    print("")
    for result in bundle.results:
        status = "VALID  " if result.valid else "INVALID"
        print(f"[{status}] {result.contract:<26} {result.artifact}  ({result.record_count} records)")
        for finding in result.errors:
            print(f"    error    {finding.keyword:<18} {finding.path or '/'}  ({finding.field})")
            print(f"             {finding.reason}")
        for finding in result.warnings:
            print(f"    warning  {finding.keyword:<18} {finding.path or '/'}  ({finding.field})")
            print(f"             {finding.reason}")
    for finding in bundle.reference_findings:
        print(f"    {'error' if finding.severity == 'error' else 'warning'}    "
              f"{finding.keyword:<18} {finding.artifact} {finding.path}  ({finding.field})")
        print(f"             {finding.reason}")
    print("")
    print("RESULT: " + ("VALID" if bundle.valid else "INVALID"))


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="validate_contracts.py",
        description="Validate QA artifacts against the contract JSON Schemas (M-01).",
    )
    parser.add_argument("--list", action="store_true", help="list available contracts and exit")
    parser.add_argument("--contract", help="contract name to validate against (see --list)")
    parser.add_argument("--file", action="append", default=[], help="artifact file to validate (repeatable)")
    parser.add_argument("--bundle", action="append", default=[],
                        help="directory or file set to validate as a bundle with reference checks (repeatable)")
    parser.add_argument("--check-evidence", action="store_true",
                        help="also check that referenced evidence paths exist (warnings)")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--schema-dir", default=SCHEMA_DIR, help="override the schema directory")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    try:
        validator = ContractValidator(schema_dir=args.schema_dir)
    except (ValidatorError, OSError, ValueError) as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2

    if args.list:
        for name in validator.list_contracts():
            cfg = validator.store.contracts[name]
            print(f"{name:<26} shape={cfg.get('shape', 'record'):<15} schema={cfg['schema']}")
        return 0

    if not args.bundle and not args.file:
        parser.error("nothing to validate: use --file, --bundle or --list")

    try:
        if args.bundle:
            result = validator.validate_bundle(args.bundle, check_evidence=args.check_evidence)
            if args.json:
                print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
            else:
                _print_human(result)
            return 0 if result.valid else 1

        if args.contract is None:
            parser.error("--contract is required when using --file")
        bundle = BundleResult()
        for path in args.file:
            bundle.results.append(validator.validate_artifact(path, contract=args.contract))
        if args.check_evidence:
            bundle.reference_findings.extend(
                validator._check_evidence({
                    args.contract: [(r.artifact, bp, rec) for r in bundle.results for bp, rec in r.record_items]
                })
            )
        if args.json:
            print(json.dumps(bundle.to_dict(), indent=2, ensure_ascii=False))
        else:
            _print_human(bundle)
        return 0 if bundle.valid else 1
    except ValidatorError as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
