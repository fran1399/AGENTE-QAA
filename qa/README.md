# QA Runtime Data

Separation of concerns for QA artifacts:

- `tests/` - Test definitions and generated test cases (QA-owned)
- `evidence/` - Verifiable evidence (screenshots, traces, videos, logs, console, network)
- `bugs/` - Structured bug records with traceable evidence
- `reports/` - QA reports and summaries
- `memory/` - Historical QA information for regression and system learning (see Memory Record Contract in docs/AGENT-CONTRACTS.md)

Guidelines:
- Do not commit secrets or sensitive production data
- All important artifacts must reference evidence paths
- Keep artifacts traceable back to findings/conclusions
- Historical data is not current evidence. Any use must be validated against current evidence and current application behavior.

## Validation Infrastructure

Contract validation tooling lives under `qa/` (see `docs/CONTRACTS-VALIDATION.md`):

- `schema/` - JSON Schemas for the contracts (`docs/AGENT-CONTRACTS.md`); registry in `schema/index.json`
- `tools/` - executable contract validator and its automated tests

Run it before consolidating results:

```bash
python qa/tools/validate_contracts.py --bundle qa/
```
