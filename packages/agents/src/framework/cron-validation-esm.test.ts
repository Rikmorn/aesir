/**
 * Cron validation against the BUILT ESM output.
 *
 * The rest of the suite imports TypeScript source, which vitest transpiles into
 * a module scope that still has `require`. That is exactly why #50 shipped: the
 * validator called `require("cron-parser")` and passed every test here, while
 * the compiled ESM the container runs raised ReferenceError, the bare catch
 * swallowed it, and every cron expression came back invalid.
 *
 * So this test deliberately does not import the schema. It loads `dist/` in a
 * real `node` child process, which is the only place the distinction between
 * require and import is observable, and feeds it the definition that actually
 * crashed the service rather than a hand-written fixture that could drift from
 * the schema.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDir, "../..");
const builtTypes = path.join(packageRoot, "dist/framework/types.js");
const definitionPath = path.join(
  packageRoot,
  "definitions/test-scheduled-agent/definition.yaml",
);

const INVALID_CRON = "not a cron expression";

function runInNode(script: string): string {
  return execFileSync("node", ["--input-type=module", "-e", script], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("cron validation in the built ESM output", () => {
  beforeAll(() => {
    if (!existsSync(builtTypes)) {
      execFileSync("npx", ["tsc", "-b"], {
        cwd: packageRoot,
        encoding: "utf8",
        stdio: "pipe",
      });
    }
  }, 120_000);

  it("validates the real test-scheduled-agent definition, and rejects a bad cron in it", () => {
    expect(existsSync(builtTypes)).toBe(true);
    expect(existsSync(definitionPath)).toBe(true);

    const script = `
      import { readFileSync } from "node:fs";
      import { parse } from "yaml";
      import { AgentDefinitionYamlSchema } from ${JSON.stringify(builtTypes)};

      const definition = parse(readFileSync(${JSON.stringify(definitionPath)}, "utf-8"));

      const asShipped = AgentDefinitionYamlSchema.safeParse(definition);

      const withBadCron = AgentDefinitionYamlSchema.safeParse({
        ...definition,
        schedules: [{ ...definition.schedules[0], cron: ${JSON.stringify(INVALID_CRON)} }],
      });

      process.stdout.write(JSON.stringify({
        cronUnderTest: definition.schedules[0].cron,
        shippedOk: asShipped.success,
        shippedErrors: asShipped.success ? [] : asShipped.error.issues.map((i) => i.path.join(".") + ": " + i.message),
        badCronRejected: !withBadCron.success,
      }));
    `;

    const result = JSON.parse(runInNode(script));

    // Guards the fixture: if the definition ever loses its schedule, the rest
    // of this test would pass vacuously.
    expect(result.cronUnderTest).toBeTruthy();

    // The regression. Before #50 this was false with
    // "schedules.0.cron: Invalid cron expression", because the parser never
    // loaded and the refinement reported that failure as a bad expression.
    expect(result.shippedErrors).toEqual([]);
    expect(result.shippedOk).toBe(true);

    // The guard against "fixing" it by making the refinement always pass.
    expect(result.badCronRejected).toBe(true);
  }, 60_000);

  it("loads the compiled module without a require-related failure", () => {
    const probe = `
      import(${JSON.stringify(builtTypes)})
        .then(() => process.stdout.write("loaded"))
        .catch((error) => {
          process.stdout.write("failed: " + error.message);
          process.exitCode = 1;
        });
    `;

    expect(runInNode(probe)).toBe("loaded");
  }, 60_000);
});
