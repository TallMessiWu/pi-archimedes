import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

// logo.js decides TRUECOLOR once, at import time, from the environment. Pin it
// before anything imports the splash, so the assertions below are about which
// animation *frame* got rendered rather than about the machine running them.
vi.hoisted(() => {
  process.env.COLORTERM = "truecolor";
});

// ── Screen mode (ADR 0027) ───────────────────────────────────────────────────
//
// Two things used to be gated on the screen: the splash animation and the
// startup resource listing. The listing was scraped out of pi's component tree
// and re-rendered into the header, appending into terminal scrollback — which
// fullscreen screen does not have. Task 8 deleted that half (pi owns its
// listing now, and `quietStartup` is the supported knob), leaving the logo
// animation, which only advances a frame counter and asks *the renderer we were
// just handed* for a frame. That is screen-safe, so the gate is gone; what
// still differs per screen is the height the header sizes itself against, read
// from the same per-call capability check.
//
// `isViewportTUI` is faked by marker so a single test file can present both
// screens to the same module instance: a fake renderer carrying
// `__viewport: true` is a viewport TUI, anything else is the regular one.

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return {
    ...actual,
    isViewportTUI: vi.fn((tui: unknown) => (tui as { __viewport?: boolean })?.__viewport === true),
  };
});

// Real `readEffectiveSettings` (the splash reads pi's `quietStartup` through
// it); the namespace helpers are stubbed because the UI config they serve is
// stubbed below.
vi.mock("@pi-archimedes/core/settings-io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pi-archimedes/core/settings-io")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    removeConfig: vi.fn(),
  };
});

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, loadUIConfig: vi.fn() };
});

vi.mock("./thinking/patch.js", () => ({ patchThinkingRenderer: vi.fn() }));
vi.mock("./thinking/transform.js", () => ({ transformThinkingContent: vi.fn() }));

// `patchStartupListing` and `renderHeader` stay real on purpose: what these
// tests assert is which renderer the animation drives and how tall the header
// comes out, and both are invisible through a stub.
vi.mock("./startup/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startup/index.js")>();
  return { ...actual, revealStartupListing: vi.fn(), stopStartupListing: vi.fn() };
});

vi.mock("./migration.js", () => ({
  migrateCoreToUIConfig: vi.fn(),
  migrateCompactThinkingToStyle: vi.fn(),
  migrateRemovedToolPatch: vi.fn(),
  UI_CONFIG_KEYS: [],
}));

vi.mock("./bash/index.js", () => ({
  registerBashToolOverride: vi.fn(),
  clearActiveBashIntervals: vi.fn(),
}));

vi.mock("./codemode/index.js", () => ({
  registerCodemodeToolOverride: vi.fn(async () => true),
  clearActiveCodemodeIntervals: vi.fn(),
}));

import { registerUI } from "./index.js";
import { stripAnsi } from "@pi-archimedes/core/text";
import { loadUIConfig, DEFAULT_UI_CONFIG } from "./config.js";
import { stopStartupListing } from "./startup/index.js";
import { getShinedLogo, LOGO, LOGO_SETTLE_FRAME } from "./startup/logo.js";

// ── Harness ─────────────────────────────────────────────────────────────────

type HeaderFactory = (tui: TUI, theme: Theme) => {
  render(width: number): string[];
  dispose?(): void;
};

function startSession(): { headerFactory: HeaderFactory } {
  const listeners: Record<string, ((event: any, ctx: any) => void)[]> = {};
  const pi = {
    on: vi.fn((event: string, handler: (event: any, ctx: any) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event]!.push(handler);
    }),
    registerTool: vi.fn(),
    getSettings: vi.fn(() => ({})),
  } as unknown as ExtensionAPI;

  const setHeader = vi.fn();
  const ctx = {
    hasUI: true,
    cwd: "/workspace/test-project",
    scopedModels: [],
    ui: {
      setHeader,
      setEditorComponent: vi.fn(),
      setWorkingVisible: vi.fn(),
      theme: {} as Theme,
    },
    isIdle: vi.fn(() => true),
    shutdown: vi.fn(),
  } as unknown as ExtensionContext;

  registerUI(pi);
  for (const handler of listeners["session_start"] ?? []) handler(null, ctx);

  return { headerFactory: setHeader.mock.calls[0]![0] as HeaderFactory };
}

