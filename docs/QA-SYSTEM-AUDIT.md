# QA System — Auditoría integral (arquitectura, agentes, eficiencia, modelos, UX, M-01…M-06, seguridad, pruebas, docs, GitHub)

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-11 |
| Tipo | Auditoría **read-only** de verificación (no implementa cambios) |
| Base inspeccionada | QA Core + M-01 (contratos), M-02 (reportes), M-03 (runner), M-04 (pre-flight), M-05 (auto-healing), M-06 (data verification SQLite) |
| Única escritura permitida | Este documento (`docs/QA-SYSTEM-AUDIT.md`) |
| Modelo de evidencia | `esperado` / `observado` / `evidencia` / `conclusión` / `confianza` · **NO EVIDENCE = NO CONFIRMED RESULT** |
| Veredicto | **AUDITORÍA PARCIAL EN CURSO — AUD-01, AUD-03, AUD-04, AUD-05, AUD-06, AUD-07, AUD-08, AUD-09, AUD-10, AUD-11 y AUD-12 RESUELTOS y AUD-02 cerrado como falso positivo (build/tests verdes; 2026-10-11/12). Persisten áreas NO VERIFICADAS (calidad real de los LLM). NO apto para declarar "seguro/optimizado/listo" todavía.** |

> Regla aplicada: una capacidad **documentada** no se asume funcional; se contrasta con el código y,
> cuando es posible, con una ejecución no destructiva. Todo hallazgo se clasifica como
> **defecto reproducido** / **defecto confirmado por inspección** / **riesgo potencial** /
> **limitación conocida** / **oportunidad de optimización** / **preferencia de diseño**.

---

## 0. Alcance y límites de esta auditoría

**Se auditó:** arquitectura (config OpenCode, 8 agentes, 12 skills, coordinación), eficiencia/tokens,
modelos, UX/idioma, contratos M-01…M-06, seguridad/permisos, pruebas/mantenibilidad/docs y preparación GitHub.

**No se hizo (límites explícitos):**
- No se modificó ningún archivo del proyecto salvo este documento.
- ~~No se re-ejecutó la batería de Playwright completa (49 tests) porque el build estaba roto~~ → **actualizado 2026-10-11/12:**
  tras resolver AUD-01 se ejecutó la suite completa → **49 passed**; suite Python → **111 OK**; y tras AUD-03/AUD-05 →
  **50 passed** y suite Python → **114 OK**; y tras AUD-04 → **52 passed** (misma suite Python 114 OK). AUD-06 no altera la suite
  (solo `MANIFEST.json`, no consumido por el runtime) y AUD-07 tampoco (solo documentación; se re-ejecutó la batería para verificar
  las cifras → `typecheck` 0, **52 passed**, Python **114 OK**, `validate_contracts` `valid:true`). Ver §13, §15, §17, §18 y §19.
  Durante la auditoría el conteo se obtuvo con `playwright test --list` (solo listado).
- ~~No se ejecutaron agentes LLM reales (no se probó el comportamiento de los 8 agentes con modelos reales).
  Por eso el **enforcement efectivo de permisos** queda **NO VERIFICADO**.~~ → **actualizado 2026-10-12 (AUD-09):** se verificó el
  enforcement con los mecanismos oficiales (`opencode debug config`/`debug agents`) y con **pruebas de ejecución headless por agente**
  (`opencode run --standalone --agent …`). El **enforcement quedó VERIFICADO** (ver §4/§16); sigue **NO VERIFICADO** el
  comportamiento **de calidad** de los agentes LLM (más allá de permisos).
- No se inspeccionó en profundidad `automation/specs/**` (specs de negocio). Marcado como **NO VERIFICADO** donde aplica.
- Las cifras de pruebas Python se obtuvieron re-ejecutando la suite (ver §7).
- **Evidencia local (no distribuida):** los directorios `automation/.runs/**`,
  `automation/.artifacts/**` y `automation/.dist/**` citados en este informe son **artefactos
  locales** excluidos por `.gitignore`; **no forman parte del conjunto publicable** (`MANIFEST.json`)
  ni existirán en un clon limpio. Los comportamientos auditados se reproducen con las pruebas y
  scripts **incluidos** (mapa en **§29**).

---

## 1. Chequeo inicial de modificaciones y atribución (consigna previa)

**Estado del repositorio:** **no es un repositorio Git** (`git status --short` → `fatal: not a git repository`, exit 128;
`Test-Path .git` = `False`). No hay historial ni `git diff`; **ninguna eliminación es reversible por VCS**.

Detección de cambios por **mtime** (no hay VCS) y por comparación con el build compilado:

| Archivo | mtime | Observación |
| --- | --- | --- |
| `automation/runner/runner.ts` | 2026-10-11 21:49:04 | Edición más reciente del árbol |
| `automation/tests/runner.infra.spec.ts` | 2026-10-11 21:38:08 | Edición previa (M-06) |
| `automation/.dist/runner/runner.js` | 2026-10-11 21:39:43 | Build **anterior** a la edición de `runner.ts` (21:39 < 21:49) |

**Conclusión de atribución (confianza ALTA):** los cambios detectados en `runner.ts` y `runner.infra.spec.ts`
pertenecen a la etapa previa de trabajo sobre **M-06** (mtime 21:38–21:49), **no** a esta auditoría.
La auditoría (sesión posterior) sólo hizo lecturas. **No se atribuye ningún cambio a la fase de auditoría**,
por lo que **no hubo nada que revertir** bajo la consigna “revertí únicamente los cambios introducidos durante esta auditoría”.
Sí se reportan (AUD-01, AUD-11) como **residuos de la etapa M-06**. AUD-01 ya fue limpiado (2026-10-11, ver §13); AUD-11 también quedó **resuelto** (2026-10-12, ver §21).

**Estado de los archivos nombrados en la consigna:**
- `report.ts`: **no modificado** en la ventana de esta sesión (mtime 2026-10-11 15:24).
- `runner.ts`: modificado **antes** de la auditoría (21:49); contenía un residuo con defecto (AUD-01) y logs `DEBUG` (AUD-11) — ambos ya resueltos (AUD-01 el 2026-10-11; AUD-11 el 2026-10-12, ver §21).
- `automation/tests/runner.infra.spec.ts`: modificado **antes** de la auditoría (21:38); cambio de puerto 4190→4191 documentado en M-06.
- `docs/QA-SYSTEM-AUDIT.md`: **no existía**; este documento es su primera versión.

---

## 2. Resumen ejecutivo

El sistema está **bien diseñado y con buenas intenciones de gobernanza** (evidencia primero, FAIL ≠ BUG,
adapters desacoplados, validador M-01 como gate, pre-flight como bloqueo previo). La integración
código↔contratos↔documentación es, en general, real. Sin embargo, la auditoría encontró:

1. ~~**El build del runner está roto** (P1, reproducido)~~ → **RESUELTO (AUD-01, 2026-10-11):**
   `runner.ts` referenciaba `dataVerifications` fuera de alcance; se eliminaron 2 líneas redundantes.
   `npm run typecheck` → 0, `npm test` → **49 passed**, suite Python → 111 OK. Detalle en §4 (AUD-01) y §13.
2. ~~**5 de 8 agentes apuntan a un modelo que no existe en el catálogo** (P1)~~ → **FALSO POSITIVO / CERRADO (AUD-02):**
   los **4** modelos configurados existen y están `active` (gratuitos, cost 0/0). La “ausencia” de la consulta inicial se debió
   a que la vista por defecto del catálogo lista solo la versión más nueva por familia (se debe consultar con `all: true`).
   **Asignación sin cambios.** Ver §4 (AUD-02) y §14.
3. ~~**La validación “M-01” de los artefactos del runner no ocurre en runtime**: el runner sólo hace un chequeo
   estructural propio para `data_verification.json`; y además **M-01 no puede detectar** `data_verification.json`
   ni `report.json` en modo `--bundle` (faltan hints), por lo que quedan sin validar silenciosamente (P2).~~ →
   **RESUELTO (AUD-03/AUD-05, 2026-10-12):** agregados los hints `report_id`/`verification_id` (M-01 ya detecta ambos en `--bundle`)
   y el runner ahora valida `data_verification.json` con el **validador canónico M-01** (no con un chequeo parcial). Detalle en §4 y §15.
4. **Los enlaces de evidencia del `report.html` están rotos** (rutas repo-relative resueltas contra el directorio del reporte) (P2).
5. **Documentación desactualizada / corrupta**: ~~`MANIFEST.json` no lista `docs/DATA-VERIFICATION.md`~~ → **RESUELTO (AUD-06, 2026-10-12):**
   ruta incorporada al inventario. **RESUELTO (AUD-07, 2026-10-12):** conteos y estados de M-02/M-06 corregidos en `README.md`,
   `automation/README.md`, `docs/AUTOMATION-ARCHITECTURE.md` y `docs/RUNNER-M03.md`; realidad medida **52 tests** (2 smoke + 30 `runner.infra` +
   20 `sqlite-adapter`). **RESUELTO (AUD-08, 2026-10-12):** BOM y mojibake corregidos en `README.md`, `automation/README.md` y
   `docs/RUNNER-M03.md` (instancia adicional detectada en el alcance); `docs/QA-SYSTEM-AUDIT.md` conserva ejemplos de mojibake
   como **evidencia citada** (no es daño). Ver §4 (AUD-07/AUD-08), §19 y §20.
6. ~~**Configuración de permisos en sintaxis V1** (`permission`/`bash`/`task`) mientras OpenCode V2 documenta
   `permissions`/`shell`/`subagent`; el **enforcement efectivo no quedó verificado**.~~ → **RESUELTO (AUD-09, 2026-10-12):**
   la versión instalada (**OpenCode 2.0.24**) **acepta y normaliza** la sintaxis V1 (`permission`→`permissions`, `bash`→`shell`,
   `task`→`subagent`): **no hay incompatibilidad** (premisa de AUD-09 = falso positivo). Al verificar el enforcement se detectó y
   corrigió una **deficiencia real de least-privilege**: un mapa `bash` **sin comodín `"*"`** no restringía (`qa-lead` ejecutaba shell
   arbitrario) y **4 agentes read-only** no tenían regla `bash`. Ver §4 (AUD-09) y §16.

**No se declara el sistema “seguro”, “optimizado” ni “listo”**: quedan áreas NO VERIFICADAS
(enforcement de permisos, comportamiento real de agentes con sus modelos).

---

## 3. Estado por área

| # | Área | Estado | Confianza |
| --- | --- | --- | --- |
| 1 | Arquitectura (config, capas, desacople) | **VERIFICADO** (con hallazgos de permisos) | ALTA |
| 2 | Agentes (8 definiciones) | **VERIFICADO** (modelos existen y están `active`; ver AUD-02) | ALTA |
| 3 | Skills (12) y coordinación qa-lead | **VERIFICADO** | ALTA |
| 4 | Eficiencia / tokens | **HALLAZGO** (duplicación; runner sin tokens) | MEDIA |
| 5 | Modelos | **VERIFICADO** (4 de 4 IDs existen, `active`, gratuitos) | ALTA |
| 6 | UX / idioma | **HALLAZGO** (inconsistencia ES/EN; HTML en inglés) | ALTA |
| 7 | M-01 (contratos/validador) | **VERIFICADO** (AUD-03 resuelto: detecta `report`/`data-verification`) | ALTA |
| 8 | M-04 (pre-flight) | **VERIFICADO** | ALTA |
| 9 | M-05 (auto-healing) | **VERIFICADO** (por inspección + tests existentes) | MEDIA |
| 10 | M-02 (reportes) | **HALLAZGO** (links rotos; doc desactualizada) | ALTA |
| 11 | M-06 (data verification SQLite) | **VERIFICADO** (AUD-05 resuelto: runtime valida con M-01) | ALTA |
| 12 | Seguridad / permisos | **VERIFICADO** (V1 válido en 2.0.24; enforcement probado; AUD-09 corregido) | ALTA |
| 13 | Pruebas / mantenibilidad / docs | **VERIFICADO** (docs alineadas: AUD-07; encoding BOM/mojibake corregido: AUD-08). Build: **RESUELTO** | ALTA |
| 14 | Preparación GitHub | **PARCIAL** (falta LICENSE; no hay Git) | ALTA |

---

## 4. Hallazgos priorizados

Severidad: **P0** = bloqueante crítico · **P1** = grave (bloquea build/ejecución o funcionalidad clave) ·
**P2** = importante (corrección necesaria, no bloquea todo) · **P3** = menor / limpieza.

### Necesarios (correcciones)

#### AUD-01 — [P1] ✅ RESUELTO (2026-10-11) — El build del runner estaba roto (`dataVerifications` fuera de alcance)
- **Clase:** defecto reproducido.
- **Ubicación:** `automation/runner/runner.ts:763-764` (función `writeExecutionReports`).
- **Evidencia (comando real):**
  - `npm.cmd run typecheck` → `automation/runner/runner.ts(764,26): error TS2552: Cannot find name 'dataVerifications'` · `exit=2`.
  - `npx.cmd tsc -p automation/runner/tsconfig.json --noEmit` → mismo error, `build_check_exit=2`.
- **Esperado:** `npm run typecheck` y `npm run build:runner` exit 0.
- **Observado:** error de compilación TS2552. `dataVerifications` es una `const` local del bloque `try` de `main()`
  (`runner.ts:1089`) y se referencia dentro de la función top-level `writeExecutionReports` (`runner.ts:764`).
- **Impacto (ALTO):** `package.json` define `"pretest": "npm run build:runner"` y `"presuite": "npm run build:runner"`.
  Al fallar el build (exit 2), **`npm test` y `npm run suite` abortan antes de ejecutar**.
  Además, `tsc` **emite igual** los `.js` con defecto (no hay `noEmitOnError`), por lo que un rebuild dejaría
  el `.dist` con un `ReferenceError: dataVerifications is not defined` en runtime.
- **Enmascaramiento:** el `.dist` actual (21:39) es **stale** (anterior a la edición de 21:49) y todavía funciona,
  por lo que una corrida manual con `node automation/.dist/runner/runner.js` “parece” correcta.
- **Línea redundante además de rota:** `buildReportInput` ya recibe `errors` en `counts` y el runner pasa
  `errors: dataVerifications.errors` en `runner.ts:1136`; la línea 764 **sobrescribe con el mismo valor** (en el camino normal)
  y **rompe** el camino pre-flight BLOCKED (donde `dataVerifications` aún no existe).
- **Método:** reproducido (comando real).
- **Corrección propuesta:** eliminar las líneas 763–764 (el contador ya es correcto y la referencia está fuera de alcance).
- **Beneficio:** restaura `npm test` y `npm run suite`; elimina el riesgo de `.dist` corrupto.
- **Esfuerzo:** ~5 min (borrar 2 líneas + `npm test`).
- **Atribución:** residuo de la etapa M-06, **no** de la auditoría.
- **✅ RESOLUCIÓN (2026-10-11):** eliminadas las líneas 763–764 de `runner.ts` (comentario + asignación redundante);
  cambio mínimo sin alterar M-06. **Causa confirmada:** `dataVerifications` es local a `main()` (`runner.ts:1089`) y
  `buildReportInput` ya fija `summary.errors` desde `counts.errors` (`runner.ts:719-724`).
  Validación: `npm run typecheck` → 0; `npm run build:runner` → 0 (`.dist` regenerado); `npm test` → **49 passed**;
  `python -m unittest discover -s qa/tools` → **111 OK**; `validate_contracts.py --bundle qa` → `valid:true / 31 / 0 / 0`.
  Backup: `…/AUD-01-backup` (SHA-256 `runner.ts` `BA0340F5…` → `53B920E9…`). Detalle completo en §13.

#### AUD-02 — [FALSO POSITIVO / CERRADO] Asignación de modelos a los 8 agentes
- **Ubicación:** `AGENTS.md` (sección Models) y frontmatter `model:` de `.opencode/agents/*.md`.
- **Esperado:** todos los IDs de modelo existen en el catálogo (`AGENTS.md` dice explícitamente “Check availability… Do not invent model IDs”).
- **Observado (premisa original, luego descartada):** con la **vista por defecto** (39 modelos) no aparecía `opencode/nemotron-3-ultra-free`,
  pero sí `nemotron-3.5-lightning-free`, `mimo-v2.6-flash-free` y `longcat-2.5-preview-free`.
- **Conclusión (confianza ALTA) — FALSO POSITIVO:** consultando el catálogo **con `all: true`**, los **4** IDs configurados existen,
  están `status: active` y son gratuitos (`cost: 0/0`) [ver §14.1]. **No hay defecto y la asignación NO se modificó.**
- **Causa de la discrepancia:** la vista **por defecto** del catálogo lista solo la versión más nueva por familia; `nemotron-3.5-lightning-free`
  (2026-08-11) es más reciente dentro de la familia Nemotron y **ocultaba** a `nemotron-3-ultra-free` (2026-06-04). La afirmación previa de
  `docs/QA-SYSTEM-STABILITY-AUDIT.md` (2026-10-10, F-10) queda **confirmada**, no contradicha.
- **Alcance restante (NO es defecto):** la **calidad/rendimiento/estabilidad** de cada modelo y el criterio de asignación por agente **siguen
  sin verificarse** (requieren ejecución real de agentes LLM). **No se aplicó ninguna corrección** (falso positivo). Ver §14.
- **🔎 ACTUALIZACIÓN DE INVESTIGACIÓN (2026-10-11):**
  - **Hecho (evidencia):** al consultar el catálogo **con `all: true`** (incluye versiones que no son la más nueva de su
    familia), `opencode/nemotron-3-ultra-free` ("Nemotron 3 Ultra Free") aparece con `status: active`, `cost: 0/0`,
    `released: 2026-06-04`. Los **4** modelos configurados existen y están `active` (detalle en §14.1).
  - **Clasificación corregida:** **NO** es “modelo inexistente”, ni “ID incorrecto”, ni “alias”, ni “fallo del proveedor”.
    Es un **modelo válido que no es la versión más nueva de su familia** (no listado en la vista por defecto).
  - **Riesgo metodológico (lección):** la vista por defecto del catálogo puede ocultar modelos válidos; verificar disponibilidad con `all: true`.

### P2 —

#### AUD-03 — [RESUELTO 2026-10-12] M-01 no podía detectar/validar `data_verification.json` ni `report.json` en modo `--bundle`
- **Ubicación:** `qa/schema/index.json` (`artifact_hints`, líneas 24–40) y artefactos `automation/.runs/<run>/{data_verification.json,report.json}`.
- **Esperado:** `--bundle <out>` valida todos los artefactos del runner contra su contrato.
- **Observado (reproducido):** `python qa/tools/validate_contracts.py --bundle automation/.runs/m06final-20261011-221241 --json`
  reporta para `data_verification.json` y `report.json`: `"could not determine the contract for this artifact"` (warning),
  y el bundle queda `"valid": true` sin haber validado esos archivos. `execution_trace.json` sí se detecta.
- **Causa:** `artifact_hints` no incluye `verification_id` (contrato `data-verification`) ni `report_id` (`execution-report`),
  aunque ambos contratos están registrados en `index.json:21-22`.
- **Impacto (MEDIO):** falsa sensación de conformidad M-01; los artefactos M-02/M-06 no se validan por bundle.
  El test M-06 “contract invalid rejection” (`runner.infra.spec.ts:1358`) valida con `--contract data-verification --file …` **explícito**, no por bundle.
- **Método:** reproducido.
- **Corrección propuesta:** agregar `"verification_id": "data-verification"` y `"report_id": "execution-report"` a `artifact_hints`
  (o un mecanismo equivalente) y ampliar los tests de bundle.
- **✅ RESOLUCIÓN (2026-10-12):** agregadas ambas entradas a `artifact_hints` en `qa/schema/index.json`. Verificado con el mismo
  run dir: `--bundle` ahora reporta `data-verification` (1 record) y `execution-report` (1 record) como artefactos **detectados y válidos**
  (antes: `unknown`/warning). Se agregó el test `RunnerArtifactsDetectionTest` en `qa/tools/test_validate_contracts.py` (hints + autodetección
  de archivo serializado + rechazo en bundle con error explícito) y `validateRunDir` en `automation/tests/runner.infra.spec.ts` ahora exige
  que `report.json`/`data_verification.json` se reconozcan por contrato. Detalle y evidencia en §15.

#### AUD-04 — [RESUELTO 2026-10-12] Enlaces de evidencia rotos en `report.html`
- **Ubicación:** `automation/runner/report.ts:198, 226, 265` (`href` = ruta repo-relative) vs `report.ts:569` (el HTML se escribe en `outDir`).
- **Esperado:** al abrir `report.html`, los enlaces a evidencia abren el archivo.
- **Observado:** el HTML generado contiene `href="automation/.runs/m06final-20261011-221241/evidence/TC-M06-FINAL-1_assertions.json"`.
  Como `report.html` vive en `automation/.runs/m06final-20261011-221241/`, el navegador resuelve el enlace relativo a
  `…/m06final-20261011-221241/automation/.runs/…/evidence/…` → enlace inexistente.
- **Evidencia:** grep de `href` sobre el reporte generado (§7) + inspección de `renderReportHtml`.
- **Impacto (MEDIO):** los reportes HTML no son navegables como archivo local ni servidos desde el directorio del run;
  sólo funcionan si se sirven desde la raíz del repo. El test M-02 no verifica resolución de enlaces.
- **Método:** confirmado por inspección (la consecuencia 404 no se forzó en navegador en esta sesión).
- **Corrección propuesta:** generar `href` relativo al propio `report.html` (p. ej. `relative(outDir, abs)`) o usar rutas `file://`/servidor documentado.
- **✅ RESOLUCIÓN (2026-10-12):** `renderReportHtml` ahora recibe el directorio de salida y construye el `href` **relativo al propio
  `report.html`** (`relative(outDir, abs)`), con separadores `/` y percent-encoding por segmento (`encodeURIComponent`): portable,
  sin rutas absolutas dependientes de la computadora del usuario y seguro para nombres con espacios/`#`/`&`/no-ASCII. Se aplicó a la
  evidencia de cada Caso, al índice de evidencias y a `preflight.record_path`; se conservan el chequeo de existencia y el fallback
  `href="#"` + `(missing)`, el `escapeHtml` de etiquetas y el `report.json` intacto (las rutas de evidencia siguen repo-relative en
  el JSON). Archivos: `automation/runner/report.ts` (+ `.dist/runner/report.js` recompilado) y `automation/tests/runner.infra.spec.ts`.
  Verificación real en navegador (antes 404 → después 200) en §17.

#### AUD-05 — [RESUELTO 2026-10-12] La validación runtime de `data_verification.json` era un chequeo parcial, no M-01
- **Ubicación:** `automation/runner/runner.ts:964-998` (`validateDataVerificationJson`), llamada en `runner.ts:1093-1095`.
- **Esperado (implícito en docs):** validación contra el contrato M-01 (`DATA-VERIFICATION.md:103` lo llama “M-01 contract”).
- **Observado:** es un chequeo TypeScript estructural “lightweight” (su propio comentario dice “without duplicating the full M-01 validator”).
  No verifica pattern `^DV-[A-Za-z0-9._-]+$`, `minLength`, enteros de `rows_returned`, `min` de `duration_ms`, ni `params[]`.
  **El runner no invoca `validate_contracts.py`** para `data_verification.json`, `execution_trace.json` ni `report.json` en runtime.
- **Impacto (MEDIO):** la garantía “los artefactos del runner son M-01 válidos” sólo se cumple en tests/manual, no en la corrida.
- **Método:** reproducido end-to-end (antes del fix): un manifiesto con `verification_id: "BAD-ID"` ejecutó el runner con
  **exit 0** y escribió `data_verification.json` con `verification_id: "BAD-ID"`; el chequeo TS parcial lo aceptó (`typeof === 'string'`)
  mientras `validate_contracts.py --contract data-verification --file …` lo rechaza (exit 1, `pattern ^DV-[A-Za-z0-9._-]+$`).
- **Corrección propuesta:** decidir si el runner debe invocar el validador M-01 (Python) o si es aceptable el chequeo parcial; documentarlo explícitamente.
- **✅ RESOLUCIÓN (2026-10-12):** se **eliminó** `validateDataVerificationJson` (duplicación parcial) y el runner ahora invoca el
  **validador canónico M-01** mediante `validateArtifactM01(...)` → `python qa/tools/validate_contracts.py --contract data-verification --file <dv> --json`
  (reutiliza el mecanismo Python ya usado por el pre-flight M-04). El mismo manifiesto con `verification_id: 'BAD-ID'` ahora **falla con exit 2**
  y error explícito (`data_verification.json does not conform to the data-verification contract` + detalle `pattern` de M-01). No se crearon módulos nuevos.
  Test agregado: `runner.infra.spec.ts` “runtime M-01 gate rejects an invalid data_verification artifact”. Detalle en §15.

#### AUD-06 — [RESUELTO 2026-10-12] `MANIFEST.json` desactualizado (falta `docs/DATA-VERIFICATION.md`)
- **Evidencia (reproducido):** `manifest_version=1.10.0-core files=167 missing=0 extras=1`; el único archivo presente no listado es `docs/DATA-VERIFICATION.md`.
  (Recalculado en la remediación, el árbol sin regenerables tenía **169** archivos: además del omitido, `docs/QA-SYSTEM-AUDIT.md` — este
  mismo informe, creado durante la auditoría — tampoco estaba listado.)
- **Impacto (BAJO/MEDIO):** el inventario deja de ser completo (el propio scope dice “Every listed path exists” — verdad — pero no lista todo).
- **Método:** reproducido (`Test-Path` por entrada + diff de árbol).
- **Causa (confirmada):** `MANIFEST.json` (`generated 2026-10-11 04:27:13`) es anterior a `docs/DATA-VERIFICATION.md`
  (`2026-10-11 04:27:59`); el manifiesto se mantiene **a mano** (no hay generador ni validador de frescura) y no se regeneró. La
  omisión **no** es intencional ni coherente con el alcance (`docs/` = “QA Core infrastructure”; el resto de `docs/*.md` sí está listado).
