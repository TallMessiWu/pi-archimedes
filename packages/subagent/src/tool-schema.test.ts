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
//
// The precedent stops at the technique, though, and the difference is what makes
// the two helpers below more than a grep: `log-discipline.test.ts` only greps
// whole lines for a call shape, so a match on any line is the fact it wants,
// while this file reads *structure* — a member list scoped by a type literal, a
// field list scoped by one brace-balanced branch. Scoping to a region is where a
// naive regex lies: it matches names inside comments and inside template strings
// as happily as inside code, and it ends a region wherever a marker string
// happens to sit. So the code view is built before anything is matched:
// comments and string/template interiors blanked, and the branch read to its
// matching brace. Both are load-bearing here and neither would be needed for a
// line-level grep.

const INDEX_SOURCE = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

/**
 * `INDEX_SOURCE` with every comment and every string / template / regex
 * *interior* replaced by spaces. Newlines are kept, so an offset in the result
 * is the same offset in the file.
 *
 * Why not `text.replace(...)` for the comments followed by a brace count:
 * `index.ts` contains `n.replace(/"/g, '')`, where one `/` opens a regex literal
 * and a `"` sits *inside* it. Stripping comments and quotes without having read
 * the string and regex states that far takes that `"` for the start of a string
 * and blanks the real statement after it — dropping a genuine `t.<field>` read
 * and reporting a phantom that was never declared. A guard that lies about a real
 * read is worse than the phantom it guards, so the scan tracks each of them: line
 * comments, block comments, single- and double-quoted strings, template literals —
 * where `${…}` re-enters code, so an interpolation is kept (`` `"${t.agent}"` ``
 * is a real read of `agent`) and only its braces count inside the template — and
 * regex literals.
 *
 * Deliberately narrow, and loud where it stops: the regex state does not model
 * `[…]` character classes, and a `/` after a `)` or a `}` is read as division.
 * Either would have to appear inside the parallel branch to matter, and the
 * failure it would cause is an unbalanced brace, which `closingBrace()` throws on
 * instead of letting a quietly narrowed window pass.
 */
function blankNonCode(source: string): string {
  // Reads always come from `source` and writes always go to `out`: blanking in
  // place would erase the very backslash the escape rule below depends on, and the
  // next character would then look unescaped and end the string early.
  const out = source.split("");
  let mode: "code" | "line" | "block" | "single" | "double" | "template" | "regex" = "code";
  /** The brace depth each open `${` was seen at; a `}` there closes the interpolation, not a block. */
  const interpolations: number[] = [];
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    switch (mode) {
      case "line":
        if (ch === "\n") {
          mode = "code";
          i++;
          continue;
        }
        out[i] = " ";
        i++;
        continue;
      case "block":
        if (ch === "*" && next === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          mode = "code";
          continue;
        }
        if (ch !== "\n") out[i] = " ";
        i++;
        continue;
      case "single":
      case "double":
      case "regex": {
        const quote = mode === "single" ? "'" : mode === "double" ? '"' : "/";
        // A backslash escapes the next character inside a string, a template and a
        // regex alike, so the pair is consumed together: neither `"\\"` nor `/\//`
        // ends where a scan that only looked at the current character would say.
        if (ch === "\\" && next !== undefined && next !== "\n") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (ch === quote) {
          out[i] = " ";
          i++;
          mode = "code";
          continue;
        }
        // A newline cannot legally sit inside these three: end the literal there,
        // so one unbalanced quote cannot swallow the rest of the file and hide the
        // branch's reads entirely.
        if (ch === "\n") {
          mode = "code";
          i++;
          continue;
        }
        out[i] = " ";
        i++;
        continue;
      }
      case "template": {
        if (ch === "\\" && next !== undefined && next !== "\n") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (ch === "`") {
          out[i] = " ";
          i++;
          mode = "code";
          continue;
        }
        if (ch === "$" && next === "{") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          interpolations.push(depth);
          mode = "code";
          continue;
        }
        if (ch !== "\n") out[i] = " ";
        i++;
        continue;
      }
      case "code": {
        if (ch === "/" && next === "/") {
          out[i] = " ";
          i++;
          mode = "line";
          continue;
        }
        if (ch === "/" && next === "*") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          mode = "block";
          continue;
        }
        if (ch === "'") {
          out[i] = " ";
          i++;
          mode = "single";
          continue;
        }
        if (ch === '"') {
          out[i] = " ";
          i++;
          mode = "double";
          continue;
        }
        if (ch === "`") {
          out[i] = " ";
          i++;
          mode = "template";
          continue;
        }
        // The lookback reads `out`, the part already scanned, so a `/` whose
        // division-operand was a blanked string reads as what it is.
        // The lookback deliberately reads `source` and not `out`: the quote or the
        // backtick that just closed a literal is exactly the signal that this `/`
        // divides it, and a blanked view would have hidden that.
        if (ch === "/" && startsRegex(source, i)) {
          out[i] = " ";
          i++;
          mode = "regex";
          continue;
        }
        if (ch === "{") {
          depth++;
          i++;
          continue;
        }
        if (ch === "}") {
          // This `}` closes an interpolation rather than a block, so the scan goes
          // back into the template instead of ending the window early.
          if (interpolations.length > 0 && interpolations[interpolations.length - 1] === depth) {
            interpolations.pop();
            out[i] = " ";
            i++;
            mode = "template";
            continue;
          }
          depth--;
          i++;
          continue;
        }
        i++;
        continue;
      }
    }
  }
  return out.join("");
}

