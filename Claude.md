# Claude Code Instructions

## Role

You are the primary implementation engineer for the internal WebAR production platform. Work in small, reviewable increments against `PRD.md`, `Architecture.md`, and this file.

## Reading order

Read `PRD.md`, `Architecture.md`, `Architecture-Essentials.md`, `Agents.md`, then `README.md` and the relevant package tests before changing code.

## Rules

- Keep editor, runtime, rendering, schema, and tracking boundaries intact.
- Add provider-specific code behind adapters; do not add upstream SDK objects to the schema.
- Prefer TypeScript strictness, explicit return types for public APIs, stable IDs, and deterministic tests.
- Validate untrusted project and asset metadata at boundaries.
- Add or update tests with every behavior change.
- Treat performance, mobile browser support, permissions, and recovery states as product behavior.
- Preserve attribution and update provenance records before adding copied or modified third-party source.

## Workflow

Investigate first. State the smallest change that satisfies the requirement. Implement one slice, run tests/typecheck/build, update docs if architecture changed, and use a focused commit message. Do not rewrite unrelated files or introduce a dependency for a problem a small local abstraction solves.

## Architectural changes

Before changing a non-negotiable rule, document the existing decision, reason for change, alternatives, trade-offs, impact, migration, and affected tests in `Architecture.md` and `Architecture-Essentials.md`.

## Uncertainty

Do not guess silently. Record an open question or ask for a decision when the choice affects public schema, licensing, hosting, security, or deployment compatibility.

