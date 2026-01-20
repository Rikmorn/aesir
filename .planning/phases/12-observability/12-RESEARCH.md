# Phase 12: Observability - Research

**Researched:** 2026-01-20
**Domain:** Structured logging with pino, correlation IDs, sensitive data redaction
**Confidence:** HIGH

## Summary

This research covers implementing production-ready logging infrastructure using pino to replace the existing hand-rolled logger in `@aesir/common/logging`. The current implementation is a custom Logger class that outputs JSON but lacks pino's performance optimizations, native redaction, and ecosystem integration.

The standard approach is to use pino as the core logger with pino-http for HTTP request logging. Pino is the established choice for Node.js applications requiring high-performance structured logging - it is 5x faster than Winston, uses asynchronous logging to avoid blocking the event loop, and is the default logger for Fastify.

For correlation IDs, the decision to use explicit context passing (no AsyncLocalStorage) aligns with pino's child logger pattern. Each operation creates a child logger with correlation context that flows through function calls. The hierarchical ID pattern (req_, agent_, tool_, etc.) can be implemented using nanoid with custom prefixes for readable, performant IDs.

**Primary recommendation:** Replace the custom Logger class with pino, configure built-in redaction for sensitive fields, and use child loggers for correlation context propagation.

## Standard Stack

The established libraries for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pino | ^9.0.0 | Core logger | Fastest Node.js logger, JSON by default, child loggers, built-in redaction |
| pino-http | ^10.0.0 | HTTP request logging | Automatic req/res logging, request ID generation, Express/Fastify compatible |
| nanoid | ^5.0.0 | Correlation ID generation | Secure, URL-friendly, 60-80% faster than uuid, smaller output |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | ^11.0.0 | Dev-only log formatting | Development only - transforms JSON to readable output |
| @types/pino | (bundled) | TypeScript types | Types bundled with pino v9+ |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nanoid | crypto.randomUUID | 4x faster but 36-char output vs 21-char, less readable |
| nanoid | ulid | Sortable IDs but larger, more complex for simple correlation |
| pino-http | custom middleware | More control but lose battle-tested req/res handling |

**Installation:**
```bash
pnpm add pino pino-http nanoid
pnpm add -D pino-pretty
```

## Architecture Patterns

### Recommended Project Structure
```
packages/common/src/logging/
├── index.ts                 # Public API exports
├── logger.ts                # pino instance factory, base configuration
├── redaction.ts             # Redaction paths and censor configuration
├── correlation.ts           # ID generation utilities (prefixed nanoid)
├── types.ts                 # Logger types, LogContext interface
└── logger.test.ts           # Unit tests
```

### Pattern 1: Factory-based Logger Creation
**What:** Create loggers via factory function with configuration, not global singleton
**When to use:** Always - enables testing, per-service configuration, DI
**Example:**
```typescript
// Source: pino official docs + ARCH-06 factory requirement
import pino from 'pino';
import type { LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  component?: string;
  correlationId?: string;
  level?: string;
}

export function createLogger(options: CreateLoggerOptions): pino.Logger {
  const { service, component, correlationId, level = 'info' } = options;

  return pino({
    level,
    base: {
      service,
      ...(component && { component }),
      ...(correlationId && { correlationId }),
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}","time":${Date.now()}`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: REDACTION_PATHS,
      censor: '[REDACTED]',
    },
  });
}
```

### Pattern 2: Child Logger for Correlation Context
**What:** Create child loggers that inherit parent config and add context
**When to use:** Every operation that needs correlation - requests, agent runs, tool calls
**Example:**
```typescript
// Source: pino docs - child loggers
const baseLogger = createLogger({ service: 'dev-agent' });

// HTTP request handler
function handleRequest(req: Request) {
  const correlationId = generateCorrelationId('req');
  const requestLogger = baseLogger.child({
    correlationId,
    component: 'api:webhooks',
  });

  requestLogger.info({ path: req.url }, 'Request received');

  // Pass to downstream
  await processRequest(req, requestLogger);
}

