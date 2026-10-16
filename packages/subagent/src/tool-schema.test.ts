/**
 * Issue #114 — the parameter set `subagent` declares is the whole contract, so
 * every name in it must be a name `execute` actually reads.
 *
 * #114 deleted a declared `async` boolean ("Run asynchronously
 * (fire-and-forget)") that nothing read: a model that passed `async: true` got a
 * fully synchronous run with no warning. That is a false statement in a
 * model-facing contract, and worse than a missing feature, because the contract
 * *is* what the model believes about the tool — it is what gets rendered into
 * the tool list, what the model plans around, what a wrong answer gets blamed
 * on. Deleting the claim is the fix; implementing fire-and-forget is out of
 * scope and blocked on #113 (reaping subagent children across session
 * replacement).
 *
 * The review that followed found a SECOND instance of the same defect class the
 * issue never named: `count?: number` on the parallel task item, read nowhere.
 * It differed from `async` in one instructive way: it lived only in the
 * hand-written `params` type on `execute` in `index.ts`, never in `TaskItem`, so
 * the JSON Schema the model sees never advertised it and a guard that enumerates
 * the schema alone could not have caught it. The root cause of both was one
 * contract stated twice — once for the model, once for TypeScript — with nothing
 * keeping the two in step. So the fix is structural rather than another
 * assertion: `SubagentParams` in `tool-schema.ts` is
 * `Static<typeof SUBAGENT_PARAMS_SCHEMA>` and `execute` takes that, which is the
 * `ask` / `sudo` precedent. There is no second list left to drift on its own, so
 * the only way to introduce a `count` is to say so at one of the two surfaces a
 * reviewer reads: the schema, or `execute`'s signature.
 *
 * What is guarded where, stated honestly:
 *
 *   - the schema's declared sets are pinned below, exactly and enumerated from
 *     the schema object rather than restated;
 *   - there is no second TS-side list left for a test to police. `tsc` does
 *     reject a params type that *contradicts* the schema — `model?: number` at
 *     the params position fails `registerTool`'s `execute` with TS2322 — but
 *     that check is neither new nor the derivation's doing: `registerTool`
 *     infers `TParams` from `parameters` and declares `execute`'s `params` as
 *     `Static<TParams>` (`pi-coding-agent` `dist/core/extensions/types.d.ts:514`),
 *     so the same TS2322 fires with or without `SubagentParams` (measured against
 *     the pre-derivation literal, and it failed there too).
 *   - what `tsc` never caught, and still does not, is the phantom itself. An
 *     extra *optional* member only widens the params type, and pi declares
 *     `execute` as a method, so method parameters are bivariant: `count?: number`
 *     in the old literal, in `TaskItem` inside that literal, and spliced on as
 *     `params: SubagentParams & { count?: number }` all compile (each measured).
 *     So the derivation removes the *place* a phantom hid — it does not add a
 *     compiler check that would catch one. Writing a phantom now takes a
 *     deliberate `& { … }` at the params position, an edit a reviewer sees, where
 *     before it was the default way to state the contract.
 *   - the residual gap: nothing here detects a schema field that `execute`
 *     declares and then ignores — `async` was exactly that, and it stays
 *     undetectable, because `execute`'s body is erased at runtime and a runtime
 *     test cannot see a type. Measured: adding `count` to the schema turns the
 *     task-item pin below red while `tsc` stays green, since the body never reads
 *     it. What covers that is the two pins, a schema small enough to read in one
 *     screen — five top-level parameters, four task fields — and review.
 *
 * If a name reappears here it has to arrive together with the behaviour that
 * honours it (#113 first, for `async`) and a consumer that reads it; until then
 * the honest description is the one that does not mention it.
 */

import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { SUBAGENT_PARAMS_SCHEMA } from "./tool-schema.js";

/** Read a schema node's declared property names, failing loudly if it has none. */
function propertyNames(node: unknown, what: string): string[] {
  const properties = (node as { properties?: Record<string, unknown> }).properties;
  if (!properties) throw new Error(`${what} declares no properties`);
  return Object.keys(properties);
}

/** The top-level parameters `subagent` declares. Read from the schema, never restated. */
function declaredParams(): string[] {
  return propertyNames(SUBAGENT_PARAMS_SCHEMA, "SUBAGENT_PARAMS_SCHEMA");
}

/**
 * The properties declared for ONE entry of the `tasks` array — `TaskItem`.
 * Reached through the schema rather than exported from `tool-schema.ts`, so the
 * guard depends on the contract the model actually receives and the module
 * keeps its current public surface (`TaskItem` is deliberately unexported).
 */
function declaredTaskItemParams(): string[] {
  const tasks = (SUBAGENT_PARAMS_SCHEMA as { properties?: Record<string, unknown> }).properties?.tasks;
  if (!tasks) throw new Error("SUBAGENT_PARAMS_SCHEMA declares no `tasks` property");
  const items = (tasks as { items?: unknown }).items;
  if (!items) throw new Error("`tasks` is not an array schema — no item schema to enumerate");
  return propertyNames(items, "The `tasks` item schema (TaskItem)");
}

describe("SUBAGENT_PARAMS_SCHEMA — declared parameter set (issue #114)", () => {
  it("declares exactly the parameters execute reads, nothing more", () => {
    // Exact and sorted, so it fails in BOTH directions: re-advertising a
    // parameter nobody consumes (`async`) and over-eager deletion of one
    // somebody does. Read from the schema object, never restated by hand. And
    // because `SubagentParams` is derived, adding a name here is also adding it
    // to what `execute` is handed, so this pin is where a new name has to be
    // justified.
    expect([...declaredParams()].sort()).toEqual(["agent", "cwd", "model", "task", "tasks"]);
  });
});

describe("TaskItem — declared parallel task item (issue #114, second instance: `count`)", () => {
  it("declares exactly the task fields the executor knows about, nothing more", () => {
    // `count` was the proof this surface needs its own pin: a phantom can be
    // added to the task item while the top-level set above stays green.
    expect([...declaredTaskItemParams()].sort()).toEqual(["agent", "cwd", "model", "task"]);
  });
});

// Legacy-caller compatibility check — a real behavioural guarantee, so it is
// pinned rather than assumed. TypeBox `Type.Object` does not set
// `additionalProperties: false`, so deleting `async` — and deleting `count` from
// the TS type, which the schema never advertised anyway — stops promising the
// option without turning an existing caller's payload into a validation error: a
// caller still passing `async: true`, or a `count` on a task, keeps validating, it
// just no longer gets a promise about it. That is what makes both deletions safe
// to land in a patch release, and it is the one thing here that fails on its own
// if anyone ever tightens the schema with `additionalProperties: false`.
describe("SUBAGENT_PARAMS_SCHEMA — legacy callers passing the deleted fields still validate", () => {
  it("accepts a payload carrying `async`", () => {
    expect(Value.Check(SUBAGENT_PARAMS_SCHEMA as never, { task: "x", async: true })).toBe(true);
  });

  it("accepts a task item carrying `count`", () => {
    expect(
      Value.Check(SUBAGENT_PARAMS_SCHEMA as never, { tasks: [{ task: "x", count: 1 }] }),
    ).toBe(true);
  });
});
