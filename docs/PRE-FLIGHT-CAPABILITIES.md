# Pre-flight (M-04) — detección de capacidades

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-10 |
| Estado | **IMPLEMENTADO (M-04)** — detector ejecutable + registro validado por M-01; valida la configuración de auto-healing (M-05) |
| Artefacto | `qa/schema/pre-flight-record.schema.json` (contrato existente, validado por M-01) |
| Detector | `qa/tools/preflight.py` (Python 3 stdlib, sin dependencias) |
| Pruebas | `qa/tools/test_preflight.py` (48 pruebas, escenarios aislados) |
| Consumidores | `test-executor` (gate obligatorio antes de ejecutar), `qa-lead`, `test-data`, `risk-analyst` |

> Este documento define **qué debe detectar** Pre-flight, **cómo se decide**
> `READY` / `BLOCKED`, **cómo se ejecuta** el detector y **cómo se registra** el
> resultado. Regla base: una capacidad no detectada **no** se asume disponible;
> se marca `BLOCKED` (condición faltante) o `UNVERIFIED` (no se pudo comprobar).

## Resultados posibles

- **`READY`** — todas las capacidades **requeridas** por el objetivo están
  disponibles y verificadas. El registro **no** incluye `blocked_reasons`.
- **`BLOCKED`** — al menos una capacidad requerida falta o no puede
  verificarse. El registro **debe** enumerar cada causa en `blocked_reasons`.
  `BLOCKED` **nunca** se convierte en `READY` por conveniencia ni por límite de
  tiempo/contexto; se documenta y se detiene la ejecución dependiente.

No hay un tercer resultado en el contrato (`enum`: `READY` | `BLOCKED`). La duda
sobre una capacidad **requerida** se resuelve como `BLOCKED` (con la causa); la
duda o ausencia de una capacidad **no requerida** se registra como
`NOT_REQUIRED` y **no** bloquea.

Un registro `READY` **puede** incluir chequeos con `status: WARN` cuando el
chequeo `target_accessible` opera bajo la política explícita `browser_fallback`
(ver "Semántica del sondeo HTTP del target" más abajo). Esos WARN son
**trazables** y **no** confirman accesibilidad funcional: la evidencia de la
navegación real del flujo de ejecución la determina. Un WARN de Pre-flight
**nunca** se presenta como PASS de un Test Case.

### Semántica del sondeo HTTP del target y política `browser_fallback`

El chequeo `target_accessible` distingue tres situaciones y **nunca** presenta un
sondeo denegado o inconcluso como confirmación de acceso funcional:

| Situación del sondeo (urllib, GET por defecto) | `capability_state` | Efecto |
| --- | --- | --- |
| Status aceptado (`allowed_status`, o `< ok_status_max` y no denegado) | `AVAILABLE` (`OK`) | Confirma accesibilidad funcional por sondeo |
| HTTP 401/403/407/429 (denegado por el servidor, p. ej. protección bot) | `PROBE_DENIED` (`WARN`) **solo con** `browser_fallback: true`; sin la política → `REQUIRES_CONFIGURATION` (`BLOCKED`) | No confirma acceso; la navegación real decide |
| Error de conexión / timeout (sin respuesta) | `PROBE_INCONCLUSIVE` (`WARN`) **solo con** `browser_fallback: true`; sin la política → `REQUIRES_CONFIGURATION` (`BLOCKED`) | No confirma acceso; la navegación real decide |
| Status inesperado (p. ej. 500, o ≥ `ok_status_max`) | `REQUIRES_CONFIGURATION` (`BLOCKED`) en **todas** las políticas | Error real del target; no se relaja |

`need.target.browser_fallback: true` (booleano, validado) declara que la vía de
acceso prevista es el **navegador** (Playwright): si el sondeo HTTP falla, la
ejecución puede continuar y la **evidencia de la navegación real** (trace de
ejecución, assertions, estado HTTP obtenido por el navegador) determina si la
aplicación es accesible mediante el flujo de ejecución. El registro conserva el
WARN con su causa y `confidence: MEDIUM` (acceso aún no confirmado por sondeo);
el `detail` del chequeo lo aclara explícitamente. Sin la política declarada, las
reglas estrictas de bloqueo se mantienen intactas: la política es **aditiva y
explícita**, nunca un relajamiento global.