// Downstream function receives logger
async function processRequest(req: Request, logger: pino.Logger) {
  logger.info('Processing request'); // Inherits correlationId
}
```

### Pattern 3: Hierarchical Correlation IDs
**What:** Generate prefixed IDs that indicate operation type, link parent/child
**When to use:** Operations that spawn sub-operations (requests spawning agent runs)
**Example:**
```typescript
// Source: CONTEXT.md decisions
import { nanoid } from 'nanoid';

type OperationType = 'req' | 'agent' | 'tool' | 'api' | 'job';

export function generateCorrelationId(type: OperationType): string {
  return `${type}_${nanoid(16)}`; // e.g., req_V1StGXR8_Z5jdHi6
}

export function generateChildCorrelationId(
  parentId: string,
  type: OperationType
): string {
  return `${type}_${nanoid(16)}`;
}

// Usage in logging context
interface CorrelationContext {
  correlationId: string;
  parentCorrelationId?: string;
  rootCorrelationId?: string;
}
```

### Pattern 4: pino-http Integration for HTTP Layer
**What:** Use pino-http middleware for automatic request/response logging
**When to use:** All HTTP entry points (webhooks, API endpoints)
**Example:**
```typescript
// Source: pino-http docs
import pinoHttp from 'pino-http';
import { generateCorrelationId } from './correlation.js';

