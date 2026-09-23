# Architecture Essentials

1. The internal editor and public runtime are separate applications.
2. Tracking and rendering are separate services with explicit contracts.
3. Tracking providers are replaceable adapters.
4. Provider-specific APIs never leak into project data.
5. Project documents are versioned and validated before runtime use.
6. Stable asset IDs are used instead of embedding mutable URLs in scene logic.
7. Multiple triggers and scenes are supported by the schema from the beginning.
8. Public deployments resolve stable experience IDs to explicit versions.
9. Runtime behavior is mobile-first, feature-detected, and failure-visible.
10. Third-party dependencies require provenance and license notes.
11. Prefer the smallest boundary that proves the requirement; do not build speculative infrastructure.
12. Do not change architecture casually. Record decision, reason, alternatives, trade-offs, impact, and migration implications.
13. Published experiences must remain compatible with the runtime/schema versions they declare.
14. Never commit secrets, execute arbitrary project JavaScript, or mix private administration data into public runtime payloads.

