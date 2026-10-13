# Auto-healing con guardrails (M-05)

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-10 |
| Estado | **IMPLEMENTADO** — motor, contrato, pre-flight, integración en el runner y 12 TC demo (+ 1 verificación de infraestructura) |
| Posición | **Etapa 2.5**, sobre el runner reutilizable (M-03) y el pre-flight (M-04) |
| Riesgo principal | Un heal puede **ocultar un Bug** o convertir un FAIL en PASS indebido |
| Motor | `automation/runner/healed.ts` (adapter Playwright) |
| Contrato | `qa/schema/auto-heal-record.schema.json` (M-01) |
| Depende de | Runner reusable (M-03), contratos de evidencia (M-01), pre-flight (M-04), regresión |

## Objetivo

Recuperar una prueba cuando un **selector/locator dejó de funcionar** por un
cambio de UI legítimo, **sin** enmascarar defectos reales, y dejando evidencia
verificable de cada recuperación.

## 1. Modos de operación

El modo se declara en el manifiesto (`requirements.need.auto_healing.mode`) y
llega al adapter por entorno (`QAA_AUTOHEAL_MODE`).

| Modo | Comportamiento |
| --- | --- |
| `OFF` (por defecto) | No se intenta recuperación. Un selector roto produce `NOT_ATTEMPTED` con 0 candidatos; el store **nunca** se lee ni se escribe. |
| `OBSERVE` | Se identifican y registran candidatos, pero **ninguno** se usa (`accepted: false`, `used_recovery: false`). El test continúa con el selector original y el resultado real se conserva. Nunca lee, escribe ni reutiliza el store. |
| `HIGH_CONFIDENCE` | Criterios estrictos; si un candidato inequívoco los cumple, se sustituye el locator y se verifica. Es el único modo que lee y escribe el store de reutilización. |

## 2. Detección de selectores rotos

- Se intenta el locator original; si no resuelve (timeout/no encontrado) o no
  cumple el estado requerido (habilitado/editable), se marca como **candidato a
  heal** (nunca como PASS).
- Un fallo se trata primero como **FAIL** sujeto a Failure Classification;
  el auto-healing solo entra si el fallo es compatible con un cambio de selector
  (el elemento existe con otro atributo), no cuando el flujo funcional falla.

## 3. Evaluación de alternativas (sin asumir equivalencia)

Los candidatos se generan en este **orden de prioridad** (strategies del
contrato):

1. atributos de prueba estables (`data-testid`, `data-test`, `data-qa`, `data-cy`, `id`);
2. rol + nombre accesible (`role=... [name=...]`);
3. label / placeholder;
4. texto visible / atributos semánticos (`aria-label`, `title`);
5. contexto DOM (relación con ancestro/vecino);
6. otros atributos estables.

Cada candidato se evalúa y se acepta **solo si cumple las cuatro condiciones**:

1. **Unicidad**: exactamente 1 elemento (`count === 1`);
2. **Visibilidad**: el elemento es visible;
3. **Estado**: habilitado y, para `fill`, editable;
4. **Identidad funcional**: mismo rol semántico y misma función objetivo que el
   descriptor `expected` declarado por el spec.

Si no hay un candidato inequívoco, **no hay recuperación**. Un candidato
ambiguo (más de un elemento distinto) no se elige. Varios selectores que
resuelven al **mismo** elemento (fingerprint de ruta DOM) no cuentan como
ambigüedad.

## 4. Guardrails (invariantes)

- Un heal **NO** puede ocultar un Bug.
- Un heal **NO** puede convertir automáticamente un FAIL en PASS: el status
  sigue siendo el que producen las aserciones.
- Un heal **NO** puede cambiar Expected Results.
- Un heal **NO** puede sustituir un elemento por otro con **función distinta**
  (el candidato se rechaza: `REJECTED`).
- Un heal **NO** puede re-ejecutar una acción mutante cuando no puede determinar
  si el efecto ya se aplicó. Esto incluye cuando el sondeo del resultado
  (`outcome`) lanza una excepción: el intento queda **incierto** y la acción no
  se vuelve a ejecutar (se registra `duplicate_prevented: true`; ver §5).
- Tras recuperar, se **re-verifica** el resultado (`verification_after`); solo las
  recuperaciones `POST_VERIFICATION_PASS` se persisten en el store.
