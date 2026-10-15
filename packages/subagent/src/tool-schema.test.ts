/**
 * Issue #114 — the parameter set `subagent` declares to the model is the whole
 * contract, so every name in it must be a name `execute` actually reads.
 *
 * `SUBAGENT_PARAMS_SCHEMA` declared an `async` boolean described as "Run
 * asynchronously (fire-and-forget)". Nothing read it: no branch, no type, no
 * test — a model that passed `async: true` got a fully synchronous run with no
 * warning. That is a false statement in a model-facing contract, and it is worse
 * than a missing feature, because the contract *is* what the model believes about
 * the tool: it is what gets rendered into the tool list, what the model plans
 * around, and what a wrong answer gets blamed on. Deleting the claim is the fix;
 * implementing fire-and-forget is out of scope and blocked on #113 (reaping
 * subagent children across session replacement), so it stays unimplemented on
 * purpose.
 *
 * So this file is a tripwire, not a style preference. It enumerates the declared
 * parameter names from the schema itself — no duplicated copy of the schema that
 * could drift — and pins the set exactly, which catches both directions:
 * re-advertising a parameter nobody consumes, and an over-eager deletion of one
 * somebody does. If `async` reappears here, it has to arrive together with the
 * behaviour that honours it (#113 first) and a consumer that reads it; until then
 * the honest description is the one that does not mention it.
 */

import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { SUBAGENT_PARAMS_SCHEMA } from "./tool-schema.js";

/** The five parameters `execute` reads. Read from the schema, never restated. */
function declaredParams(): string[] {
  const properties = (SUBAGENT_PARAMS_SCHEMA as { properties?: Record<string, unknown> }).properties;
  if (!properties) throw new Error("SUBAGENT_PARAMS_SCHEMA declares no properties");
  return Object.keys(properties);
}

describe("SUBAGENT_PARAMS_SCHEMA — declared parameter set (issue #114)", () => {
  it("declares exactly the parameters execute reads, nothing more", () => {
    expect([...declaredParams()].sort()).toEqual(["agent", "cwd", "model", "task", "tasks"]);
  });

  it("does not declare `async` — a declared-but-unread parameter is a false promise (#114)", () => {
    expect(declaredParams()).not.toContain("async");
  });

  it("still declares every surviving parameter — the deletion stops at `async`", () => {
    for (const name of ["agent", "task", "tasks", "model", "cwd"]) {
      expect(declaredParams(), `parameter "${name}" is missing from the schema`).toContain(name);
    }
  });
});

// Legacy-caller compatibility check — a real behavioural guarantee, so it is
// pinned rather than assumed. TypeBox `Type.Object` does not set
// `additionalProperties: false`, so removing `async` stops advertising the option
// without turning an existing caller's payload into a validation error: a caller
// still passing `async: true` keeps validating, it just no longer gets a promise
// about it. That is what makes the deletion safe to land in a patch release.
describe("SUBAGENT_PARAMS_SCHEMA — legacy callers passing `async` still validate", () => {
  it("accepts a payload carrying the deleted `async` field", () => {
    expect(declaredParams()).not.toContain("async");
    expect(Value.Check(SUBAGENT_PARAMS_SCHEMA as never, { task: "x", async: true })).toBe(true);
  });
});
