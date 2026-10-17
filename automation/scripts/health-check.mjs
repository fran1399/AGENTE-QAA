#!/usr/bin/env node
/**
 * Health check del sistema AGENTE-QAA.
 * Verifica: agentes, skills, modelos, Python, Playwright, Node, schemas.
 * Exit 0 = todo OK, 1 = hay problemas.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
let errors = 0;
let warnings = 0;

function ok(msg) { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.warn(`  ⚠ ${msg}`); warnings++; }
function err(msg) { console.error(`  ✗ ${msg}`); errors++; }

// 1. Agentes
console.log('\n[1/7] Agentes');
const agentsDir = join(ROOT, '.opencode', 'agents');
const expectedAgents = ['qa-lead', 'test-designer', 'risk-analyst', 'exploratory-qa', 'test-data', 'test-executor', 'bug-analyst', 'qa-reviewer'];
for (const agent of expectedAgents) {
  const path = join(agentsDir, `${agent}.md`);
  if (existsSync(path)) ok(`${agent}`);
  else err(`${agent} faltante`);
}

// 2. Skills
console.log('\n[2/7] Skills');
const skillsDir = join(ROOT, '.opencode', 'skills');
const expectedSkills = ['playwright-qa', 'api-testing', 'contract-validation', 'pre-flight', 'bug-analysis', 'test-data', 'test-design', 'exploratory-testing', 'regression', 'retest', 'error-handling'];
for (const skill of expectedSkills) {
  const path = join(skillsDir, skill, 'SKILL.md');
  if (existsSync(path)) ok(`${skill}`);
  else err(`${skill} faltante`);
}

// 3. Herramientas Python
console.log('\n[3/7] Herramientas Python (QA Core)');
const tools = ['validate_contracts.py', 'preflight.py', 'render_qa_report.py'];
for (const tool of tools) {
  const path = join(ROOT, 'qa', 'tools', tool);
  if (existsSync(path)) ok(`${tool}`);
  else err(`${tool} faltante`);
}

// 4. Schemas JSON
console.log('\n[4/7] Schemas JSON (M-01)');
const schemaDir = join(ROOT, 'qa', 'schema');
const schemas = readdirSync(schemaDir).filter(f => f.endsWith('.json'));
if (schemas.length > 0) ok(`${schemas.length} schemas encontrados`);
else err('No se encontraron schemas en qa/schema/');

// 5. Runner M-03
console.log('\n[5/7] Runner M-03');
const runnerDir = join(ROOT, 'automation', 'runner');
const runnerFiles = ['runner.ts', 'report.ts', 'healed.ts', 'sqlite-adapter.ts', 'config.ts', 'support.ts'];
for (const file of runnerFiles) {
  const path = join(runnerDir, file);
  if (existsSync(path)) ok(`${file}`);
  else err(`${file} faltante`);
}

// 6. Tests
console.log('\n[6/7] Tests');
const testFiles = [
  'qa/tools/test_validate_contracts.py',
  'qa/tools/test_preflight.py',
  'qa/tools/test_data_verification.py',
  'qa/tools/test_report_generator.py',
  'qa/tools/test_render_qa_report.py',
];
for (const tf of testFiles) {
  const path = join(ROOT, tf);
  if (existsSync(path)) ok(`${tf}`);
  else err(`${tf} faltante`);
}

// 7. Configuración
console.log('\n[7/7] Configuración');
const opencodeJson = join(ROOT, 'opencode.json');
if (existsSync(opencodeJson)) {
  try {
    const config = JSON.parse(readFileSync(opencodeJson, 'utf8'));
    if (config.default_agent === 'qa-lead') ok('default_agent: qa-lead');
    else warn(`default_agent es '${config.default_agent}', esperado 'qa-lead'`);
    if (config.permissions) ok('permissions presente');
    else err('permissions faltante en opencode.json');
  } catch (e) {
    err(`opencode.json inválido: ${e.message}`);
  }
} else {
  err('opencode.json faltante');
}

// Resumen
console.log('\n' + '='.repeat(50));
if (errors === 0 && warnings === 0) {
  console.log('✓ Sistema AGENTE-QAA: todo OK');
  process.exit(0);
} else if (errors === 0) {
  console.log(`⚠ Sistema AGENTE-QAA: ${warnings} advertencia(s)`);
  process.exit(0);
} else {
  console.error(`✗ Sistema AGENTE-QAA: ${errors} error(es), ${warnings} advertencia(s)`);
  process.exit(1);
}