export function createHttpLogger(baseLogger: pino.Logger) {
  return pinoHttp({
    logger: baseLogger,
    genReqId: (req, res) => {
      // Check for incoming correlation ID header
      const existingId = req.headers['x-correlation-id'];
      if (existingId && typeof existingId === 'string') {
        // Map external to internal: store as parent, generate new
        return generateCorrelationId('req');
      }
      return generateCorrelationId('req');
    },
    customProps: (req) => {
      const externalId = req.headers['x-correlation-id'];
      return {
        ...(externalId && { parentCorrelationId: externalId }),
      };
    },
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}
```

### Pattern 5: Temporal Workflow Logging Integration
**What:** Configure Temporal Runtime to use pino logger
**When to use:** Temporal worker initialization
**Example:**
```typescript
// Source: Temporal TypeScript observability docs
import { Runtime, DefaultLogger } from '@temporalio/worker';
import pino from 'pino';

const logger = pino({ /* config */ });

// Create Temporal-compatible logger that routes to pino
const temporalLogger = new DefaultLogger('INFO', ({ level, message, meta }) => {
  const pinoLevel = level.toLowerCase();
  logger[pinoLevel]({ ...meta, component: 'temporal:runtime' }, message);
});

Runtime.install({ logger: temporalLogger });
```

### Anti-Patterns to Avoid
- **Global mutable logger:** Don't create a single exported logger instance that gets mutated. Use factory + child pattern.
- **console.log anywhere:** Production code must use pino logger. console.log is unstructured, slow, and uncontrollable.
- **Logging sensitive data then redacting:** Extract only needed fields. Don't log entire objects hoping redaction catches everything.
- **AsyncLocalStorage for correlation:** Per CONTEXT.md decision, explicit passing is preferred for transparency.
- **pino-pretty in production:** Adds overhead, defeats pino's performance. Use external tools (jq, pino-pretty CLI) for viewing.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON serialization | Custom stringify | pino internals | pino uses fast-json-stringify, 2x faster |
| Redaction | Regex-based scrubbing | pino redact option | fast-redact is optimized, ~2% overhead |
| Request ID generation | Math.random + timestamp | nanoid | Cryptographically secure, URL-safe |
| HTTP request logging | Custom middleware | pino-http | Handles edge cases, response time, errors |
| Log level filtering | if statements | pino level config | Runtime changeable, per-component |
| Timestamp formatting | new Date().toISOString() | pino.stdTimeFunctions | Pre-optimized, configurable format |

**Key insight:** pino's performance comes from careful optimization at every level. Hand-rolling any piece loses these gains and introduces bugs that are already solved.

## Common Pitfalls

### Pitfall 1: Blocking the Event Loop with Logging
**What goes wrong:** Synchronous logging (console.log, sync file writes) blocks Node.js event loop
**Why it happens:** Default behavior of many loggers, easy to overlook
**How to avoid:** pino is async by default; use transports for any additional processing
**Warning signs:** Response times spike under load, "event loop blocked" warnings

### Pitfall 2: Redaction Path Wildcards Overhead
**What goes wrong:** Using `**` wildcards adds ~50% overhead to logging
**Why it happens:** Must scan entire object graph for matches
**How to avoid:** List explicit paths when possible: `['req.headers.authorization', 'password']` not `['**.password']`
**Warning signs:** LOG_LEVEL=debug causes measurable performance impact

### Pitfall 3: Circular References in Log Objects
**What goes wrong:** Error: "Converting circular structure to JSON"
**Why it happens:** Logging raw request/response objects, error stacks with circular refs
**How to avoid:** pino handles this with depthLimit/edgeLimit, but prefer explicit field extraction
**Warning signs:** Logs failing silently or throwing serialization errors

### Pitfall 4: Lost Correlation ID in Async Operations
**What goes wrong:** Operations spawn but don't carry correlation context
**Why it happens:** Forgetting to pass logger to async callbacks, Promises
**How to avoid:** Always pass logger as parameter; make it a required argument in key functions
**Warning signs:** Logs that can't be traced back to originating request

### Pitfall 5: Per-Component Level Overrides Not Working
**What goes wrong:** Setting LOG_LEVEL_GITHUB=debug has no effect
**Why it happens:** Component-based filtering requires mixin or custom logic, not built-in
**How to avoid:** Implement mixin function that checks component against env vars
**Warning signs:** Can't debug specific component without changing global level

### Pitfall 6: Temporal Workflow Logger Non-Determinism
**What goes wrong:** Workflow replays cause duplicate/inconsistent logs
**Why it happens:** Standard logging in workflow code runs on every replay
**How to avoid:** Use `wf.log` (workflow context logger) not imported pino logger in workflows
**Warning signs:** Same log message appears multiple times with different data

## Code Examples

Verified patterns from official sources:

### Base Logger Configuration
```typescript
// Source: pino API docs, CONTEXT.md decisions
import pino from 'pino';

const REDACTION_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createBaseLogger(service: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: process.env.SERVICE_NAME ?? service,
    },
    // Both ISO and epoch per CONTEXT.md
    timestamp: () => `,"timestamp":"${new Date().toISOString()}","time":${Date.now()}`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: REDACTION_PATHS,
      censor: '[REDACTED]',
    },
  });
}
```

### Child Logger with Correlation
```typescript
// Source: pino child logger docs
export function createChildLogger(
  parent: pino.Logger,
  context: {
    component?: string;
    correlationId?: string;
    parentCorrelationId?: string;
    rootCorrelationId?: string;
  }
) {
  return parent.child(context);
}

// Usage
const agentLogger = createChildLogger(baseLogger, {
  component: 'agents:dev-agent',
  correlationId: generateCorrelationId('agent'),
  parentCorrelationId: requestCorrelationId,
  rootCorrelationId: requestCorrelationId,
});
```

### Per-Component Level Override via Mixin
```typescript
// Source: pino mixin docs, CONTEXT.md per-component override
export function createLoggerWithComponentLevels(service: string) {
  const componentLevels = parseComponentLevels(); // LOG_LEVEL_GITHUB=debug etc.

  return pino({
    level: 'trace', // Set to lowest, mixin controls actual output
    mixin(mergeObject, level, logger) {
      const component = logger.bindings().component;
      if (component) {
        const componentLevel = componentLevels[component.replace(':', '_').toUpperCase()];
        if (componentLevel && pino.levels.values[componentLevel] > level) {
          // Return empty to skip log (mixin can't truly filter, need custom approach)
        }
      }
      return {};
    },
    // ... other config
  });
}

