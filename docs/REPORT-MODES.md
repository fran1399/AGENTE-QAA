# Report Modes — `REPORT_MODE: FAST` / `REPORT_MODE: DETAIL`

Presentation layer for QA reporting. It sits **on top of** the Lead Consolidation Report and the contracts in `AGENT-CONTRACTS.md`; it does not replace or modify them.

> **Language (2026-10-12):** these templates define the **structure**. Render their human-facing text (section titles, legend, narrative fields) in the **user's language** per the Language Policy in `AGENTS.md`, keeping the technical terms listed under *Terminology* as-is. States and contract values are never translated.

## Selection

Accepted forms:

- `REPORT_MODE: FAST` / `REPORT_MODE: DETAIL`
- `FAST` / `DETAIL`, when the context clearly refers to the reporting mode

Default when nothing is specified: **`REPORT_MODE: FAST`**.

Generate **only** the requested mode. Never generate both automatically.

## Fundamental principle

FAST and DETAIL present **exactly the same QA results**. The mode never changes:

- Test Cases executed
- Results (PASS/FAIL/BLOCKED/NOT VERIFIED)
- Failure Classification of each FAIL
- Bugs
- Test Data states and blocks
- Pre-flight result (READY/BLOCKED)
- Risk
- Evidence
- Confidence
- QA Reviewer verdict / state
- Retest / Regression results
- QA conclusion
- BLOCKED and NOT VERIFIED states

The only difference is the **amount, depth, organization and presentation** of the information shown.

**Reporting mode ≠ testing type.** FAST does not turn the execution into a Smoke Test and does not reduce Scope or depth. The type of testing depends on the Scope and the objective given by the user.

- `Smoke Test + REPORT_MODE: FAST` → testing = Smoke Test, report = FAST
- `Regression + REPORT_MODE: FAST` → testing = Regression, report = FAST

QA mandatory controls (Risk Matrix, Evidence, QA Reviewer, traceability) remain in **both** modes.

Indicators used: 🟢 PASS · 🔴 FAIL · 🟡 BLOCKED · ⚪ NOT VERIFIED · ⚠️ HIGH · 🔵 MEDIUM · ℹ️ LOW

---

## `REPORT_MODE: FAST`

Objective: a clear, actionable QA result, fast. Brief, direct, visual.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QA TEST REPORT
[APLICACIÓN]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🟢 PASS: X
🔴 FAIL: X
🟡 BLOCKED: X
⚪ NOT VERIFIED: X

🐞 CONFIRMED BUGS: X
🧩 FAILURE CLASSIFICATION: [APP_BUG / TEST_DATA / TEST_INFRASTRUCTURE / BLOCKED / INSUFFICIENT_EVIDENCE] (omitir si no hay FAILs)
⚠️ MAX RISK: [LOW/MEDIUM/HIGH/CRITICAL]
🔎 QA REVIEWER: [estado]

Confidence: [HIGH/MEDIUM/LOW]

## 📌 Scope
Resumen breve del alcance ejecutado. Si el Pre-flight fue BLOCKED, indicarlo aquí con su causa.

## 🧪 Result

| ID     | Test Case | Result  | Confidence |
| ------ | --------- | ------- | ---------- |
| TC-001 | ...       | 🟢 PASS | HIGH       |

## 🧩 Failure Classification
Solo cuando existan FAILs: una línea por FAIL con su clasificación y resultado del análisis
(ej. `TC-003 FAIL → TEST_DATA (dato consumido) · no es Bug`).
Si no hay FAILs, omitir la sección. Un FAIL nunca se muestra como Bug sin su clasificación.

## 🐞 Bugs
Únicamente Bugs confirmados. Si no existen: 🟢 No confirmed Bugs.
(Los candidatos descartados como Not a Bug no se listan salvo que sean relevantes para entender la conclusión.)

## 🚫 Blocks
Pre-flight BLOCKED o Test Cases BLOCKED por Test Data: causa concreta, una línea cada uno.

## ⚠️ Risks
Únicamente los riesgos relevantes para la conclusión.

## 🔎 QA Reviewer
Estado claro: ACCEPT | CHALLENGE | INSUFFICIENT_EVIDENCE | BLOCKED.
Si el Reviewer obligatorio no pudo ejecutarse, indicarlo explícitamente.
Nunca convertir un Reviewer no ejecutado en ACCEPT.