## Tabla de detección

Cada fila es un chequeo; "Requerido" depende del objetivo y del adapter en uso.

| # | Capacidad | Qué detecta | Señal objetiva | `READY` si… | `BLOCKED` (causa registrada) si… |
| --- | --- | --- | --- | --- | --- |
| 1 | Runtime | Versión de Python, Node.js y npm | `python --version`, `node --version`, `npm --version`; comparación con `*_min` | Runtime requerido presente y dentro del mínimo | Runtime ausente o por debajo del mínimo |
| 2 | Dependencias | Instalación reproducible | `package-lock.json` presente; `node_modules/<paquete>/package.json` | Lockfile y paquetes declarados presentes | Lockfile o dependencia declarada ausente |
| 3 | Herramientas / adapters | Adapter y binarios requeridos | `@playwright/test` + `playwright.config.*`; ejecutables en `PATH` | Adapter configurado y herramientas presentes | Adapter sin configurar o herramienta ausente |
| 4 | Navegadores | Binario del navegador del adapter | Directorio de instalación de Playwright (`<browser>-*`) | Navegador requerido instalado | Navegador no instalado (`npx playwright install <browser>`) |
| 5 | Acceso al target | Alcanzabilidad del target Web/API | TCP/HTTP (status) al host/puerto/URL | Target responde con status esperado | Target inalcanzable o status inesperado |
| 6 | Credenciales y configuración | Presencia de credenciales/config requeridas | Variables de entorno **por nombre** (el valor nunca se lee) | Variables requeridas presentes | Variable requerida ausente |
| 7 | Test Data | Existencia, estado y validación | Registro Test Data `AVAILABLE`, `validated=true`, `usable=true`, con evidencia | Datos requeridos disponibles y validados | Dato inexistente/`UNVERIFIED`/no usable → `BLOCKED-by-data` |
| 8 | Evidence | Capacidad de **guardar** evidencia | Directorio de evidencia escribible (prueba de escritura efímera) | Directorio escribible | Ruta inexistente/no escribible |
| 9 | QA Reviewer | Disponibilidad cuando el riesgo la exige | Señal de runtime `QAA_QA_REVIEWER_AVAILABLE` (ver más abajo) | Reviewer disponible cuando es obligatorio | Reviewer obligatorio (riesgo HIGH/CRITICAL) y no disponible/verificable |
| 10 | Config de auto-healing (M-05) | Validez de la configuración declarada | `requirements.need.auto_healing` (validado por M-01) | `mode` ∈ {`OFF`,`OBSERVE`,`HIGH_CONFIDENCE`} y `store` (si existe) es string | `mode` inválido o `store` no-string → `BLOCKED` (exit 2) |

## Reglas del contrato

1. **Pre-flight solo detecta; no ejecuta** el caso de prueba. Es un gate binario
   de capacidades.
2. **No simular**: si falta una herramienta o permiso, se reporta `BLOCKED`.
   Nunca se emite `READY` "a futuro" ni se finge una capacidad.
3. **Requerido vs opcional**: solo las capacidades **requeridas por el objetivo**
   pueden producir `BLOCKED`. Las opcionales ausentes se registran
   (`NOT_REQUIRED`), no bloquean.
4. **Trazabilidad**: cada `blocked_reason` debe indicar la causa concreta
   (capacidad + detalle verificable + acción), no una causa genérica.
5. **Entrada a la ejecución**: `test-executor` no ejecuta si Pre-flight no es
   `READY`. Un `BLOCKED` se propaga tal cual al reporte.
6. **QA Reviewer obligatorio**: si el riesgo es HIGH/CRITICAL, la disponibilidad
   del reviewer es una capacidad **requerida** (coherente con la regla de
   `risk-record`: HIGH/CRITICAL ⇒ `needs_qa_reviewer` = true).