- **✅ RESOLUCIÓN (2026-10-12):** se incorporó `"docs/DATA-VERIFICATION.md"` en el bloque ordenado de `docs/` (entre
  `CONTRACTS-VALIDATION.md` y `PLATFORM-ADAPTERS.md`); se actualizaron `version` (`1.10.0-core` → `1.11.0-core`) y `generated`
  (`2026-10-11` → `2026-10-12`); no se alteraron el `scope`, las demás entradas ni la estructura. Detalle en §18.
- **✅ CIERRE (2026-10-12):** `docs/QA-SYSTEM-AUDIT.md` también se incorporó al inventario. Se confirmó que **no existe** una regla
  documentada que excluya los informes de auditoría (`docs/QA-SYSTEM-STABILITY-AUDIT.md` ya estaba listado), por lo que su ausencia era
  otra omisión del mismo defecto. Estado final: **169 entradas, 0 faltantes, 0 duplicados, 0 archivos del alcance fuera del manifiesto.**
  Detalle en §18.

#### AUD-07 — Documentación vs implementación (M-02/M-06 “No implementado”; conteos de tests obsoletos)
- **Evidencia (confirmado por inspección):**
  - `automation/README.md:53` (“19 tests”), `:72` y `:106` (“21 tests”), `:121` (“M-02 reportes / M-06 BD | **No** (fuera de alcance)”).
  - `docs/AUTOMATION-ARCHITECTURE.md:29,37,110,124,126` marcan M-02 y M-06 como “futuro”/“No implementado”.
  - `README.md:58` (“21 tests: 2 smoke + 19 runner.infra”).
  - `docs/RUNNER-M03.md:8,129,237,275,264,289` (“19 tests: 9 M-03 + 6 M-05 + 4 M-02”, “21 tests”, “M-02 (reportes), 4 tests
    adicionales”, “Sin … generador de reportes propio (M-02)”).
  - Realidad medida en la auditoría: `npx playwright test --list` → **“Total: 49 tests in 3 files”** (`infra.smoke` 2 + `runner.infra` 27 + `sqlite-adapter` 20).
- **Impacto (MEDIO):** onboarding y estado del proyecto erróneos; contradice la gobernanza “documentado ≠ funcional”.
- **Método:** reproducido (`--list`) + lectura.
- **RESUELTO (AUD-07, 2026-10-12):** conteos y estados corregidos en `README.md:58`, `automation/README.md` (conteos, árbol de
  archivos, filas M-02/M-06 y dependencias de BD), `docs/AUTOMATION-ARCHITECTURE.md` (estado, diagrama y tabla §5) y
  `docs/RUNNER-M03.md` (conteos, desglose de tests y limitación de reportes). Realidad medida verificada: `playwright test --list`
  → **52 tests in 3 files** y `npm test` → **52 passed**. Detalle en §19.

#### AUD-08 — [RESUELTO 2026-10-12] `README.md`, `automation/README.md` y `docs/RUNNER-M03.md` con BOM y mojibake (doble codificación)
- **Evidencia (reproducido):** `README.md` → `bom=True`, 16 secuencias `â€…`; `automation/README.md` → `bom=True`, 7 secuencias.
  Códigos de carácter verificados en torno a “Orchestration” de `README.md`: `…96,32,226,8364,8220,32,…` = `â`+`€`+`“` (mojibake de `–`).
- **Impacto (BAJO/MEDIO):** los README se ven corruptos; el BOM además puede afectar herramientas de texto.
- **Método:** reproducido (lectura de bytes y conteo de secuencias).
- **✅ RESOLUCIÓN (AUD-08, 2026-10-12):** mojibake recuperable corregido y BOM eliminado (UTF-8 sin BOM) en `README.md`,
  `automation/README.md` y `docs/RUNNER-M03.md` (instancia adicional del mismo patrón detectada al ampliar el alcance);
  contenido, estructura, comandos, rutas e identificadores conservados, y finales de línea intactos (LF; CRLF en `RUNNER-M03.md`).
  `docs/QA-SYSTEM-AUDIT.md` conserva las secuencias de mojibake como **citas de evidencia** (no son daño). Detalle, backups y
  verificación en §20.

#### AUD-09 — Permisos: la sintaxis V1 es válida; deficiencia real de least-privilege en `bash` — **RESUELTO (2026-10-12)**
- **Ubicación:** `opencode.json` (`"permission": { "external_directory": "deny" }`, `"mcp": { "context7": … }`) y frontmatter de los 8 agentes (`permission: { edit/bash/task/external_directory }`).
- **Esperado (hipótesis AUD-09, doc OpenCode V2 — Permissions):** en V2 se usa `permissions` (array), `shell` y `subagent`; “V1 uses different field and action names… in V2, use `permissions`, `shell`, and `subagent` instead of `permission`, `bash`, and `task`”. Bajo la política base V2, si los nombres V1 no se honraran, `edit: deny` y los allowlist de `bash` **no restringirían** nada.
- **Observado (evidencia, 2.0.24):**
  - `opencode debug config` **normaliza** la config: `"permission": {…}` → `"permissions": [ { action, resource, effect } ]`, y `mcp.context7.enabled:false` → `servers.context7.disabled:true`. Es decir, **lee y transforma**, no ignora.
  - `opencode debug agents` lista las **permission efectivas** por agente con las reglas del frontmatter **mapeadas** (`edit`→`edit`, `bash`→`shell`, `task`→`subagent`, `external_directory`→`external_directory`). Código del binario instalado contiene el mapa `{bash:"shell", task:"subagent", apply_patch:"patch"}`.
  - La evaluación efectiva es `findLast` sobre la lista, que **siempre** comienza con el default materializado `{action:"*", resource:"*", effect:"allow"}` (sólo cae a `ask` si **nada** coincide). → un mapa `bash` **sin `"*"`** (o ausente) **no restringe**.
- **Runtime (antes del fix, `opencode run --standalone --agent … --format json`):** `qa-lead` **EJECUTÓ** `echo AUD09_PROBE_QL_NONALLOW` (allowlist **no** restrictiva); `bug-analyst` y `test-designer` **EJECUTARON** `echo` (sin regla `bash`); `test-executor` fue **RECHAZADO** por `"*": ask` (“cannot ask the user for permission”).
- **Impacto (ALTO, confirmado):** “least privilege / read-only por defecto” **no estaba aplicado** para `qa-lead` (allowlist inútil) ni para 4 agentes read-only (`test-designer`, `exploratory-qa`, `risk-analyst`, `bug-analyst`), que podían ejecutar shell arbitrario. `edit: deny`, `task: deny` y `external_directory: deny` **sí** se aplicaban.
- **Método / confianza:** `debug config`/`debug agents` + código del binario + pruebas de ejecución por agente. **ALTA** (sintaxis válida); **ALTA** (deficiencia de least-privilege).
- **Corrección (mínima, 2026-10-12):** `qa-lead` → `"*": ask` en `bash` (conserva su allowlist); `bug-analyst` → `"*": ask` + allowlist del validador (conserva su capacidad documentada); `test-designer`/`exploratory-qa`/`risk-analyst` → `bash: deny`. Detalle, evidencia y límites en §16. **No** se migró a la sintaxis V2: **no es necesaria**.

### P2/P3 — defectos menores y limitaciones

#### AUD-10 — [RESUELTO 2026-10-12] M-06: la doc sobreestimaba el límite de filas y el timeout; `params` en evidencia
- **Ubicación:** `automation/runner/sqlite-adapter.ts:192,199,322` vs `docs/DATA-VERIFICATION.md:134-136`.
- **Observado:**
  - “Row limit … prevents excessive data retrieval”: el código hace `rows.slice(0, limit)` (línea 199) **después** de traer todas las filas (`stmt.all()`); no evita la materialización en memoria.
  - “Query timeout (default 5000ms) prevents hanging”: la línea 192 ejecuta `PRAGMA busy_timeout = <timeout>`, que es una espera de **lock**, no un timeout de ejecución de sentencia.
  - `evidence.push('params: ' + JSON.stringify(request.params))` (línea 322) incorpora valores de parámetros a la evidencia/reporte; si contuvieran datos sensibles, se expondrían (contradice “no credentials … in reports”).
- **Impacto (BAJO/MEDIO):** expectativas incorrectas + posible exposición de datos en evidencia.
- **Método:** confirmado por inspección.
- **Corrección (mínima, 2026-10-12):** doc alineada al comportamiento real (materialización completa + `busy_timeout` = espera de lock + truncado que afecta `row_count`); y **no** se serializan valores de parámetros en la evidencia: se registra `params_bound: <n>` y `params` lleva un `<redacted>` por parámetro (aridad conservada; el valor reproducible sigue en el manifiesto). Detalle y evidencia en §21.
- **Estado:** ✅ **RESUELTO** (defecto de documentación confirmado; exposición era **riesgo potencial** —no había datos sensibles reales— mitigado por la redacción).

#### AUD-11 — Logs `DEBUG` residuales en el runner (y en el `.dist`) — **RESUELTO (2026-10-12)**
- **Ubicación:** `automation/runner/runner.ts:958,1039,1041,1043` y `automation/.dist/runner/runner.js` (4 líneas).
- **Observado:** `console.log('DEBUG: no verification results to write')`, `DEBUG: manifest.web_server = …`, `DEBUG: calling startServer...`, `DEBUG: startServer resolved` — sin flag, siempre activos.
- **Impacto (BAJO):** ruido en stdout de producción; apariencia de código sin terminar.
- **Método:** confirmado por inspección (grep). Atribución: etapa M-06.
- **Corrección (2026-10-12):** eliminadas las 4 líneas `DEBUG` de `runner.ts`; se **conservaron** los `console.log` operativos (banner, resumen `run … PASS/FAIL`, pre-flight, data verification). `automation/.dist/runner/runner.js` regenerado con `npm run build:runner`. Detalle en §21.
- **Estado:** ✅ **RESUELTO**.

#### AUD-12 — Línea del reporte de BLOCKED sin causas + reporte HTML sólo en inglés — **RESUELTO (2026-10-12, alcance acotado)**
- **Ubicación:** `automation/runner/report.ts:230-233` (sólo renderiza `blocked_reasons` si hay) y `runner.ts` (passa `blocked_reasons: []` cuando BLOCKED) → la sección Pre-flight muestra “BLOCKED” pero **sin causas**.
- **Idioma:** `report.ts:275` `<html lang="en">` y todas las etiquetas en inglés (“Pre-flight”, “Test Cases”, “Infrastructure Errors”, “Evidence Index”, “Light mode”…), mientras la UI de bienvenida (`docs/USER-INTERFACE.md`) está en español.
- **Impacto (BAJO):** pérdida de información en el reporte; inconsistencia de idioma con el usuario final.
- **Método:** confirmado por inspección.
- **Corrección (2026-10-12):** (a) las causas reales de pre-flight ahora se propagan al reporte: `runner.ts` pasa `causes` a `preflight.blocked_reasons` (antes `[]`) y agrega `block_reason` por caso; (b) presentación BLOCKED clara y en **español natural** (sección "Verificación previa (pre-flight)", "Resultado", "Registro", "Motivos del bloqueo", columna "Motivo del bloqueo" y una leyenda explicativa), conservando estados/JSON keys/IDs. La prueba no ejecutada nunca se marca PASS/FAIL (verificado: `summary.passed=failed=errors=skipped=executed=0`, `blocked=1`). **Alcance acotado por indicación del usuario:** no se tradujo el reporte completo ni la interfaz global; `lang="en"` se conserva porque el documento sigue siendo mayoritariamente en inglés. Detalle y límites en §21.
- **Estado:** ✅ **RESUELTO** (causas registradas + textos del estado BLOCKED en español; i18n global del reporte = fuera de alcance).

---

## 5. Diagnóstico de eficiencia / tokens

- **Runner sin tokens:** confirmado por diseño — `automation/runner/runner.ts` ejecuta Playwright por CLI; no invoca un modelo por paso
  (los tests M-03 verifican “re-run without AI intervention”). **Medido:** por inspección de código; no se instrumentó un contador de tokens.
- **Control de profundidad:** `opencode.json:4` `subagent_depth: 1` + `task: deny` en todos los subagentes → sólo QA Lead delega. Buena contención de costo. **VERIFICADO** por inspección.
- **Oportunidad de optimización (no medida):** las reglas núcleo (“NO EVIDENCE = NO CONFIRMED RESULT”, diferenciación
  `tool called → … → result validated`, `FAIL ≠ APP_BUG`) se **repiten** en `AGENTS.md`, los 8 agentes y varias de las 12 skills.
  Es costo de tokens por sesión y riesgo de deriva documental. **Beneficio:** hipotético hasta medir (no se midió).
- **Interfaz de bienvenida** (`docs/USER-INTERFACE.md`) se muestra en la primera interacción: costo fijo por sesión, aceptable.
- **Carga de instrucciones:** `AGENTS.md` se carga siempre; su sección “Models” lista los IDs configurados, **todos existentes y `active`**
  (verificado con `all: true`; ver AUD-02, cerrado como falso positivo).
- **No verificado:** no se midió latencia real de los agentes ni consumo de tokens (requeriría correr los agentes con sus modelos reales).

---

## 6. Evaluación de agentes, modelos y herramientas

**Agentes (8):** `qa-lead` (primary, orquesta), `test-designer`, `exploratory-qa`, `risk-analyst`, `test-executor`,
`test-data`, `bug-analyst`, `qa-reviewer`. Definiciones consistentes con `AGENTS.md`; permisos declarados con `edit: deny`.
**Ejecución de shell (verificada 2026-10-12, AUD-09, §16):** `test-executor` (allowlist de pruebas), `qa-lead` y `bug-analyst`
(allowlist acotada + `"*": ask`), y **`deny`** en `test-designer`, `exploratory-qa`, `risk-analyst`, `test-data` y `qa-reviewer`
(ejecución es exclusiva de `test-executor`). Coordinación de `qa-lead` (permisos `task`) habilita a los 7 subagentes.
**VERIFICADO** (config + enforcement, ver §16).

**Observaciones de diseño (preferencias / riesgos):**
- `risk-analyst` no tiene una skill propia dedicada (no existe skill “risk”); su procedimiento vive sólo en el prompt del agente
  y en `docs/VALIDATION-POLICY.md`. Es una **preferencia de diseño** aceptable, pero rompe la simetría “agente ↔ skill”.
- `qa-reviewer` y `test-data` tienen `bash: deny` (correcto para no ejecutar), pero QA Reviewer podría necesitar leer evidencia de forma acotada.

**Modelos (medido, actualizado 2026-10-11):** catálogo `opencode` = **41** modelos con `all: true` (la vista por defecto
muestra 39 porque oculta versiones no-nuevas). Los **4** modelos configurados **existen y están `active`**:
`qa-lead/test-designer/risk-analyst/test-data/bug-analyst → nemotron-3-ultra-free`,
`exploratory-qa → mimo-v2.6-flash-free`, `test-executor → nemotron-3.5-lightning-free`,
`qa-reviewer → longcat-2.5-preview-free`. Ver AUD-02 (cerrado como falso positivo) y §14.

**Herramientas / adapters:** Playwright Web/API (M-03/M-05) y `api-testing` (skill) están desacoplados del Core (no hay
dependencias Python↔Node). M-04 pre-flight es Python stdlib read-only. M-06 usa `node:sqlite` (experimental en Node 24).
**VERIFICADO** por inspección.

---

## 7. Comandos y resultados reales

```text
# 1) ¿Es repo git?
git status --short  → fatal: not a git repository ; exit=128 ; Test-Path .git → False

# 2) Type-check (reprodujo el P1 durante la auditoría; RESUELTO 2026-10-11)
npm.cmd run typecheck
  → (antes) automation/runner/runner.ts(764,26): error TS2552: Cannot find name 'dataVerifications'. ; typecheck_exit=2
  → (después de AUD-01) sin errores ; exit 0
npx.cmd tsc -p automation/runner/tsconfig.json --noEmit
  → (antes) mismo error ; build_check_exit=2

# 3) Conteo real de tests (no destructivo)
npx.cmd playwright test --list  → "Total: 49 tests in 3 files"
  (infra.smoke 2 · runner.infra 27 · sqlite-adapter 20)
  → tras AUD-05: 50 tests (runner.infra 28, +1 test del gate M-01 runtime)

# 4) M-01: bundle sobre artefactos reales (qa/)
python qa/tools/validate_contracts.py --bundle qa --json
  → valid:true ; records 31 ; errors 0 ; warnings 0

# 5) M-01: bundle sobre la salida del runner (revelaba AUD-03; RESUELTO 2026-10-12)
python qa/tools/validate_contracts.py --bundle automation/.runs/m06final-20261011-221241 --json
  → (antes) data_verification.json y report.json → "could not determine the contract for this artifact" (warning)
  → (después) data_verification.json → contrato `data-verification` (1 record, VALID)
              report.json            → contrato `execution-report` (1 record, VALID)
  → execution_trace.json   → valid

# 6) Pruebas Python (M-01/M-04/M-06)
python -m unittest discover -s qa/tools -p "test_*.py"
  → Ran 111 tests in 34.550s ; OK ; exit 0

# 7) MANIFEST vs árbol (antes del fix)
manifest_version=1.10.0-core ; files=167 ; missing=0 ; extras=1 → docs/DATA-VERIFICATION.md

# 7b) MANIFEST vs árbol — AUD-06, después del cierre
manifest_version=1.11.0-core ; files=169 ; missing=0 ; duplicates=0 ; extras=0 (sin archivos del alcance fuera del manifiesto)

# 8) Encoding
README.md → bom=True ; mojibake(â€…)=16 ; automation/README.md → bom=True ; mojibake=7

# 9) Modelos (herramienta de modelos de OpenCode)
opencode, vista por defecto (39): NO incluye nemotron-3-ultra-free     ← lectura INICIAL (incompleta)
opencode, all:true (41): nemotron-3-ultra-free, nemotron-3.5-lightning-free, mimo-v2.6-flash-free,
  longcat-2.5-preview-free  → TODOS presentes y active (corrige AUD-02; ver §14)

# 9b) Validación de la remediación AUD-01 (2026-10-11)
npm.cmd run typecheck → exit 0 ; npm.cmd test → 49 passed ; python -m unittest discover → Ran 111 … OK
python qa/tools/validate_contracts.py --bundle qa --json → valid:true ; records 31 ; errors 0 ; warnings 0

# 9c) Validación de la remediación AUD-03 / AUD-05 (2026-10-12)
npm.cmd run typecheck → exit 0
npm.cmd test → 50 passed (incl. "runtime M-01 gate rejects an invalid data_verification artifact")
python -m unittest discover -s qa/tools -p "test_*.py" → Ran 114 … OK
python qa/tools/validate_contracts.py --bundle qa --json → valid:true ; records 31 ; errors 0 ; warnings 0
python qa/tools/validate_contracts.py --bundle automation/.runs/m06final-20261011-221241
  → data-verification VALID (1) · execution-report VALID (1) · 0 errors   (antes: 2 "unknown")
python qa/tools/validate_contracts.py --contract execution-report --file …/report.json → VALID
python qa/tools/validate_contracts.py --contract data-verification --file …/data_verification.json → VALID
# AUD-05 (manifiesto con verification_id='BAD-ID', base SQLite válida):
#   antes   → runner exit 0 (pasaba el chequeo TS parcial) ; --contract data-verification --file → INVALID (pattern)
#   después → runner exit 2 + "data_verification.json does not conform to the data-verification contract" + detalle M-01

# 10) Evidencia (href en report.html real) — ANTES del fix
href="automation/.runs/m06final-20261011-221241/evidence/TC-M06-FINAL-1_assertions.json"   (report.html vive en ese dir)

# 10b) AUD-04 — resolución del href por el navegador (reporte servido por HTTP)
#   ANTES (reporte histórico pre-fix)
#     href="automation/.runs/m06-assoc-test/evidence/TC-1_assertions.json"
#     GET http://127.0.0.1:4212/automation/.runs/m06-assoc-test/evidence/TC-1_assertions.json → 404
#   DESPUÉS (reporte regenerado con el fix)
#     href="evidence/TC-DEMO-WEB-1_assertions.json"
#     GET http://127.0.0.1:4211/evidence/TC-DEMO-WEB-1_assertions.json → 200 application/json (1114 B)
```

> Nota: el `exit=-1` que muestra PowerShell en algunos comandos Python proviene del manejo de stderr
> (`NativeCommandError`), no de un fallo del test; el total `Ran 111/114 … OK` y el `valid:true` son los resultados reales.

---

## 8. Diferencias documentación vs implementación (resumen)

| Doc | Dice | Realidad medida |
| --- | --- | --- |
| `README.md:58` | “npm test … 21 tests (2 smoke + 19 runner.infra)” | **RESUELTO (AUD-07, 2026-10-12):** corregido a **52 tests** (2 smoke + 30 `runner.infra` + 20 `sqlite-adapter`) |
| `automation/README.md:53,72,106` | “19/21 tests” | **RESUELTO (AUD-07, 2026-10-12):** conteos corregidos (52); árbol con `report.ts`/`sqlite-adapter.ts`/`sqlite-adapter.spec.ts` |
| `automation/README.md:121` | M-02 y M-06 “No (fuera de alcance)” | **RESUELTO (AUD-07, 2026-10-12):** filas M-02/M-06 = implementados/verificados |
| `docs/AUTOMATION-ARCHITECTURE.md:29,37,110,124,126` | M-02/M-06 “futuro”/“No implementado” | **RESUELTO (AUD-07, 2026-10-12):** estado, diagrama y tabla §5 = implementados |
| `docs/RUNNER-M03.md:8,129,237,275,264,289` | “19/21 tests”; “Sin … generador de reportes propio (M-02)” | **RESUELTO (AUD-07, 2026-10-12):** conteos corregidos (52; 30 `runner.infra`) y M-02 = implementado (`report.json`+`report.html`) |
| `docs/CONTRACTS-VALIDATION.md:30-48` | 14 contratos “covered” | `index.json` registra **17** (incluye M-02/M-05/M-06) |
| `docs/DATA-VERIFICATION.md:103` | `data_verification.json` = “M-01 contract” | **RESUELTO (AUD-05, 2026-10-12):** runtime ahora valida con M-01; doc alineada |
| `docs/DATA-VERIFICATION.md:134-136` | row limit / query timeout “prevents…” | **RESUELTO (AUD-10, 2026-10-12):** doc corregida (el límite no evita la materialización; `timeout_ms` es `busy_timeout`, no timeout de ejecución) y los valores de `params` ya no se serializan en la evidencia |
| `MANIFEST.json` | inventario completo | **RESUELTO (AUD-06, 2026-10-12):** `docs/DATA-VERIFICATION.md` y `docs/QA-SYSTEM-AUDIT.md` incorporados (169 entradas; 0 faltantes, 0 duplicados, 0 fuera del alcance) |

---

## 9. Limitaciones aceptables vs mejoras opcionales

**Limitaciones aceptables (conocidas, no defectos):**
- El runner ejecuta suites **demo aisladas** (`demo-qaa`, `heal-demo`) — de los 11 TC de negocio DC Shoes sólo TC-001 está portado.
- Sólo Chromium instalado (Firefox/WebKit bajo demanda).
- M-06 soporta sólo SQLite (`node:sqlite` experimental en Node 24).
- M-01 es un **subconjunto** de JSON Schema Draft 2020-12 con self-check D1 (rechaza keywords no soportadas).
- El store HC de auto-healing termina con entradas `STALE` por diseño; la no-lectura del store no es observable dinámicamente.
- No hay CI ni verificación automática de frescura documental (por eso persistieron AUD-06/AUD-07; ambos ya se remediaron a mano).

**Mejoras opcionales (valor/riesgo razonable):**
- Añadir `LICENSE` y preparar `.github/` (la preparación GitHub está incompleta: **no existe `LICENSE`**).
- Renombrar/documentar el script `npm run report` (hoy abre el **reporte de Playwright**, no el `report.html` de M-02 — `package.json:24`).
- Reducir duplicación de reglas núcleo entre agentes/skills (tokens).
- Chequeo de frescura documental (p. ej. contar `test()` y comparar con README).

---

## 10. Inventario de traducción ES (es-AR) — resumen

Clasificación: **Traducir** (texto de cara al usuario) · **Conservar** (identificadores/valores de contrato) · **Equivalencia técnica**.

| Archivo / ubicación | Estado actual | Propuesta | Clasificación |
| --- | --- | --- | --- |
| `automation/runner/report.ts` y etiquetas (`Pre-flight`, `Test Cases`, `Infrastructure Errors`, `Evidence Index`, `Light/Dark mode`, `Block Reason`) | Inglés | **Parcial (AUD-12, 2026-10-12):** textos de estado BLOCKED/pre-flight en es-AR ("Verificación previa (pre-flight)", "Resultado", "Registro", "Motivos del bloqueo", "Motivo del bloqueo"). El resto se conserva en inglés por indicación del usuario (no traducir la interfaz globalmente); `lang="en"` sin cambios | Traducir (prioridad alta: es el artefacto que ve el usuario) |
| `README.md:43` | Mezcla: “… + reportes (M-02): base de automatización …, desacoplada del QA Core” | Unificar idioma del README | Traducir/Conservar (decidir idioma único) |
| `automation/README.md`, `docs/AUTOMATION-ARCHITECTURE.md`, `docs/QA-SYSTEM-STABILITY-AUDIT.md` | Español | Consistente | Conservar |
| `docs/AGENT-CONTRACTS.md`, `CONTRACTS-VALIDATION.md`, `DATA-VERIFICATION.md`, `PLATFORM-ADAPTERS.md`, `VALIDATION-POLICY.md` | Inglés | Traducir prosa; conservar IDs/enums | Traducir prosa + Conservar identificadores |
| Valores de contrato (`PASS/FAIL/BLOCKED`, `APP_BUG`, `TEST_DATA`, `NOT VERIFIED`, `verification_id`, `DV-…`) | Inglés | **No traducir** | Conservar (comparabilidad de contratos) |
| `README.md` / `automation/README.md` / `docs/RUNNER-M03.md` (AUD-08) | Mojibake (`â€"`, `Â`, `Ã³`) | Corregir codificación antes/además de traducir | **RESUELTO (2026-10-12):** mojibake y BOM corregidos (UTF-8 sin BOM) |