/**
 * Whether the `/` at `i` opens a regex literal instead of dividing. A regex can
 * only appear where a value is expected, so the answer is whatever precedes it:
 * a regex after an operator, an opening bracket or a comma, a division after a
 * name, a digit, a closing bracket or a closing quote.
 *
 * Two known limits, both out of reach here and both landing on the loud side of
 * the failure: a `}` is not in the division set, so a `/` straight after one reads
 * as a regex, and the regex state itself does not model `[…]` classes. Either
 * would have to appear inside the parallel branch to matter, and the result is an
 * unbalanced brace, which `closingBrace()` throws on.
 */
function startsRegex(text: string, i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const prev = text[j];
    if (prev === undefined || prev === " " || prev === "\t" || prev === "\n") continue;
    return !/[\w$)'"`\]]/.test(prev);
  }
  return true;
}

/**
 * Index of the `}` closing the `{` at `open`, measured on a comment/string-blanked
 * view so a brace inside a comment or a string cannot end the window early. Throws
 * rather than returning -1: an unclosed branch means the scan and the file disagree
 * about a literal, and the honest answer is "this parser stopped understanding".
 */
function closingBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(
    "The parallel-mode branch of index.ts has no matching `}` in the comment/string-blanked view — " +
      "either the branch was rewritten or this scanner mis-reads a string, template or regex inside it",
  );
}

/**
 * `INDEX_SOURCE` with comments and literal interiors blanked (see
 * `blankNonCode`). Both parsers below read this and never the raw text: matching
 * raw text is what let a name merely *mentioned in a comment* count as a declared
 * or read field — the same false statement #114 is about, in the other direction.
 */
const INDEX_CODE = blankNonCode(INDEX_SOURCE);

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
 * Read off the blanked view, so a member mentioned in a comment above the type is
 * not counted as declared. The window ends at the first `}>`, so it needs the
 * type to stay a flat object literal — which it is — and it says so rather than
 * mis-parsing if a nested object type ever appears inside it.
 */
function declaredTaskItemTsType(): string[] {
  const match = INDEX_CODE.match(/tasks\?:\s*Array<\{([\s\S]*?)\}>/);
  const members = match?.[1];
  if (!members) throw new Error("Could not find the inline `tasks?: Array<{…}>` type in index.ts");
  if (members.includes("{")) {
    throw new Error("The inline `tasks` item type is no longer a flat object literal — this parser needs widening");
  }
  return group1(members, /[;{\s]([A-Za-z_$][\w$]*)\??\s*:/g);
}

/**
 * The task fields `execute` reads, in the parallel branch: every `t.<name>`
 * between `if (params.tasks …) {` and the `}` that closes it. Scoped deliberately
 * — `index.ts` binds `t` to other things elsewhere (`getAllTools` maps
 * `(t) => t.name`), and those are not task fields — and scoped by *braces*, not by
 * the first comment that looks like a landmark: the old window ended at the
 * `// Single mode` marker, so it both swallowed the comments inside the branch
 * (where a `t.count` in prose counted as a read) and would stop early at that
 * string anywhere it appeared. Blank-and-balance is what makes "read" mean read in
 * code.
 */
function readTaskFields(): string[] {
  // The anchor is the same in the raw file and in the blanked view — the scan
  // replaces characters with spaces, it never deletes one — so the offsets below
  // line up with what a reader sees in `index.ts`.
  const anchor = "if (params.tasks && params.tasks.length > 0";
  const start = INDEX_CODE.indexOf(anchor);
  if (start < 0) throw new Error("Could not find the parallel-mode branch in index.ts");
  const end = closingBrace(INDEX_CODE, INDEX_CODE.indexOf("{", start));
  const body = INDEX_CODE.slice(start, end + 1);
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
