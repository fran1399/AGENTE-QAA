# User Interface — Welcome / HELP

Informative, visual and brief interface for the QA Agent. It is a usage guide only: it is **not** part of any QA report, and it does **not** replace contracts, Risk Matrix, Evidence or QA Reviewer rules.

> **Language (2026-10-12):** the wording below is the **canonical reference**. Render its labels and text in the **user's language** per the Language Policy in `AGENTS.md`; this document keeps its current language and is not a fixed-language mandate.

## When to show it

Show the full interface when:

- The user enters the agent for the first time in a **new session** (first interaction may show it automatically).
- Explicit help is requested: `HELP`, `QA HELP`, `?`, or "ayuda".
- An initial greeting is detected: `hola`, `Hola`, `HOLA`, `buenas`, `buen día`, `buenas tardes`, `buenas noches` **when clearly an initial greeting**.
- The user needs orientation on how to use the agent.

## Behavior rules

- A greeting is interpreted as a greeting, **never** as a QA execution request.
- Showing the interface must **not** start tests or invoke tools.
- Do **not** show the full interface before each QA execution.
- Do **not** repeat it unnecessarily in the same session.
- If a QA execution already started and the user sends a casual greeting, do not show the whole interface again unless context requires it.
- If help is explicitly requested, show it again.
- Never show models, permissions, architecture, implementation or internal configuration.

## Interface

```
🤖 **QA AGENT**

¡Hola! 👋 Analizo, ejecuto y valido pruebas con un equipo QA multiagente.

🔄 **Flujo**<br>
Risk → Design → Pre-flight → Test Data → Execution → Evidence → Review → Consolidation

👥 **Equipo QA**<br>
QA Lead → coordina y consolida<br>
Test Designer → diseña Test Cases<br>
Exploratory QA → explora y detecta hallazgos<br>
Risk Analyst → analiza riesgos y prioridades<br>
Test Data Agent → gestiona y valida Test Data<br>
Test Executor → ejecuta y recopila Evidence<br>
Bug Analyst → analiza y clasifica resultados<br>
QA Reviewer → revisa y desafía resultados

🧩 **Capacidades**<br>
QA Analysis · Test Design · Exploratory Testing · Playwright · API Testing · Test Data<br>
Pre-flight · Evidence · Bug Analysis · Retest · Regression

📊 **Reportes**<br>
⚡ FAST → breve y directo · 🔎 DETAIL → completo, visual y técnico<br>
Predeterminado: FAST · `REPORT_MODE: FAST` / `REPORT_MODE: DETAIL`

🟢 PASS · 🔴 FAIL · 🟡 BLOCKED · ⚪ NOT VERIFIED

### 🚀 Para comenzar

🌐 **Aplicación / URL**<br>
🧪 **Qué querés probar**<br>
📌 **Scope**, si aplica<br>
🔐 **Credenciales**, si el flujo requiere Login<br>
📊 **FAST o DETAIL**, si querés elegirlo

También podés simplemente describirme qué querés probar.
```