/** A renderer on regular screen / fullscreen screen. */
const regularTui = (): TUI => ({ terminal: { rows: 24 }, requestRender: vi.fn() }) as unknown as TUI;
const viewportTui = (): TUI =>
  ({ terminal: { rows: 24 }, requestRender: vi.fn(), __viewport: true }) as unknown as TUI;

describe("startup splash on either screen", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stopStartupListing();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const [label, makeTui] of [
    ["regular screen", regularTui],
    ["fullscreen screen", viewportTui],
  ] as const) {
    it(`animates the splash on ${label}, driving the renderer it was handed`, () => {
      vi.useFakeTimers();
      const { headerFactory } = startSession();
      const tui = makeTui();

      headerFactory(tui, {} as Theme);
      vi.advanceTimersByTime(100);

      // The frame timer runs, and it asks *this* renderer for its frames.
      expect((tui as unknown as { requestRender: ReturnType<typeof vi.fn> }).requestRender)
        .toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  }

  it("stops asking for frames once the logo settles, on either screen", () => {
    vi.useFakeTimers();
    const { headerFactory } = startSession();

    for (const tui of [regularTui(), viewportTui()]) {
      headerFactory(tui, {} as Theme);
      const requestRender = (tui as unknown as { requestRender: ReturnType<typeof vi.fn> }).requestRender;
      vi.advanceTimersByTime(3_000);
      const settled = requestRender.mock.calls.length;
      expect(settled).toBeGreaterThan(0);

      vi.advanceTimersByTime(3_000);
      expect(requestRender.mock.calls.length).toBe(settled);
    }
  });

  it("re-reads the screen per call instead of caching the first renderer", () => {
    const { headerFactory } = startSession();

    // Same factory, renderer swapped underneath it — what switchTuiMode()
    // effectively does by handing the factory a brand new TUI.
    const regular = headerFactory(regularTui(), {} as Theme);
    expect(regular.render(80)).toHaveLength(21);

    const viewport = headerFactory(viewportTui(), {} as Theme);
    expect(viewport.render(80).length).toBeLessThan(21);

    const backToRegular = headerFactory(regularTui(), {} as Theme);
    expect(backToRegular.render(80)).toHaveLength(21);
  });
});

// ── What the header actually draws on each screen ───────────────────────────
//
// Installing the splash on both screens is only half of it. The header is
// drawn from the animation ref, so it must arrive at the finished state
// whatever the screen, and it must not be sized to a terminal it does not
// scroll through: inside a viewport a header padded to `rows - 3` would be the
// whole screen and leave the editor nothing to render in.
describe("header output per screen mode", () => {
  const ROWS = 24;
  const THEME = { fg: (_token: string, text: string) => text } as unknown as Theme;

  beforeEach(() => {
    vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG });
  });

  afterEach(() => {
    stopStartupListing();
    vi.useRealTimers();
  });

  /** The settled logo rows, as the completed splash draws them. */
  const settledLogoRows = (): string[] =>
    getShinedLogo(LOGO_SETTLE_FRAME, DEFAULT_UI_CONFIG.animationStyle, DEFAULT_UI_CONFIG.colorfulLogo);

  /** Install the splash, then let the animation run to its end. */
  function settled(tui: TUI): string[] {
    vi.useFakeTimers();
    const { headerFactory } = startSession();
    const comp = headerFactory(tui, THEME);
    vi.advanceTimersByTime(3_000);
    return comp.render(80).map((l) => l.trim());
  }

  it("draws the settled logo on fullscreen screen, not the animation's first frame", () => {
    const lines = settled(viewportTui());

    // Content = the logo at rest, then the blank separator line. Nothing else.
    expect(lines).toEqual([...settledLogoRows().map((l) => l.trim()), ""]);
    // Stripped: a truecolor logo colours every block character separately, so
    // a run of blocks is not a literal run of block code points.
    expect(stripAnsi(lines.join("\n"))).toContain("████");
  });

  it("does not pad the header to terminal height on a frame-bounded screen", () => {
    const lines = settled(viewportTui());

    // The viewport allocates its own height; a header padded to `rows - 3`
    // would be the entire screen and leave the editor nothing to render in.
    expect(lines).toHaveLength(LOGO.length + 1);
    expect(lines.filter((l) => l === "")).toHaveLength(1);
  });

  it("still sizes the header to the terminal on regular screen, where the splash scrolls away", () => {
    const { headerFactory } = startSession();

    const lines = headerFactory(regularTui(), THEME).render(80);

    expect(lines).toHaveLength(ROWS - 3);
  });
});