## 🏁 Conclusion
Máximo unas pocas líneas: qué quedó confirmado, qué quedó pendiente,
riesgos relevantes, y si la ejecución quedó completamente validada o no.
```

### FAST rules

- Prioritize speed and clarity.
- No extensive internal reasoning.
- Do not list all Evidence or all Execution Traces.
- Do not repeat information.
- No technical detail that does not change the conclusion.
- Never hide FAIL, BLOCKED or NOT VERIFIED.
- Never reduce testing quality to shorten the report.
- When detailed artifacts exist, point to their location only when useful.
- New capabilities (Pre-flight, Test Data, Failure Classification, Retest/Regression, API/UI) appear in summarized form only: one line each, never omitted from the conclusion.

---

## `REPORT_MODE: DETAIL`

Objective: complete, technical, visually organized and easy-to-analyze report in clear professional Markdown (titles, subtitles, separators, tables, indicators, blocks, logical grouping). Not a tool log.

### Structure

**Executive summary**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QA TEST REPORT
[APLICACIÓN]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🟢 PASS: X
🔴 FAIL: X
🟡 BLOCKED: X
⚪ NOT VERIFIED: X

🐞 CONFIRMED BUGS: X
⚠️ MAX RISK: HIGH
🔎 QA REVIEWER: [estado]

Confidence: [HIGH/MEDIUM/LOW]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

1. **📌 Scope** — Application, executed Scope, Out of Scope.
2. **🛫 Pre-flight** — result `READY` / `BLOCKED` and its checks (target, credentials, tools, adapters, Test Data, config) with evidence; when BLOCKED, the execution did not start and the causes are explicit.
3. **🧪 Test Cases** — table `ID | Test Case | Result | Confidence`, nothing else.
4. **🗃️ Test Data** — records with `TD-xxx`, state (AVAILABLE/MISSING/INVALID/EXPIRED/CONSUMED/UNVERIFIED), Test Cases blocked by data and traceability (`test_data_id`). Never show invented values.
5. **⚠️ Risk Assessment** — table `Risk | Area | Level | Reviewer`, only risks relevant to the conclusion.
6. **🐞 Bugs**
   - *Confirmed Bugs*: Bug ID, Summary, Failure Classification (APP_BUG), Severity, Priority, Risk, Evidence, Status. If none: 🟢 No se confirmaron Bugs.
   - *Investigated / Not a Bug*: separate section so false positives are not mixed with real Bugs.
7. **🧩 Failure Classification** — per FAIL: Test Case, classification (APP_BUG/TEST_DATA/TEST_INFRASTRUCTURE/BLOCKED/INSUFFICIENT_EVIDENCE), outcome (TEST_FAILED/CAUSE_IDENTIFIED/BUG_CONFIRMED/BLOCKED/INSUFFICIENT_EVIDENCE), rationale, confidence. A FAIL without classification is never shown as a Bug.
8. **📸 Evidence** — total count, relevant Evidence, references, artifact location. Not an unnecessarily long list.
9. **🔗 Execution Traceability** — summary of `tool_requested → tool_executed → execution_success → result_obtained → result_validated`; extra detail only when needed to understand a result.
10. **🔌 API / UI Execution** — per execution, the adapter used (`api-testing` for API/HTTP, `playwright-qa` for Web/PWA), scope executed, and validated results. Requests executed but not validated are shown as such.
11. **🔁 Retest / Regression** — retest records (Bug, Test Case, result, evidence, fix status FIXED/NOT_FIXED/INDETERMINATE) and the regression decision with its justification (risk, impact, area, dependencies, Memory). Only executed retests/regressions are results.
12. **🔎 QA Reviewer** — clearly presented:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 QA REVIEWER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: 🟡 BLOCKED
Verdict: NOT EXECUTED
Reason: el Reviewer no pudo ejecutarse por una limitación del entorno.
Impact: R-001 permanece ⚪ NOT VERIFIED.
```

   Never emit ACCEPT or CHALLENGE when the reviewer did not run.
13. **🎯 Confidence** — global Confidence and individual Confidence when relevant; explain only when necessary why a result is MEDIUM or LOW.
14. **⚪ Blocked / Not Verified** — BLOCKED, NOT VERIFIED, missing Evidence and pending validations, separated explicitly (including Pre-flight BLOCKED and Test Data blocks). Never hidden inside the conclusion.
15. **🏁 Final Consolidation** — human, professional conclusion answering: what was tested, what worked, whether Bugs were found, pending risks, what remains unverified, and whether the execution can be considered fully validated.

## Terminology

Keep standard technical terms as-is: QA, QA Lead, QA Reviewer, Test Case, Test Execution, Test Data, Pre-flight, Failure Classification, Evidence, Bug, Defect, Severity, Priority, Risk, Retest, Regression, Smoke Test, Confidence, PASS, FAIL, BLOCKED, NOT VERIFIED, Playwright, API Testing. No artificial translations, no invented English terms.