**Términos repetidos inconsistentemente detectados:** “Test Case/TC”, “Evidence/Evidencia”, “Failure Classification”,
“Pre-flight”, “Runner” — se usan sin criterio único entre docs ES e EN. **Riesgo de compatibilidad:** traducir
nombres de contrato/enums rompería M-01; **no** deben tocarse. **Casos dudosos:** `docs/REPORT-MODES.md` mezcla títulos EN
con cuerpos ES (intencional según su sección “Terminology”).

> **Nota (2026-10-12):** la **comunicación dinámica** con el usuario ahora sigue la *Language Policy* central
> de `AGENTS.md` (heredada por los 8 agentes); la documentación interna conserva su idioma. Alcance,
> verificación de herencia y validación en runtime: **§30**.

---

## 11. Riesgos residuales

1. ~~**Build/CI inutilizable** mientras AUD-01 no se corrija~~ → **mitigado:** AUD-01 **RESUELTO** (2026-10-11); `typecheck` 0, `npm test` 49.
2. ~~**Agentes con modelo inexistente** (AUD-02)~~ → **descartado:** los 4 modelos existen y están `active`; resta la **decisión de asignación** (sin benchmark ejecutado).
3. ~~**Permisos no verificados** (AUD-09): riesgo de que “least privilege” no esté técnicamente aplicado.~~ → **mitigado (2026-10-12):**
   V1 es válido en 2.0.24 (no requiere migrar) y el enforcement quedó verificado por diagnóstico + ejecución; se corrigió la falta de
   comodín `"*"` (`qa-lead`) y las reglas `bash` ausentes en 4 agentes read-only. Ver §16.
4. ~~**Validación M-01 incompleta en runtime/bundle** (AUD-03/AUD-05): artefactos M-02/M-06 podrían consolidarse sin validar.~~ →
   **mitigado:** AUD-03/AUD-05 **RESUELTOS** (2026-10-12); el bundle detecta `report.json`/`data_verification.json` y el runner valida
   `data_verification.json` con el validador canónico M-01.
5. ~~**Enlaces de evidencia no navegables en `report.html`** (AUD-04): el reporte HTML no permitía abrir la evidencia.~~ →
   **mitigado (2026-10-12):** AUD-04 **RESUELTO**; `href` relativos al propio reporte, verificados en navegador (200 vs 404). Ver §17.
6. ~~**`MANIFEST.json` incompleto** (AUD-06): decisiones tomadas sobre un inventario desactualizado.~~ → **mitigado (2026-10-12):**
   AUD-06 **RESUELTO** (`docs/DATA-VERIFICATION.md` incorporado; ver §18).
7. ~~**Documentación desactualizada/corrupta** (AUD-07 resuelto; AUD-08 pendiente): decisiones tomadas sobre estado erróneo.~~ → **mitigado (2026-10-12):** AUD-07 (docs alineadas) y **AUD-08** (encoding BOM/mojibake) **RESUELTOS**; sin discrepancias conocidas dentro del alcance.
8. **Sin Git y sin LICENSE** (AUD-*): cambios irreversibles y preparación GitHub incompleta.
9. ~~**M-06 con doc inexacta (`prevents…`), `params` serializados en evidencia, `DEBUG` residual y reporte de BLOCKED sin causas** (AUD-10/AUD-11/AUD-12).~~ → **mitigado (2026-10-12):** AUD-10 (doc corregida + valores de `params` no persistidos), AUD-11 (4 líneas `DEBUG` eliminadas; logs operativos conservados) y AUD-12 (causas reales propagadas al reporte + textos del estado BLOCKED en es-AR) **RESUELTOS**; ver §21. Resta como **mejora opcional** la i18n completa del `report.html` (fuera de alcance por indicación del usuario).

---

## 12. Plan de remediación (priorizado)

**Fixes necesarios (runtime/contratos):**
1. **AUD-01 [P1]** ✅ **RESUELTO (2026-10-11)** — eliminadas las líneas 763–764; `typecheck` 0, `npm test` 49, Python 111 OK. Ver §13.
2. **AUD-02** ✅ **FALSO POSITIVO / CERRADO** — los 4 modelos existen y están `active`; **no** es una corrección necesaria,
   sólo una **decisión de asignación** opcional (propuesta en §14). *(requiere aprobación del usuario)*
3. **AUD-03 [P2]** ✅ **RESUELTO (2026-10-12)** — `verification_id`/`report_id` en `artifact_hints` + tests de detección/bundle. Ver §15.
4. **AUD-04 [P2]** ✅ **RESUELTO (2026-10-12)** — `href` del `report.html` relativos al propio reporte (POSIX + percent-encoding)
   en Casos, índice de evidencias y `preflight.record_path`; tests de resolución y de espacios/no-ASCII. Ver §17.
5. **AUD-05 [P2]** ✅ **RESUELTO (2026-10-12)** — el runner valida `data_verification.json` con el validador canónico M-01. Ver §15.
6. **AUD-06 [P2]** ✅ **RESUELTO (2026-10-12)** — `docs/DATA-VERIFICATION.md` y `docs/QA-SYSTEM-AUDIT.md` incorporados al inventario (`1.11.0-core`, 169 entradas; 0 faltantes, 0 duplicados, 0 fuera del alcance); ver §18.
7. **AUD-07 [P2]** ✅ **RESUELTO (2026-10-12)** — conteos y estados de M-02/M-06 corregidos en `README.md`, `automation/README.md`, `docs/AUTOMATION-ARCHITECTURE.md` y `docs/RUNNER-M03.md` (ver §19).
8. **AUD-08 [P2]** ✅ **RESUELTO (2026-10-12)** — mojibake (doble codificación CP1252 reinterpretada como UTF-8) corregido y normalizado a UTF-8 sin BOM en `README.md`, `automation/README.md` y `docs/RUNNER-M03.md`; contenido, comandos y finales de línea conservados (ver §20).
9. **AUD-09 [P2]** ✅ **RESUELTO (2026-10-12)** — V1 es válido en OpenCode 2.0.24 (**no** requiere migrar a V2); enforcement verificado
   por diagnóstico + ejecución, y corregida la deficiencia de least-privilege en `bash` (`qa-lead`, `bug-analyst`, `test-designer`,
   `exploratory-qa`, `risk-analyst`). Ver §16.

**Optimizaciones opcionales (post-fix):**
- ~~**AUD-10/AUD-11/AUD-12 [P3]** límites de M-06 (timeout real, no serializar `params` sensibles), quitar `DEBUG`, mostrar causas de BLOCKED, i18n del HTML.~~ → **RESUELTOS (2026-10-12, ver §21):** doc de límites corregida y `params` no serializados (AUD-10); `DEBUG` eliminado (AUD-11); causas de BLOCKED en el reporte + textos de estado en es-AR (AUD-12). Queda como **mejora opcional** la i18n completa del `report.html` (no solicitada).
- Reducir duplicación de reglas núcleo; añadir `LICENSE`; chequeo de frescura documental; renombrar `npm run report`.

**Gates de aceptación sugeridos:** `npm run typecheck` 0 · `npm test` 55 PASS · `python -m unittest discover -s qa/tools -p "test_*.py"` OK ·
`validate_contracts.py --bundle qa` `valid:true` · `--bundle <out>` detectando también `report.json`/`data_verification.json`.

---

## 13. Registro de remediación — AUD-01 (2026-10-11)

**Alcance autorizado:** resolver exclusivamente AUD-01. No se tocaron `opencode.json`, `AGENTS.md`, los archivos de agentes,
modelos, permisos ni dependencias; no se implementaron otros hallazgos.

**Preservación del estado (antes de modificar):**
- Backup **fuera del repo** (para no alterar el inventario): `%LOCALAPPDATA%\Temp\opencode\AUD-01-backup\`
  con `automation\runner\runner.ts` (46.923 B) y `automation\.dist\runner\runner.js` (44.532 B).
- SHA-256 — `runner.ts`: antes `BA0340F5…34D5C6` → después `53B920E9…381EAB`;
  `.dist/runner.js`: antes `EB2219B3…F83445` → después `2F2908AA…4434FE`.

**Causa confirmada:** `dataVerifications` es una `const` local de `main()` (`runner.ts:1089`); la línea 764 la referenciaba desde
la función top-level `writeExecutionReports` (`runner.ts:751`). Era **redundante**: `buildReportInput` ya fija
`summary.errors: counts.errors` (`runner.ts:719-724`) y el runner ya pasa `errors: dataVerifications.errors` (`runner.ts:1136`);
en el camino pre-flight BLOCKED (`runner.ts:1064`) habría lanzado `ReferenceError`.

**Corrección aplicada (mínima):** eliminadas **2 líneas** en `writeExecutionReports` (comentario + asignación). El diff contra el
backup muestra **únicamente** esas 2 líneas. No se alteró la lógica de M-06 ni de ningún otro módulo. Los `console.log('DEBUG…')`
(AUD-11) se conservaron.

| # | Comando | Resultado | Exit |
| --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | sin errores | **0** |
| 2 | `npm.cmd run build:runner` | `.dist` regenerado (mtime posterior a `runner.ts`) | **0** |
| 3 | `npm.cmd test` | **49 passed** (incl. 6 M-06, 6 M-02, 20 SQLite) | **0** |
| 4 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 111 tests … OK** | **0** |
| 5 | `python qa/tools/validate_contracts.py --bundle qa --json` | `valid:true`, records 31, errors 0, warnings 0 | **0** |

**Frescura del build (no dependencia de artefactos obsoletos):** `npm test` ejecuta `pretest → build:runner`, por lo que compila
antes de testear; se verificó que la función compilada ya no contiene la referencia (`refs_en_funcion=0`) y que el `.dist` quedó
con mtime posterior a `runner.ts`.

**MANIFEST.json:** no requiere actualización (no tiene hashes; `automation/runner/runner.ts` conserva su ruta; `.dist` no está listado).

**Estado:** ✅ **RESUELTO y validado.**

---

## 14. Investigación de modelos (AUD-02) y propuesta de asignación

### 14.1 Configuración actual de los 8 agentes

| Agente | ID configurado (frontmatter `model:`) | Proveedor | Nombre visible | ¿Resuelve? |
| --- | --- | --- | --- | --- |
| qa-lead | `opencode/nemotron-3-ultra-free` | opencode | Nemotron 3 Ultra Free | ✅ `active` |
| test-designer | `opencode/nemotron-3-ultra-free` | opencode | Nemotron 3 Ultra Free | ✅ `active` |
| risk-analyst | `opencode/nemotron-3-ultra-free` | opencode | Nemotron 3 Ultra Free | ✅ `active` |
| test-data | `opencode/nemotron-3-ultra-free` | opencode | Nemotron 3 Ultra Free | ✅ `active` |
| bug-analyst | `opencode/nemotron-3-ultra-free` | opencode | Nemotron 3 Ultra Free | ✅ `active` |
| exploratory-qa | `opencode/mimo-v2.6-flash-free` | opencode | MiMo-V2.6-Flash Free | ✅ `active` |
| test-executor | `opencode/nemotron-3.5-lightning-free` | opencode | Nemotron 3.5 Lightning Free | ✅ `active` |
| qa-reviewer | `opencode/longcat-2.5-preview-free` | opencode | LongCat 2.5 Preview Free | ✅ `active` |

(Coincide exactamente con `AGENTS.md:83-90`.)

**Evidencia:** catálogo de OpenCode consultado **con `all: true`** → 41 modelos; los 4 IDs presentes, `status: active`, `cost: 0/0`.
`nemotron-3-ultra-free` liberado 2026-06-04; `nemotron-3.5-lightning-free` 2026-08-11.

### 14.2 Comprobado vs. pendiente

- **Comprobado (evidencia):** existencia de los 4 IDs, `active`, costo 0, fecha de release.
- **Pendiente (NO VERIFICADO):** invocación real de cada modelo (no se ejecutaron agentes), benchmarks de calidad/velocidad,
  estabilidad y límites de tasa del tier gratuito.

### 14.3 Clasificación de la causa (AUD-02)

| Categoría | ¿Aplica? |
| --- | --- |
| Modelo inexistente | **No** — existe en el catálogo |
| Identificador incorrecto | **No** — el ID coincide carácter a carácter |
| Alias | **No** — el ID es el propio |
| Modelo no disponible en el catálogo actual | **No** — presente y `active` |
| Fallo temporal del proveedor | **No** — no se invocó ningún modelo |
| Modelo válido que NO es la versión más nueva de su familia | **Sí** — oculto por la vista por defecto |

### 14.4 Propuesta de asignación (los 8 agentes) — pendiente de aprobación

| Agente | Modelo recomendado | Justificación (responsabilidades) | Ventajas esperadas | Riesgos / alternativas |
| --- | --- | --- | --- | --- |
| qa-lead | `opencode/nemotron-3-ultra-free` | Orquestación + consolidación final; mayor carga de razonamiento | Línea “Ultra” (gama alta), gratuito, disponible | Sin benchmark; alt.: `space-bunny-free` |
| test-designer | `opencode/nemotron-3-ultra-free` | Diseño de casos y cobertura | Idem | Alt.: `longcat-2.5-preview-free` |
| risk-analyst | `opencode/nemotron-3-ultra-free` | Evaluación y priorización de riesgo | Idem | Alt.: `longcat-2.5-preview-free` |
| bug-analyst | `opencode/nemotron-3-ultra-free` | Análisis de fallas + Failure Classification | Idem | Alt.: `longcat-2.5-preview-free` |
| test-data | `opencode/nemotron-3-ultra-free` | Identificación/validación de datos y trazabilidad | Idem | Carga menor: `lightning` si se prioriza velocidad |
| exploratory-qa | `opencode/mimo-v2.6-flash-free` | Exploración iterativa guiada por riesgo; velocidad | “Flash”: rápido, gratuito | Menor profundidad en casos complejos; alt.: `ling-3.1-flash-free` |
| test-executor | `opencode/nemotron-3.5-lightning-free` | Ejecución controlada + captura de evidencia | “Lightning”: rápido, gratuito | Alt.: `mimo-v2.6-flash-free` |
| qa-reviewer | `opencode/longcat-2.5-preview-free` | Revisión **independiente** del QA Lead | **Modelo distinto** a qa-lead → menor sesgo compartido; gratuito | “preview” (menos estable); alt.: `space-bunny-free` |

**Nota:** no se ejecutaron los modelos, por lo que las “ventajas” se basan en rol/nombre/disponibilidad, no en benchmarks.
Todos los recomendados son **gratuitos y `active`**.

### 14.4.1 ¿Conviene reducir la cantidad de modelos?

- Actual: **4 modelos** (`ultra` ×5, `mimo-flash`, `lightning`, `longcat`).
- Reducir a **3** uniendo qa-reviewer a `ultra` elimina la **diversidad de modelo** y debilita la revisión independiente (riesgo funcional).
- Reducir a **2** (`ultra` + `lightning`) es viable operativamente, pero pierde diversidad para qa-reviewer.
- **Recomendación:** **mantener los 4** (o bajar a 3 solo si se acepta perder diversidad del reviewer). No reducir a 1–2.

### 14.5 Riesgo metodológico detectado

La vista **por defecto** del catálogo lista solo la versión más nueva por familia y puede **ocultar** modelos válidos
(caso `nemotron-3-ultra-free`). **Regla:** verificar disponibilidad con `all: true` antes de concluir “inexistente”.

---

## 15. Registro de remediación — AUD-02 / AUD-03 / AUD-05 (2026-10-12)

**Alcance autorizado:** resolver exclusivamente AUD-02, AUD-03 y AUD-05. No se tocaron `opencode.json`, `AGENTS.md`, los archivos
de agentes, los modelos, los permisos ni las dependencias; no se implementaron otros hallazgos (AUD-04, AUD-06…AUD-12 siguen pendientes).

**Preservación del estado (antes de modificar):** backup **fuera del repo** (para no alterar el inventario) en
`%LOCALAPPDATA%\Temp\opencode\AUD-03-05\backup\`, con los archivos afectados/relacionados y sus SHA-256:
`qa\schema\index.json` (4.035 B, `3344519E…`), `automation\runner\runner.ts` (46.821 B, `53B920E9…`),
`automation\.dist\runner\runner.js` (44.423 B, `2F2908AA…`), `automation\tests\runner.infra.spec.ts` (60.503 B, `4A8502F8…`),
`qa\tools\test_validate_contracts.py` (19.375 B, `9CE96812…`), `qa\tools\test_data_verification.py` (5.619 B, `4DEE4311…`),
`qa\tools\test_report_generator.py` (13.848 B, `1D83C432…`), `docs\QA-SYSTEM-AUDIT.md` (43.653 B, `53BE6113…`).
(Se respaldaron también dos archivos de test que finalmente **no** se modificaron, para dejar constancia del estado previo.)

**AUD-02 — sin cambio de código (falso positivo).** No se modifica `AGENTS.md` ni el frontmatter de agentes; la asignación de modelos
queda **igual**. Sólo se corrige la premisa en este informe (§4 y §14).

**Causa confirmada (AUD-03 y AUD-05 tienen causas distintas):**
- **AUD-03:** `artifact_hints` (`qa/schema/index.json`) no mapeaba las claves identificadoras de dos artefactos del runner, así que
  el modo `--bundle` no podía detectarlos y los dejaba como `unknown` (warning). Causa: **falta de detección**, no falta de contrato.
- **AUD-05:** el runner validaba `data_verification.json` con un chequeo TypeScript propio (`validateDataVerificationJson`) que
  duplicaba **parcialmente** el esquema (`typeof === 'string'`), más débil que M-01 (no aplicaba `pattern`, `minLength`, mínimos).
  Causa: **duplicación reducida y desalineada** del contrato.

**Correcciones aplicadas (mínimas, reutilizando M-01):**
1. `qa/schema/index.json`: agregadas **2 entradas** a `artifact_hints` — `"report_id": "execution-report"` y
   `"verification_id": "data-verification"`.
2. `automation/runner/runner.ts`: **eliminado** `validateDataVerificationJson` (chequeo parcial) y reemplazado por `validateArtifactM01(...)`,
   que invoca el **validador canónico M-01** (`python qa/tools/validate_contracts.py --contract <c> --file <f> --json`), reutilizando el
   mecanismo Python ya usado por el pre-flight M-04. Se conserva el `fail(..., EXIT_USAGE)` ante artefacto inválido. No se crearon módulos
   nuevos ni validaciones redundantes.

**Verificación antes/después (reproducida):**

| # | Escenario | Antes | Después |
| --- | --- | --- | --- |
| 1 | `--bundle` de un run con `report.json` + `data_verification.json` | ambos `unknown` (warning); bundle `valid:true` sin validarlos | `data-verification` (1) y `execution-report` (1) detectados y **VALID** |
| 2 | manifiesto `verification_id='BAD-ID'` | runner **exit 0**; `--contract data-verification --file` → INVALID (pattern) | runner **exit 2** + “does not conform to the data-verification contract” + detalle `pattern` |
| 3 | bundle con `report.json` inválido (sin `summary`) y `data_verification.json` inválido | `report.json` no se validaba ni se detectaba | bundle **INVALID** con errores `required`/`pattern` en ambos contratos |

| # | Comando | Resultado | Exit |
| --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | sin errores | **0** |
| 2 | `npm.cmd run build:runner` | `.dist` regenerado | **0** |
| 3 | `npm.cmd test` | **50 passed** (incluye el nuevo gate M-01 en runtime) | **0** |
| 4 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests … OK** | **0** |
| 5 | `python qa/tools/validate_contracts.py --bundle qa --json` | `valid:true`, records 31, errors 0, warnings 0 | **0** |
| 6 | `… --bundle automation/.runs/m06final-20261011-221241` | `data-verification` VALID + `execution-report` VALID | **0** |
| 7 | `… --contract execution-report --file …/report.json` | VALID (1 record) | **0** |
| 8 | `… --contract data-verification --file …/data_verification.json` | VALID (1 record) | **0** |

**Diferenciación pedida (objeto en memoria vs archivo serializado vs bundle):** la detección/validación se ejercen sobre el **archivo
serializado** (`--file`) y sobre el **bundle** (`--bundle`). El runner ya no valida un objeto en memoria: valida el
`data_verification.json` **escrito a disco** con el mismo validador M-01 que usa el bundle. No se introdujo un validador nuevo.

**MANIFEST.json:** no requiere actualización (lista rutas, no hashes; los archivos modificados conservan su ruta y no se agregaron ni
eliminaron archivos administrados).

**Estado:** ✅ **AUD-03 y AUD-05 RESUELTOS y validados; AUD-02 cerrado como falso positivo (sin cambio de asignación de modelos).**

---

## 16. Registro de remediación — AUD-09 (permisos: sintaxis y enforcement) — 2026-10-12

**Alcance autorizado:** determinar si los permisos declarados se aplican **efectivamente** en la versión instalada y corregir
**sólo** las deficiencias demostradas, preservando las capacidades de cada rol (un hallazgo por vez, con aprobación del usuario).

**Versión y mecanismo (evidencia).** Instalado: **OpenCode Desktop 2.0.24**; CLI
`%APPDATA%\ai.opencode.desktop\cli\<version>\opencode-cli.exe` (`opencode v2.0.24`).
Mecanismos oficiales usados: `opencode debug config`, `opencode debug agents`; y pruebas de ejecución por agente con
`opencode run --standalone --agent <a> --model <m> --format json`.

**16.1 Premisa de AUD-09 → FALSO POSITIVO (la sintaxis V1 es válida y no requiere migrar).**
- `opencode debug config` **normaliza** la config: `"permission": {…}` → `"permissions": [ {action,resource,effect} ]`, y
  `mcp.context7.enabled:false` → `servers.context7.disabled:true`. Se **lee y transforma**, no se ignora.
- `opencode debug agents` muestra las **permission efectivas**: las reglas del frontmatter aparecen **mapeadas**
  (`edit`→`edit`, `bash`→`shell`, `task`→`subagent`, `external_directory`→`external_directory`).
- Binario instalado: mapa `{bash:"shell", task:"subagent", apply_patch:"patch"}` y esquema con claves V1 (`bash`, `task`).
- **Conclusión (ALTA):** no hay incompatibilidad de sintaxis; OpenCode 2.0.24 soporta V1 por compatibilidad. **No se migra** a `permissions`/`shell`/`subagent`.

**16.2 Deficiencia real detectada (enforcement de least-privilege).**
- **Mecanismo (código del binario 2.0.24):** `Mb(action, resource, rules) = rules.findLast(r => match(action,r.action) && match(resource,r.resource)) ?? {effect:"ask"}`, sobre una lista que **siempre** empieza con `{action:"*", resource:"*", effect:"allow"}`.
- **Consecuencia:** un mapa `bash` **sin comodín `"*"`** (o su ausencia) **no restringe** — los comandos no listados caen en el default `allow`.
- **Runtime ANTES del fix** (`echo AUD09_PROBE_*`, comando no listado):

| Agente | Regla `bash` declarada | Resultado (runtime) |
| --- | --- | --- |
| `qa-lead` | allowlist (2 scripts) | **EJECUTADO (allow)** — la allowlist **no** restringía |
| `bug-analyst` | *(sin `bash`)* | **EJECUTADO (allow)** |
| `test-designer` | *(sin `bash`)* | **EJECUTADO (allow)** |
| `test-executor` | `"*": ask` + allowlist | **RECHAZADO** — “This non-interactive run cannot ask the user for permission…” |
| `qa-reviewer` | `bash: deny` | `shell * deny` (runtime no capturado por cuota del tier free) |
| `test-data` | `bash: deny` | `shell * deny` |

- **Conclusión (ALTA):** `edit: deny`, `task: deny` y `external_directory: deny` **sí** aplican; pero el allowlist de `qa-lead` **no restringía** y 4 agentes read-only (`test-designer`, `exploratory-qa`, `risk-analyst`, `bug-analyst`) podían ejecutar shell arbitrario.

**16.3 Cambio mínimo aplicado (5 archivos de agente).**
- `qa-lead.md`: agregado `"*": ask` al mapa `bash` (conserva allowlist `validate_contracts.py`/`preflight.py`).
- `bug-analyst.md`: agregado bloque `bash` con `"*": ask` + allowlist de `validate_contracts.py` (conserva su capacidad documentada de validar registros).
- `test-designer.md`, `exploratory-qa.md`, `risk-analyst.md`: agregado `bash: deny` (roles sin ejecución; ejecución es exclusiva de `test-executor`).
- **No** se tocaron `opencode.json`, `AGENTS.md`, los modelos, ni `test-executor`/`test-data`/`qa-reviewer` (sus restricciones ya eran correctas). **No** se agregaron dependencias ni módulos.

**16.4 Verificación después del fix.**
- `opencode debug config` → **exit 0** (config válida).
- `opencode debug agents` (permission `shell`): `qa-lead` `*→ask` + allowlist; `bug-analyst` `*→ask` + allowlist; `test-designer`/`exploratory-qa`/`risk-analyst` `*→deny`; `qa-reviewer`/`test-data` `*→deny`; `test-executor` sin cambios.
- **Runtime post-fix:** `qa-lead` + `echo …` → **RECHAZADO** (antes ejecutaba); `bug-analyst` + `echo …` → **RECHAZADO**;
  `qa-lead` + `python qa/tools/validate_contracts.py --help` → **EJECUTADO** (capacidad conservada).

**16.5 Preservación del estado.** Backup **fuera del repo**: `%LOCALAPPDATA%\Temp\opencode\AUD-09\backup\`
(8 agentes + `opencode.json`). SHA-256 antes→después: `qa-lead.md` `2BBF1BFD…`→`A3D7C282…`, `bug-analyst.md` `61891616…`→`A0019642…`,
`exploratory-qa.md` `809724DE…`→`F8062E74…`, `risk-analyst.md` `97314E29…`→`E17EC5A8…`, `test-designer.md` `99245A57…`→`0B2266DD…`.

**16.6 Gates ejecutados.**

| # | Comando | Resultado | Exit |
| --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | sin errores | **0** |
| 2 | `npm.cmd test` | **50 passed** | **0** |
| 3 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests … OK** | **0** |
| 4 | `python qa/tools/validate_contracts.py --bundle qa --json` | `errors: []`, `warnings: []` | **0** |
| 5 | `opencode debug config` | config normalizada válida | **0** |

**MANIFEST.json:** sin cambios (lista rutas, no hashes; no se agregaron ni quitaron archivos administrados).

**16.7 Limitaciones / NO VERIFICADO.**
- El **runtime `deny`** de `test-designer`/`exploratory-qa`/`risk-analyst` no se capturó por ejecución: el tier gratuito devolvió
  `provider.auth`/`429`/`402` en esos intentos. Se verificó por `debug agents` (`shell * deny`) + mecanismo de `deny` probado
  (`external_directory: deny` propio y rechazo `ask` de `test-executor`).
- La **calidad/comportamiento** de los agentes LLM (más allá de permisos) sigue **NO VERIFICADO**.
- Migración a la sintaxis V2 `permissions`/`shell`/`subagent`: **no necesaria** en 2.0.24.

**Estado:** ✅ **AUD-09 RESUELTO** (premisa de sintaxis = falso positivo; deficiencia de least-privilege corregida y verificada).

---

## 17. Registro de remediación — AUD-04 (enlaces de evidencia en `report.html`) — 2026-10-12

**Alcance autorizado:** resolver exclusivamente AUD-04 (un hallazgo por vez, con aprobación del usuario). No se abordaron otros
hallazgos (AUD-06…AUD-08, AUD-10…AUD-12 siguen pendientes). No se modificaron contratos, artefactos JSON, la generación de
evidencias, los agentes, `opencode.json` ni dependencias.

**17.1 Reproducción (reporte real en un subdirectorio).**
- Reporte: `automation/.runs/m06-assoc-test/report.html`. Evidencia real y existente:
  `automation/.runs/m06-assoc-test/evidence/TC-1_assertions.json`.
- `href` generado (pre-fix): `automation/.runs/m06-assoc-test/evidence/TC-1_assertions.json` — la ruta desde la **raíz del repo**.
- Como `report.html` vive en ese mismo directorio, el navegador resolvía `…/m06-assoc-test/automation/.runs/m06-assoc-test/evidence/TC-1_assertions.json`
  → **inexistente (404)**. El `<a>` existía; el destino no.

**17.2 Causa demostrada.** No era la existencia de la evidencia ni el escape HTML: las rutas de evidencia se expresan
**relativas a la raíz del repositorio**, pero `report.html` se escribe en `outDir` y el navegador resuelve cada `href` relativo
**a la URL del documento**. `renderReportHtml` usaba la ruta repo-relative tal cual, encadenando `outDir` + ruta absoluta-lógica.

**17.3 Corrección mínima (`automation/runner/report.ts`).**
- Helper `reportHref(reportDir, absolute)` = `relative(reportDir, absolute)` con separadores `/` y `encodeURIComponent` por segmento.
- `renderReportHtml(report, repoRoot, outDir)`: recibe `outDir`; los `href` de (a) evidencia de cada Caso, (b) índice de evidencias y
  (c) `preflight.record_path` se construyen con `reportHref(outDir, resolve(repoRoot, …))`.
- Se conserva el chequeo de existencia (`resolve(repoRoot, ev)` + `existsSync`), el fallback `href="#"` + `(missing)`, el `escapeHtml` de
  las etiquetas y el **JSON intacto** (`report.json` mantiene las rutas de evidencia repo-relative; sólo cambia el HTML).
- Sin rutas absolutas, sin `file://`, sin `file:///`, sin dependencias ni módulos nuevos.