7. **Read-only**: las verificaciones no modifican Test Data ni la aplicación. La
   única escritura en disco es una prueba de escritura efímera en el directorio
   de evidencia (creada y borrada al instante) y el `--out` opcional del
   registro.
8. **Sin secretos**: las credenciales se detectan por **nombre**; el valor nunca
   se lee, imprime ni almacena. Las causas nombran la variable, no su contenido.

## Implementación ejecutable (M-04)

### Uso

```bash
python qa/tools/preflight.py --requirements <archivo.json> [--out <registro.json>] [--json]
```

| Salida | Significado |
| --- | --- |
| `0` | `READY` |
| `1` | `BLOCKED` (al menos una condición requerida no se cumple) |
| `2` | Fatal (uso/JSON inválido, o el registro generado no satisface el contrato) |

Por defecto el registro generado se valida con M-01 antes de informarse
(`--no-validate` lo omite). El registro se imprime en formato legible; `--json`
imprime el JSON y `--out` lo escribe en disco.

Ejemplo con la base técnica actual:

```bash
python qa/tools/preflight.py --requirements qa/tools/fixtures/preflight/requirements_demo_web.json
```

### Formato del archivo de requisitos

```json
{
  "task": "TS-demo-web",
  "scope": "opcional; por defecto = task",
  "platform": "web | pwa | api | hybrid | native | static",
  "need": {
    "runtime": { "python": true, "node": true, "npm": true,
                 "python_min": [3, 10], "node_min": [24, 0] },
    "node_packages": ["@playwright/test"],
    "adapters": ["playwright"],
    "browsers": ["chromium"],
    "tools": ["node", "npm"],
    "target": { "url": "https://host/path", "method": "GET",
                "ok_status_max": 499, "timeout_ms": 3000,
                "browser_fallback": true },
    "credentials": ["QAA_API_TOKEN"],
    "config": ["QAA_BASE_URL"],
    "auto_healing": { "mode": "OFF", "store": "ruta/opcional" },
    "test_data": [ { "data_id": "TD-1", "file": "qa/tests/ejemplo.json" } ],
    "evidence_dir": "qa/evidence",
    "requires_evidence": true,
    "qa_reviewer": { "required": true, "risk_level": "HIGH" }
  }
}
```

Notas:

- `target` puede usar `url` (HTTP/HTTPS) o `host` + `port` (TCP).
- `target.browser_fallback` (booleano opcional, por defecto `false`) declara que
  la vía de acceso prevista es el navegador: un sondeo HTTP denegado
  (401/403/407/429) o inconcluso (error de conexión) se registra como WARN
  (`PROBE_DENIED`/`PROBE_INCONCLUSIVE`), no bloquea, y el acceso lo decide la
  evidencia de la navegación real. Sin esta política, esos casos bloquean.
- `test_data[].file` es un artefacto `test-data-record` (objeto o array); se
  busca por `data_id` y se exige `state=AVAILABLE`, `validation.validated=true`,
  `usable=true` y evidencia no vacía.
- `qa_reviewer.required` puede omitirse: con `risk_level` HIGH/CRITICAL se
  infiere `true` (Risk Matrix).
- `auto_healing` es opcional y **desactivado por defecto** (`mode: OFF`). El
  chequeo **no sondea** el motor (bundled con el adapter Playwright,
  `automation/runner/healed.ts`): valida la configuración declarada. Un `mode`
  fuera de `OFF|OBSERVE|HIGH_CONFIDENCE` o un `store` no-string producen
  `BLOCKED` (`REQUIRES_CONFIGURATION`) y el detector aborta con exit `2`. La
  corrección real del motor se prueba con los artefactos `auto-heal-record`
  (M-01) y las demos aisladas, nunca por este chequeo.
- Los adapters soportados son `playwright` (Web/PWA) y `http` (cliente estándar).

### Vocabulario de capacidades

