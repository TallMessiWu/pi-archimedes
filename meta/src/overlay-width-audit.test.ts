/**
 * Frame-width audit for the `/archimedes` settings overlay, the `/plugins`
 * overlay (same manager, different items) and the onboarding overlay.
 *
 * Automated stand-in for a `PI_TUI_WRITE_LOG` capture: render each surface
 * through its real entry point at several frame widths, measure **every produced
 * line** with pi-tui's own `visibleWidth` (what the terminal draws), and require
 * it to land on the frame. These are the surfaces `OVERLAY_CHROME` feeds, and
 * the cursor marker they emit is the shape the old `.length`-based width maths
 * measured far too wide — see Task 4 of the pi 1.x alignment plan.
 */

import { describe, it, expect, vi } from "vitest";
import {
  CURSOR_MARKER,
  stripTerminalSequences,
  visibleWidth as tuiVisibleWidth,
} from "@earendil-works/pi-tui";
import type { SettingItem } from "@earendil-works/pi-tui";
import { createSettingsManager, type PromptDescriptor } from "./settings-manager.js";
import { createOnboardingOverlay } from "./onboarding/overlay.js";
import type { OverlayTheme } from "@pi-archimedes/core/overlay";

// The onboarding overlay's live spinner previews come from @pi-archimedes/ui;
// the audit only needs a deterministic 4-cell string per (style, tick).
vi.mock("@pi-archimedes/ui/editor", () => ({
  spinFrame: vi.fn((style: string, tick: number) => {
    const c = 0x2800 + ((tick % 8) + (style.length % 4));
    return String.fromCharCode(c) + "⣷⣾⣽";
  }),
}));

// One entry per failure mode of the deleted width maths.
const URL = `https://example.com/${"segment/".repeat(12)}`;

