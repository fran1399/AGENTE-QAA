# Contribuir a AGENTE-QAA

Gracias por tu interés en contribuir. Este documento explica cómo agregar agentes, skills y módulos al sistema.

## Estructura del proyecto

```
.opencode/
├── agents/          # 8 perfiles de agente (qa-lead primario + 7 subagentes)
└── skills/          # 11 procedimientos reutilizables (SKILL.md)
automation/
├── runner/          # Runner M-03 + reportes M-02 + auto-healing M-05 + SQLite M-06
├── manifests/       # Suites declarativas (demo Web/API)
├── specs/           # Especificaciones Playwright
└── tests/           # Tests de infraestructura del runner
qa/
├── schema/          # JSON Schemas de los contratos (M-01)
├── tools/           # Validador, pre-flight, renderizador y sus pruebas
├── evidence/        # Evidencia: capturas, traces, logs
├── bugs/            # Bug records estructurados
├── reports/         # Reportes QA
└── memory/          # Información histórica para regresión
tests/               # Definiciones de Test Case (raíz)
docs/                # Contratos, arquitectura, políticas
```

## Agregar un agente

1. Creá un archivo en `.opencode/agents/<nombre>.md` con el siguiente formato:

```markdown
---
description: Descripción clara del agente.
mode: subagent  # o primary si es el agente principal
model: opencode/<modelo-disponible>
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: ask
  - action: subagent
    resource: "*"
    effect: deny
---

# Nombre del Agente

## Responsibilities
...

## Core Rules
- NO EVIDENCE = NO CONFIRMED RESULT
- ...
```

2. Actualizá `AGENTES.md` con la descripción del nuevo agente.
3. Si el agente necesita permisos especiales, agregalos en `opencode.json` bajo `agents.<nombre>.permissions`.
4. Verificá que el modelo exista con `opencode models`.

## Agregar un skill

1. Creá una carpeta en `.opencode/skills/<skill-id>/` con un `SKILL.md`:

```markdown
---
name: Nombre del Skill
description: Cuándo usarlo y qué hace.
---

# Título

## Purpose
...

## Rules
- NO EVIDENCE = NO CONFIRMED RESULT
- ...
```

2. El skill se descubre automáticamente. No hace falta registrarlo en ningún lado.
3. Si el skill tiene scripts o referencias, ponelos en la misma carpeta.

## Agregar un módulo

1. Creá el código en `automation/runner/` o `qa/tools/` según corresponda.
2. Agregá tests en `qa/tools/test_<modulo>.py` o `automation/tests/`.
3. Documentá el módulo en `docs/<MODULO>.md`.
4. Actualizá `AGENT-CONTRACTS.md` con los contratos del módulo.
5. Actualizá `README.md` con el nuevo módulo en la tabla M-01…M-06.

## Principios rectores

- **NO EVIDENCE = NO CONFIRMED RESULT**: nunca afirmes un resultado sin evidencia.
- **FAIL ≠ APP_BUG**: cada FAIL pasa por Failure Classification antes de confirmar un Bug.
- **Mínimo privilegio**: los agentes solo tienen los permisos que necesitan.
- **Lectura por defecto**: no modifiques código de la aplicación sin autorización.
- **Desacoplamiento**: la lógica QA no depende de los adapters de ejecución.

## Tests

```bash
# Tests Python (QA Core)
python qa/tools/test_validate_contracts.py
python qa/tools/test_preflight.py
python qa/tools/test_data_verification.py
python qa/tools/test_report_generator.py
python qa/tools/test_render_qa_report.py

# Tests Playwright (Runner)
npm test

# Health check del sistema
node automation/scripts/health-check.mjs
```

## Commits

Usá mensajes descriptivos en español o inglés:

```
feat: agrega agente test-designer
fix: corrige validación de contratos en M-01
docs: actualiza documentación de M-05
test: agrega tests de integración multiagente
```
