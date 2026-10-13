# QA Report - TS-DC-001 - dcshoes.com.ar

Fecha: 2026-10-08
Aplicacion: https://www.dcshoes.com.ar/

## Alcance ejecutado

IN SCOPE: Home, navegacion y categorias, listado de productos, busqueda, filtros, ordenamiento, detalle de producto, imagenes y variantes, seleccion de talle, agregar al carrito, contador del carrito, visualizacion del carrito, quitar productos.

OUT OF SCOPE (no ejecutado): Login con cuentas reales, registro, datos personales, checkout, pago, confirmacion de compras, pedidos reales.

No se amplio el scope.

## Test Cases ejecutados

| Test Case | Titulo | Status | Confidence |
|---|---|---|---|
| TC-001 | Acceso y render del Home | PASS | HIGH |
| TC-002 | Navegacion a categoria via clic real | PASS | HIGH |
| TC-003 | Listado de productos y precios | PASS | HIGH |
| TC-004 | Aplicacion y eliminacion de filtros | PASS | HIGH |
| TC-005 | Ordenamiento por precio (asc y desc) | PASS | HIGH |
| TC-006 | Busqueda de productos | PASS | HIGH |
| TC-007 | Detalle de producto e imagenes | PASS | HIGH |
| TC-008 | Seleccion de variante (talle) | PASS | MEDIUM |
| TC-009 | Agregar al carrito y contador | PASS | HIGH |
| TC-010 | Visualizacion del carrito | PASS | HIGH |
| TC-011 | Quitar producto del carrito | PASS | HIGH |

PASS: 11
FAIL: 0
BLOCKED: 1 (QA Reviewer, ver mas abajo)
INSUFFICIENT_EVIDENCE: 0 Test Cases

## Bugs encontrados

Ningun bug confirmado.

- BUG-001 Boton Search disabled con valor cargado -> NOT_A_BUG (estado transitorio durante autocomplete; el clic efectivo navego). Confidence HIGH.
- BUG-002 Placeholder "%1" en "Sólo queda %1" -> NOT_A_BUG (contenedor display:none, rect 0x0, no visible). Confidence HIGH.
- BUG-003 Campo #qty oculto con value/min 0 -> NOT_A_BUG (se agrego 1 unidad correctamente). Confidence MEDIUM.

Observaciones latentes (no defectos actuales): BUG-002 y BUG-003 quedan registradas por si el estado cambia en el futuro.

## Risk (Risk Record: qa/tests/dcshoes_risk.json)

- R-001 Alta al carrito: impact CRITICAL, probability MEDIUM -> risk_level HIGH -> QA Reviewer OBLIGATORIO.
- R-002 Listado/filtros/orden: risk_level MEDIUM.
- R-003 Busqueda: risk_level MEDIUM.
- R-004 Falsos positivos del propio proceso: risk_level MEDIUM.

## Evidence principal

> **Nota de distribución.** Las capturas de pantalla del sitio comercial de terceros
> (`qa/evidence/dcshoes/*.png`) **no se distribuyen** con este repositorio: se retiraron
> del conjunto publicable y del árbol de trabajo por no contar con una licencia
> demostrable para redistribuirlas bajo MIT. Las rutas de evidencia se conservan sin
> cambios en los registros históricos estructurados (`qa/tests/dcshoes_tc.json`,
> `qa/tests/dcshoes_execution_trace.json`, `qa/bugs/dcshoes_bugs.json`) como referencia.
> La fuente verificable es el spec reproducible `automation/specs/dcshoes/home.spec.ts`
> (TC-001) y dichos registros.

Directorio histórico: qa/evidence/dcshoes/ (9 capturas, **no distribuidas**)

- TC-001_home.png (716.105 bytes)
- TC-002_categoria_calzado.png (473.040 bytes)
- TC-004_filtro_color.png (97.465 bytes)
- TC-005_orden_mayor_precio.png (345.400 bytes)
- TC-006_busqueda.png (202.334 bytes)
- TC-007_detalle_producto.png (293.520 bytes)
- TC-009_contador_carrito.png (293.039 bytes)
- TC-010_carrito.png (91.377 bytes)
- TC-011_carrito_vacio.png (80.189 bytes)

Trazas: qa/tests/dcshoes_execution_trace.json (TR-001..TR-013, tool_requested -> tool_executed -> execution_success -> result_obtained -> result_validated).

Nota de evidencia: TC-008 no tiene screenshot propio; su validacion se basa en lectura de DOM (TR-009) y en la confirmacion posterior "Talle: 11" en el carrito (TC-010). Es evidencia indirecta.

## QA Reviewer Verdict

Estado: BLOCKED - NO EJECUTADO.

Se invoco al subagente qa-reviewer dos veces por ser OBLIGATORIO (R-001, risk_level HIGH). Ambas invocaciones fallaron por una limitacion del entorno: "OpenCode's free tier can only be used from within OpenCode".

Conforme a NO EVIDENCE = NO CONFIRMED RESULT, NO se declara verdict. No se simula ni se auto-revisa la conclusion (la auto-revision romperia la independencia exigida).

## Conclusion final

- Sobre las 11 ejecuciones de Test Cases: los flujos del scope se comportaron como se esperaba y los resultados estan respaldados por Evidence (PASS 11/11, confidence alta en 10 y media en TC-008).
- NO se emite conclusion global de tipo GO/CONFIRMED para el R-001 (riesgo HIGH): la revision independiente obligatoria quedo BLOCKED por limitacion de entorno. Estado del R-001: NOT_VERIFIED a nivel de doble chequeo.
- Ningun Bug confirmado; los 3 candidatos se descartaron con evidencia (NOT_A_BUG).

## Confidence

- Ejecucion y evidencia de los Test Cases: HIGH (excepto TC-008: MEDIUM, evidencia indirecta).
- Conclusion global consolidada del R-001: LOW / NOT_VERIFIED, por ausencia del QA Reviewer obligatorio.