- `BLOCKED` / `NOT VERIFIED` / `INSUFFICIENT_EVIDENCE` se conservan.
- Toda recuperación es visible en evidencia y en el reporte (no silenciosa).
- El auto-healing está **desactivado por defecto** y es **opcional por objetivo**.

## 5. Registro, evidencia, confianza y trazabilidad

Cada intento se registra como un artefacto **`auto-heal-record`** (M-01) en
`<out>/autoheal_record.json`, con un `heal_id` único
(`AH-<run_id>-<context_id>-<seq>`) para garantizar unicidad global incluso al
fusionar records de varios specs/contextos.

Estados posibles (`status`): `ORIGINAL_OK`, `RECOVERED`, `REUSED`, `OBSERVED`,
`REJECTED`, `AMBIGUOUS`, `STALE`, `NO_CANDIDATE`, `NOT_ATTEMPTED`.

La protección contra duplicados **no** es un estado propio del motor: cuando una
acción mutante recuperada no puede demorar su efecto (efecto ya aplicado o
indeterminado, incluida una excepción en el sondeo del resultado), el intento
conserva el `status` real (`RECOVERED`/`REUSED`) y se marca con el booleano
`duplicate_prevented: true` más la causa en `reason_reject`; la acción mutante no
se re-ejecuta. `DUPLICATE_PREVENTED` permanece en el enum del esquema como valor
reservado, pero el motor actual **no lo emite**.

Cada record conserva: selector original y usado, candidatos evaluados con su
`reason` (aceptado/rechazado) y `accepted`, modo, `used_recovery`,
`reused_from_store`, `verification_after`, `evidence` (captura obligatoria),
`confidence` y `ai_calls` (siempre `0`). El validador M-01 rechaza un record
recuperado sin `selector_used`, sin `strategy_used` o sin `reason_accept`.

El **runner** enriquece cada trace con un bloque `auto_healing`
(`mode`, `attempts`, `heal_ids`, `ai_calls: 0`) y añade `test_case_id` a los
records seleccionados; `summary.json` incluye un bloque `auto_healing` agregado.

## 6. Store de reutilización (sin IA)

`<out>/autoheal_store.json` (o `--autoheal-store <p>` para reutilización
entre corridas) es estado de máquina versionado (`store_version`). Solo en
`HIGH_CONFIDENCE`:

- las recuperaciones `POST_VERIFICATION_PASS` se persisten como `VERIFIED`;
- en una corrida posterior se re-valida la alternativa almacenada en el contexto
  actual; si sigue cumpliendo los criterios, se reutiliza (`REUSED`,
  `reused_from_store: true`, strategy `stored_reuse`) **sin llamadas a IA**
  (`ai_calls: 0`);
- si la alternativa almacenada dejó de coincidir, se invalida con causa
  (`STALE`, `last_invalid_reason`) y el motor vuelve a la pipeline de candidatos.

`OFF` nunca lee ni escribe el store; `OBSERVE` nunca lo lee, lo usa ni lo
escribe. La reutilización no depende de ningún modelo.

## 7. Recuperación temporal vs. modificación permanente

- **Temporal (en corrida):** se resuelve el locator en memoria para no romper la
  ejecución; queda registrada como heal. No modifica la prueba en disco.
- **Permanente:** actualizar el locator en el código de prueba. **No** se aplica
  automáticamente durante la corrida; exige validación y regresión.

## 8. Validación y regresión antes de cambios permanentes

Un cambio permanente de selector solo se acepta si:

1. La prueba con el locator nuevo pasa de forma estable (repetir N veces).
2. Se ejecuta la **regresión** afectada y no hay regresiones introducidas.
3. La recuperación fue revisada y **no** oculta un cambio funcional real.

Nunca se acepta un cambio permanente "en caliente" durante una corrida normal.

## 9. Integración con el runner y Pre-flight

- **Manifiesto:** `requirements.need.auto_healing: { "mode": "OFF|OBSERVE|HIGH_CONFIDENCE", "store": "ruta/opcional" }`.
- **Runner (M-03):** resuelve el modo y el store, los pasa por entorno y enriquece
  traces/summary con `auto_healing` (ver `docs/RUNNER-M03.md`).
- **Pre-flight (M-04):** valida la configuración de auto-healing como
  `config_dependencies` (CAT_CONFIG). Un `mode` inválido o un `store` no-string
  producen `BLOCKED` y el detector aborta con exit `2`.
