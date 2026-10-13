# Platform Adapters

## Design Principle

QA reasoning must not depend directly on any specific automation framework. Execution adapters are pluggable and must remain decoupled from QA Core.

## Web (MVP)

- Initial adapter: Playwright
- Capture evidence: screenshots, traces, videos, console, network when relevant

## PWA (MVP)

- Manifest
- Service Worker
- Cache
- Offline/Online behavior
- Storage
- Installability
- Updates
- Responsive behavior
- Synchronization (only when verifiable)

## API (Initial adapter)

- Initial adapter: `api-testing` skill (API/HTTP), independent from Playwright
- Capabilities: execute requests; validate status codes, headers, payloads; capture Evidence (request/response artifacts); Execution Traceability; differentiate request executed from result validated
- Auth/schemas: only when provided or verifiable; otherwise BLOCKED / INSUFFICIENT_EVIDENCE
- Adapter selection happens during Pre-flight; QA Core must not depend on Playwright or on this adapter

## Hybrid (Planned)

Separate concerns: web, mobile, bridge, API. Avoid cross-layer assumptions.

## Native (Planned)

Android/iOS considerations: emulator/simulator/device, permissions, notifications, deep links, local storage, lifecycle. Verifiable evidence required.

## Rule

Adding new platforms must not require rewriting Core QA logic. Platform-specific details remain isolated to executor skills: `playwright-qa` (Web/PWA) and `api-testing` (API/HTTP). The Test Executor chooses the adapter from the Scope after Pre-flight.