**17.4 Verificación antes/después (reproducida).**

| Escenario | Antes | Después |
| --- | --- | --- |
| `href` de evidencia (reporte y evidencia en el mismo dir) | `automation/.runs/<run>/evidence/TC-…_assertions.json` → destino inexistente | `evidence/TC-…_assertions.json` → existe |
| Navegador (servido por HTTP) sobre el reporte real | `GET /automation/.runs/m06-assoc-test/evidence/TC-1_assertions.json` → **404** | `GET /evidence/TC-DEMO-WEB-1_assertions.json` → **200** (`application/json`, 1114 B) |
| Espacios / no-ASCII | (habría quedado como ruta repo-relative rota) | `con%20espacios%20y%20%C3%B1.json` → resuelve al archivo |
| `&` y `#` en el nombre | — | `%26` / `%23` en el `href`; etiqueta legible con `&amp;` |

**Evidencia (comandos y salida real):**
```
# 1) Test dirigido de AUD-04 + M-02 (resolución, espacios/no-ASCII, missing)
npx playwright test automation/tests/runner.infra.spec.ts --grep "AUD-04|m02: report.json" --reporter=line
  → 3 passed
# 2) Navegador servido por HTTP (run con el fix)
#   http://127.0.0.1:4211/report.html → href="evidence/TC-DEMO-WEB-1_assertions.json"
#   fetch resuelto → status 200, content-type application/json, bytes 1114
# 3) Navegador sobre el reporte histórico (sin fix)
#   http://127.0.0.1:4212/report.html → href="automation/.runs/m06-assoc-test/evidence/TC-1_assertions.json"
#   fetch resuelto → status 404
```
> La resolución en el navegador se comprobó sirviendo el run por HTTP (`file://` no es navegable en el entorno): el `href` relativo
> se resuelve contra la URL del documento, exactamente el mismo mecanismo que en producción.

| # | Comando | Resultado | Exit |
| --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | sin errores | **0** |
| 2 | `npm.cmd run build:runner` | `.dist` regenerado | **0** |
| 3 | `npm.cmd test` | **52 passed** (+2 de AUD-04) | **0** |
| 4 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests … OK** | **0** |
| 5 | `python qa/tools/validate_contracts.py --bundle qa --json` | `valid:true`, artifacts 4, errors 0, warnings 0 | **0** |