- **Test Executor / QA Reviewer:** deben estar conscientes de que un resultado con
  `used_recovery: true` proviene de un locator sustituido; la evidencia del record
  y del trace lo hace visible, nunca silencioso.

## 10. Criterios de aceptación (demostrados en demos aisladas)

- **Caso A** (locator roto por UI legítima): se registra `RECOVERED`/`REUSED`, con
  evidencia y post-verificación; el status real se conserva.
- **Caso B** (bug real: la aserción correcta falla): el auto-healing **no** lo
  oculta; el caso permanece FAIL (TC-HEAL-5).
- **Caso C** (candidato ambiguo): no se elige (`AMBIGUOUS`); el caso no muta a PASS.
- **Caso D** (función distinta): se rechaza (`REJECTED`); sin sustitución cruzada.

Demos aisladas (app local `127.0.0.1:4174`, sin red externa ni credenciales):

| TC | Modo | Qué demuestra |
| --- | --- | --- |
| TC-HEAL-1 | OFF | Selector intacto → `ORIGINAL_OK`, sin recuperación |
| TC-HEAL-9 | OFF | Selector roto → `NOT_ATTEMPTED`, 0 candidatos, store intacto |
| TC-HEAL-10 | OBSERVE | Candidatos identificados pero no usados (`OBSERVED`), store intacto |
| TC-HEAL-2 | HC | Recuperación por `stable_attribute` + post-verificación |
| TC-HEAL-7 | HC | Reutilización desde store en el mismo run (`REUSED`) |
| TC-HEAL-8 | HC | Alternativa almacenada obsoleta → `STALE` con causa + nueva recuperación |
| TC-HEAL-3 | HC | Ambigüedad no recuperable → `AMBIGUOUS` |
| TC-HEAL-4 | HC | Mismo atributo, función distinta → `REJECTED` |
| TC-HEAL-6 | HC | Acción mutante recuperada no se repite (`RECOVERED` + `duplicate_prevented`) |
| TC-HEAL-11 | HC | Sin identidad inequívoca → `NO_CANDIDATE` |
| TC-HEAL-13 | HC | Excepción en el sondeo del resultado → no re-ejecuta la acción mutante |
| TC-HEAL-5 | HC | FAIL preservado aunque el selector se recupere |
| TC-HEAL-12 | HC (infra) | El bundle del run valida con M-01 (`auto-heal-record`) |

La suite demo define **12 Test Cases** en manifiestos (`TC-HEAL-1`…`TC-HEAL-11`
y `TC-HEAL-13`, distribuidos en las suites `SUITE-heal-demo-off/observe/hc/hc-fail`).
`TC-HEAL-12` **no** es un Test Case de suite: es una **verificación de
infraestructura** (que el bundle de la corrida valide con M-01, contrato
`auto-heal-record`) ejecutada por `automation/tests/runner.infra.spec.ts`
(test "heal A"), separada de los Test Cases que ejecuta el runner.

La eficiencia se mide **solo** sobre esta suite demo aislada; no se hacen
afirmaciones de consumo de tokens.

### Limitaciones conocidas (reales)

- El store de reutilización **no** es observable dinámicamente: la prueba de que
  `OFF`/`OBSERVE` "no leen ni escriben" se basa en la ausencia de cambios del
  store entre corridas, no en instrumentación interna del motor.
- En `HIGH_CONFIDENCE` el store puede terminar con entradas `STALE` **por diseño**
  (p. ej. `TC-HEAL-2`/`TC-HEAL-8`), sin que eso sea un defecto.
- El auto-healing solo sustituye **locators**: no corrige fallos funcionales ni de
  negocio, y no debe usarse sobre apps reales sin autorización.
- Los números de eficiencia/tokens corresponden únicamente a la suite demo aislada
  (`127.0.0.1:4174`); no hay afirmaciones de consumo de tokens en producción.

## 11. Relación con otras capacidades

- **M-03 (runner):** el auto-healing se construye sobre el runner.
- **M-01 (contratos):** los heals usan el contrato `auto-heal-record` y el
  Execution Trace; una recuperación no infiere éxito por sí sola.
- **Regresión:** obligatoria antes de aceptar cambios permanentes.
- **Failure Classification:** un heal no resuelto se clasifica
  (`TEST_INFRASTRUCTURE`/`APP_BUG`/`INSUFFICIENT_EVIDENCE`), no se fuerza PASS.