Cada chequeo registra `capability` (id granular), `required`, `observed`,
`observed_state`, `action` (si aplica) y `capability_state`. Estos campos
aditivos están **validados estructuralmente** por M-01 en
`pre-flight-record.schema.json` (tipos y valores permitidos); siguen siendo
**opcionales** para conservar la compatibilidad con registros anteriores.

| `capability_state` | Significado |
| --- | --- |
| `AVAILABLE` | Presente y verificado |
| `REQUIRES_CONFIGURATION` | Falta un dato/permiso/estado (credencial, target, Test Data, reviewer) |
| `NOT_INSTALLED` | Ejecutable/paquete/navegador ausente en la máquina |
| `NOT_REQUIRED` | Capacidad no necesaria para esta tarea (nunca bloquea) |
| `UNVERIFIED` | No se pudo comprobar (si es requerida, bloquea) |
| `PROBE_DENIED` | Sondeo HTTP del target denegado (401/403/407/429). Solo con política `browser_fallback`; **no bloquea**, `status: WARN`, acceso pendiente de confirmación por navegador |
| `PROBE_INCONCLUSIVE` | Sondeo HTTP del target sin respuesta (error de conexión/timeout). Solo con política `browser_fallback`; **no bloquea**, `status: WARN`, acceso pendiente de confirmación por navegador |

Traducción al contrato: `AVAILABLE→OK`, `REQUIRES_CONFIGURATION`/`NOT_INSTALLED`
→`BLOCKED`, `PROBE_DENIED`/`PROBE_INCONCLUSIVE`→`WARN` (solo bajo política
explícita), `UNVERIFIED`→`UNVERIFIED`, `NOT_REQUIRED`→`NOT_APPLICABLE`.

`availability_source` (opcional, usado por el chequeo del QA Reviewer) declara el
origen de la evidencia de disponibilidad: `declarative_signal` (señal provista por
el operador, **no** comprobada automáticamente) o `direct_probe` (comprobación
directa del entorno; reservado a futuros detectores). El detector actual solo
emite `declarative_signal` y nunca afirma haber comprobado al reviewer.

### Incompatibilidad detectada y propuesta (contratos conservados)

El enum `check` del contrato `pre-flight-record` está **cerrado a 6 valores**
(`target_accessible`, `credentials_available`, `tools_available`,
`adapter_available`, `test_data_available`, `config_dependencies`) y **no** tiene
una categoría dedicada para "Evidence escribible" ni para "QA Reviewer", ni un
identificador granular del chequeo.

**No se modificó el enum del contrato.** El detector aplica una extensión
**aditiva y no rompiente**, permitida por `additionalProperties: true`, y mapea
cada chequeo a la categoría canónica más cercana. Los campos aditivos
(`capability`, `capability_state`, `observed_state`, `required`, `observed`,
`action`, `detail`, `availability_source`) ya están **declarados y validados** en
`pre-flight-record.schema.json` (tipos y enums), de modo que un registro con un
tipo o estado inválido es rechazado por M-01, sin que los registros anteriores
(que no los usan) dejen de ser válidos:

| `capability` (id) | `check` canónico (enum) |
| --- | --- |
| `runtime_python` / `runtime_node` / `runtime_npm` | `config_dependencies` |
| `node_lockfile` / `node_package_*` | `config_dependencies` |
| `config_*` / `auto_healing` | `config_dependencies` |
| `adapter_playwright` / `adapter_http` / `qa_reviewer` | `adapter_available` |
| `browser_*` / `tool_*` / `evidence_write` | `tools_available` |
| `target_access` | `target_accessible` |
| `credential_*` | `credentials_available` |
| `test_data_*` | `test_data_available` |

**Propuesta (NO aplicada)** para una futura revisión del contrato: agregar
`evidence_writable` y `reviewer_available` al enum `check`. Los campos
`capability`/`capability_state` ya son **primera clase** dentro de los campos
aditivos validados, por lo que esa parte de la propuesta quedó cubierta de forma
aditiva y rompiente; el registro sigue siendo válido bajo el contrato vigente.

### Detección del QA Reviewer

