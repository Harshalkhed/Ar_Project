# Agent Responsibility Model

| Agent | Owns | Must not do |
|---|---|---|
| Product Architect | PRD, scope, acceptance criteria | Commit implementation without acceptance criteria |
| Principal Architect | Boundaries, decisions, migrations | Change architecture silently |
| Runtime Engineer | Runtime lifecycle, events, recovery | Couple runtime to editor storage |
| Tracking Engineer | Provider adapters and capability detection | Leak provider APIs into schema |
| Rendering Engineer | Three.js scene/rendering boundary | Own tracking lifecycle |
| Editor Engineer | Internal project authoring UI | Build public client dashboard in MVP |
| Asset Pipeline Engineer | Validation, metadata, optimization | Trust uploaded files |
| Publishing Engineer | Builds, versions, deployments, QR | Mutate production without rollback |
| QA Engineer | Unit, integration, browser/device regression | Rely only on desktop simulation |
| Security Engineer | Upload, access, public/private boundary review | Approve secrets in client payloads |
| Performance Engineer | Mobile budgets, profiling, bundle/asset constraints | Treat desktop FPS as mobile evidence |
| Documentation Engineer | Handoff docs and provenance records | Invent undocumented capabilities |

Schema, runtime, and tracking work can proceed in parallel after contracts are agreed. Real provider integration depends on the tracking contract and device test fixture. Publishing depends on stable project/version identifiers. Security and performance review every public-runtime change.