/** A theme that actually colourises, so SGR sequences are in the measured lines. */
const theme = {
  fg: (token: string, text: string) =>
    token === "accent"
      ? `\x1b[38;2;80;120;255m${text}\x1b[0m`
      : token === "error"
        ? `\x1b[38;2;255;90;90m${text}\x1b[0m`
        : `\x1b[38;2;120;160;200m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  muted: (text: string) => `\x1b[38;2;100;100;100m${text}\x1b[0m`,
  strikethrough: (text: string) => `\x1b[9m${text}\x1b[0m`,
} as unknown as OverlayTheme & Record<string, (...args: never[]) => unknown>;

const plainTheme: OverlayTheme = { fg: (token: string, text: string) => String(theme.fg(token, text)) };

const ITEMS: SettingItem[] = [
  {
    id: "wide",
    label: "界面表示の幅",
    currentValue: "既定",
    description: "この設定はオーバーレイの幅を検証するための日本語の説明です。".repeat(3),
  },
  {
    id: "linked",
    label: `docs\x1b]8;;${URL}\x07link\x1b]8;;\x07`,
    currentValue: `see \x1b]8;;${URL}\x07this\x1b]8;;\x07`,
    description: `reference: \x1b]8;;${URL}\x07manual\x1b]8;;\x07`,
  },
  { id: "coloured", label: "\x1b[33mtinted\x1b[0m label", currentValue: "\x1b[32mon\x1b[0m", values: ["on", "off"] },
  {
    id: "model",
    label: "モデル スコープ モデル",
    currentValue: "anthropic/claude-opus-4.5",
    description: `${"説明文".repeat(60)}`,
  },
];

const PROMPTS: Record<string, PromptDescriptor> = {
  model: { kind: "text", label: "モデル スコープ モデル" },
};

interface Violation {
  surface: string;
  frameWidth: number;
  row: number;
  measured: number;
}

/** Every produced line of a bordered overlay must land on the frame exactly. */
function audit(surface: string, frameWidth: number, lines: string[]): Violation[] {
  const bad: Violation[] = [];
  lines.forEach((line, row) => {
    const measured = tuiVisibleWidth(line);
    if (measured !== frameWidth) bad.push({ surface, frameWidth, row, measured });
  });
  return bad;
}

// ── Capture content checks ───────────────────────────────────────────────────
//
// A width audit only proves something if the captured frame is the frame it means
// to measure. List search accepts printable ASCII only (`isAsciiPrintable` in
// settings-manager.ts: `data.length === 1 && data >= " " && data <= "~"`), while
// the free-text prompt field is pi-tui's `Input`, which takes any non-control
// input including wide characters — so a wide-character prompt is real content
// and a wide-character search query is not reachable at all. Each capture
// therefore declares the content it expects and is checked before the frame is
// measured.

/** Drawn text of the search row, border and padding removed, or undefined. */
function searchRow(raw: string[]): string | undefined {
  return raw
    .map((l) => stripTerminalSequences(l).replace(/[│┌└┐┘─]/g, "").trim())
    .find((l) => l.includes("Search:"));
}

function drawnIncludes(raw: string[], needle: string): boolean {
  return raw.some((l) => stripTerminalSequences(l).includes(needle));
}

/**
 * The raw line of the row that draws `needle`, or undefined unless exactly one
 * row draws it. Strips terminal sequences and the border glyphs the way
 * `searchRow()` does to *locate* the row, then hands back the untouched line so
 * a caller can still look inside it for the zero-width `CURSOR_MARKER` — which
 * the strip would remove.
 */
function drawnLine(raw: string[], needle: string): string | undefined {
  const rows = raw.filter((l) => stripTerminalSequences(l).replace(/[│┌└┐┘─]/g, "").includes(needle));
  return rows.length === 1 ? rows[0] : undefined;
}

/**
 * The most drawn columns that may follow the marker on a *crowded* prompt row.
 * Measured at width 40: 3 — the cell the fake cursor occupies, the one padding
 * space that still lands on the frame, and the right border cell. One column of
 * slack, so the tripwire below fires on a fixture that stops crowding the row
 * rather than on a border that grew by a cell.
 */
const MARKER_EDGE_ROOM = 4;

function makeManager() {
  return createSettingsManager({
    items: ITEMS.map((i) => ({ ...i })),
    prompts: PROMPTS,
    theme: theme as never,
    onChange: () => {},
    onSave: () => {},
    onClose: () => {},
  });
}

function makeOnboarding() {
  return createOnboardingOverlay({
    theme: plainTheme,
    thinkingDefault: "Full",
    toolDefault: "Minimal",
    plugins: [
      { id: "ui", label: "界面表示", description: "TUI 拡張機能".repeat(6), selected: true },
      { id: "linked", label: `plugin\x1b]8;;${URL}\x07link\x1b]8;;\x07`, description: `see \x1b]8;;${URL}\x07docs\x1b]8;;\x07`, selected: false },
      { id: "diff", label: "\x1b[35mdiff\x1b[0m", description: "Shiki diff rendering", selected: true },
    ],
    spinners: ["typing", "pulse", "rain"],
    spinnerDefault: "pulse",
    onDone: () => {},
  });
}

describe("overlay surfaces frame-width audit", () => {
  const FRAME_WIDTHS = [40, 60, 84, 100];

  it("keeps every produced line on the frame, on every surface and mode", () => {
    const violations: Violation[] = [];
    const over: Violation[] = [];

    for (const frameWidth of FRAME_WIDTHS) {
      const capture = (
        surface: string,
        lines: string[],
        expectContent?: (raw: string[]) => string | null,
      ) => {
        // Check the capture is what the audit thinks it is *before* measuring it.
        const problem = expectContent?.(lines);
        expect(problem ?? null, `${surface}@${frameWidth} is not the capture this audit measures`).toBeNull();
        const bad = audit(surface, frameWidth, lines);
        violations.push(...bad);
        over.push(...bad.filter((v) => v.measured > frameWidth));
      };

      // /archimedes settings — list, search (emits CURSOR_MARKER), prompt mode
      capture("settings:list", makeManager().render(frameWidth), (raw) =>
        drawnIncludes(raw, "界面表示の幅") ? null : "list rows not rendered",
      );

      // The search row with an empty query — the shape that carries the cursor
      // marker. The wide keystrokes after `/` are dropped by the ASCII gate.
      const searchingEmpty = makeManager();
      searchingEmpty.handleInput("/");
      for (const ch of "界面") searchingEmpty.handleInput(ch);
      capture("settings:search-empty", searchingEmpty.render(frameWidth), (raw) => {
        // Tripwire for that gate: if search ever accepts wide input, this capture
        // has to feed the wide query — otherwise a CJK search row goes unmeasured
        // and the frame-width claim quietly goes stale.
        if (!raw.some((l) => l.includes(CURSOR_MARKER))) return "cursor marker not rendered";
        const row = searchRow(raw);
        if (row?.trim() !== "Search:")
          return `search row is not the empty query: ${JSON.stringify(row?.trim())}`;
        return null;
      });

      // A populated search row: `link` is accepted by the ASCII gate and matches
      // exactly one fixture, so the filter result is checked, not assumed.
      const searching = makeManager();
      searching.handleInput("/");
      for (const ch of "link") searching.handleInput(ch);
      capture("settings:search", searching.render(frameWidth), (raw) => {
        const row = searchRow(raw);
        if (row?.trim() !== "Search: link")
          return `search row does not show the query: ${JSON.stringify(row?.trim())}`;
        if (!raw.some((l) => l.includes(CURSOR_MARKER))) return "cursor marker missing from the search row";
        if (!drawnIncludes(raw, "docs")) return "filtered list lost the OSC 8 fixture row";
        if (drawnIncludes(raw, "tinted")) return "search did not narrow the list";
        return null;
      });

      // Prompt mode takes wide input (its field is pi-tui's `Input`), so the
      // value the audit types really does land in the drawn frame. On the
      // narrowest frame the value fills the row, so its tail — and the zero-width
      // cursor behind it — are cut onto the frame instead of overflowing it.
      const prompting = makeManager();
      prompting.handleInput("\x1b[B"); // down to the free-text "model" row
      prompting.handleInput("\x1b[B");
      prompting.handleInput("\x1b[B");
      prompting.handleInput("\r");
      for (const ch of "検証モデル名") prompting.handleInput(ch);
      capture("settings:prompt", prompting.render(frameWidth), (raw) => {
        if (!drawnIncludes(raw, "検証")) return "prompt field does not show the typed wide value";
        // #100: the cursor marker survives a full prompt row. `CURSOR_MARKER` is
        // zero width, so on a row whose value already fills the frame it is the
        // one thing that costs nothing to keep and everything to lose — the old
        // `.length`-based padding counted it as drawn columns and the truncation
        // that followed cut it off the tail, leaving the user a value, no cursor
        // and no clue why. The search rows above already carry the sibling
        // assertion; this is the prompt row's.
        //
        // It is bound to the row that draws the value, not to the frame: while a
        // field is open the search row is not drawn, but a whole-frame `.some()`
        // would still be satisfied by a marker that migrated onto any other row,
        // which is exactly the regression shape this guards. `drawnLine` refuses
        // an ambiguous match for the same reason.
        const row = drawnLine(raw, "検証");
        if (row === undefined) return "the typed value is not drawn on exactly one row";
        if (!row.includes(CURSOR_MARKER)) return "cursor marker missing from the prompt value row";
        // Tripwire against a decorative guard: the crowded shape is what the
        // assertion is for, and it only exists at the narrowest frame, where the
        // seeded value plus the typed value (37 columns) exceed the 34 the field
        // is handed, so pi-tui's `Input` scrolls the row and the head of the
        // value ("anthropic") is not even drawn. Measured there: the marker lands
        // at drawn column 37 of 40 with 3 columns after it. If the fixture ever
        // stops crowding the row, say so loudly rather than letting the guard go
        // green on an easy case.
        if (frameWidth === FRAME_WIDTHS[0]) {
          const at = row.indexOf(CURSOR_MARKER);
          const room = tuiVisibleWidth(row.slice(at + CURSOR_MARKER.length));
          if (room > MARKER_EDGE_ROOM)
            return `prompt value row is not crowded at the narrowest frame: ${room} columns follow the marker`;
        }
        return null;
      });

      // An empty filter result exercises the "no matching settings" row too.
      const noMatches = makeManager();
      noMatches.handleInput("/");
      for (const ch of "zzzz") noMatches.handleInput(ch);
      capture("settings:no-matches", noMatches.render(frameWidth), (raw) => {
        if (searchRow(raw)?.trim() !== "Search: zzzz") return "search row does not show the query";
        if (!drawnIncludes(raw, "No matching settings")) return "empty-filter row not rendered";
        return null;
      });

      // Onboarding — four steps, each with its own row shapes.
      const intro = makeOnboarding();
      capture("onboarding:thinking", intro.render(frameWidth), (raw) =>
        drawnIncludes(raw, "Thinking style") ? null : "thinking step not rendered",
      );
      intro.handleInput("\r");
      capture("onboarding:tool", intro.render(frameWidth), (raw) =>
        drawnIncludes(raw, "Tool output style") ? null : "tool step not rendered",
      );
      intro.handleInput("\r");
      capture("onboarding:plugins", intro.render(frameWidth), (raw) =>
        drawnIncludes(raw, "Which plugins")
          ? drawnIncludes(raw, "pluginlink")
            ? null
            : "plugin row carrying the OSC 8 label not rendered"
          : "plugin step not rendered",
      );
      intro.handleInput("\r");
      capture("onboarding:spinner", intro.render(frameWidth), (raw) =>
        drawnIncludes(raw, "Which spinner") ? null : "spinner step not rendered",
      );
    }

    // Guard the fixtures: the marker is the shape that used to measure far too
    // wide, so a green audit that never emitted one would prove nothing.
    const probe = makeManager();
    probe.handleInput("/");
    expect(probe.render(84).some((line) => line.includes(CURSOR_MARKER))).toBe(true);

    const summary = (list: Violation[]) =>
      list.slice(0, 6).map((v) => `${v.surface}@${v.frameWidth}:row${v.row}=${v.measured}`).join(", ");
    expect(
      over,
      `${over.length}/${violations.length} off-frame line(s) [wider than the frame]: ${summary(over)}`,
    ).toEqual([]);
    expect(violations, `${violations.length} off-frame line(s) total: ${summary(violations)}`).toEqual([]);
  });
});