La disponibilidad del reviewer es una capacidad **externa** (modelo/agente) que
el detector **no puede invocar ni comprobar automáticamente**. Se obtiene de una
**señal declarativa** provista por el operador: `QAA_QA_REVIEWER_AVAILABLE=1|true|yes`
(disponible) o `0|false|no` (no disponible). Una mención en un archivo de
configuración **no** es suficiente.

Esta señal es una **declaración externa, no una comprobación automática**: el
detector no ejecuta ninguna sonda que verifique la disponibilidad real del
reviewer. Por eso cada chequeo del reviewer registra
`availability_source: "declarative_signal"` y `detail` describe la limitación;
el registro **jamás** presenta la señal como prueba automática de
disponibilidad.

Si la capacidad es requerida (riesgo HIGH/CRITICAL o `required: true`) y **no
existe evidencia suficiente** de disponibilidad (señal ausente, no reconocida o
negativa), el resultado se conserva honestamente como `BLOCKED` con estado
`UNVERIFIED` (o `REQUIRES_CONFIGURATION` cuando la señal reporta "no
disponible"). La señal positiva solo habilita la corrida **declarándola**;
confirmar la disponibilidad real del reviewer sigue siendo responsabilidad del
operador/QA Lead.

## Relación con M-01 y con la base técnica

- El resultado de Pre-flight se serializa como **`pre-flight-record`** y pasa por
  el validador de M-01 antes de usarse (esquema y fixtures válidos/inválidos ya
  existentes). El detector **autovalida** su salida y aborta con exit `2` si el
  registro no satisface el contrato.
- Los chequeos 1–4 y 8 se apoyan en la base técnica de automatización descrita en
  `docs/AUTOMATION-ARCHITECTURE.md` y verificable con `npm run verify:env`.
- El detector es **Python 3 stdlib** (mismo runtime que M-01); no se agregaron
  dependencias ni se duplicó la validación en Node.

## Integración con el QA Agent

- **QA Lead**: ordena el Pre-flight antes de una ejecución relevante y conoce las
  capacidades requeridas y su resultado. Si es `BLOCKED`, identifica las causas y
  qué debe resolverse; una condición obligatoria por la Risk Matrix impide
  continuar como si estuviera habilitada.
- **Test Executor**: ejecuta el detector antes de ejecutar, registra el
  `pre-flight-record` y lo valida con el skill `contract-validation`.
- El resultado del Pre-flight **no** sustituye al QA Reviewer ni confirma que los
  resultados de las pruebas sean correctos.

## Pruebas automatizadas

`python qa/tools/test_preflight.py` (o `python -m unittest discover -s qa/tools -p "test_*.py"`)
cubre: entorno listo, runtime/dependencia ausente, herramienta no disponible,
credencial ausente (sin exponer secretos), target inaccesible, navegador no
instalado, Test Data faltante/no validado, imposibilidad de guardar evidencia,
QA Reviewer obligatorio no disponible (señal declarativa, no sonda automática),
capacidad no necesaria, registro válido e inválido según M-01, **validación
estructural de los campos aditivos** (tipos, enums y compatibilidad con
registros anteriores) y **semántica del sondeo del target** (HTTP 200 confirma;
HTTP 403 nunca se presenta como confirmación y bloquea por defecto; con
`browser_fallback: true` el 403 → `PROBE_DENIED`/WARN y el error de conexión →
`PROBE_INCONCLUSIVE`/WARN, sin bloquear y con la accesibilidad decidida por la
navegación real; HTTP 500 bloquea en toda política; `browser_fallback` debe ser
booleano; `allowed_status` puede declarar un 403 explícitamente previsto), la
**configuración de auto-healing (M-05)** (`mode` válido, `store` string,
`OFF/OBSERVE/HIGH_CONFIDENCE` → `AVAILABLE`, `mode` inválido → `BLOCKED`) y la
no-requerencia cuando la capacidad no se declara. Los
escenarios usan servidores HTTP locales efímeros (status configurable), un
puerto local cerrado y fixtures; no dependen de aplicaciones externas.