**17.5 Preservación del estado (antes de modificar).** Backup **fuera del repositorio** en
`%LOCALAPPDATA%\Temp\opencode\AUD-04\backup\` (para no alterar el inventario), con SHA-256 antes → después:

| Archivo | Antes (B · SHA-256) | Después (B, SHA-256) |
| --- | --- | --- |
| `automation/runner/report.ts` | 23.476 · `EECBB1AF…` | 24.562, `DEE67BD5…` |
| `automation/tests/runner.infra.spec.ts` | 64.712 · `DE56AEAE…` | 70.374, `13823C27…` |
| `automation/.dist/runner/report.js` | 21.422 · `70C4AB20…` | 22.479, `A4886003…` |

**MANIFEST.json:** no requiere actualización (lista rutas, no hashes; los archivos modificados conservan su ruta y
`automation/.dist`, `automation/.runs`, `automation/.artifacts` están explícitamente excluidos del inventario).

**17.5 Limitaciones / NO VERIFICADO.**
- El reporte histórico `automation/.runs/m06-assoc-test/report.html` se generó **antes** del fix y no se regeneró (sirve como “antes”).
- La comprobación de navegador se hizo con el motor del entorno (Chromium vía servidor HTTP) y con `new URL` (WHATWG); **no** se probó Firefox/WebKit.
- El caso de espacios/no-ASCII se verificó por render + resolución de URL, no por una corrida del runner con ese nombre (el runner
  no produce esos nombres de forma determinista).
- Reportes `report.json` históricos previos a M-02 siguen sin `summary.errors` (no es regresión de AUD-04).

**MANIFEST.json:** no requiere actualización (lista rutas, no hashes; los archivos modificados conservan su ruta).

**Estado:** ✅ **AUD-04 RESUELTO** (defecto reproducido, causa corregida en `report.ts`, enlace verificado 200 desde la ubicación real del reporte).

---

## 18. Registro de remediación — AUD-06 (`MANIFEST.json`) — 2026-10-12

**Alcance autorizado:** resolver exclusivamente AUD-06 (un hallazgo por vez, con aprobación del usuario). No se abordaron
AUD-07/AUD-08 ni otros hallazgos. No se modificaron contratos, artefactos JSON, la generación de evidencias, los agentes,
`opencode.json` ni dependencias.

**18.1 Confirmación del defecto.**
- `docs/DATA-VERIFICATION.md` **existe** (5.728 B) y pertenece al alcance del manifiesto: `scope` declara “QA Core infrastructure”,
  el resto de `docs/*.md` sí está listado, y el documento describe el contrato M-06 `data-verification` (ya registrado en `qa/`).
- `MANIFEST.json` se mantiene **a mano**: no hay script generador ni validador de frescura, y `qa/tools/validate_contracts.py`
  no lo consume (`--help` no expone opción de manifiesto). Su política de inclusión está en el campo `scope`.
- Diff real (árbol excluyendo regenerables `node_modules`, `.dist`, `.runs`, `.artifacts`, `__pycache__`): **169** archivos presentes,
  **167** listados → faltaban `docs/DATA-VERIFICATION.md` y `docs/QA-SYSTEM-AUDIT.md` (este informe).
- **Causa:** `MANIFEST.json` (`generated 2026-10-11 04:27:13`) es anterior a `docs/DATA-VERIFICATION.md` (`2026-10-11 04:27:59`);
  el manifiesto no se regeneró al añadir el documento. La omisión **no** es intencional.

**18.2 Corrección (mínima, sobre `MANIFEST.json`).**
- (a) Se añadió `"docs/DATA-VERIFICATION.md"` en el bloque ordenado de `docs/` (entre `CONTRACTS-VALIDATION.md` y `PLATFORM-ADAPTERS.md`).
- (b) Se añadió `"docs/QA-SYSTEM-AUDIT.md"` en el mismo bloque (entre `PRE-FLIGHT-CAPABILITIES.md` y `QA-SYSTEM-STABILITY-AUDIT.md`).
- (c) `version`: `1.10.0-core` → `1.11.0-core` (según la convención observada — la versión avanza cuando cambia el contenido; sin bump por archivo).
- (d) `generated`: `2026-10-11` → `2026-10-12`.
- No se alteró el `scope`, ni el contenido/orden de las demás entradas, ni la estructura (LF, 2 espacios, sin BOM).

**18.3 Verificación (estado final).**
```
files=169 ; duplicates=0 ; listed-but-missing=0
IN TREE BUT NOT IN MANIFEST → (none)
IN MANIFEST BUT NOT IN TREE → (none)
```

| # | Comprobación | Resultado |
| --- | --- | --- |
| 1 | `ConvertFrom-Json` (estructura / parseo) | OK |
| 2 | Todas las rutas listadas existen | OK (0 faltantes) |
| 3 | Sin entradas duplicadas ni rutas inválidas | OK (0 duplicados) |
| 4 | `docs/DATA-VERIFICATION.md` y `docs/QA-SYSTEM-AUDIT.md` incluidos y ordenados | OK |
| 5 | `python qa/tools/validate_contracts.py --bundle qa --json` | `valid:true`, artifacts 4, errors 0, warnings 0 (exit 0) |
| 6 | Archivos del alcance fuera del manifiesto | OK (0) |

> No se re-ejecutó la batería de Playwright/unittest: `MANIFEST.json` no es consumido por el runtime ni por ninguna prueba
> (verificado por búsqueda), por lo que la modificación no puede alterar su resultado. El único check afectado —la estructura y la
> exactitud del inventario— se ejecutó y pasó.

**18.4 Preservación del estado.** Backups fuera del repositorio (para no alterar el inventario):
`…\AUD-06\backup\` (estado original) y `…\AUD-06\backup-final\` (estado previo al cierre).

| Archivo | Antes (B · SHA-256) | Después (B · SHA-256) |
| --- | --- | --- |
| `MANIFEST.json` | 8.104 · `2A185709…` | 8.168 · `E2DE3960…` |
| `docs/QA-SYSTEM-AUDIT.md` | 70.775 · `72A0C6FD…` | (actualizado) |

**18.5 Cierre de la discrepancia restante.** `docs/QA-SYSTEM-AUDIT.md` pertenece al alcance: `scope` cubre “QA Core infrastructure”,
el bloque `docs/` lista **todos** los demás `docs/*.md` (incluido el otro informe de auditoría, `docs/QA-SYSTEM-STABILITY-AUDIT.md`) y **no
existe** una regla documentada que excluya los informes de auditoría. Su ausencia era, por tanto, otra omisión del mismo defecto; se
incorporó en el bloque ordenado de `docs/`. Estado final: **169 entradas; 0 faltantes, 0 duplicados, 0 archivos del alcance fuera del
manifiesto.** Se mantuvo `version` `1.11.0-core` / `generated` `2026-10-12` (misma remediación; sin bump por archivo).

**Estado:** ✅ **AUD-06 RESUELTO** (defecto confirmado, causa determinada, `docs/DATA-VERIFICATION.md` y `docs/QA-SYSTEM-AUDIT.md`
incorporados y verificados; sin discrepancias conocidas dentro del alcance).

---

## 19. Registro de remediación — AUD-07 (documentación vs implementación) — 2026-10-12

**Alcance autorizado:** resolver exclusivamente AUD-07 (un hallazgo por vez, con aprobación del usuario). **No** se abordaron
AUD-08 (encoding/BOM/mojibake), AUD-10, AUD-11 ni AUD-12. No se modificaron código, contratos, `MANIFEST.json`, artefactos JSON,
agentes, `opencode.json`, `AGENTS.md` ni dependencias. No se eliminó ningún archivo.

**19.1 Confirmación del defecto (documentación vs implementación real).**
- **Estados incorrectos.** `automation/README.md:121` marcaba “M-02 reportes / M-06 BD | **No** (fuera de alcance)”;
  `docs/AUTOMATION-ARCHITECTURE.md:29,37,110` describían M-02 y M-06 como “futuro” y `:124,126` como “**No implementado**”.
- **Conteos obsoletos.** `README.md:58` (“21 tests: 2 smoke + 19 runner.infra”), `automation/README.md:53` (“19 tests”), `:72` y
  `:106` (“21 tests”), `:116` (“35/35”) y `docs/AUTOMATION-ARCHITECTURE.md:120` (“35 tests”).
- **Implementación real (contrastada con código y pruebas, no sólo existencia de archivos).**
  - **M-02** (reportes `report.json` + `report.html` por corrida; contrato `execution-report`): `automation/runner/report.ts`;
    **8** tests en `automation/tests/runner.infra.spec.ts` (6 `m02:` + 2 de AUD-04) y **14** en `qa/tools/test_report_generator.py`.
  - **M-06** (verificación de datos SQLite read-only; contrato `data-verification`): `automation/runner/sqlite-adapter.ts`
    (`node:sqlite`); **20** tests en `automation/tests/sqlite-adapter.spec.ts` + **7** de integración en `runner.infra.spec.ts`
    + **14** en `qa/tools/test_data_verification.py`.
- **Realidad medida (2026-10-12):** `playwright test --list` → **52 tests in 3 files** (`infra.smoke` 2 + `runner.infra` 30 +
  `sqlite-adapter` 20); desglose de `runner.infra` = 9 M-03 + 6 M-05 + 8 M-02 + 7 M-06.
- **Causa:** los textos se redactaron cuando M-02/M-06 eran “hoja de ruta” y no se actualizaron al implementarlos; no existe
  verificación automática de frescura documental (ver §9).

**19.2 Corrección (mínima, sólo documentación; se conservaron estructura, estilo, idioma y secciones).**
- `README.md:58`: conteo → “52 tests: 2 smoke + 30 runner.infra (9 M-03 + 6 M-05 + 8 M-02 + 7 M-06) + 20 sqlite-adapter (M-06)”.
- `automation/README.md`: `:53` (30 tests seriales + desglose) y alta de `sqlite-adapter.spec.ts` en el árbol; `:72` (52 tests en
  3 archivos); `:106` (52 tests); `:116` (M-01 38/38 y M-04 48/48); `:121` reemplazada por filas M-02 y M-06 =
  implementados/verificados; árbol `runner/` con `report.ts` (M-02) y `sqlite-adapter.ts` (M-06); `:97` “ni ningún driver de BD
  **externo** (M-06 usa el módulo integrado `node:sqlite`)”.
- `docs/AUTOMATION-ARCHITECTURE.md`: `:6` (estado) incluye M-02 y M-06 implementados; `:29`/`:37`/`:110` “futuro” → implementado;
  `:120` 35 → **38** tests del validador M-01; `:124`/`:126` → implementados y verificados (con sus contratos).
- **No** se alteraron contratos, artefactos ni el encoding (BOM/mojibake se preservaron tal cual: AUD-08 sigue fuera de alcance).

**19.3 Validación (2026-10-12).**

| # | Comando | Resultado |
| --- | --- | --- |
| 1 | `npm.cmd run typecheck` | exit 0 |
| 2 | `npm.cmd test` | **52 passed** (2.3 m) |
| 3 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests — OK** |
| 4 | `python qa/tools/validate_contracts.py --bundle qa --json` | `valid:true`, artifacts 4, errors 0, warnings 0 (exit 0) |
| 5 | `npx playwright test --list` | **52 tests in 3 files** |
| 6 | Búsqueda de residuos (“19 tests”, “21 tests”, “35/35”, “No implementado”, “futuro”) en los 3 documentos | 0 |

> Las correcciones son **sólo de documentación** y no pueden alterar el resultado de la suite; se re-ejecutó para registrar las
> cifras reales. Los conteos citados provienen de esa ejecución. Las referencias a `docs/RUNNER-M03.md`, `docs/AUTO-HEALING.md` y
> `docs/DATA-VERIFICATION.md` se conservaron y los archivos existen.

**19.4 Preservación del estado.** Backups fuera del repositorio (previos a cualquier edición): `…\AUD-07\backup\`.

| Archivo | Antes (B · SHA-256) | Después (B) |
| --- | --- | --- |
| `README.md` | 5.196 · `80BC0F8B…` | 5.228 |
| `automation/README.md` | 9.145 · `1B0B6512…` | 9.691 |
| `docs/AUTOMATION-ARCHITECTURE.md` | 9.009 · `A5B25F1C…` | 9.409 |
| `docs/RUNNER-M03.md` | 15.129 · `D75670D5…` | 17.189 |
| `docs/QA-SYSTEM-AUDIT.md` | 78.002 · `9B6AF0EF…` | (este informe) |

**19.5 Discrepancias de la misma clase fuera de la lista de documentos inspeccionados.**
- `docs/RUNNER-M03.md` (documento vivo referenciado por `README.md`): `:8` (“19 tests: 9 M-03 + 6 M-05 + 4 M-02”), `:129` (“21 tests”),
  `:237`/`:275` (“19 tests”), `:264` (“M-02 (reportes), 4 tests adicionales”), `:289` (“Sin … generador de reportes propio (M-02)”).
  **CORREGIDO (AUD-07, 2026-10-12, aprobación del usuario)** — ver §19.6.
- `docs/QA-SYSTEM-STABILITY-AUDIT.md:136,274`: conteos históricos (“9 tests M-03”, “35 OK”); es un informe de auditoría puntual
  (artefacto histórico), no se modifica.

**Estado:** ✅ **AUD-07 RESUELTO** (defecto confirmado, causa determinada, conteos y estados corregidos y verificados en `README.md`,
`automation/README.md`, `docs/AUTOMATION-ARCHITECTURE.md` y `docs/RUNNER-M03.md`; sin discrepancias conocidas dentro del alcance).
Queda AUD-08 y la instancia de la misma clase listada en §19.5 (`docs/QA-SYSTEM-STABILITY-AUDIT.md`, artefacto histórico).

**19.6 Cierre de `docs/RUNNER-M03.md` (misma clase; aprobación del usuario, 2026-10-12).**
- **Defecto (mismo patrón que AUD-07):** `:8` (“19 tests: 9 M-03 + 6 M-05 + 4 M-02”), `:129` (“21 tests”), `:237`/`:275` (“19 tests”),
  `:264` (“M-02 (reportes), 4 tests adicionales”) y `:289` (“Sin … generador de reportes propio (M-02)”), pese a que M-02 genera
  `report.json` + `report.html` y el desglose real es 9 M-03 + 6 M-05 + 8 M-02 + 7 M-06 (**30**).
- **Corrección (sólo documentación):** `:8`/`:129`/`:237` conteos → **30** `runner.infra` (y **52** en `npm test`); `:247` M-01 **38/38**;
  `:264` “8 tests adicionales” (6 `m02` + 2 `AUD-04`); nuevo bloque con los **7** tests `m06`; `:275` “30 tests”; `:289` reformulada
  (M-02 implementado y limitación de formato) más un bullet M-06 (sólo SQLite read-only). Se preservaron BOM y CRLF del archivo.
- **Validación (2026-10-12):** `playwright test --list` → 30 en `runner.infra` (9 M-03 + 6 M-05 + 2 AUD-04 + 6 M-02 + 7 M-06) y
  **52** totales; `npm.cmd test` → **52 passed** (exit 0); `test_validate_contracts.py` → **38 OK**; `test_preflight.py` → **48 OK**;
  `validate_contracts --bundle qa` → `valid:true`, errors 0, warnings 0; archivo UTF-8 válido; residuos de las afirmaciones antiguas → 0.

---

## 20. Registro de remediación — AUD-08 (encoding: BOM y mojibake) — 2026-10-12

**Alcance autorizado:** resolver exclusivamente AUD-08 (un hallazgo por vez, con aprobación del usuario). **No** se abordaron
AUD-10, AUD-11 ni AUD-12. No se modificaron código, contratos, `MANIFEST.json`, artefactos JSON, agentes, `opencode.json`,
`AGENTS.md`, modelos, permisos ni dependencias. No se eliminó ningún archivo.

**20.1 Inspección de alcance completo (codificación).** Se inspeccionaron **todos** los archivos de texto del árbol
(excluyendo `node_modules/`, `.git/`, `.runs/`, `.dist/`, `__pycache__/` y `qa/evidence/`): se comprobó BOM UTF-8, finales de
línea, validez UTF-8 estricta y presencia de caracteres de reemplazo (U+FFFD) o de prefijos de mojibake
(doble codificación). Resultado por archivo:

| Archivo | BOM | EOL | Diagnóstico | Veredicto |
| --- | --- | --- | --- | --- |
| `README.md` | sí | LF | doble codificación (27 tramos no-ASCII dañados) | daño confirmado → **corregido** |
| `automation/README.md` | sí | LF | doble codificación (149 tramos) | daño confirmado → **corregido** |
| `docs/RUNNER-M03.md` | sí | CRLF | doble codificación (101 tramos) | daño confirmado → **corregido** (instancia ampliada) |
| `docs/QA-SYSTEM-AUDIT.md` | no | LF | UTF-8 correcto; contiene ejemplos de mojibake **citados como evidencia** | **no es daño** (citas intencionales) |
| `qa/{bugs,memory,reports,tests}/.gitkeep`, `tests/.gitkeep` | sí | — | sólo BOM + CRLF (sin contenido) | diferencia de formato menor, fuera de la documentación → **no se modifica** |
| Resto (`docs/*.md`, `.opencode/**`, `qa/**`, `tests/**`, raíz) | no | LF | UTF-8 válido, sin mojibake ni U+FFFD | sin hallazgos |

**Causa (confirmada):** doble codificación — el texto UTF-8 original se decodificó como Windows-1252 (CP1252) y se volvió a
codificar como UTF-8 (p. ej. el guion largo U+2013 = bytes `E2 80 93` se transformó en los caracteres `U+00E2 U+20AC U+201C`).
Es **recuperable** aplicando la transformación inversa CP1252→UTF-8 sobre cada tramo no-ASCII. El BOM y los finales de línea
son **formato**, no daño por sí mismos: ningún archivo se clasificó como defectuoso por tener BOM o CRLF, sino por el contenido
dañado.

**20.2 Corrección (mínima; se conservaron contenido, estructura, comandos, rutas e identificadores).**
- Cada tramo de mojibake se recuperó con la inversa CP1252→UTF-8, **sólo** cuando decodificaba de forma válida y unívoca.
  Verificación clave: **ningún carácter ASCII cambió** → comandos, rutas, identificadores y nombres técnicos intactos.
- Normalización a **UTF-8 sin BOM** (estándar del resto de la documentación; sin dependencia que lo requiera) y **finales de
  línea conservados** (LF en `README.md` y `automation/README.md`; CRLF en `docs/RUNNER-M03.md`).
- `docs/QA-SYSTEM-AUDIT.md` **no** se modificó en su contenido de evidencia: las secuencias de mojibake preexistentes quedan
  como citas (no se crearon nuevas).

**20.3 Preservación del estado.** Backups fuera del repositorio (bytes originales, previos a cualquier edición):
`…\AUD-08\backup\`.

| Archivo | Antes (B · SHA-256) | Después (B · SHA-256) |
| --- | --- | --- |
| `README.md` | 5.228 · `0927C967…A9190` | 5.103 · `508EF99B…272E715A` |
| `automation/README.md` | 9.691 · `22A83E7E…E2E9C05A` | 9.039 · `9DD323F8…FE00EAF17E` |
| `docs/RUNNER-M03.md` | 17.189 · `95573B8D…0F253C8E9` | 16.480 · `9CFCFBC5…5DA9CE56059270` |

**20.4 Verificación (2026-10-12).**

| # | Comprobación | Resultado |
| --- | --- | --- |
| 1 | Validez UTF-8 estricta de los 3 archivos tras la corrección | **OK** en los 3 |
| 2 | Tramos no-ASCII que aún recuperarían (mojibake residual) | **0** en los 3 |
| 3 | Caracteres de reemplazo U+FFFD | **0** en los 3 |
| 4 | Contenido **ASCII idéntico** al original (comandos/rutas/identificadores) | **idéntico** en los 3 |
| 5 | BOM tras la corrección | **eliminado** en los 3 (UTF-8 sin BOM) |
| 6 | Finales de línea tras la corrección | **LF / LF / CRLF** (sin cambios) |
| 7 | Re-lectura del contenido corregido (árbol y diagrama incluidos) | texto ES/EN correcto; árbol `├─/└─/│` y diagrama `▶/▼/◀` bien formados |
| 8 | Re-escaneo global del árbol (mojibake/U+FFFD) | sólo el informe (citas) y los `.gitkeep` (BOM sin contenido) |

> AUD-08 es una corrección **sólo de documentación**: no altera el resultado de `npm test`, la suite Python ni la validación de
> contratos; por eso no se re-ejecutó la batería. `MANIFEST.json` sólo lista rutas (sin tamaños ni hashes), por lo que no se
> desfasa al editar estos documentos.

**20.5 Casos dudosos / limitaciones.**
- No quedan casos irrecuperables dentro del alcance documental: todos los tramos dañados decodificaron de forma unívoca.
- `docs/QA-SYSTEM-AUDIT.md` conserva deliberadamente ejemplos de mojibake como **evidencia citada** (no es daño).
- Se conservan el BOM + CRLF de los `.gitkeep` (archivos sin contenido, ajenos a la documentación) y los CRLF de `docs/RUNNER-M03.md`
  (formato sin impacto real; se evita un cambio no solicitado).
- Fuera de alcance (no forma parte de AUD-08): `docs/QA-SYSTEM-STABILITY-AUDIT.md` (informe histórico, no se modifica); resultó **sin mojibake**.

**Estado:** ✅ **AUD-08 RESUELTO** (defecto confirmado y reproducido; causa determinada; mojibake recuperable corregido y BOM
eliminado en `README.md`, `automation/README.md` y `docs/RUNNER-M03.md`; verificado sin residuos dentro del alcance).
Restaban AUD-10…AUD-12 (P3) — **resueltos el 2026-10-12, ver §21**.

---

## 21. Registro de remediación — AUD-10 / AUD-11 / AUD-12 (M-06 + reporte) — 2026-10-12

**Alcance autorizado:** remediación incremental de **AUD-10** (límites/`params` de M-06), **AUD-11** (logs `DEBUG`) y **AUD-12**
(BLOCKED y reporte HTML), con evidencia por hallazgo. Sin Git → backups fuera del repositorio. **No** se reabrieron hallazgos
cerrados (AUD-01…AUD-09) ni se inició el bloque siguiente.

### 21.1 AUD-10 — M-06: límites documentados vs reales y valores de `params` en la evidencia

- **Clasificación:** AUD-10a = **defecto de documentación confirmado por inspección**; AUD-10b = **riesgo potencial** (los valores
  de `params` se serializaban, pero los artefactos inspeccionados no contenían datos sensibles reales).
- **Conducta real antes del fix (por inspección):** `executeQuery` usa `stmt.all()` (materializa todo el resultado) y recién después
  aplica `.slice(0, limit)`; `timeout_ms` se aplica con `PRAGMA busy_timeout` (espera de lock). La evidencia incluía
  `params: <JSON con los valores>` en `data_verification.json` y en `execution_trace.json`.
- **Corrección:**
  - `docs/DATA-VERIFICATION.md`: "prevents excessive data retrieval" → el límite **acota** las filas usadas pero **no** evita la
    materialización (agregar `LIMIT`/agregado para acotar la lectura); "query timeout … prevents hanging" → es `PRAGMA busy_timeout`
    (espera de lock), **no** un timeout de ejecución; se documentó además que el truncado afecta `row_count`/`empty`/`not_empty`.
  - `automation/runner/sqlite-adapter.ts`: se dejó de serializar los valores de parámetros. La evidencia registra `params_bound: <n>`
    y el campo `params` guarda un `<redacted>` por parámetro (aridad conservada; el valor reproducible sigue en el manifiesto).
    Nuevos `redactParamValues()` y `REDACTED_PARAM`.
- **Diferenciación pedida:** `timeout_ms`/`max_rows` nunca se persisten como resultado (sólo se usan en ejecución); de `params` se
  persistía el **valor** (ahora sólo el conteo). Nada de esto aparece en `report.json`/`report.html` (los `cases` no incluyen
  `data_verifications`): vive en `data_verification.json` y `execution_trace.json`.
- **Tests:** `automation/tests/sqlite-adapter.spec.ts` #21 (el valor secreto no aparece en resultado/evidencia; `params` =
  `['<redacted>']`), #22 (el truncado hace que `row_count` evalúe sobre el subconjunto) y #23 (`timeout_ms: 1` **no** aborta una
  consulta que tarda más → espera de lock, no timeout de ejecución).

### 21.2 AUD-11 — Logs `DEBUG` residuales

- **Clasificación:** **defecto confirmado por inspección** (instrumentación temporal de M-06, siempre activa).
- **Corrección:** eliminadas las 4 líneas `console.log('DEBUG…')` de `automation/runner/runner.ts`; `.dist/runner/runner.js` regenerado.
  Se **conservaron** los `console.log` operativos (banner, resumen `run … PASS/FAIL`, `data verification`, pre-flight). No se borró
  nada "por contener la palabra DEBUG": los artefactos `automation/.runs/m06-debug-error*` (`TC-M06-DEBUG-1`, `DV-DEBUG-ERR`) son
  **datos de corridas**, no instrumentación, y no se tocaron.
- **Verificación:** grep posterior → **0** coincidencias de `DEBUG` en `automation/runner/**` y `automation/.dist/runner/**`.

### 21.3 AUD-12 — Causas de BLOCKED y presentación (es-AR, alcance acotado)

- **Clasificación:** **defecto confirmado por inspección** (el reporte mostraba "BLOCKED" sin causas; idioma sólo en inglés).
- **Confirmado por inspección:** `runner.ts` pasaba `blocked_reasons: []`; el caso BLOCKED no llevaba `block_reason`; el
  `report.html` no renderizaba la lista si estaba vacía. La prueba **no** se mostraba como PASS/FAIL (`blockedTrace` fija
  `status=BLOCKED`, `executed=false`, `validation_performed=false`).
- **Corrección:**
  - Causas reales: `runner.ts` propaga `causes` a `preflight.blocked_reasons` y agrega `block_reason` por caso
    (`buildReportInput`/`writeExecutionReports` con nuevo parámetro `blockedReasons`).
  - Presentación: `report.ts` muestra "Verificación previa (pre-flight)", "Resultado", "Registro", "Motivos del bloqueo", la
    columna "Motivo del bloqueo" y una leyenda. Estados/campos JSON/IDs **sin cambios** (`PASS/FAIL/BLOCKED/SKIPPED`,
    `block_reason`, `blocked_reasons`).
  - **Alcance:** sólo los textos del estado BLOCKED/pre-flight. **No** se tradujo el reporte completo ni la interfaz global (por
    indicación); `lang="en"` se conserva porque el documento sigue siendo mayoritariamente inglés. La i18n total del `report.html`
    queda como **mejora opcional**.
- **Tests (endurecidos):** `runner.infra.spec.ts` — el test de pre-flight BLOCKED y `m02: BLOCKED run…` ahora verifican
  `summary.executed=passed=failed=errors=skipped=0`, `blocked=1`, `preflight.blocked_reasons` y `cases[].block_reason` con el motivo
  real (`QAA_M03_MISSING_CRED` / `QAA_M02_MISSING_CRED`), y que el HTML contiene el motivo y las etiquetas es-AR.
- **Evidencia directa (corrida real, 2026-10-12):** manifiesto desechable que exige `QAA_AUD12_MISSING_CRED` (no definida) →
  `runner.js` exit **3**; `report.json` → `overall_status=BLOCKED`, `summary={selected:1, executed:0, passed:0, failed:0, errors:0,
  blocked:1, skipped:0}`, `preflight = {"result":"BLOCKED","blocked_reasons":["[credentials_available] credential_QAA_AUD12_MISSING_CRED: environment variable 'QAA_AUD12_MISSING_CRED' not set; action: …"]}`
  y `cases[0].block_reason` con el mismo motivo; `report.html` contiene `Motivos del bloqueo`, `Motivo del bloqueo`,
  `Verificación previa`, `La ejecución no se inició`, el `verification_id`/motivo y `BLOCKED`.

### 21.4 Preservación (sin Git)

Backups fuera del repositorio (bytes originales, previos a toda edición): `…\AUD-10-11-12\backup\`.

| Archivo | Antes (B · SHA-256) | Después (B · SHA-256) |
| --- | --- | --- |
| `automation/runner/sqlite-adapter.ts` | 12.058 · `7B4BDFEC9C0DD45B1B1C7EAC9A14AEE4CA72EB30E062EF304765F90599F79755` | 13.224 · `AE745B98D94058581C4F1E678360A1B5190FE2CE04266DCCEF0F3E2B5F52618D` |
| `automation/runner/runner.ts` | 46.436 · `6CD34C96EF4D9FF2D858AAF7BBAE812E2CAF5285EC16C72977442E8F223A2984` | 46.363 · `C2C9E7F9E12E5F961F5EB67814108A530F0FA767231D7F55A69E222B6EAF1ACE` |
| `automation/runner/report.ts` | 24.562 · `DEE67BD58B3B08D232966487DC70EB7FBCE12D85DA711BF073AE088A37154715` | 24.915 · `DF51024309852F1D1BA4758C90859FB0E3BF823AA74058A1846816479791A75E` |
| `docs/DATA-VERIFICATION.md` | 5.728 · `F9DBCB9524BBCC28108C8C06CF6D2A0B4B8FDA641956DAC6F52308AD3676DB77` | 6.929 · `B70675E7A8772D4D9328674C23991A879C638862156D1078690E5CCB65B151D4` |
| `automation/tests/sqlite-adapter.spec.ts` | 13.714 · `60938D21E28A6730279A8A398D088E96FEB0FC31C6B8A45796B2F405853CC05F` | 16.537 · `9F8F3C87C85329FECD46523FA14796101E165007C16747257D9DD9E32E94B2D5` |
| `automation/tests/runner.infra.spec.ts` | 70.374 · `13823C27AC575E0433AB5F1882A655401FA19949DF8750685A850D8888B50FE5` | 72.848 · `F935DCDB740099428DD877BA9D7BBC3E53A3BD781D50B7F5B02522F416A044D9` |

> `.dist/runner/*.js` son **generados** (`npm run build:runner`) y están excluidos del inventario `MANIFEST.json`; no se listan.
> `docs/AGENT-CONTRACTS.md` se respaldó por precaución pero **no se modificó** (hash idéntico): el esquema `params` ya acepta
> `[<redacted>]`, así que no hubo cambio de contrato.

### 21.5 Verificación (2026-10-12)

| # | Comando | Resultado real |
| --- | --- | --- |
| 1 | `npm.cmd run typecheck` | **0 errores** |
| 2 | `npm.cmd test` | **55 passed** (2 smoke + 30 `runner.infra` + 23 `sqlite-adapter`); antes 52 |
| 3 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests — OK** |
| 4 | `python qa/tools/validate_contracts.py --bundle qa --json` | **`valid: true`** (4 artifacts, 31 records, 0 errors) |
| 5 | grep `DEBUG` en `automation/runner/**` + `automation/.dist/runner/**` | **0 coincidencias** |
| 6 | `npm.cmd run build:runner` tras los cambios | `.dist` regenerado: sin `DEBUG`, con `redactParamValues`/`REDACTED_PARAM` |

> Las 3 pruebas nuevas viven en el archivo existente `sqlite-adapter.spec.ts` (sin infraestructura nueva) y los tests de BLOCKED
> se endurecieron en `runner.infra.spec.ts`.

### 21.6 Limitaciones / no verificado

- AUD-10: la exposición era **potencial** —los artefactos inspeccionados no contenían credenciales reales—; se mitiga el *riesgo*
  (no se "reprodujo una fuga"). Sobre los límites: el **truncado de filas** sí se reprodujo (test #22) y la condición de `timeout_ms`
  como espera de lock se verificó (test #23: una consulta más lenta que el timeout **no** se aborta); **no** se reprodujo
  el camino `SQLITE_BUSY` por base bloqueada (difícil de forzar de forma determinista): queda **documentado**, no reproducido.
- AUD-12: se tradujeron **sólo** los textos del estado BLOCKED/pre-flight (por indicación). El resto del `report.html` (títulos de
  secciones, métricas, índice de evidencias, `Light/Dark mode`, `lang="en"`) permanece en inglés → **mejora opcional**.
- No verificado (fuera de alcance): calidad real de los LLM.

**Estado:** ✅ **AUD-10 RESUELTO** · ✅ **AUD-11 RESUELTO** · ✅ **AUD-12 RESUELTO** (alcance acotado por indicación del usuario).

---

## 22. Declaración de no modificación

**Fase de auditoría (inicial):** salvo la creación de este documento (`docs/QA-SYSTEM-AUDIT.md`), la auditoría **no alteró**
código, pruebas, prompts operativos, contratos, configuraciones, modelos ni dependencias, y **no eliminó** archivos.
La operación de verificación fue de sólo lectura (`--list`, lectura de archivos, `--noEmit`, `--bundle`, consulta de modelos).

**Fase de remediación (2026-10-11, autorizada):** se aplicó **únicamente** la corrección AUD-01 (ver §13). No se modificaron
`opencode.json`, `AGENTS.md`, los archivos de agentes, los modelos, los permisos ni las dependencias, ni se implementaron otros hallazgos.

**Fase de remediación (2026-10-12, autorizada):** se aplicaron **únicamente** AUD-03 y AUD-05 (ver §15); AUD-02 se cerró como
falso positivo **sin** tocar `AGENTS.md` ni la asignación de modelos. Archivos modificados: `qa/schema/index.json`,
`automation/runner/runner.ts` (y su compilado `.dist/runner/runner.js` regenerado), `automation/tests/runner.infra.spec.ts`,
`qa/tools/test_validate_contracts.py`, más este informe. No se tocaron `opencode.json`, `AGENTS.md`, los archivos de agentes, los
modelos, los permisos ni las dependencias. No se eliminó ningún archivo del proyecto (el backup vive fuera del repo).

**Fase de remediación (2026-10-12, autorizada):** se aplicó **únicamente** AUD-09 (ver §16): se modificó el frontmatter `permission`
de `qa-lead`, `bug-analyst`, `test-designer`, `exploratory-qa` y `risk-analyst` (reglas `bash`). **No** se tocaron `opencode.json`,
`AGENTS.md`, los modelos ni las dependencias. Backup fuera del repo en `…\AUD-09\backup\`. No se eliminó ningún archivo del proyecto.

**Fase de remediación (2026-10-12, autorizada):** se aplicó **únicamente** AUD-04 (ver §17): se modificó `automation/runner/report.ts`
(construcción del `href` relativo al propio `report.html`) — con su compilado `automation/.dist/runner/report.js` regenerado — y
`automation/tests/runner.infra.spec.ts` (2 tests de resolución de enlaces); más este informe. **No** se tocaron contratos, artefactos
JSON, agentes, `opencode.json`, `AGENTS.md`, modelos, permisos ni dependencias. Backup fuera del repo en `…\AUD-04\backup\`. No se
eliminó ningún archivo del proyecto (el run generado `automation/.runs/aud04-after` es salida regenerable, fuera del inventario `MANIFEST`).

**Fase de remediación (2026-10-12, autorizada):** se aplicó **únicamente** AUD-06 (ver §18): se modificó `MANIFEST.json`
(incorporación de `docs/DATA-VERIFICATION.md` y `docs/QA-SYSTEM-AUDIT.md`; `version` `1.11.0-core`, `generated` `2026-10-12`), más este
informe. **No** se tocaron contratos, artefactos JSON, agentes, `opencode.json`, `AGENTS.md`, modelos, permisos ni dependencias. Backups
fuera del repo en `…\AUD-06\backup\` y `…\AUD-06\backup-final\`. No se eliminó ningún archivo del proyecto.

**Fase de remediación (2026-10-12, autorizada):** se aplicó **únicamente** AUD-07 (ver §19 y §19.6): se modificaron `README.md`,
`automation/README.md`, `docs/AUTOMATION-ARCHITECTURE.md` y `docs/RUNNER-M03.md` (**sólo documentación**: conteos y estados de
M-02/M-06), más este informe. **No** se tocaron código, contratos, `MANIFEST.json`, artefactos JSON, agentes, `opencode.json`,
`AGENTS.md`, modelos, permisos ni dependencias; el encoding (BOM/mojibake, AUD-08) se preservó sin cambios. Backups fuera del repo en
`…\AUD-07\backup\`. No se eliminó ningún archivo del proyecto.

**Fase de remediación (2026-10-12, autorizada):** se aplicó **únicamente** AUD-08 (ver §20): se corrigió el mojibake
(doble codificación CP1252 reinterpretada como UTF-8) y se normalizaron a UTF-8 sin BOM `README.md`, `automation/README.md` y
`docs/RUNNER-M03.md` (**sólo documentación**), más este informe. **No** se tocaron código, contratos, `MANIFEST.json`,
artefactos JSON, agentes, `opencode.json`, `AGENTS.md`, modelos, permisos ni dependencias. Backups fuera del repo en
`…\AUD-08\backup\`. No se eliminó ningún archivo del proyecto (los `.gitkeep` con BOM quedan fuera del alcance por no ser
documentación de contenido).

**Fase de remediación (2026-10-12, autorizada):** se aplicaron **únicamente** AUD-10, AUD-11 y AUD-12 (ver §21). Se modificaron
`automation/runner/sqlite-adapter.ts` (redacción de `params` + comentarios), `automation/runner/runner.ts` (quitar `DEBUG`; propagar
causas de BLOCKED), `automation/runner/report.ts` (presentación BLOCKED en es-AR), `docs/DATA-VERIFICATION.md` (doc de límites) y
`automation/tests/{sqlite-adapter,runner.infra}.spec.ts` (3 tests nuevos + endurecimiento de los tests de BLOCKED), más este informe;
los compilados `automation/.dist/runner/*.js` se regeneraron con `build:runner`. **No** se tocaron contratos (`AGENT-CONTRACTS.md`),
`qa/schema/**`, `MANIFEST.json`, artefactos JSON, agentes, `opencode.json`, `AGENTS.md`, modelos, permisos ni dependencias. Backups
fuera del repo en `…\AUD-10-11-12\backup\`. No se eliminó ningún archivo del proyecto.

**Fase de verificación y remediación (2026-10-12, autorizada):** Bloque 3 (ver §23). Se verificó la **configuración efectiva** de los 8 agentes (`opencode debug config` / `debug agents`) y se intentó el **enforcement en runtime** de `bash: deny` para `test-designer`, `exploratory-qa` y `risk-analyst` → **NO VERIFICADO** por bloqueo del proveedor (`provider.auth` 403, free tier): no se modificó ningún permiso, agente, `opencode.json` ni modelo. En cobertura se inventarió `automation/specs/**` (spec ↔ manifiesto ↔ casos ↔ evidencia) y se corrigió **sólo documentación** (`README.md`, `automation/README.md`, `docs/RUNNER-M03.md`: conteos `52→55` y `20→23`), sin tocar código, contratos, `MANIFEST.json`, artefactos JSON ni dependencias. Backups fuera del repo en `…\AUD-BLOCK3\backup\`. No se eliminó ningún archivo del proyecto.

**Fase de verificación y optimización (2026-10-12, autorizada):** Bloque 4 (ver §24). Se inspeccionó la **arquitectura de coordinación multiagente** (8 agentes, `.opencode/agents/**`, `opencode.json`, 12 skills, flujo de 12 etapas, contratos de salida) y se intentó una **prueba de coordinación real** (delegación desde esta sesión a `test-designer` y a `qa-reviewer`) → **NO VERIFICADO** por bloqueo del proveedor (`provider.auth` 403, free tier); **no** se declara que la coordinación funcione en runtime. **No** se modificaron prompts de agentes, permisos, modelos, `opencode.json`, `AGENTS.md`, contratos ni dependencias. **Único cambio: documentación** — `docs/AUTOMATION-ARCHITECTURE.md` (nombre de agente `explorer` → `exploratory-qa`, B4-COORD-01). Backups fuera del repo en `…\AUD-BLOCK4\backup\`. No se eliminó ningún archivo del proyecto.

**Estado final: AUDITORÍA PARCIAL EN CURSO — 11 hallazgos resueltos y validados (AUD-01, AUD-03, AUD-04, AUD-05, AUD-06, AUD-07, AUD-08, AUD-09, AUD-10, AUD-11, AUD-12) y 1 cerrado como falso positivo (AUD-02); Bloque 3: permisos (configuración) VERIFICADO y enforcement en runtime NO VERIFICADO por bloqueo del proveedor, cobertura inventariada con 1 discrepancia de documentación corregida; Bloque 4: coordinación (diseño/configuración) VERIFICADO por inspección y coordinación en runtime NO VERIFICADO por bloqueo del proveedor, con 1 corrección de documentación (B4-COORD-01) y optimizaciones sólo propuestas.**
**Restan áreas NO VERIFICADAS (calidad real de los LLM, coordinación en runtime, diferencialidad real de QA Reviewer) y mejoras opcionales (i18n completa del `report.html`, cobertura opcional de bordes del fixture demo, eliminación de redundancia intra-agente).**

---

## 23. Bloque 3 — Permisos efectivos y cobertura de automatización — 2026-10-12

**Alcance autorizado:** (1) verificar los permisos efectivos de los 8 agentes y comprobar en runtime si
`test-designer`, `exploratory-qa` y `risk-analyst` rechazan una ejecución de shell prohibida; (2) inventariar la
cobertura de `automation/specs/**` (spec ↔ suite/manifiesto ↔ casos ↔ evidencia) y detectar discrepancias entre lo
**declarado** y lo **ejecutado**; corregir sólo defectos demostrados y documentar lo no verificable. Sin iniciar la
optimización multiagente ni la preparación para GitHub.

### 23.1 Permisos efectivos (configuración) — VERIFICADO

- **Mecanismo:** `opencode-cli.exe` **2.0.24** → `opencode debug config` (normaliza `permission` → `permissions[]`) y
  `opencode debug agents` (resuelve los permisos efectivos con el mismo motor de permisos). Salida cruda (efímera):
  `automation/.runs/block3-tmp/agents.txt` (excluida del `MANIFEST`).
- **Resultado por agente (permisos relevantes a su rol):**

| Agente | Tipo | `shell`/`bash` | `edit` | `subagent`/`task` | Coherencia con su responsabilidad |
| --- | --- | --- | --- | --- | --- |
| `qa-lead` | primary | `*`→ask + allow (`preflight.py`, `validate_contracts.py`) | deny | 7 especialistas = allow | OK (orquesta; read-only) |
| `test-designer` | subagent | **deny** | deny | deny | OK (diseña; no ejecuta) |
| `exploratory-qa` | subagent | **deny** | deny | deny | OK (explora; sin shell) |
| `risk-analyst` | subagent | **deny** | deny | deny | OK (analiza; no ejecuta) |
| `test-data` | subagent | deny | deny | deny | OK (datos; no ejecuta) |
| `bug-analyst` | subagent | `*`→ask + allow (`validate_contracts.py`) | deny | deny | OK |
| `test-executor` | subagent | `*`→ask + allowlist operativa (Playwright, `npm test*`, `npm run suite*`, `npm run build:runner*`, runner, `git status`/`diff`, `preflight`, `validate_contracts`) | deny | deny | OK (capacidades necesarias presentes) |
| `qa-reviewer` | subagent | **deny** | deny | deny | OK (**revisión independiente**: no ejecuta ni edita) |

- Global: `read:*.env*=ask` / `*.env.example=allow`; `external_directory` global `deny` con allowlist de los directorios
  propios de OpenCode.
- **Conclusión (confianza ALTA):** la configuración efectiva de los 8 agentes es **coherente** con sus responsabilidades;
  `qa-reviewer` conserva su independencia (sin shell/edición/delegación) y `test-executor` conserva las capacidades
  operativas requeridas. **No se demostró defecto de configuración → no se modificó ningún permiso/agente.**

### 23.2 Enforcement en runtime de `bash: deny` — **NO VERIFICADO** (bloqueo de proveedor)

- **Objetivo:** comprobar **por ejecución** (operación inofensiva y aislada, `echo AUD_BLOCK3_PROBE_*`) que los 3 agentes
  ven rechazada la herramienta de shell, y distinguir *denegación efectiva del permiso* de *rechazo del modelo por
  instrucciones*, *error de proveedor/cuota/auth* y *resultado no concluyente*.
- **Intentos realizados (3):**

| # | Vía | Resultado real |
| --- | --- | --- |
| 1 | `opencode run --standalone --agent test-designer --model opencode/nemotron-3-ultra-free --format json …` | exit 1; `{"type":"error","error":{"type":"provider.auth","message":"OpenCode's free tier can only be used from within OpenCode","status":403}}` |
| 2 | `opencode run --agent test-designer --model opencode/nemotron-3-ultra-free --format json …` (sin `--standalone`) | idéntico `provider.auth` 403 |
| 3 | Subagente `test-designer` dentro de OpenCode | `Subagent failed (ses_…): OpenCode's free tier can only be used from within OpenCode` |

- **Clasificación:** **error de proveedor** (`provider.auth` 403, free tier), **no** evidencia de permisos. El modelo nunca
  llegó a invocar la herramienta, por lo que **no** se puede demostrar una denegación técnica ni inferirla de un eventual
  "no puedo" del modelo.
- **Conclusión:** el enforcement en runtime de `bash: deny` para `test-designer`, `exploratory-qa` y `risk-analyst` queda
  **NO VERIFICADO** (no confundir con aprobado). Es la **misma limitación ya documentada en AUD-09**; **no se reabre**
  AUD-09 por no existir evidencia nueva. La verificación se limita a la **configuración efectiva** (§23.1), resuelta por el
  mismo motor de permisos.

### 23.3 Cobertura de `automation/specs/**` — inventario

- **Método (sólo lectura):** script `automation/.runs/block3-tmp/inventory.py` (efímero, excluido del `MANIFEST`) que
  relaciona cada manifiesto (`suite_id`, `test_cases[].spec`/`test_name`) con los `test('…')` reales de cada spec y con
  los tests de `automation/tests/*.spec.ts` que ejecutan cada suite.

| Spec | Suite (manifiesto) | Casos | ¿Ejecutado por `npm test`? | Evidencia |
| --- | --- | --- | --- | --- |
| `automation/specs/demo-web/site.spec.ts` | `SUITE-demo-qaa-web` | TC-DEMO-WEB-1, TC-DEMO-WEB-2 | Sí (`runner.infra` "web: …") | `.runs/suite-demo-web` + `.artifacts` (regenerables) |
| `automation/specs/demo-api/api.spec.ts` | `SUITE-demo-qaa-api` | TC-DEMO-API-1, TC-DEMO-API-2 | Sí (`runner.infra` "api: …") | `.runs` + `.artifacts` (regenerables) |
| `automation/specs/heal-demo/off.spec.ts` | `SUITE-heal-demo-off` | TC-HEAL-1, TC-HEAL-9 | Sí ("heal C") | `.runs` (regenerable) |
| `automation/specs/heal-demo/observe.spec.ts` | `SUITE-heal-demo-observe` | TC-HEAL-10 | Sí ("heal D") | `.runs` (regenerable) |
| `automation/specs/heal-demo/hc.spec.ts` | `SUITE-heal-demo-hc` | TC-HEAL-2,3,4,6,7,8,11,13 | Sí ("heal A/E/F") | `.runs` (regenerable) |
| `automation/specs/heal-demo/hc-fail.spec.ts` | `SUITE-heal-demo-hc-fail` | TC-HEAL-5 | Sí ("heal B") | `.runs` (regenerable) |
| `automation/specs/dcshoes/home.spec.ts` | `SUITE-dcshoes-tc001` | TC-001 | **No** (requiere el sitio real) | `qa/tests/dcshoes_execution_trace.json` (histórico); la captura del sitio comercial `qa/evidence/dcshoes/TC-001_home.png` **no se distribuye** (ver §32). Referencia reproducible: el propio spec |

- **Consistencia estructural:** 7 specs ↔ 7 manifiestos; **0** `test_name` sin spec, **0** specs sin manifiesto, **0**
  tests "huérfanos" (presentes en el spec pero ausentes del manifiesto), **0** referencias inválidas. `TC-HEAL-12` no es un
  spec: es la verificación de infraestructura ("heal A") del bundle M-01.
- **Aclaración:** la existencia de un archivo de spec **no** implica ejecución; sólo `SUITE-dcshoes-tc001` queda sin corrida
  automatizada dentro de `npm test`.

### 23.4 Discrepancia demostrada (declarado vs ejecutado) y corrección

- **B3-COV-01 (documentación, severidad BAJA).** `README.md:58`, `automation/README.md:56`/`:75`/`:109`/`:125` y
  `docs/RUNNER-M03.md:8`/`:129`/`:206` declaraban **"20 tests `sqlite-adapter` / 52 tests"**; la realidad medida es
  **23 / 55** (los 3 tests añadidos en AUD-10/§21 no se reflejaron en esos documentos).
- **Evidencia:** `node node_modules/playwright/cli.js test --list` → **"Total: 55 tests in 3 files"**; `npm.cmd test` →
  **55 passed** (2 `infra.smoke` + 30 `runner.infra` + 23 `sqlite-adapter`).
- **Corrección (sólo documentación):** cifras actualizadas a `55` / `23` en los 3 documentos. Sin cambios de código,
  contratos, `MANIFEST.json`, artefactos JSON ni dependencias.

### 23.5 Oportunidades de cobertura no cubiertas (no son defectos; opcionales)

- **`SUITE-dcshoes-tc001`:** spec y manifiesto presentes pero **sin corrida automatizada** (depende del sitio real; ya
  declarado como limitación en `docs/AUTOMATION-ARCHITECTURE.md` §5). En este bloque **no** se ejecutó contra el sitio en
  vivo (fuera de alcance; red externa). Existe evidencia **histórica** de una etapa previa.
- **Fixture `automation/scripts/serve-demo.mjs`:** sin aserción quedan `GET /api/health`, el `404` de un `/api/*` desconocido
  y bordes de `POST /api/orders` (`qty>10`, `qty` no entero, JSON inválido). Lo probado hoy cubre producto desconocido,
  `qty=0` y el caso válido.
- **No se amplió la cobertura** en este bloque: son mejoras opcionales, no defectos demostrados.

### 23.6 Validación (comandos y resultados reales)

| # | Comando | Resultado |
| --- | --- | --- |
| 1 | `npm.cmd run typecheck` | **exit 0** (sin errores) |
| 2 | `npm.cmd test` | **55 passed** (2 smoke + 30 `runner.infra` + 23 `sqlite-adapter`) |
| 3 | `node node_modules/playwright/cli.js test --list` | **Total: 55 tests in 3 files** |
| 4 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests — OK** |
| 5 | `python qa/tools/validate_contracts.py --bundle qa --json` | **`valid: true`** (4 artifacts, 31 records, 0 errors) |
| 6 | `opencode debug agents` / `opencode debug config` | configuración efectiva de los 8 agentes (ver §23.1) |

> Las pruebas usan el código actual (`pretest` recompila `automation/.dist`); no se validó con artefactos compilados
> desactualizados.

### 23.7 Preservación (sin Git)

Backups fuera del repositorio (bytes originales, previos a toda edición):
`%LOCALAPPDATA%\Temp\opencode\AUD-BLOCK3\backup\`.

| Archivo | Antes (B · SHA-256) | Después (B · SHA-256) |
| --- | --- | --- |
| `README.md` | 5.103 · `508EF99B5A25CAA33370FB48116E6B435019DA9563FE28852971368F272E715A` | 5.103 · `163110816A185B9C1EE794BE7F3BD9B9632C1C1A61922B18D95788B181013B05` |
| `automation/README.md` | 9.039 · `9DD323F8EF1D4A054581E9417C1AC02E217C084260080697A68B53FE00EAF17E` | 9.039 · `E6EB00377D8675F16DB9C2CDACD18BBB7AD3065B7A53342396AA112CC865DA56` |
| `docs/RUNNER-M03.md` | 16.480 · `9CFCFBC5803169D912A095C73E68561DEA912098FFDAAC5D415DA9CE56059270` | 16.480 · `15413FA4EDC079ADA1E23AB48FC73088E68174EC523A118282E0D3A8F36A4DE9` |

- Los tamaños no cambian (sólo `20→23` y `52→55`); encoding preservado (UTF-8 sin BOM; `docs/RUNNER-M03.md` se mantiene
  CRLF como estaba, `README.md`/`automation/README.md` en LF) y sin `U+FFFD`.
- `docs/QA-SYSTEM-AUDIT.md` es **este** informe (auto-referencia); sus hashes no se tabulan.
- `MANIFEST.json` **no** requiere cambios: no se agregó ni quitó ninguna ruta gestionada.

### 23.8 Limitaciones / no verificado

- Enforcement en runtime de `bash: deny` para los 3 agentes: **NO VERIFICADO** por bloqueo del proveedor (`provider.auth`
  403, free tier) — §23.2. No se declara aprobado.
- Fuera de alcance del Bloque 3 y por tanto no verificados aquí: calidad real de los LLM; i18n completa del `report.html`.
- Los conteos de documentos **históricos** (`docs/QA-SYSTEM-STABILITY-AUDIT.md`, fechado 2026-10-10) **no** se reescribieron por ser snapshots de su fecha.

**Estado:** 🟡 Permisos (configuración efectiva) **VERIFICADO** · 🔴 Enforcement en runtime **NO VERIFICADO** (bloqueo de
proveedor) · ✅ Cobertura inventariada · ✅ B3-COV-01 corregido (sólo documentación).

---

## 24. Bloque 4 — Verificación y optimización de la coordinación multiagente — 2026-10-12

**Alcance autorizado:** (1) inspeccionar la arquitectura de coordinación (8 agentes, `AGENTS.md`, `opencode.json`, skills y flujo documentado); (2) probar la **coordinación real** con QA Lead como coordinador; (3) evaluar eficiencia con las métricas realmente disponibles; (4) revisar la independencia de QA Reviewer; (5) proponer optimizaciones y corregir sólo lo demostrado. Sin iniciar el bloque de limpieza/preparación para GitHub.

### 24.1 Arquitectura de coordinación (inspección) — VERIFICADO (diseño/configuración)

- **Delegación:** `opencode.json:3-4` (`default_agent: qa-lead`, `subagent_depth: 1`). QA Lead (`mode: primary`) es el **único** que delega: su `permission.task` habilita exactamente los 7 especialistas (`test-designer`, `exploratory-qa`, `risk-analyst`, `test-executor`, `test-data`, `bug-analyst`, `qa-reviewer`) con `"*": deny`; los 7 especialistas tienen `task: deny` → **sin delegación anidada**.
- **Condiciones de participación:** **no existe** una matriz explícita "tipo de tarea → agentes". El flujo canónico de 12 etapas está en `AGENTS.md` y `qa-lead.md:30`; la selección de especialistas queda a criterio de QA Lead (`qa-lead.md:38`). Sólo QA Reviewer tiene condición escrita, por riesgo (`qa-lead.md:72`; `docs/VALIDATION-POLICY.md`).
- **Transferencia de resultados:** los subagentes devuelven **texto** a QA Lead; los formatos de salida están en `docs/AGENT-CONTRACTS.md` (Generic Result, Risk Record, Exploratory Finding, Test Case, Test Data Record, Bug Record/Failure Classification, Reviewer Verdict). `Lead Consolidation Report` usa `inputs_by_agent[].output_ref` ("path or identifier").
- **Independencia de QA Reviewer (diseño):** `edit: deny`, `bash: deny`, `task: deny` → no ejecuta, no edita, no delega; sólo lee. Modelo distinto al de QA Lead (`longcat-2.5-preview-free` vs `nemotron-3-ultra-free`).
- Coherencia de roles/permisos ya verificada en §23.1; **sin cambios**.

### 24.2 Prueba de coordinación real — **NO VERIFICADO** (bloqueo de proveedor)

- **Intento 1 (delegación a especialista):** `subagent(test-designer, "responde LISTO")` → **`Subagent failed`**; `provider.auth`: *"OpenCode's free tier can only be used from within OpenCode"*.
- **Intento 2 (delegación al revisor independiente):** `subagent(qa-reviewer, …)` → **mismo error**. Se **detuvieron** los intentos (Bloque 4 §2).
- QA Lead `mode: primary` **no** es invocable como subagente y `opencode run --agent qa-lead` ya había fallado por el mismo motivo en el Bloque 3 (§23.2).
- **Evidencia histórica concordante:** `qa/reports/dcshoes_report.md:70-74` registra una corrida real previa con `qa-reviewer` invocado **dos veces**, ambas fallidas con el mismo mensaje; veredicto **BLOCKED – NO EJECUTADO** (no degradado a `ACCEPT`).
- **Conclusión:** **no hay evidencia de ejecución real** de la coordinación (QA Lead → especialistas → retorno → consolidación → revisión). **No se declara que la coordinación funcione en runtime.** El bloqueo es de **infraestructura/proveedor** (free tier), **no** un defecto de diseño demostrado.

### 24.3 Eficiencia — métricas disponibles y límites

- **No hay métricas directas de tokens ni de duración por agente/delegación** en las herramientas disponibles; todo lo de eficiencia aquí es **cualitativo** (sin tiempos ni porcentajes inventados).
- **Única métrica cuantitativa real:** el runner (M-02) registra `duration_ms` por corrida y por caso (p. ej. `automation/.runs/m06-demo-run/report.json`: 5024 ms; caso `TC-M06-WEB-1` 643 ms). Es **tiempo de pruebas**, no de agentes.
- **Duplicación entre agentes:** frases como "NO EVIDENCE = NO CONFIRMED RESULT" o "tool called → … → result validated" se repiten en casi todos los prompts. **No es redundancia de contexto en runtime** (cada agente corre en su propio contexto): eliminarla **degradaría** cada guardrail. **No debe eliminarse.**
- **Duplicación intra-agente (redundancia real, mismo contexto):** `test-executor.md` repite "tool called → … → result validated" en *Execution Discipline* (l.115) y *Evidence & Traceability* (l.135); `qa-lead.md` cita el gate de validación de contratos en *Validation Rules* (l.79) y de nuevo en *Output* (l.115). Impacto en tokens **muy bajo**.
- **Resultado generado y no aprovechado (estructural):** los 8 agentes tienen `edit: deny` y ninguno tiene escritura genérica → **los agentes no persisten** los artefactos de diseño (Test Case, Risk Record, Test Data Record, Bug Record); sólo `test-executor` escribe, y únicamente vía runner (`npm run suite*`). Los `qa/tests/dcshoes_*.json` existen pero se persistieron fuera del flujo de agente. Coherente con "read-only por defecto"; la trazabilidad de diseño depende del operador. **(Observación estructural, no defecto demostrado.)**

### 24.4 Revisión independiente de QA Reviewer

- **Diseño:** recibe artefactos por referencia (lee archivos), **no** ejecuta el validador (sin shell) y devuelve `Reviewer Verdict` (ACCEPT/CHALLENGE/INSUFFICIENT_EVIDENCE) con rationale y `missing_evidence`; su scope cubre Failure Classification, Bugs, Test Data, Pre-flight, Retest/Regression, auto-healing y conformidad de contratos.
- **Diferencialidad:** no afirmable por inspección y **no comprobada en ejecución** por el bloqueo del proveedor → **NO VERIFICADO**.
- **No simulación:** el archivo *declara* independencia, pero eso no se tomó como prueba.

### 24.5 Hallazgo demostrado y corrección

- **B4-COORD-01 (documentación, severidad BAJA, CONFIRMADO).** `docs/AUTOMATION-ARCHITECTURE.md:17` listaba el Core QA como `… · test-data · explorer · bug-analyst · qa-reviewer`; **no existe** un agente `explorer` (el subagente genérico `explore` no es parte del Core QA). El nombre correcto es `exploratory-qa`.
  - **Evidencia:** `opencode debug agents` → 8 IDs (`qa-lead`, `test-designer`, `exploratory-qa`, `risk-analyst`, `test-executor`, `test-data`, `bug-analyst`, `qa-reviewer`); `explorer` sólo aparecía en esa línea.
  - **Corrección (sólo documentación):** `explorer` → `exploratory-qa`, diagrama re-pad a 74 columnas. Sin cambios de código, contratos, `MANIFEST.json`, agentes, permisos ni dependencias.

### 24.6 Optimizaciones (estado de implementación)

- **Con fundamento técnico:**
  1. **Selección proporcional de agentes** en `qa-lead.md`: las tareas triviales/de bajo riesgo no requieren todos los especialistas; escalar según complejidad/riesgo. (Toca **reglas de delegación → requiere aprobación**.) → **IMPLEMENTADA** en §24.10 (**B4-COORD-02**).
  2. **Eliminar redundancia intra-agente** en `test-executor.md` (l.115/135) y `qa-lead.md` (l.79/115). Ahorro mínimo; no medible sin runtime.
  3. **Persistencia de artefactos de diseño:** decidir si QA Lead debe poder persistir Test Cases/Risk/Bugs/Test Data (hoy `edit: deny`). (**Permisos/seguridad → requiere aprobación explícita**.)
- **Hipotéticas (sin evidencia):** condensar el flujo de 12 etapas según complejidad; alinear el flujo resumido de `docs/USER-INTERFACE.md:32` con el canónico.
- Ninguna de estas 3 optimizaciones se implementó; **no se marcan como optimizadas**.

### 24.7 Validación

- **Bloques §24.1–24.5:** no se aplicaron cambios operativos (ni código, ni prompts de agentes, ni permisos, ni modelos). El único cambio fue **documentación** (`docs/AUTOMATION-ARCHITECTURE.md`) más este informe.
- **§24.10 (ajuste final):** se modificó **1 instrucción de coordinación** en `.opencode/agents/qa-lead.md` (selección proporcional de agentes), con aprobación explícita. No se tocaron modelos, permisos, contratos ni otros archivos operativos.
- Conforme a la regla del bloque ("si sólo se modifican instrucciones/documentos, ejecutar sólo las comprobaciones pertinentes, sin repetir pruebas que no aporten evidencia"), **no** se re-ejecutaron `typecheck`/`npm test`/pruebas Python/`validate_contracts`: ningún componente que cubren cambió. Estado vigente = Bloque 3 §23.6 (`typecheck` exit 0 · `npm test` 55 passed · Python 114 OK · bundle `valid: true`).
- Verificación del cambio de §24.1–24.5: `docs/AUTOMATION-ARCHITECTURE.md` conserva 74 columnas, sin BOM, LF, sin `U+FFFD` (SHA-256 en §24.8).
- Verificación de §24.10: `.opencode/agents/qa-lead.md` conserva UTF-8 sin BOM, LF, sin `U+FFFD`; los 8 roles siguen identificados; sin cambios de modelos, permisos ni contratos (SHA-256 en §24.8).

### 24.8 Preservación (sin Git)

Backup fuera del repo:
- §24.1–24.5: `%LOCALAPPDATA%\Temp\opencode\AUD-BLOCK4\backup\`.
- §24.10: `%LOCALAPPDATA%\Temp\opencode\AUD-BLOCK4\opt1\` (`qa-lead.md`, `QA-SYSTEM-AUDIT.md`).

| Archivo | Antes (B · SHA-256) | Después (B · SHA-256) |
| --- | --- | --- |
| `docs/AUTOMATION-ARCHITECTURE.md` | 9.409 · `F349038AB91B290EF2B4DD1A8A16ED0B569EFC38E63E5D33099D5662A5A7417E` | 9.408 · `7E7DC4E3EEEEE4CA2819A7B4F48503BE4CF8A48BD2763081EA4192887D4DEF8B` |
| `.opencode/agents/qa-lead.md` | 6.518 · `A3D7C2827ACDCB51EDBE79D28145E42CAD485EEF2588D2F709F661392E9C11E1` | 7.245 · `1D8FC34CB66BABB00647398057B432DE2E6AB8C7DD50F8522498F27AC27774C0` |

- La diferencia de 1 byte en `AUTOMATION-ARCHITECTURE.md` se debe sólo al re-pad del diagrama (una `·` menos, UTF-8 2 bytes); ambas versiones tienen 74 columnas.
- En `qa-lead.md`, el backup es byte-idéntico al original (mismo SHA-256); el crecimiento (+727 B) corresponde sólo al texto añadido en `## Delegation`.
- `docs/QA-SYSTEM-AUDIT.md` es **este** informe (auto-referencia); su hash no se tabula. Hash previo a §24.10: `A4FF112EC4204C7B9A442B4DF69C8139F0CB56E5E4B88F302C0146D74ACCAF4C`. `MANIFEST.json` **no** requiere cambios (mismas rutas). No se eliminó ningún archivo del proyecto.

### 24.9 Limitaciones / no verificado

- **Coordinación en runtime** (delegación, retorno, consolidación, revisión independiente): **NO VERIFICADO** por bloqueo del proveedor (`provider.auth` 403, free tier) — §24.2.
- **Diferencialidad real de QA Reviewer:** **NO VERIFICADO** — §24.4.
- **Tokens/tiempo por agente:** **no medibles** con las herramientas disponibles — §24.3.
- Defectos de **higiene del workspace** (no del sistema QA) detectados y **no** tocados (corresponden al bloque de limpieza): `.aud-tmp/` (vacío), `<ruta-malformada>/automation/.runs/` (árbol con ruta malformada) y `.aud-block3-debug-config.txt` (UTF-16) en la raíz.
- Fuera de alcance del Bloque 4 y no verificados aquí: calidad real de los LLM; i18n completa del `report.html`.
- No se inició el bloque de limpieza/preparación para GitHub.

### 24.10 Ajuste final — selección proporcional de agentes (B4-COORD-02, IMPLEMENTADO)

- **Cambio aplicado:** en `.opencode/agents/qa-lead.md`, sección `## Delegation` (l. 57–69), se sustituyó la lista de especialistas (sin criterio de uso) por una **guía de selección proporcional al alcance, la complejidad y el riesgo**. Cada uno de los 7 roles conserva su identidad y ahora incluye *cuándo* invocarlo; se aclara que la guía **no es una secuencia obligatoria** y que las tareas simples/de bajo riesgo pueden resolverse con **flujo reducido**, mientras mayor alcance/riesgo justifica más especialistas. Se añadió: dar a cada agente un **objetivo claro y el contexto necesario**, y **usar sus resultados en la consolidación final**.
- **Justificación:** la sección previa enumeraba los especialistas sin criterio de proporcionalidad, lo que no orientaba la delegación; el ajuste la orienta sin alterar responsabilidades, permisos, contratos ni el control de revisión por riesgo (que se mantiene referenciado en `## Validation Rules`).
- **Preservado:** los **8 roles** siguen identificados (los 7 especialistas en `## Delegation` + el propio `qa-lead`); `opencode.json`, modelos, permisos, `AGENT-CONTRACTS.md`, `docs/VALIDATION-POLICY.md` y el resto de archivos operativos **sin cambios**. No se eliminaron otras instrucciones (no fue reducción de texto) y **no** se implementaron las propuestas #2 ni #3 (§24.6).
- **Sin afirmación de mejora medida:** NO se declara mejora de consumo de tokens ni de velocidad; no hubo comparación real (§24.3).
- **No verificado:** la coordinación en **runtime** permanece **NO VERIFICADO** por bloqueo del proveedor (§24.2).
- **Evidencia:** `.opencode/agents/qa-lead.md:57-69` (contenido final); SHA-256 antes/después y backup en §24.8.

**Estado:** 🟡 Coordinación (diseño/configuración) **VERIFICADO por inspección** · 🔴 Coordinación en runtime **NO VERIFICADO** (bloqueo de proveedor) · ✅ B4-COORD-01 corregido (sólo documentación) · ✅ B4-COORD-02 implementado (selección proporcional en `qa-lead.md`) · ⏸️ Optimizaciones #2 y #3 propuestas, **no** implementadas.

---

## 25. Bloque 5 - Limpieza integral y preparación para GitHub - 2026-10-12

### 25.1 Objetivo, alcance y criterios

Preparar el árbol para una publicación limpia y reproducible, retirando residuos confirmados y ordenando artefactos generados, **sin** publicar en GitHub y **sin** reestructurar carpetas operativas ni tocar código fuente/contratos/agentes/config/modelos/permisos/dependencias. Criterios aplicados a cada candidato (§3): si algo lo referencia (config/script/prueba/doc/agente); si integra la instalación/ejecución normal; si es regenerable por un procedimiento reproducible; si contiene datos únicos; y si es documentación histórica o registro de auditoría. Ante duda, el elemento **no** se elimina: se mueve a cuarentena (reversible) o se conserva.

### 25.2 Preservación (§1)

- Respaldo completo fuera del proyecto: `%LOCALAPPDATA%\Temp\opencode\AUD-BLOCK5\backup-full\` (2026-10-12), incluyendo temporales y generados evaluados.
- **845 archivos · 50.345.010 B.** Verificación: `robocopy /E /COPY:DAT` (exit 1 = OK); manifiesto nombre+tamaño idéntico (`differences=0`; SHA `B1DC941E1306CDC592B8C504E56F1C5DE031E983BF0C6D52990D987B46B3622E`); **hash SHA-256 por archivo idéntico** (content hash-manifest `7CA6B25AC2F0D192704F22FAF79D1EDD077490D04FCCBD63D05E7456822E4252`).
- No se restauró desde respaldos antiguos (AUD-BLOCK3/4); las modificaciones aprobadas (Bloques 3 y 4) se conservan.

### 25.3 Inventario integral (§2)

- Método: enumeración recursiva **incluyendo ocultos** (excl. `node_modules`), rutas normalizadas a `/`, comparadas contra las 169 rutas de `MANIFEST.json`.
- Estado inicial: **392** archivos (excl. `node_modules`); 169 en `MANIFEST` (**0 faltantes**); **223 fuera** del `MANIFEST` (todos clasificables: regenerables + 1 residuo).
- `node_modules/`: 453 archivos · 45.082.009 B — regenerable, excluido por `.gitignore`, **conservado** localmente para poder ejecutar validaciones.

| Cat. | Elementos | Decisión |
| --- | --- | --- |
| 1. Código/config necesario | agentes (8), skills (12), `automation/runner|specs|tests|scripts|manifests|fixtures`, `qa/schema`, `qa/tools/*.py`, contratos, `playwright.config.ts`, `tsconfig.json` | Conservado |
| 2. Documentación vigente | `README.md`, `automation/README.md`, `qa/README.md`, `docs/AUTOMATION-ARCHITECTURE.md`, `USER-INTERFACE`, `REPORT-MODES`, `VALIDATION-POLICY`, etc. | Conservado |
| 3. Documentación histórica | `docs/QA-SYSTEM-STABILITY-AUDIT.md`, `docs/QA-SYSTEM-AUDIT.md`, `qa/reports/dcshoes_report.md`, `qa/bugs/dcshoes_bugs.json` | Conservado |
| 4. Artefactos regenerables | `automation/.artifacts/`, `automation/.dist/`, `automation/.runs/`, `qa/tools/__pycache__/`, `node_modules/` | Cuarentena (.gitignore ya los excluye); `node_modules` local |
| 5. Residuos confirmados | `.aud-block3-debug-config.txt` (UTF-16, rutas locales), `.aud-tmp/` (vacío), `<ruta-malformada>/` (árbol vacío con ruta malformada) | **Retirado** (cuarentena) |
| 6. Dudosos | 5 directorios de `automation/.runs/` citados como evidencia en §17/§21 | **Conservado** |

### 25.4 Limpieza controlada (§4) — retirado / conservado

Retirado a **cuarentena** (reversible, no borrado):

| Elemento | Tipo | Archivos | Bytes |
| --- | --- | --- | --- |
| `.aud-block3-debug-config.txt` | residuo | 1 | 1.708 |
| `.aud-tmp/` | residuo (vacío) | 0 | 0 |
| `<ruta-malformada>/` | residuo (vacío) | 0 | 0 |
| `qa/tools/__pycache__/` | regenerable | 6 | 219.255 |
| `automation/.dist/` | regenerable (build) | 6 | 115.971 |
| `automation/.artifacts/` | regenerable (salida Playwright; `automation/README.md:57` dice "no es evidencia QA") | 48 | 724.900 |
| `automation/.runs/` (resto) | regenerable | 111 | 471.127 |

- **Conservado por evidencia** (citado en la auditoría): `automation/.runs/m06-assoc-test`, `m06final-20261011-221241`, `m06-demo-run`, `m06-debug-error`, `m06-debug-error-2` (51 archivos).
- **Conservado por función:** `node_modules/` (local; excluido de publicación). No se eliminó código fuente ni se reestructuraron carpetas operativas.

### 25.5 `.gitignore` (§4/§5)

- Cambio acotado: 587 → 734 B. SHA-256 antes `D4BC9FE4756EC6EE0A5D1537AD3DAFC1DDD2ABDEBDBB8B5C27B330510E732448` → después `0BC7F926F42C3C91D137D92A09780480A81F89D99773896BDC9C827E56C5F2DE`. UTF-8 sin BOM, LF.
- **Añadido:** `.aud-*` (dumps temporales de auditoría), `*.log`, `.DS_Store`, `Thumbs.db`, `Desktop.ini`.
- Ya cubría (sin cambios): `node_modules/`, `automation/.artifacts/`, `automation/.dist/`, `automation/.runs/`, `qa/runs/`, `__pycache__/`, `*.pyc`, `*.tsbuildinfo`, `.env*`.

### 25.6 Regenerabilidad verificada (§6)

| Artefacto | Cómo se regeneró | Resultado |
| --- | --- | --- |
| `automation/.dist/` | `npm test` → `pretest` (`build:runner`) | 6 archivos · 115.971 B |
| `automation/.artifacts/` | `npm test` (reporter Playwright) | `playwright-report/` + `test-results/` |
| `qa/tools/__pycache__/` | ejecución de los tests Python | 2 archivos · 103.090 B |

Los regenerados durante la validación se re-movieron a `…\quarantine\regenerated-after-validation\` para dejar el árbol minimal (solo inventario).

### 25.7 MANIFEST.json

- **Sin cambios** (no se agregó/quitó ninguna ruta). Tras la limpieza: **169/169** rutas presentes, **0 faltantes**.
- Los 5 runs conservados quedan fuera del `MANIFEST` por diseño (su `scope` excluye `node_modules`, `.dist`, `.runs`, `.artifacts` y bytecode).

### 25.8 Validaciones ejecutadas (§6)

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **55 passed**, exit 0 |
| `python qa/tools/test_validate_contracts.py` | 38 OK |
| `python qa/tools/test_preflight.py` | 48 OK |
| `python qa/tools/test_report_generator.py` | 14 OK |
| `python qa/tools/test_data_verification.py` | 14 OK (114 total) |
| `python qa/tools/validate_contracts.py --bundle qa/ --json` | `valid: true`, errors 0, exit 0 |

Toolchain: Node v24.21.0 · npm 11.19.0 · Python 3.12.10. No se repitieron pruebas que no aportaran evidencia.

### 25.9 Preparación para GitHub (§5) — secretos, rutas y licencias

- **Secretos:** escaneo de patrones (password/secret/api_key/token/`BEGIN PRIVATE KEY`/bearer) sobre el árbol (excl. `node_modules`): **sin credenciales reales**. Las coincidencias son documentación, tests y fixtures ficticios (`QAA_PF_ABSENT_SECRET`, `SELECT password FROM users`). `.npmrc`/`opencode.json` sin secretos; no existe `.env`.
- **Rutas locales del equipo:** saneadas en §28 — las rutas personales de `docs/QA-SYSTEM-AUDIT.md` se sustituyeron por referencias portables (`%LOCALAPPDATA%`, `%APPDATA%`, `<ruta-malformada>`). No eran secretos. El residuo `.aud-block3-debug-config.txt` (que también exponía rutas locales) ya había sido retirado.
- **Licencia:** incorporada en §28 (MIT · `Copyright (c) 2026 Francisco Ruiz`); `README.md` enlaza a `LICENSE`.
- **Documento comparativo con un framework externo:** estaba marcado HISTÓRICO (no operativo); **retirado** del árbol y de `MANIFEST` en §27 (limpieza final de referencias externas).
- `.opencode/` solo contiene 8 agentes + 12 skills (sin configuración local sensible).

### 25.10 Preservación (sin Git) (§7)

- Cuarentena fuera del repo: `%LOCALAPPDATA%\Temp\opencode\AUD-BLOCK5\quarantine\` → `residues/`, `regenerables/`, `regenerated-after-validation/`.
- Nada se eliminó de forma irreversible; respaldo íntegro en `…\AUD-BLOCK5\backup-full\`.

### 25.11 Limitaciones y decisiones pendientes (§8)

- **Publicación en GitHub: NO iniciada** (esperando aprobación).
- Sin Git en el proyecto: la cobertura de `.gitignore` se verificó **por inspección de patrones**, no con `git check-ignore`.
- Decisiones pendientes: (a) licencia; (b) sanear o conservar rutas locales en docs históricos; (c) purga definitiva de la cuarentena (opcional: los regenerables ya están excluidos de publicación).
- Sin cambios en código fuente, contratos, esquemas, agentes, `opencode.json`, `AGENTS.md`, modelos, permisos ni dependencias.

**Estado (Bloque 5):** ✅ Residuos retirados (cuarentena) · ✅ Regenerabilidad verificada · ✅ Validaciones OK (typecheck 0 · npm 55 · Python 114 · bundle `valid:true`) · ✅ `MANIFEST` 169/169 · ✅ `.gitignore` endurecido · ⚠️ Licencia y publicación en GitHub pendientes de aprobación.

---

## 26. Bloque 5 (ajuste) - Eliminación definitiva de residuos en cuarentena - 2026-10-12

### 26.1 Alcance

Eliminar **definitivamente** el contenido de la cuarentena creada en §25 (`%LOCALAPPDATA%\Temp\opencode\AUD-BLOCK5\quarantine`), sin crear una segunda cuarentena y **sin** tocar `backup-full` ni los respaldos históricos (AUD-BLOCK3/4). Los residuos dejan de existir; no se reubican.

### 26.2 Verificación previa (que nada fuera necesario)

- `automation/scripts/create-m06-demo-db.mjs` regenera `demo.db` **y** `manifest.json` → `automation/.runs/m06-demo/*` es regenerable.
- Referencias en documentación a `.artifacts/`, `.dist/`, `.runs/`, `__pycache__`, `block3-tmp`, `aud04-after`: comandos de ejemplo, inventarios históricos o artefactos declarados **efímeros/regenerables** por la propia auditoría; ninguno exige que el artefacto en cuarentena exista.
- La métrica citada en §21 (`automation/.runs/m06-demo-run/report.json`, `duration_ms`) corresponde a un run **conservado en el proyecto** (§25.4), no a la cuarentena.

### 26.3 Eliminado definitivamente

**182 archivos · 2.332.687 B** · manifiesto SHA-256 `0AE89F410A33FA1361D8C81AC29703E728400B61B8F261AE33CE79D48EAA4813`.

| Grupo | Contenido | Archivos |
| --- | --- | --- |
| `residues/` | `.aud-block3-debug-config.txt`, `.aud-tmp/`, `<ruta-malformada>/` | 1 (+2 dirs vacíos) |
| `regenerables/` | `.artifacts/` (48), `.dist/` (6), `.runs/` resto (111), `__pycache__/` (6) | 171 |
| `regenerated-after-validation/` | `.dist/`, `.artifacts/`, `__pycache__` (recreados durante las validaciones de §25.6) | 10 |

### 26.4 Conservado (no eliminado)

- **Evidencia:** los 5 runs de §25.4 (`m06-assoc-test`, `m06final-20261011-221241`, `m06-demo-run`, `m06-debug-error`, `m06-debug-error-2`) intactos en el proyecto (51 archivos).
- Código fuente, pruebas, contratos, documentación vigente e histórica, `node_modules/` (local).
- `backup-full` (845 archivos · 50.345.010 B) y respaldos AUD-BLOCK3/4: **intactos y externos** al proyecto.

### 26.5 Validaciones re-ejecutadas (tras la eliminación)

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **55 passed**, exit 0 |
| `python qa/tools/test_validate_contracts.py` | 38 OK |
| `python qa/tools/test_preflight.py` | 48 OK |
| `python qa/tools/test_report_generator.py` | 14 OK |
| `python qa/tools/test_data_verification.py` | 14 OK (114 total) |
| `python qa/tools/validate_contracts.py --bundle qa/ --json` | `valid: true`, errors 0, exit 0 |

Regenerabilidad **re-confirmada**: `npm test` recreó `automation/.dist/` (6 archivos) y `automation/.artifacts/` (2); los tests Python recrearon `qa/tools/__pycache__/` (2). Tras validar, esos regenerados se eliminaron de forma **definitiva** (mismo criterio, sin segunda cuarentena) para mantener el árbol minimal; `automation/.runs/` quedó con exactamente los 51 archivos de evidencia conservados.

### 26.6 Estado del árbol tras el ajuste

- `MANIFEST.json`: **169/169** rutas presentes · **0 faltantes** · sin cambios (mismo SHA que el respaldo).
- Residuos y regenerables: **ausentes**. Cuarentena: **inexistente** (`AUD-BLOCK5` solo contiene `backup-full`).
- Total del proyecto: **673 archivos · 48.820.624 B** (incluye `node_modules/`).
- Nota: los 5 runs conservados contienen subdirectorios vacíos `pw/<test>/` generados por Playwright; **no** se tocaron para no alterar el bundle de evidencia.

### 26.7 Limitaciones

- Sin Git en el proyecto: cobertura de `.gitignore` verificada por inspección de patrones.
- **Decisiones pendientes** (sin cambios): licencia; sanear o conservar rutas locales en docs históricos; publicación en GitHub (no iniciada).

**Estado (Bloque 5 - ajuste):** ✅ Cuarentena eliminada definitivamente (182 archivos) · ✅ Evidencia y respaldos conservados · ✅ Validaciones OK (typecheck 0 · npm 55 · Python 114 · bundle `valid:true`) · ✅ Regenerabilidad re-confirmada · ⚠️ Licencia y publicación en GitHub pendientes de aprobación.

---

## 27. Limpieza final de referencias externas - 2026-10-12

### 27.1 Objetivo y alcance

Retirar de AGENTE-QAA toda referencia a un **proyecto/framework externo de referencia** y a su repositorio asociado, de modo que el proyecto tenga identidad documental **independiente** y publicable. Se actuó **solo sobre documentación y `MANIFEST.json`**; no se tocó código, contratos, pruebas, agentes, esquemas, configuraciones ni funcionalidad.

### 27.2 Búsqueda (recursiva, sin distinguir mayúsculas)

Patrón: nombre del proyecto externo y sus variantes de escritura, nombre del repositorio asociado y URLs. Ámbito: **todo el árbol**, incluidos archivos ocultos y documentos históricos. Se distinguió lo publicable de lo excluido por `.gitignore` (`node_modules/`, artefactos regenerables).

### 27.3 Documento comparativo retirado

- **Eliminado** del árbol el documento comparativo de compatibilidad con el framework externo, y **retirada su ruta de `MANIFEST.json`**.
- **No** se creó otro documento comparativo con nombre distinto.
- Los aprendizajes ya incorporados de forma independiente se conservan en la documentación propia: runner (M-03), auto-healing (M-05) y verificación de datos (M-06) en `docs/AUTOMATION-ARCHITECTURE.md`, `docs/AUTO-HEALING.md` y `docs/DATA-VERIFICATION.md`. El documento comparativo no aportaba contenido técnico no incorporado que justificara conservarlo.

### 27.4 Menciones retiradas (conservando el sentido)

Cada mención se sustituyó por una **descripción genérica** ("documento comparativo con un framework externo") o se eliminó el fragmento cuando ya no aportaba valor. Se preservaron intactos los hallazgos técnicos propios, las evidencias, los criterios de aceptación y las correcciones de AGENTE-QAA.

| Archivo | Menciones | Acción |
| --- | --- | --- |
| Documento comparativo externo | documento completo | **Eliminado** (también del `MANIFEST`) |
| `docs/QA-SYSTEM-AUDIT.md` | 13 | Descripción genérica / fragmento eliminado |
| `docs/QA-SYSTEM-STABILITY-AUDIT.md` | 6 | Descripción genérica |
| `docs/AUTOMATION-ARCHITECTURE.md` | 1 | "la arquitectura objetivo del sistema" |
| `MANIFEST.json` | 1 | Ruta retirada |

**Total de menciones retiradas en archivos conservados: 21** (además del propio documento eliminado).

### 27.5 Estado de `MANIFEST.json`

- JSON **válido**; **168 entradas** (era 169), **sin duplicados**, **sin rutas faltantes**, **0** entradas fuera del árbol.
- Rutas con `/`; ninguna referencia al proyecto externo.

### 27.6 Validaciones (resultados reales)

| Verificación | Resultado |
| --- | --- |
| Búsqueda recursiva final (todo el árbol) | **0 coincidencias** |
| Enlaces internos al documento eliminado | **0** enlaces colgantes |
| `MANIFEST.json` (JSON + integridad) | válido · 168 · 0 duplicados · 0 faltantes |
| `python qa/tools/validate_contracts.py --bundle qa/ --json` | `valid: true`, errors 0, exit 0 |
| Suites Python (`test_validate_contracts`, `test_preflight`, `test_report_generator`, `test_data_verification`) | 38 + 48 + 14 + 14 = **114 OK**, exit 0 |
| Preservación de agentes/código/pruebas | Comparación SHA-256 contra el respaldo `backup-full`: **solo difieren** `.gitignore` (de §25), `docs/AUTOMATION-ARCHITECTURE.md`, `docs/QA-SYSTEM-STABILITY-AUDIT.md`, `docs/QA-SYSTEM-AUDIT.md` y `MANIFEST.json`. **0** cambios en agentes, código, pruebas o configuración. |
| `.opencode/agents/qa-lead.md` | SHA-256 `1D8FC34C…` — **sin cambios** |
| Árbol (excl. `node_modules`) | **219 archivos** = 168 del `MANIFEST` + 51 de evidencia |

### 27.7 Limitaciones y decisiones pendientes

- Sin Git en el proyecto: la verificación de exclusión por `.gitignore` es por inspección de patrones.
- **Decisiones pendientes** (sin cambios): licencia; conservar o sanear las rutas locales en la documentación; **publicación en GitHub no iniciada**.
- El respaldo externo `%LOCALAPPDATA%\Temp\opencode\AUD-BLOCK5\backup-full\` (845 archivos) **no** se modificó; conserva una copia del documento retirado **fuera** del proyecto (no publicable).

**Estado (§27):** ✅ Referencias externas **0** · ✅ Documento comparativo eliminado y retirado del `MANIFEST` · ✅ Aprendizajes útiles ya incorporados en documentación propia · ✅ Agentes/código/pruebas **sin cambios** · ✅ Gate y suites Python OK · ⚠️ Licencia y publicación pendientes de aprobación.

---

## 28. Preparación final para publicación (licencia, saneamiento y cierre) - 2026-10-12

### 28.1 Alcance y preservación (§5)

Preparar los archivos para publicar **sin** inicializar Git, sin commits y sin subir nada. Antes de modificar, se respaldó fuera del proyecto en `%LOCALAPPDATA%\Temp\opencode\AUD-PUBPREP\backup\`: `README.md` (`16311081…`), `docs/QA-SYSTEM-AUDIT.md` (`E7E95968…`) y `MANIFEST.json` (`CC7D51AB…`). Se preservaron todos los cambios aprobados de etapas previas; no se restauró nada desde respaldos antiguos ni se modificó código operativo.

### 28.2 Licencia MIT (§1)

- **Creado** `LICENSE` (raíz) con el texto estándar de la licencia MIT y el aviso `Copyright (c) 2026 Francisco Ruiz`. Sin condiciones propias.
- `README.md`: nueva sección **License** que indica distribución bajo MIT y enlaza `[LICENSE](LICENSE)` (sin duplicar el texto).
- `MANIFEST.json`: `LICENSE` incorporado al inventario; `version` `1.11.0-core` → **`1.12.0-core`** (convención observada: el minor sube al cambiar el conjunto de archivos); `generated` `2026-10-12` (sin cambio).

### 28.3 Dependencias y avisos de terceros (§1)

| Componente | Versión | Licencia | Comprobado en |
| --- | --- | --- | --- |
| `@playwright/test` | 1.64.0 | Apache-2.0 | `package.json` + `LICENSE` |
| `playwright` / `playwright-core` | 1.64.0 | Apache-2.0 | `package.json` + `LICENSE` |
| `typescript` | 5.9.3 | Apache-2.0 | `package.json` + `LICENSE.txt` |
| `@types/node` | 24.19.1 | MIT | `package.json` + `LICENSE` |
| `undici-types` (transitiva) | — | MIT | `package.json` |
| Python | 3.12.10 | PSF | solo biblioteca estándar (sin dependencias de terceros) |

- Todas las licencias verificadas son permisivas (Apache-2.0 / MIT) y compatibles en la práctica con distribuir el proyecto bajo MIT. **No** se hizo revisión legal formal; no se declara compatibilidad absoluta.
- **No verificable aquí:** licencia del binario de Chromium (descargado por Playwright, fuera del repositorio y no incluido en la publicación).

### 28.4 Saneamiento de rutas personales (§2)

- Búsqueda recursiva (sin distinguir mayúsculas) sobre el conjunto publicable (`MANIFEST`).
- Se saneó `docs/QA-SYSTEM-AUDIT.md` (**17 líneas afectadas**) sustituyendo rutas absolutas de la máquina del desarrollador por referencias portables, preservando el significado de la evidencia histórica, los nombres de archivo, los hashes y los pasos de reproducción:
  - `C:\Users\<usuario>\AppData\Local\Temp\opencode\…` → `%LOCALAPPDATA%\Temp\opencode\…` (**11**).
  - `C:\Users\<usuario>\AppData\Roaming\ai.opencode.desktop\cli\<version>\opencode-cli.exe` → `%APPDATA%\ai.opencode.desktop\cli\<version>\opencode-cli.exe` (**1**).
  - Nombre del residuo con ruta malformada → `<ruta-malformada>` (**4**).
  - Bullet «Rutas locales» de §25.9 reescrito para reflejar el saneamiento.
- **Sin cambios funcionales:** `qa/tools/preflight.py` y `qa/tools/test_preflight.py` usan la variable de entorno genérica `LOCALAPPDATA` (no son rutas personales).
- Las rutas personales que restan en `automation/.runs/**` (evidencia reproducible) **no** se alteran: `.gitignore` excluye `automation/.runs/`, por lo que **no forman parte de la publicación**.

### 28.5 Archivos publicables, secretos y `.gitignore` (§3)

- Archivos necesarios **presentes**; `LICENSE` incorporado. El documento comparativo externo **no reaparece** (0 referencias al proyecto externo en todo el árbol).
- **Secretos:** sin credenciales reales. Las coincidencias del escaneo son documentación, código y pruebas con valores ficticios (`super-secret-token-12345`, `QAA_SECRET_TOKEN`, `SELECT password FROM users`) que verifican que **no** se filtran. No existe `.env` real ni credenciales en el árbol publicable.
- **`.gitignore`:** excluye `node_modules/`, `automation/.artifacts/`, `automation/.dist/`, `automation/.runs/`, `qa/runs/`, `__pycache__/`, `*.pyc`, `*.tsbuildinfo`, `.env`/`.env.*` (con `!.env.example`), `.aud-*`, `*.log` y basura del SO. **Ningún** respaldo externo, credencial ni residuo local dentro del conjunto publicable.
- **`.env.example`:** no existe; la regla `!.env.example` ya permitiría versionar un ejemplo seguro si se añadiera.
- **README:** documenta comandos reales (`npm ci`, `verify:env`, `browsers:install`, `build:runner`, `test`, `suite:demo-*`, `typecheck`; `python qa/tools/preflight.py …`), coherentes con `package.json`.

### 28.6 Validación técnica final (§6)

| Comando | Resultado |
| --- | --- |
| `npm.cmd run typecheck` | exit 0 |
| `npm.cmd test` | **55 passed**, exit 0 |
| `python -m unittest discover -s qa/tools -p "test_*.py"` | **114 OK**, exit 0 |
| `python qa/tools/validate_contracts.py --bundle qa --json` | `valid: true`, errors 0, exit 0 |

- Las pruebas regeneraron `automation/.dist/` (6), `automation/.artifacts/` (2) y `qa/tools/__pycache__/` (6); tras validar se **retiraron** (artefactos locales). `automation/.runs/` quedó **intacto** (51 archivos; hash sin cambios).
- **UTF-8:** `LICENSE`, `README.md`, `docs/QA-SYSTEM-AUDIT.md` y `MANIFEST.json` sin BOM y decodifican correctamente.
- **Enlaces del `README`:** el único enlace interno es `LICENSE` → existe.
- **`MANIFEST.json`:** válido · **169** entradas · 0 duplicados · 0 rutas faltantes · `LICENSE` incluido.
- **Árbol** (excl. `node_modules`): **220 archivos** = 169 del `MANIFEST` + 51 de evidencia (`automation/.runs/`).
- **Coordinación multiagente en runtime: NO VERIFICADA** (bloqueo del proveedor, `provider.auth` 403, free tier). No se declara verificada.

### 28.7 Limitaciones y decisiones pendientes (§7)

- Sin Git en el proyecto: la cobertura de `.gitignore` se verificó por inspección de patrones (no `git check-ignore`).
- **No verificado:** licencia del binario de Chromium (fuera del repositorio) y revisión legal formal de licencias de terceros.
- La evidencia `automation/.runs/**` queda **excluida** de la publicación por `.gitignore` (decisión existente); las referencias históricas del informe a esos runs no serán resolubles en un clon limpio.
- La clasificación de artefactos **locales vs. reproducibles** y el **mapa de reproducción** con pruebas incluidas están en **§29** (nota documental; no altera ningún resultado de §1–§28).
- Falta la **aprobación explícita** del usuario para iniciar Git y publicar.

**Estado final (§28): PREPARADO CON DECISIONES PENDIENTES** — ✅ Licencia MIT incorporada (`Copyright (c) 2026 Francisco Ruiz`) · ✅ Rutas personales saneadas en el conjunto publicable · ✅ Sin secretos, sin referencias externas, sin respaldos/residuos locales publicables · ✅ `.gitignore` correcto · ✅ `MANIFEST.json` válido (169) · ✅ Validaciones OK (typecheck 0 · npm 55 · unittest 114 · `valid:true`) · ⚠️ Pendiente: aprobación para iniciar la publicación, revisión legal formal de licencias de terceros, y (decisión existente) evidencia `automation/.runs/**` excluida por `.gitignore`.

---

## 29. Nota de distribución y reproducibilidad de la evidencia local - 2026-10-12

**Motivo:** varias secciones (§15, §17, §21, §22, §25, §26) citan artefactos concretos bajo
`automation/.runs/**`, `automation/.artifacts/**` y `automation/.dist/**`. Esos directorios son
**salidas locales** excluidas por `.gitignore` y **no se distribuyen**: un clon limpio no las
contiene. Esta nota **no altera ningún resultado ni conclusión histórica** (§1–§28): sólo distingue
lo **reproducible con el repositorio** de lo que era **artefacto local del entorno de auditoría**.

### 29.1 Clasificación de las referencias

| Tipo de referencia | Ejemplos en el informe | ¿Distribuida? | Tratamiento |
| --- | --- | --- | --- |
| Directorio/salida **regenerable** | `automation/.runs/<suite>/<run>`, `automation/.dist/runner/*.js`, `automation/.artifacts/**` | No (local) | Se regenera con las pruebas/scripts incluidos (§29.2) |
| **Artefacto histórico concreto** citado como evidencia | `automation/.runs/m06final-20261011-221241`, `m06-assoc-test`, `m06-demo-run`, `m06-debug-error*` | No (local) | Resultado histórico **conservado como conclusión**; su reproducción exacta no se afirma (§29.3) |
| **Placeholder** en ejemplos de contrato | `automation/.runs/suite/R-xxx/...` (M-01), `automation/.runs/m06-demo/...` (M-06) | — | Ejemplo ilustrativo; sin dependencia de existencia real |

### 29.2 Mapa de reproducción (pruebas/scripts incluidos en el repositorio)

| Comportamiento auditado | Sección | Prueba/script incluido (nombre real) |
| --- | --- | --- |
| AUD-04 — `report.html` resuelve el `href` de evidencia relativo a su propio directorio | §17 | `automation/tests/runner.infra.spec.ts` → `AUD-04: report.html resolves evidence links from its own directory`; `AUD-04: missing evidence renders as a disabled (missing) link` |
| M-02 — `duration_ms` calculado desde los timestamps del trace | §24.3 | `runner.infra.spec.ts` → `m02: duration_ms is computed from trace timestamps`; `m02: duration_ms is 0 for missing or invalid timestamps` |
| M-02 — reporte generado y consistente | §15 | `runner.infra.spec.ts` → `m02: report.json and report.html are generated and consistent` |
| M-06 — verificación de datos ejecutada y reflejada en el resultado | §21 | `runner.infra.spec.ts` → `m06: suite with data verifications executes them and reflects results` |
| M-06 — base inválida produce `ERROR` (sin crash) | §21 | `runner.infra.spec.ts` → `m06: error scenario - invalid database path produces ERROR status` |
| M-06 — valores de `params` redactados y sin datos sensibles en errores | §21.1 | `automation/tests/sqlite-adapter.spec.ts` → `21. parameter values are redacted from evidence and result`; `20. sensitive data is not exposed in error messages` |
| M-06 — `demo.db` + `manifest.json` regenerables | §26.2 | `automation/scripts/create-m06-demo-db.mjs` (script incluido) |
| M-01 — validación de contratos sobre una corrida | §15, §18 | `qa/tools/validate_contracts.py` (Python stdlib incluido) |

### 29.3 Alcance de lo reproducido

- Las pruebas anteriores reproducen el **comportamiento** (el fix y su no-regresión); **no**
  reconstruyen los runs históricos concretos.
- El run `automation/.runs/m06-assoc-test` (§17/§22) se cita como **"antes"** del fix (reporte
  pre-fix **sin** regenerar); su existencia exacta no se replica y **no se afirma** una reproducción
  histórica exacta.
- `automation/.runs/m06final-20261011-221241` (§15/§17) sustentó la validación M-01 ejecutada
  **entonces**; el resultado histórico se conserva, y la validación puede re-ejecutarse sobre
  cualquier corrida regenerada con el runner incluido.
- Los conteos del árbol (p. ej. **220 = 169 + 51**) describen **este entorno local**; en un clon
  limpio el árbol queda sólo con los **169** archivos del `MANIFEST.json` (los 51 restantes son
  evidencia de `automation/.runs/`, excluida por `.gitignore`).

### 29.4 Limitaciones / no verificado

- No se re-ejecutó la batería completa para esta nota (el cambio es **sólo documental**).
- La reproducción **byte a byte** de los artefactos históricos citados **no** fue verificada y
  **no** se declara.
- La cobertura de `.gitignore` se verificó por **inspección de patrones** (sin `git check-ignore`,
  porque el proyecto no es un repositorio Git): `.gitignore` (raíz) excluye `automation/.runs/`,
  `automation/.artifacts/`, `automation/.dist/`, `qa/runs/`, `__pycache__/`, `.aud-*`, `*.log`.

---

## 30. Política de idioma adaptable de la comunicación (2026-10-12)

### 30.1 Objetivo y alcance

Hacer que la comunicación **dinámica** con el usuario siga el idioma del usuario, de forma consistente entre
los 8 agentes, sin traducir el repositorio ni alterar contratos. Alcance: respuestas, preguntas, mensajes de
progreso, explicaciones de errores, interfaz de Bienvenida/HELP y reportes FAST/DETAIL. **No** se modifican
modelos, permisos, contratos, esquemas ni dependencias.

### 30.2 Estado previo (evidencia)

- Ningún agente ni skill declaraba reglas de idioma: búsqueda de
  `language|idioma|español|english|traduc|translate|respond|responde` sobre `.opencode/` → **0 coincidencias**.
- `AGENTS.md` (raíz) y las instrucciones de los 8 agentes estaban en inglés; `docs/USER-INTERFACE.md` y
  `docs/REPORT-MODES.md` contenían texto de cara al usuario en español **fijo**. Esto producía la
  inconsistencia ES/EN ya registrada en §4 (fila 6) y §10.

### 30.3 Decisión e implementación (mínima)

- **Fuente única:** nueva sección **`## Language Policy (user communication)`** en `AGENTS.md` (raíz),
  heredada por todos los agentes (ver §30.4). Los agentes **no** repiten el bloque (se evita duplicar
  instrucciones extensas en cada uno).
- Se añadió en `AGENTS.md`, sección *User Interface*, un bullet que remite a la política (evita leer la lista
  de saludos en español como mandato de idioma fijo).
- Se añadieron **notas de idioma** (fecha 2026-10-12) en `docs/USER-INTERFACE.md` y `docs/REPORT-MODES.md`:
  las plantillas definen **estructura**; el texto humano se renderiza en el idioma del usuario, conservando
  identificadores, estados, claves JSON y valores de contrato.

### 30.4 Herencia por los agentes

- **Mecanismo (revisión de configuración):** `opencode.json` no define `instructions` propias; `AGENTS.md` de
  raíz es la instrucción de proyecto cargada para todos los agentes (primario y subagentes). Ningún frontmatter
  de agente sobreescribe instrucciones.
- **Revisión de contradicciones:** los 8 agentes y las skills fueron revisados; **no** contienen reglas de
  idioma que contradigan la política. No se editó ningún archivo de `.opencode/`.
- **Comprobación en runtime:** ver §30.5, prueba 3 (subagente `bug-analyst` sin regla de idioma propia).

### 30.5 Validación en runtime

Comando base: `opencode run --standalone --agent <agente> --model opencode/nemotron-3-ultra-free "<mensaje>"`
(opencode v2.0.24). Evidencia = texto de la respuesta del agente.

| # | Escenario | Entrada | Salida observada | Estado |
| --- | --- | --- | --- | --- |
| 1 | QA Lead, solicitud en español | “Hola, responde solo con una frase breve: en qué idioma estás respondiendo? No ejecutes pruebas.” | `Estoy respondiendo en español.` | PASS |
| 2 | QA Lead, solicitud en inglés | “Hello, reply with one short sentence only: in which language are you answering? Do not run tests or use tools.” | `I am answering in English.` | PASS |
| 3 | Subagente especialista, contexto con error en otro idioma | `bug-analyst`, solicitud en español citando `ENOENT: no such file or directory, open C:/x/y` | `Significa que el sistema intentó abrir el archivo o directorio C:/x/y pero no existe (...)` | PASS |
| 4 | Cambio explícito de idioma en la misma sesión | Sesión ES `ses_ecd56b754ffeOU4RiA1d0jvGef`; turno 2: “Ahora responde en inglés con una sola frase ...” | Turno 1: `Estoy respondiendo en español.` · turno 2: `I am answering in English.` | PASS |

Observaciones: (1)(2) el mensaje se respondió en el idioma de la solicitud; (3) el subagente explicó en español
**conservando** el mensaje original en inglés, sin inventar causas; (4) el cambio se aplicó tras una solicitud
explícita en la misma conversación.

### 30.6 Limitaciones / bloqueos (no verificado)

- `opencode run` **sin** `--model` usó el modelo por defecto global `claude-haiku-5-5` y devolvió
  `Error: Upstream request failed: Insufficient account funds`. La validación forzó
  `--model opencode/nemotron-3-ultra-free`.
- Crear una sesión con **ID propio** (`--session ses_langswitchtest0000000001`) devolvió
  `Error: OpenCode's free tier can only be used from within OpenCode`; el gating del tier gratuito fue
  **intermitente**. Se resolvió creando la sesión de forma normal y continuándola con su ID real.
- **No verificado:** comportamiento de modelos distintos a `opencode/nemotron-3-ultra-free` (otros modelos por
  agente) y de proveedores externos; idioma en la interfaz interactiva (TUI) más allá del CLI headless.
- La herencia se verificó (a) por **revisión de configuración/instrucciones** y (b) por **runtime** para el
  subagente `bug-analyst`; no se instrumentó el system prompt de cada uno de los 8 agentes por separado.

### 30.7 Preservación y alcance de cambios

- Respaldo temporal verificado por **SHA-256** en `.aud-langbak-2026-10-12/` (ignorado por `.gitignore` vía
  `.aud-*`) de los 4 archivos modificados, previo a la edición.
- Archivos modificados: `AGENTS.md`, `docs/USER-INTERFACE.md`, `docs/REPORT-MODES.md`,
  `docs/QA-SYSTEM-AUDIT.md` (esta sección). Nada más.
- No se tocó: `.opencode/agents/*`, `.opencode/skills/*`, `opencode.json` (modelos/permisos), contratos,
  esquemas, `qa/tools/`, `automation/`, `README.md`, `LICENSE`. No hay Git ni publicación.

---

## 31. Verificación final previa a la publicación (2026-10-12)

### 31.1 Objetivo, método y límites

Comprobar, **sobre los archivos reales** y sin apoyarse sólo en informes previos, que el estado actual de
AGENTE-QAA es publicable. No se agregó funcionalidad, no se reinició la auditoría integral, no se inicializó
Git ni se publicó nada. Las comprobaciones se hicieron por inspección directa del árbol y ejecutando las
validaciones declaradas.

### 31.2 Estado verificado (requisitos)

| Requisito | Resultado (sobre archivos reales) |
| --- | --- |
| Licencia MIT en la raíz | `LICENSE` presente con `Copyright (c) 2026 Francisco Ruiz` |
| `README.md` enlaza a `LICENSE` | enlace `[LICENSE](LICENSE)`; el destino existe (resuelve) |
| `MANIFEST.json` | **169** entradas · **0** duplicados · **0** faltantes · rutas con `/` (0 con `\`) |
| `.gitignore` | excluye `node_modules/`, `automation/.artifacts/`, `playwright-report/`, `test-results/`, `blob-report/`, `*.tsbuildinfo`, `__pycache__/`, `*.pyc`, `automation/.dist/`, `automation/.runs/`, `qa/runs/`, `.env`/`.env.*` (`!.env.example`), `.aud-*`, `*.log` y basura del SO |
| Archivos necesarios presentes | **8** agentes · **12** skills · **18** `*.schema.json` (más el registro `index.json`) · **7** specs · **4** tests Python · **13** docs · `LICENSE`, `README.md`, `opencode.json`, `package.json`, `tsconfig.json`, `playwright.config.ts`, `MANIFEST.json` |
| Referencias al proyecto externo | **0** coincidencias del nombre del proyecto externo de compatibilidad (búsqueda case-insensitive) en el conjunto publicable; su documento histórico de auditoría **no** existe en el árbol ni en el `MANIFEST` |
| Rutas personales | sólo **2** líneas, ya saneadas a `<usuario>` / `%LOCALAPPDATA%` (ninguna ruta real) |
| Credenciales reales | patrones estrictos (API key/bearer/PEM/AWS/GitHub/JWT/Google): **0**. Las coincidencias `secret/token/password` son ficticias de documentación/pruebas (`QAA_SECRET_TOKEN`, `super-secret-token-12345`, `SELECT password FROM users`, `s3cr3t-value-xyz-do-not-leak`) que verifican que **no** se filtran |
| Respaldos/residuos publicables | **0** (nombres `backup/.bak/.tmp/.dump/.orig/.old`); `.aud-*` excluido; no hay `.env` real |
| Comandos documentados | `README.md`: instalación (`npm ci`), compilación (`build:runner`), pruebas (`npm test`, `suite:demo-*`), entorno (`verify:env`, `browsers:install`) y `preflight.py`; el validador M-01 (`validate_contracts.py`) está documentado en `docs/CONTRACTS-VALIDATION.md`, `docs/AGENT-CONTRACTS.md` y `qa/README.md` |

### 31.3 Clasificación del conjunto publicable vs. excluido

| Categoría | Contenido | Estado |
| --- | --- | --- |
| Fuente / documentación | **169** rutas del `MANIFEST.json` (incluía **9** capturas del sitio comercial bajo `qa/evidence/dcshoes/`, evidencia histórica de referencia) | **Se publica** (las **9** capturas comerciales se retiraron después: ver §32) |
| Artefactos regenerables | `node_modules/` (453 archivos), `automation/.dist/`, `automation/.artifacts/`, `__pycache__/`, `*.tsbuildinfo` | Excluidos por `.gitignore` |
| Resultados locales de ejecución | `automation/.runs/` (**51** archivos / 5 runs), `qa/runs/`, `playwright-report/`, `test-results/`, `blob-report/` | Excluidos por `.gitignore` |
| Respaldos temporales | `.aud-*` | Excluidos por `.gitignore` |

Los **51** archivos de evidencia local **no** se incorporaron para cuadrar el árbol con el `MANIFEST`: se
verificó que quedan **fuera** del conjunto publicable. Ejemplos reproducibles y su mapa están en §29.

### 31.4 Validación final (comandos y resultados reales)

| # | Comando | Resultado | Exit |
| --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | `tsc --noEmit` sin errores | **0** |
| 2 | `npm.cmd test` | **55 passed** (2.3m) | **0** |
| 3 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests** · **OK** (31.0s) | **0** |
| 4 | `python qa/tools/validate_contracts.py --bundle qa --json` | `"valid": true` | **0** |

### 31.5 Limpieza posterior y estado del árbol

- La batería generó artefactos **regenerables** (`automation/.dist/`, `automation/.artifacts/`,
  `qa/tools/__pycache__/`). Se **retiraron** (14 archivos): el árbol volvió a **220** archivos
  (excl. `node_modules`) = **169** del `MANIFEST` + **51** de evidencia, sin residuos.
- `MANIFEST.json`: **169** · 0 duplicados · 0 faltantes (tras la limpieza).
- Archivos ya versionados **sin cambios**. Hashes SHA-256 **completos** del conjunto verificado:
  - `AGENTS.md` = `473ffc39cb6982895fafac3d246bc4b161e5b8122777949083be77ce0d6c0040`
  - `docs/USER-INTERFACE.md` = `415339b165bbb0f7750a10b8479b9606fe6aa4b11b4a9a76e9269a10d504e28b`
  - `docs/REPORT-MODES.md` = `6ce6dc1a3aa90630ca0ff28ae360fca867ecba46ab95abef946e8916b9199361`
  - `docs/QA-SYSTEM-AUDIT.md` = `fa19aee528e3c4c5ed162c1d39d118a1ef412c4f19190f5c5be63d2417366b8d`
- La batería de pruebas **no** modificó ningún archivo publicable. Nota de autorreferencia: el SHA-256 de
  `docs/QA-SYSTEM-AUDIT.md` es el de la revisión verificada; como el valor se registra dentro del propio
  archivo, añadir esta línea cambia el hash del documento (ningún archivo puede contener literalmente su
  propio hash posterior sin modificarlo).
- Método: una comparación incremental por hash previa a la limpieza resultó **no concluyente** (devolvió 0
  diferencias cuando el árbol había subido a 234); el estado se verificó por **conteo y hashes directos**
  tras la limpieza.

### 31.6 Limitaciones / no verificado (impacto y efecto sobre la publicación)

| Limitación | Impacto | ¿Impide publicar? |
| --- | --- | --- |
| Coordinación multiagente en runtime **NO VERIFICADA** (bloqueo de proveedor, §24.2) | No se demuestra una corrida multiagente extremo a extremo | **No** (no afecta los archivos publicados) |
| Enforcement en runtime de `bash: deny` **NO VERIFICADO** (§23.2) | Falta prueba efectiva en runtime; el least-privilege está verificado a nivel de configuración | **No** |
| Exclusión por `.gitignore` por **inspección de patrones** (sin `git check-ignore`) | No se ejecuta la comprobación nativa de Git | **No** (patrones explícitos y correctos) |
| Revisión **legal formal** de licencias de terceros pendiente (Apache-2.0/MIT) | Riesgo legal, no técnico | **No** (permisivas y compatibles en la práctica) |
| Licencia del binario de Chromium no verificable aquí | Fuera del repositorio y no se distribuye | **No** |
| Evidencia `automation/.runs/**` excluida → referencias históricas no resolubles en un clon | Sólo documental; hay mapa de reproducción (§29) | **No** |
| `README.md` no lista el comando del validador M-01 (sí está en otros docs) | Menor, cosmético | **No** |
| Selección / eficiencia de modelos no medible | Mejora opcional | **No** |

### 31.7 Resultado

**PREPARADO CON LIMITACIONES DOCUMENTADAS.** Sin defectos críticos, sin secretos, sin archivos requeridos
ausentes y con las cuatro validaciones en **exit 0**. Las limitaciones restantes son no concluyentes
(bloqueo de proveedor) o notas documentales/legales que no impiden razonablemente una primera publicación.
**Pendiente:** aprobación explícita del usuario para iniciar Git y publicar.

## 32. Correcciones finales previas al primer push (2026-10-12)

### 32.1 Objetivo, alcance y método

Corregir **cuatro problemas concretos** detectados al revisar el ZIP de preparación, validarlos y dejar el
contenido listo para una primera publicación. No se reinició la auditoría integral, no se agregó
funcionalidad y no se publicó nada; el alcance se limitó a: (1) exposición de valores en verificaciones
SQLite, (2) tratamiento del código de salida de Playwright, (3) referencias externas residuales y cifras de
§31, y (4) retiro de capturas de un sitio comercial de terceros. Se trabajó sobre los archivos reales y se
ejecutaron las validaciones declaradas.

**Preservación.** Antes de modificar o retirar archivos se creó una copia verificable en
`%LOCALAPPDATA%\Temp\opencode\AUD-FINALFIX-20261012\backup\` con `SHA256SUMS.txt`: **22** archivos
(**12** publicables modificados + **1** respaldado sin modificarse (`automation/runner/report.ts`) + **9**
capturas retiradas). Se registraron rutas y hashes SHA-256 de los originales y se conservaron los cambios
aprobados anteriores. No se restauró ningún archivo completo desde respaldos antiguos.

### 32.2 Exposición de valores en verificaciones SQLite (M-06)

- **Problema (confirmado por lectura de código, no una fuga real de credenciales).** Aunque los parámetros
  enlazados ya se redactaban (`<redacted>`), la verificación `column_value` persistía el **valor obtenido**
  (`actual.column_value`) y el **valor esperado** (`expected.value`) en `data_verification.json`,
  `execution_trace.json` y en los mensajes de error; `expected` se devolvía completo y el reporte podía
  contener esos datos.
- **Corrección** (`automation/runner/sqlite-adapter.ts`): se añadió el marcador `REDACTED_VALUE = '<redacted>'`
  y `redactExpectedValue()`. La comparación sigue ejecutándose/evaluándose con los valores reales, pero se
  persiste `<redacted>` en `expected.value` y `actual.column_value`, y los mensajes de error ya no
  interpolan ningún valor. Se conservan `verification_id`, la columna comprobada, el `operator`, el estado
  (`PASS`/`FAIL`/`ERROR`), `column_found` y las referencias de evidencia. No se agregó ninguna opción que
  exponga valores por defecto y no se registraron valores reales en logs temporales.
- **Contrato:** no fue necesario modificar el contrato; `data-verification.schema.json` admite el marcador.
  Se actualizaron las descripciones en `docs/AGENT-CONTRACTS.md` y `docs/DATA-VERIFICATION.md`.
- **Pruebas:** marcadores ficticios `SENSITIVE_ACTUAL_TEST_7F31` y `SENSITIVE_EXPECTED_TEST_9C42`.
  `automation/tests/sqlite-adapter.spec.ts` (tests 24 y 25) verifica una comparación aprobada (PASS) y una
  fallida (FAIL): el marcador **no** aparece en el resultado, en `actual`/`expected`, en `error` ni en
  `evidence`, y el estado/conclusión se mantiene. `automation/tests/runner.infra.spec.ts`
  ("m06 sensitive values") ejecuta el runner y comprueba que **ningún** marcador aparece en
  `data_verification.json`, `report.json`, `report.html`, `execution_trace.json` ni `summary.json`.
  Los tests 13 y 23 del adaptador se ajustaron a la redacción. **No se detectó ni se afirma haber
  corregido una fuga de credenciales real** (los valores usados son ficticios).

### 32.3 Código de salida de Playwright y resultado global

- **Problema.** En `automation/runner/runner.ts` `pwCode` se obtenía pero **no** participaba en la decisión
  final: el estado global y el código de salida se calculaban sólo con los resultados mapeados.
- **Escenario reproducible (reproducido).** Un test que **pasa** pero lanza un rechazo no manejado
  (`void Promise.reject(new Error(...))`) hace que Playwright salga con **código 1** y registre un error de
  nivel superior, mientras que el Test Case mapeado queda `passed`. Con la lógica anterior el runner
  devolvía `PASS` / exit `0`, ocultando el fallo.
- **Corrección.** El código de salida de Playwright pasa a ser autoritativo: si `pwCode !== 0` y **ningún**
  resultado mapeado explica el fallo (sin FAIL/ERROR de datos ni SKIPPED), el run se marca `FAIL`, se agrega
  un mensaje a `infrastructure_errors` (visible en `report.json`/`report.html`) y el proceso devuelve
  `EXIT_FAILURES` (1); `summary.json` registra `playwright_exit_code` e `infrastructure_errors`. Un código
  distinto de `0` que sí queda representado por un FAIL/ERROR/SKIPPED **no** genera un error de
  infraestructura adicional (no se convierte todo no-cero en error de infraestructura). Se conserva la
  distinción `FAIL`/`ERROR`/`BLOCKED` y no se clasifica el FAIL.
- **Pruebas de regresión** (`automation/tests/runner.infra.spec.ts`, "m03 playwright exit"): (a) fallo no
  explicado → `overall_status=FAIL`, exit 1, `infrastructure_errors` presente y `summary.playwright_exit_code=1`;
  (b) fallo normal de un test → FAIL/exit 1 **sin** `infrastructure_errors`; (c) corrida correcta →
  `PASS`/exit 0 sin `infrastructure_errors`.

### 32.4 Referencias externas residuales y cifras

- Se retiró la **única** referencia residual al nombre del proyecto externo de compatibilidad
  (`docs/QA-SYSTEM-AUDIT.md`, fila de §31.2). Nueva búsqueda **case-insensitive** en el conjunto publicable:
  **0 coincidencias**. No se creó documento histórico sustituto ni se alteraron hallazgos técnicos.
- Cifras contrastadas contra el inventario recursivo real y corregidas en §31.2/§31.3:
  **18** `*.schema.json` (antes decía 19; `qa/schema/index.json` es el registro, no un esquema),
  **7** specs bajo `automation/specs/` (antes decía 3) y **9** capturas bajo `qa/evidence/dcshoes/`
  (antes decía 10). El resto de las cifras (8 agentes, 12 skills, 4 tests Python, 13 docs) resultaron
  correctas y se conservaron. Las cifras históricas de secciones previas (p. ej. §23.6, §24, §31.4) se
  mantienen identificadas como históricas.

### 32.5 Capturas de un sitio comercial de terceros

- Se identificaron **9** capturas (no 10) del sitio comercial en `qa/evidence/dcshoes/`. Se confirmó que
  **no** son requeridas por tests, fixtures ni scripts (sólo las referencian registros históricos).
- Se retiraron del conjunto publicable y del árbol de trabajo, y se eliminaron sus **9** rutas de
  `MANIFEST.json` (se preservaron estructura y orden; la versión pasó de `1.12.0-core` a `1.13.0-core`).
- Se ajustaron las referencias documentales (`qa/reports/dcshoes_report.md` y `docs/QA-SYSTEM-AUDIT.md`)
  indicando que las **capturas históricas locales no se distribuyen** y que los **specs reproducibles**
  incluidos (`automation/specs/dcshoes/home.spec.ts`, TC-001) y los registros estructurados son la
  referencia para verificar el comportamiento. No se eliminaron resultados reproducibles ni código, y no
  se tocaron los respaldos externos previos.

### 32.6 Validación integral (comandos y resultados reales)

| # | Comando | Resultado | Exit |
| --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | `tsc --noEmit` sin errores | **0** |
| 2 | `npm.cmd test` | **59 passed** (2 `infra.smoke` + 32 `runner.infra` + 25 `sqlite-adapter`), exit 0 | **0** |
| 3 | `python -m unittest discover -s qa/tools -p "test_*.py"` | **Ran 114 tests · OK** | **0** |
| 4 | `python qa/tools/validate_contracts.py --bundle qa --json` | `"valid": true` (4 artefactos, 31 registros, **0 errores**, **0 warnings**) | **0** |

Comprobaciones adicionales: `.gitignore` conserva los patrones que excluyen los regenerables y los
artefactos locales; `MANIFEST.json` con todas sus rutas existentes; y los escenarios de Playwright y de
redacción SQLite alineados entre sí. Con el flag opcional `--check-evidence` (no forma parte del gate):
`"valid": true`, **20 warnings** correspondientes a registros históricos que referencian las capturas
retiradas (no distribuidas).

### 32.7 Estado del árbol y del manifiesto

- `MANIFEST.json`: **160** entradas · **0** duplicados · **0** faltantes · rutas con `/` · versión
  `1.13.0-core`.
- Árbol de trabajo tras retirar los **regenerables** (`automation/.dist/`, `automation/.artifacts/`,
  `qa/tools/__pycache__/`): **211** archivos (excl. `node_modules`) = **160** del `MANIFEST` + **51** de
  evidencia local (`automation/.runs/`, **no** publicable, conservada como evidencia histórica).

### 32.8 Limitaciones pendientes (impacto y efecto sobre la publicación)

| Limitación | Impacto | ¿Impide publicar? |
| --- | --- | --- |
| **20 warnings** de `--check-evidence`: registros históricos (`qa/tests/dcshoes_*.json`, `qa/bugs/dcshoes_bugs.json`) referencian las capturas retiradas | Sólo documental; las capturas no se distribuyen por licencia. No se reescribieron los registros para no alterar resultados | **No** |
| El proyecto **no** es un repositorio Git | La exclusión por `.gitignore` se verifica por inspección de patrones (sin `git check-ignore`) | **No** |
| Coordinación multiagente y enforcement de `bash: deny` **NO VERIFICADOS** en runtime (bloqueo de proveedor, §24.2/§23.2) | No se demuestra una corrida multiagente extremo a extremo | **No** (no afecta a los archivos publicados) |
| Revisión **legal formal** de licencias de terceros pendiente | Riesgo legal, no técnico | **No** |

### 32.9 Resultado

Las cuatro correcciones se aplicaron y se verificaron sobre los archivos reales, con pruebas de regresión
que fallan contra el comportamiento anterior y pasan con el corregido. Las cuatro validaciones están en
**exit 0** y `MANIFEST.json` es válido y consistente. Persisten únicamente limitaciones no bloqueantes
(20 warnings de evidencia histórica no distribuida, ausencia de Git y la revisión legal formal).
**Pendiente:** aprobación explícita del usuario para iniciar Git y publicar. No se inicializó Git, no se
creó ningún commit, no se configuró remoto y no se publicó nada.
