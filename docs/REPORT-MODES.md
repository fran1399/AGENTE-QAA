# Report Modes — `REPORT_MODE: FAST` / `REPORT_MODE: DETAIL`

Presentation layer for QA reporting. It sits **on top of** the Lead Consolidation Report and the contracts in `AGENT-CONTRACTS.md`; it does not replace or modify them.

> **Language:** these templates define the **structure**. Render their human-facing text (section titles, legend, narrative fields) in the **user's language** per the Language Policy in `AGENTS.md`, keeping the technical terms listed under *Terminology* as-is. States and contract values are never translated.

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

**Effort and scope.** Verification effort follows the requested scope and risk, not the report mode: prioritize the essential checks of the requested scope, and add repetitions, cross-checks or extra reviews only when they resolve a concrete uncertainty or confirm a possible defect (see `.opencode/agents/qa-lead.md`). Effort stays proportional to complexity and risk, and mandatory controls are never skipped to save time. A quick, everyday request lands naturally in FAST; a deep investigation lands naturally in DETAIL.

**Reporting mode ≠ testing type.** FAST does not turn the execution into a Smoke Test. The type of testing depends on the Scope and the objective given by the user.

- `Smoke Test + REPORT_MODE: FAST` → testing = Smoke Test, report = FAST
- `Regression + REPORT_MODE: FAST` → testing = Regression, report = FAST

QA mandatory controls (Risk Matrix, Evidence, QA Reviewer, traceability) remain in **both** modes.

Indicators used: 🟢 PASS · 🔴 FAIL · 🟡 BLOCKED · ⚪ NOT VERIFIED · ⚠️ HIGH · 🔵 MEDIUM · ℹ️ LOW

---

## Report structure (all surfaces)

FAST (chat), DETAIL (chat) and the **HTML report** describe the same execution with the same results and classifications. They share **this single hierarchy**; every surface renders a section **only when it has information**. Never invent data and never render an empty section just to fill the template.

This list is the **canonical definition of the report order and of each section's responsibility**. FAST, DETAIL, the HTML report and the shared model (`qa-report-model`) follow it; they do not redefine their own order. Sections marked *optional* are omitted when they have no data.

Order (top → bottom):

1. **Executive summary** — synthesis in plain language: what was tested, what worked, what problems were found, what is not verified, and where the HTML report is when it exists or was requested. It is a summary: the detailed explanation of each finding lives in the section below.
2. **Metrics** — PASS / FAIL / BLOCKED / NOT VERIFIED, confirmed Bugs, Maximum Risk, QA Reviewer state. Derived from the data (see *Metrics match the detail*), never hand-written.
3. **Scope** — in scope (one high-level statement) and out of scope (what was *not* exercised).
4. **Pre-flight** — `READY` / `BLOCKED` and its checks, *optional*.
5. **Results** — one row per Test Case: ID, Test Case, result, Confidence, Failure Classification.
6. **Test Data** — records with state (AVAILABLE/MISSING/INVALID/EXPIRED/CONSUMED/UNVERIFIED), usability, blocked Test Cases and traceability; *optional*.
7. **Failure Classification** — one entry per FAIL: category, outcome, whether it is a Bug, and the rationale. This is **the primary place** for the analysis of a FAIL; other sections do not repeat it. *Optional* (only when there are FAILs).
8. **Bugs** — confirmed Bugs **separately** from investigated / Not a Bug findings. `Investigada / Not a Bug` is a short **index** (ID, title, outcome, Confidence); its rationale is the one in *Failure Classification*, not duplicated here.
9. **Risks** — only the risks that matter for the conclusion, with level and rationale.
10. **Not verified / Blocked** — explicit, never hidden inside the conclusion.
11. **Evidence** — references to real artifacts, with their availability/distribution limits.
12. **Traceability / adapters** — `tool_requested → … → result_validated`, the adapter used, and the `source_artifacts` the report was consolidated from; *optional for the chat summary*.
13. **Retest / Regression** — executed retests and the regression decision; *optional*.
14. **QA Reviewer** — its real state (ACCEPT / CHALLENGE / INSUFFICIENT_EVIDENCE / BLOCKED).
15. **Conclusion** — one or two lines, forward-looking: what is confirmed, what is pending and whether the execution is fully validated. It does **not** repeat the Executive summary.

Rules shared by chat and HTML:

- **One primary location per finding.** Every finding is explained in depth in exactly one section (a FAIL in *Failure Classification*, a Bug in *Bugs*, a Risk in *Risks*). The Executive summary may synthesize; the Conclusion looks forward; neither restates the full explanation.
- **Executive summary first.** FAST is essentially this summary plus the key results; DETAIL and the HTML add depth.
- **FAIL ≠ Bug.** A FAIL is never shown as a Bug without its Failure Classification. Infrastructure/test-design failures, app defects, test-data problems, blocked and insufficient-evidence results are never mixed.
- **Uncertain findings, not-verified and blocked results keep their original classification.** Never turn an uncertain finding into a confirmed Bug, nor a not-verified result into `PASS` / `ACCEPT`.
- **Metrics match the detail.** The counters equal the detailed rows; confirmed Bugs = entries of `bugs.confirmed`; **Maximum Risk is the highest level among the registered Risks**. Showing anything lower requires an explicit, documented and applied reason (`max_risk_override` + `max_risk_override_reason`), and the report must state it.
- **Chat and HTML do not contradict each other.** The FAST chat summary is generated from the same consolidated model as the HTML (see below), so both show the same counts, Maximum Risk, Bugs and QA Reviewer state.
- **Evidence limits are explicit.** References point to real artifacts; availability and distribution limits (e.g. `automation/.runs/` is git-ignored) are stated.
- **BLOCKED / NOT VERIFIED are never hidden.** They survive both modes and every surface.

### HTML report

The HTML report is the shared, reusable presentation of the hierarchy above. It is generated from the consolidated model (`qa-report-model` contract) by the single renderer `qa/tools/render_qa_report.py`:

```
# HTML report from the consolidated model
python qa/tools/render_qa_report.py --model <report.model.json> --out <report.html>

# FAST chat summary, generated from the SAME model (no separate wording)
python qa/tools/render_qa_report.py --model <report.model.json> --summary
```

The renderer derives the metrics from the model (so the summary can never contradict the detail); it renders a section only when it has data, keeps the AGENTE-QAA visual identity (dark/light theme) and shares it with the execution report (`automation/runner/report.ts`, M-02). The model uses the vocabulary of `AGENT-CONTRACTS.md` (same statuses, failure categories, risk levels and Confidence values).

The execution report (M-02) and this consolidated QA report are **two different layers**: M-02 reports a runner suite run (JSON + HTML, contract `execution-report`); this report consolidates the QA analysis (FAST/DETAIL + HTML). They share identity, vocabulary and presentation conventions, but neither replaces the other.

---

## `REPORT_MODE: FAST`

Objective: a clear, actionable QA result, fast. Brief, direct, visual.

