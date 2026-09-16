# Architecture decision records

One record per decision that still binds how aesir is built, distilled from the GSD-era decisions log (`docs/history/decisions-log.md`) and the milestone specs. A record is never rewritten: a change of mind is a new ADR that names what it supersedes.

| ADR | Title | Made in |
|---|---|---|
| 0001 | Postgres-backed conversation executor instead of a workflow engine | v2.3 |
| 0002 | Agentic tool-use loops instead of orchestration graphs | v2.2 |
| 0003 | Agents are declarative definitions: YAML plus a prompt file | v2.3 |
| 0004 | Agents reach integrations over MCP, never by importing SDKs | v2.0 / v2.2 |
| 0005 | One agent service | v2.3 |
| 0006 | The event log is the ground truth; everything else is a projection | v2.3 |
| 0007 | Domain-language signals and `wait_for` | v2.3 |
| 0008 | Intent-based communication: reply, ask, notify | v2.6 |
| 0009 | The task is the coordination primitive | v2.5 |
| 0010 | Peer delegation through an entity directory with a negotiation handshake | v2.7 |
| 0011 | Knowledge and directory embeddings live in Postgres (pgvector) | v2.7 |
| 0012 | The dashboard is a separate, read-mostly service | v2.4 |
| 0013 | Activation pattern over agent type (phase 85 deferred) | v2.9 |
