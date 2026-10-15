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
 * issue never named: `count?: number` on the parallel task item, read nowhere —
 * `execute` reads `agent`, `task`, `model`, `cwd` from each task, and
 * `executeParallel`'s own task type has no `count`. It differed from `async` in
 * one instructive way: it lived only in the TS-facing `params` type in
 * `index.ts`, never in `TaskItem`, so the JSON Schema the model sees never
 * advertised it and a guard that enumerates the schema alone could not have
 * caught it. So this file guards both surfaces, and guards them against each
 * other:
 *
 *   1. the top-level schema parameter set, pinned exactly;
 *   2. the parallel task item's declared property set, pinned exactly;
 *   3. those names against the two TS-side places a phantom can hide — the
 *      inline `params` type `execute` takes, and the task fields it reads.
 *
 * Everything is enumerated from the artefacts themselves (the schema object, and
 * the source text of `index.ts`) — no hand-written copy of the parameter list
 * that could itself drift. Only what can fail independently is asserted: three
 * of the file's original four assertions were strictly implied by the exact-set
 * check — including one that re-typed the surviving names by hand, the drift the
 * header claims to avoid — and were dropped rather than reworded.
 *
 * If a name reappears here it has to arrive together with the behaviour that
 * honours it (#113 first, for `async`) and a consumer that reads it; until then
 * the honest description is the one that does not mention it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// ── The two TS-side surfaces a phantom parameter can hide in ────────────────
//
// `index.ts` declares what it accepts twice more, neither of them the schema:
// the inline `params` type on `execute`, and the set of task fields the parallel
// branch actually reads off each task. #114's `count` lived in the first and was
// absent from the second, which is exactly the drift these two helpers detect.
// They are parsed out of the source text — the same technique `core`'s
// `log-discipline.test.ts` uses — because there is no runtime reflection over
// erased TS types, and a hand-written list of the names would be the thing the
// guard exists to catch.

const INDEX_SOURCE = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

/** Group 1 of every match of `re` in `text`, narrowing away the undefined case. */
function group1(text: string, re: RegExp): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(re)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

/**
 * Member names of the inline `tasks?: Array<{…}>` type on `execute`.
 * Handles a flat object literal only — which is what the type is — and says so
 * rather than mis-parsing if a nested object type ever appears inside it.
 */
function declaredTaskItemTsType(): string[] {
  const match = INDEX_SOURCE.match(/tasks\?:\s*Array<\{([\s\S]*?)\}>/);
  const members = match?.[1];
  if (!members) throw new Error("Could not find the inline `tasks?: Array<{…}>` type in index.ts");
  if (members.includes("{")) {
    throw new Error("The inline `tasks` item type is no longer a flat object literal — this parser needs widening");
  }
  return group1(members, /[;{\s]([A-Za-z_$][\w$]*)\??\s*:/g);
}

/**
 * The task fields `execute` reads, in the parallel branch: every `t.<name>`
 * inside `if (params.tasks …) { … }`, up to the `// Single mode` marker. Scoped
 * deliberately — `index.ts` binds `t` to other things elsewhere (`getAllTools`
 * maps `(t) => t.name`), and those are not task fields.
 */
function readTaskFields(): string[] {
  const start = INDEX_SOURCE.indexOf("if (params.tasks && params.tasks.length > 0) {");
  if (start < 0) throw new Error("Could not find the parallel-mode branch in index.ts");
  const end = INDEX_SOURCE.indexOf("// Single mode", start);
  if (end < 0) throw new Error("Could not find the end of the parallel-mode branch in index.ts");
  const body = INDEX_SOURCE.slice(start, end);
  const fields = group1(body, /(?:^|[^\w$.])t\.([A-Za-z_$][\w$]*)/g);
  // A renamed loop variable would parse to nothing, and an empty list compared
  // against the schema's list fails for the wrong reason. Say which premise broke.
  if (fields.length === 0) {
    throw new Error("No `t.<field>` reads found in the parallel-mode branch — the loop variable was renamed?");
  }
  return fields;
}

describe("SUBAGENT_PARAMS_SCHEMA — declared parameter set (issue #114)", () => {
  it("declares exactly the parameters execute reads, nothing more", () => {
    // Exact and sorted, so it fails in BOTH directions: re-advertising a
    // parameter nobody consumes (`async`, `count`) and over-eager deletion of
    // one somebody does. Nothing else in this file needs to restate the list —
    // every other assertion here derives its own from the artefacts.
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

describe("TaskItem — the schema and the TS-side task contract agree (#114's `count`)", () => {
  it("matches the member names of index.ts's inline `tasks` type", () => {
    // The class of bug #114 only half-found: `count?: number` was declared to
    // TypeScript here while the schema never advertised it, so the schema-only
    // guard could not see it. Both sides are enumerated, neither is typed out.
    expect([...declaredTaskItemTsType()].sort()).toEqual([...declaredTaskItemParams()].sort());
  });

  it("matches the task fields execute actually reads off each task", () => {
    // A declared-and-unread field is the false promise; a read-and-undeclared
    // field is a model that cannot reach the behaviour. Pin both directions.
    expect([...new Set(readTaskFields())].sort()).toEqual([...declaredTaskItemParams()].sort());
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
      Value.Check(SUBAGENT_PARAMS_SCHEMA as never, { tasks: [{ task: "x", count: 2 }] }),
    ).toBe(true);
  });
});