FAST renders the canonical sections with **summary depth**. Compact skeleton (labels in the user's language; optional sections only when they have data):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPORTE DE QA
[APLICACIÓN]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🗣️ RESUMEN EJECUTIVO
- Qué se probó: ...
- Qué funcionó: ...
- Problemas encontrados: ...
- Quedó sin verificar: ...
- Reporte HTML: [ruta, si se pidió o se generó]

🟢 PASS: X   🔴 FAIL: X   🟡 BLOCKED: X   ⚪ NOT VERIFIED: X
🐞 BUGS CONFIRMADOS: X   ⚠️ RIESGO MÁXIMO: [LOW/MEDIUM/HIGH/CRITICAL]   🔎 QA REVIEWER: [estado]

📌 Alcance — una o dos líneas (dentro / fuera).
🛫 Pre-flight — solo el resultado (READY/BLOCKED) y su causa si fue BLOCKED.
🧪 Resultados — tabla ID | Test Case | Resultado | Confianza | Clasificación.
🧩 Clasificación de fallos — una línea por FAIL (omitir si no hay FAILs).
🐞 Bugs — solo confirmados; si no hay: "No se confirmaron Bugs".
⚠️ Riesgos — solo los relevantes para la conclusión.
⚪ Sin verificar / Bloqueado — explícito.
📎 Evidencia — referencia, no un listado completo.
🔎 QA Reviewer — estado real.
🏁 Conclusión — una o dos líneas, sin repetir el resumen.
```

### FAST rules

- **Respuesta directa**: respondé lo que el usuario preguntó, con una extensión proporcional a la complejidad de la solicitud. Los ejemplos de esta sección orientan, pero no fijan una cantidad de líneas o viñetas.
- **Diferenciar el tipo de solicitud**:
  - *Consulta conversacional* («¿qué conviene comprobar primero?»): respuesta directa y breve, sin formato de reporte.
  - *Solicitud de planificación* («planificá un smoke test»): alcance, casos y criterios, sin ejecutar.
  - *Ejecución de pruebas* («hacé un smoke test»): resumen claro de resultados, problemas relevantes y limitaciones, con acceso al reporte completo cuando corresponda.
  - *Solicitud de reporte* («mostrame el reporte FAST»): formato completo de reporte.
- **Sin secciones obligatorias**: no incluyas tablas, métricas ni secciones si la pregunta no lo requiere.
- **Sin escenarios hipotéticos**: no enumeres funcionalidades que no se preguntaron ni que no se conocen del producto.
- **Evidencia y limitaciones**: incluye solo la evidencia relevante para la decisión que el usuario debe tomar.
- **Análisis extenso**: reservado para solicitudes de DETAIL, tareas complejas o cuando el usuario pide profundidad.
- **No repetir**: cada información aparece una vez. No repetir conclusiones en varias secciones.
- **No narrar pasos internos**: no expliques cómo organizaste el trabajo.
- **No ocultar**: nunca ocultes FAIL, BLOCKED o NOT VERIFIED.
- **No reducir calidad**: nunca reduzcas la calidad de las pruebas para acortar el reporte.
- **Señalar artifacts**: cuando existan artifacts detallados, indicá su ubicación solo cuando sea útil.

---

## `REPORT_MODE: DETAIL`

Objective: complete, technical, visually organized and easy-to-analyze report in clear professional Markdown (titles, subtitles, separators, tables, indicators, blocks, logical grouping). Not a tool log.

DETAIL keeps the **same canonical order** as FAST; it only adds **depth**. Use it for deep analysis and investigation: expanded analysis, technical detail, evidence and the explanations needed to understand and investigate the results (including additional verification when it adds value to a conclusion). Generate it only when requested.

DETAIL, per canonical section:

- **Executive summary · Metrics** — the same summary as FAST, plus the full computed counters and the Maximum Risk override note if one was applied.
- **Scope** — Application, executed Scope, Out of Scope.
- **Pre-flight** — result and its checks (target, credentials, tools, adapters, Test Data, config) with evidence; when BLOCKED, the execution did not start and the causes are explicit.
- **Results** — table `ID | Test Case | Result | Confidence | Failure Classification`; no analysis text beyond the row.
- **Test Data** — records with `TD-xxx`, state, Test Cases blocked by data and traceability (`test_data_id`). Never show invented values.
- **Failure Classification** — per FAIL: Test Case, classification (APP_BUG/TEST_DATA/TEST_INFRASTRUCTURE/BLOCKED/INSUFFICIENT_EVIDENCE), outcome (TEST_FAILED/CAUSE_IDENTIFIED/BUG_CONFIRMED/BLOCKED/INSUFFICIENT_EVIDENCE), rationale, confidence. The primary explanation of the FAIL. A FAIL without classification is never shown as a Bug.
- **Bugs** — *Confirmed*: Bug ID, Summary, Failure Classification (APP_BUG), Severity, Priority, Risk, Evidence, Status (if none: 🟢 No se confirmaron Bugs). *Investigated / Not a Bug*: a short index pointing back to *Failure Classification*.
- **Risks** — table `Risk | Area | Level | Reviewer`, only risks relevant to the conclusion.
- **Not verified / Blocked** — BLOCKED, NOT VERIFIED, missing Evidence and pending validations, separated explicitly (including Pre-flight BLOCKED and Test Data blocks).
- **Evidence** — total count, relevant Evidence, references, artifact location. Not an unnecessarily long list.
- **Traceability / adapters** — `tool_requested → … → result_validated`, the adapter used (`api-testing` for API/HTTP, `playwright-qa` for Web/PWA) and the `source_artifacts`. Requests executed but not validated are shown as such.
- **Retest / Regression** — retest records (Bug, Test Case, result, evidence, fix status FIXED/NOT_FIXED/INDETERMINATE) and the regression decision with its justification (risk, impact, area, dependencies, Memory). Only executed retests/regressions are results.
- **QA Reviewer** — clearly presented:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 QA REVIEWER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estado: 🟡 BLOCKED
Veredicto: NOT EXECUTED
Motivo: el Reviewer no pudo ejecutarse por una limitación del entorno.
Impacto: R-001 permanece ⚪ NOT VERIFIED.
```

  Never emit ACCEPT or CHALLENGE when the reviewer did not run.
- **Conclusion** — human, professional, forward-looking: what was tested, what worked, whether Bugs were found, pending risks, what remains unverified, and whether the execution can be considered fully validated. No repetition of the Executive summary.

## Terminology

Keep standard technical terms as-is: QA, QA Lead, QA Reviewer, Test Case, Test Execution, Test Data, Pre-flight, Failure Classification, Evidence, Bug, Defect, Severity, Priority, Risk, Retest, Regression, Smoke Test, Confidence, PASS, FAIL, BLOCKED, NOT VERIFIED, Playwright, API Testing. No artificial translations, no invented English terms.
