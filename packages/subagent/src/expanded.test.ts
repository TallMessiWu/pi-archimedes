import { describe, it, expect } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { buildExpandedText, buildProgressExpandedText, renderExpanded, renderProgressExpanded } from "./expanded.js";
import { renderCompactSingle } from "./compact.js";
import { RowBlock, type RowSegment, type RowSink } from "./row-block.js";
import type { SubagentProgress, SubagentResult } from "./types.js";

// The expanded row is what the user reads after `ctrl+o`; the compact row is
// what they see while it runs. Both have to carry the *Run outcome* vocabulary
// (CONTEXT.md) rather than collapsing it into done/failed.

const theme = { fg: (token: string, text: string) => `[${token}]${text}`, bold: (t: string) => t };

/** The content these segments carry, ignoring how each is laid out at render time. */
const drawnText = (segments: RowSegment[]): string => segments.map((s) => s.text).join("\n");

function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    agent: "reviewer",
    task: "review the diff",
    exitCode: 0,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
    model: "anthropic/claude-opus-4.5",
    finalOutput: "the answer",
    error: undefined,
    progress: undefined,
    progressSummary: { toolCount: 2, tokens: 15, durationMs: 1000 },
    ...overrides,
  };
}

describe("expanded view: run outcomes", () => {
  it("still says Done for a completed run", () => {
    expect(drawnText(buildExpandedText(makeResult({ outcome: "completed" }), undefined, theme))).toContain("✓ Done");
  });

  it("says Truncated — and not Failed — for a cut-off answer", () => {
    const out = drawnText(buildExpandedText(
      makeResult({ outcome: "truncated", exitCode: 1, finalOutput: "partial" }),
      undefined,
      theme,
    ));
    expect(out).toMatch(/truncated/i);
    expect(out).not.toMatch(/Failed/);
  });

  it("says Aborted for a cancelled run", () => {
    const out = drawnText(buildExpandedText(
      makeResult({ outcome: "aborted", exitCode: 143, error: undefined }),
      undefined,
      theme,
    ));
    expect(out).toMatch(/aborted/i);
    expect(out).not.toMatch(/Failed/);
  });

  it("keeps reporting a real error as an error", () => {
    const failed = makeResult({ exitCode: 1, error: "401 unauthorized" });
    delete failed.outcome; // a failed run claims no outcome
    const out = drawnText(buildExpandedText(failed, undefined, theme));
    expect(out).toContain("401 unauthorized");
  });
});

// ── A multi-line error, read in full (issue #112) ───────────────────────────

/**
 * What a failed child actually reports: a command line, a compiler diagnostic, a
 * stack frame, and the exit status on the last line. The last line is the one
 * whoever reads it wants (`rc=1` says what happened), and it is exactly what the
 * row cut threw away — so every assertion below keys off it.
 */
const MULTI_LINE_ERROR = [
  "Command failed: pnpm -r exec -- tsc --noEmit",
  "packages/subagent/src/index.ts:42:7 - error TS2345: Argument of type 'string' is not assignable",
  "    at runChild (/home/daniel/Coding/Javascript/pi-archimedes/packages/subagent/src/spawn.ts:88:12)",
  "error: subagent exited with rc=1",
].join("\n");
const FIRST_ERROR_LINE = "Command failed: pnpm -r exec -- tsc --noEmit";
const LAST_ERROR_LINE = "error: subagent exited with rc=1";

/** `theme.fg` for real SGR bytes, so the rendered lines carry an ANSI state. */
const ERROR_SGR = "\x1b[31m";
const RESET = "\x1b[0m";
const sgrTheme = {
  fg: (token: string, text: string) =>
    `${token === "error" ? ERROR_SGR : "\x1b[2m"}${text}${RESET}`,
  bold: (t: string) => `\x1b[1m${t}${RESET}`,
};

/** A `RowBlock` that remembers the segments it was last given, without faking the row layer. */
class CapturingRowBlock extends RowBlock {
  /** Named apart from `RowBlock`'s own private field of the same name. */
  lastSegments: RowSegment[] | undefined = undefined;

  override setSegments(segments: RowSegment[]): void {
    this.lastSegments = segments;
    super.setSegments(segments);
  }
}

/** A `RowSink` that records what the compact builders hand over (see `compact.test.ts`). */
class RecordingSink implements RowSink {
  segments: RowSegment[] | undefined = undefined;
  setText(_text: string): void {
    this.segments = undefined;
  }
  setSegments(segments: RowSegment[]): void {
    this.segments = segments;
  }
}