function parseComponentLevels(): Record<string, string> {
  const levels: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('LOG_LEVEL_') && value) {
      const component = key.replace('LOG_LEVEL_', '');
      levels[component] = value.toLowerCase();
    }
  }
  return levels;
}
```

### Migration from Custom Logger
```typescript
// BEFORE (current custom logger)
import { createLogger } from "@aesir/common";
const logger = createLogger({ defaultContext: { module: "slack-bolt-app" } });
logger.info("bolt_app_created", { outcome: "success", message: "Bolt app created" });

// AFTER (pino)
import { createLogger } from "@aesir/common";
const logger = createLogger({ service: 'aesir', component: 'integrations:slack' });
logger.info({ outcome: 'success' }, 'Bolt app created');
```

### Redaction Disable for Development
```typescript
// Source: CONTEXT.md LOG_REDACT=false decision
export function createBaseLogger(service: string) {
  const redactEnabled = process.env.LOG_REDACT !== 'false';

  return pino({
    // ... base config
    redact: redactEnabled ? {
      paths: REDACTION_PATHS,
      censor: '[REDACTED]',
    } : undefined,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| console.log | pino structured logging | 2014+ | 5x faster, structured, filterable |
| uuid for IDs | nanoid | 2017+ | Smaller, faster, URL-safe |
| Manual redaction | pino built-in redact | pino v5 (2019) | Zero-config, fast-redact optimized |
| Global logger | Factory + child pattern | Modern best practice | Testable, per-request context |
| AsyncLocalStorage | Explicit passing | pino recommendation | Transparent, debuggable |

**Deprecated/outdated:**
- pino-noir (separate redaction lib): Superseded by pino's built-in redact option
- express-pino-logger: Use pino-http directly
- pino v7-: Upgrade to v9 for latest features and bundled types

## Open Questions

Things that couldn't be fully resolved:

1. **Source location for errors (file:line)**
   - What we know: pino doesn't include this by default; would need Error.captureStackTrace or similar
   - What's unclear: Performance impact, exact implementation approach
   - Recommendation: Implement as optional feature enabled only for error level, measure impact

2. **Trace level below debug**
   - What we know: pino supports custom levels via customLevels option
   - What's unclear: Whether 'trace' is already defined (it is in pino default levels)
   - Recommendation: Use pino's built-in trace level (level: 10)

3. **Value scanning for secret patterns (sk-xxx, ghp_xxx)**
   - What we know: pino redact works on paths, not values
   - What's unclear: How to scan values efficiently without custom serializer overhead
   - Recommendation: Implement custom serializer for specific fields that might contain secrets; document as best-effort

## Sources

### Primary (HIGH confidence)
- [pino GitHub - API docs](https://github.com/pinojs/pino/blob/main/docs/api.md) - Configuration options, mixin, formatters
- [pino GitHub - Redaction docs](https://github.com/pinojs/pino/blob/main/docs/redaction.md) - Redaction paths, censor, performance
- [pino-http GitHub](https://github.com/pinojs/pino-http) - genReqId, customProps, autoLogging
- [Temporal TypeScript observability docs](https://docs.temporal.io/develop/typescript/observability) - Runtime logger, workflow logging

### Secondary (MEDIUM confidence)
- [SigNoz pino guide](https://signoz.io/guides/pino-logger/) - Best practices, 2026 patterns verified against official docs
- [Better Stack pino guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) - Configuration examples verified
- [nanoid GitHub](https://github.com/ai/nanoid) - Performance benchmarks, security

### Tertiary (LOW confidence)
- Medium articles on correlation ID patterns - Used for conceptual guidance only

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - pino is definitively the standard for high-performance Node.js logging
- Architecture: HIGH - Child logger pattern well-documented, CONTEXT.md provides clear decisions
- Pitfalls: MEDIUM - Some pitfalls from experience/articles, not all officially documented
- Correlation ID patterns: MEDIUM - Hierarchical approach from CONTEXT.md decisions, implementation details to be validated

**Research date:** 2026-01-20
**Valid until:** 2026-04-20 (pino is stable, 90-day window appropriate)