const content = (line: string): string => stripTerminalSequences(line).replace(/\s+$/, "");

function makeProgress(overrides: Partial<SubagentProgress> = {}): SubagentProgress {
  return {
    agent: "reviewer",
    status: "failed",
    task: "review the diff",
    currentTool: undefined,
    currentToolArgs: undefined,
    currentToolStartedAt: undefined,
    toolCount: 2,
    inputTokens: 10,
    outputTokens: 5,
    tokens: 15,
    cost: 0.01,
    durationMs: 1000,
    error: MULTI_LINE_ERROR,
    model: "anthropic/claude-opus-4.5",
    output: undefined,
    recentOutput: undefined,
    toolCalls: undefined,
    ...overrides,
  };
}

/** A failed run: an error and no outcome, which is what `stream.ts` reports. */
function failedResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  const result = makeResult({ exitCode: 1, error: MULTI_LINE_ERROR, ...overrides });
  // A failed run claims no outcome — `stream.ts` leaves the field off entirely.
  if (!("outcome" in overrides)) delete result.outcome;
  return result;
}

describe("expanded view: a multi-line error is readable in full (issue #112)", () => {
  /**
   * The guarantee, asserted the same way for all three builders: the error's last
   * line is present, and a `block` carries it. `block` is this repo's mechanism
   * for "read this in full" (ADR 0020), so the assertion is on the segment kind
   * rather than on the joined text — a change that pushes the error back through
   * `row()` fails here even though the joined text would still contain the line.
   */
  const revealsTheWholeError = (segments: RowSegment[]): void => {
    expect(drawnText(segments)).toContain(LAST_ERROR_LINE);
    expect(
      segments.filter((s) => s.text.includes(LAST_ERROR_LINE)).map((s) => s.kind),
      "the error's last line is inside a row again",
    ).toEqual(["block"]);
  };

  it("shows every line of a finished run's error, the last one as a block", () => {
    const segments = buildExpandedText(failedResult(), undefined, theme);
    revealsTheWholeError(segments);
    // The marker convention survives: the first line is still the outcome row,
    // with the ✗ error marker in front of it. Pinned exactly, because that row is
    // what the collapsed view draws too — only the tail moves into a block.
    const heads = segments.filter((s) => s.kind === "row" && s.text.includes("✗ "));
    expect(heads).toEqual([{ kind: "row", text: "[error]✗ " + FIRST_ERROR_LINE }]);
  });

  it("shows every line of a streaming run's error, the last one as a block", () => {
    const rows = new CapturingRowBlock();
    renderProgressExpanded(rows, makeProgress({ status: "failed" }), theme);
    revealsTheWholeError(rows.lastSegments!);
  });

  it("shows every line of a streaming parallel run's error, the last one as a block", () => {
    revealsTheWholeError(buildProgressExpandedText(makeProgress({ status: "failed" }), theme));
  });

  it("draws the whole error on screen at a narrow width as well as a wide one", () => {
    // Through the real row component, so this is about what lands on screen and
    // not about the intermediate segments (the style of the width audit).
    const [headLine, ...carriedLines] = MULTI_LINE_ERROR.split("\n");
    for (const width of [200, 120, 80, 40]) {
      const rows = new CapturingRowBlock();
      renderExpanded(rows, failedResult(), undefined, sgrTheme);
      const rendered = rows.render(width);
      const joined = rendered.map(content).join("").replace(/\s+/g, "");
      // Every line the block carries survives the wrap, whole. (The first line
      // stays a row — cut at the frame like every other row, which is why it is
      // not in this list.)
      for (const line of carriedLines) {
        // A wrapped line may break a long line across rows, so compare with the
        // whitespace removed, exactly like the width audit does.
        expect(joined, `line lost at ${width}: ${JSON.stringify(rendered.map(content))}`)
          .toContain(line.replace(/\s+/g, ""));
      }
      // The last line — the one the old cut discarded outright — is on a row of
      // its own rather than smeared across a wrap boundary.
      expect(
        rendered.map(content).some((l) => l.includes(carriedLines[carriedLines.length - 1]!)),
        `last error line missing at ${width}: ${JSON.stringify(rendered.map(content))}`,
      ).toBe(true);
      // And the head is still there, cut the way a row cuts, marker and all.
      expect(rendered.map(content)[0]).toContain("reviewer");
      expect(
        rendered.map(content).some((l) => l.includes("✗ " + headLine!.slice(0, 10))),
        `error head missing at ${width}: ${JSON.stringify(rendered.map(content))}`,
      ).toBe(true);
      for (const line of rendered) {
        expect(visibleWidth(line), `row over the frame at ${width}`).toBeLessThanOrEqual(width);
      }
    }
  });

  it("closes the error colour on every line it drew, so colour does not bleed", () => {
    // Wide enough that nothing wraps: every logical line is one rendered line, so
    // each one has to carry its own complete SGR pair. Handing `block` the whole
    // `theme.fg("error", "✗ " + error)` string instead would open one span over
    // every line and land the single reset on the last one only — the padding of
    // the earlier lines then sits inside an open span.
    const rows = new CapturingRowBlock();
    renderExpanded(rows, failedResult(), undefined, sgrTheme);
    const drawn = rows.render(200);
    const errorLines = drawn.filter((l) => l.includes(ERROR_SGR));
    expect(errorLines.length).toBe(MULTI_LINE_ERROR.split("\n").length);
    for (const line of errorLines) {
      expect(line.startsWith(ERROR_SGR), `line does not open its own span: ${JSON.stringify(line)}`)
        .toBe(true);
      expect(
        /\x1b\[0m\s*$/.test(line),
        `line leaves its span open across the padding: ${JSON.stringify(line)}`,
      ).toBe(true);
    }
  });

  it("leaves a single-line error exactly as it was rendered before", () => {
    // Byte-identical: only the multi-line case changes, so every existing
    // assertion about the outcome row keeps its meaning.
    const failed = makeResult({ exitCode: 1, error: "401 unauthorized" });
    delete failed.outcome;
    const segments = buildExpandedText(failed, undefined, theme);
    const outcome = segments.filter((s) => s.text.includes("401 unauthorized"));
    expect(outcome).toEqual([{ kind: "row", text: "[error]✗ 401 unauthorized" }]);
    expect(drawnText(segments).split("\n").filter((l) => l.includes("401"))).toHaveLength(1);
  });

  it("draws no blank row for an error that merely ends in a newline", () => {
    // stderr usually ends in one, so this is the common case rather than a corner:
    // a trailing newline is not a line of content, and opening a block for it
    // would add a blank row to the bottom of every failed run.
    const failed = makeResult({ exitCode: 1, error: "401 unauthorized\n" });
    delete failed.outcome;
    const segments = buildExpandedText(failed, undefined, theme);
    expect(segments.filter((s) => s.kind === "block" && s.text.trim() === "")).toEqual([]);
    expect(drawnText(segments).split("\n").filter((l) => l.includes("401"))).toHaveLength(1);
  });

  it("still lets the error win over the outcome, even when the error is multi-line", () => {
    // Pinned as-is, not decided here: `buildOutcomeLine` reads `data.error`
    // first, so an error and an outcome together report the error. Both halves of
    // the text have to survive that precedence now that the error is a block.
    const out = drawnText(
      buildExpandedText(failedResult({ outcome: "truncated", finalOutput: "partial" }), undefined, theme),
    );
    expect(out).toContain(FIRST_ERROR_LINE);
    expect(out).toContain(LAST_ERROR_LINE);
    expect(out).not.toMatch(/Truncated/);
  });

  // The asymmetry is the point, so it is pinned from both sides. The collapsed
  // side already has its own pins — `compact.test.ts`
  // ("hands over three row segments carrying whole fields, so newlines reach the
  // row cut") and `tool-row.width-audit.test.ts` ("keeps a multiline task or
  // error to three rows per agent (collapsed)") — so this is deliberately the
  // same claim on the same fixture, to make sure the two views are never
  // "fixed" into convergence.
  it("keeps the collapsed view cutting at the first line, on the same error", () => {
    const sink = new RecordingSink();
    renderCompactSingle(sink, failedResult(), undefined, sgrTheme, {
      state: {},
      invalidate: () => {},
    });
    const rows = new RowBlock();
    rows.setSegments(sink.segments!);
    const drawn = rows.render(80).map(content);
    expect(drawn).toHaveLength(3);
    expect(drawn[2], "the collapsed row no longer says it was cut").toMatch(/✗ .*\.\.\.$/);
    expect(drawn[2]).toContain("Command failed");
    expect(drawn.join("\n"), "the collapsed view started revealing what it summarizes")
      .not.toContain(LAST_ERROR_LINE);
  });
});

