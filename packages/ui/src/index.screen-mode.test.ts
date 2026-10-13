import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

// ── Screen-mode gate (ADR 0027) ─────────────────────────────────────────────
//
// The startup splash animation and the startup resource listing both append
// into terminal scrollback, which fullscreen screen does not have. They
// install from the header factory — the one place the current renderer is in
// hand — so the capability is read there, per call.
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

vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  removeConfig: vi.fn(),
}));

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, loadUIConfig: vi.fn() };
});

vi.mock("./startup/capture.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startup/capture.js")>();
  return { ...actual, patchConsoleLog: vi.fn(), unpatchConsoleLog: vi.fn() };
});

vi.mock("./thinking/patch.js", () => ({ patchThinkingRenderer: vi.fn() }));
vi.mock("./thinking/transform.js", () => ({ transformThinkingContent: vi.fn() }));

vi.mock("./startup/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startup/index.js")>();
  return {
    ...actual,
    renderHeader: vi.fn(() => ["header line"]),
    patchStartupListing: vi.fn(),
  };
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
import { loadUIConfig, DEFAULT_UI_CONFIG } from "./config.js";
import { patchStartupListing } from "./startup/index.js";

// ── Harness ─────────────────────────────────────────────────────────────────

type HeaderFactory = (tui: TUI, theme: Theme) => { render(width: number): string[] };

function startSession(): { headerFactory: HeaderFactory } {
  const listeners: Record<string, ((event: any, ctx: any) => void)[]> = {};
  const pi = {
    on: vi.fn((event: string, handler: (event: any, ctx: any) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event]!.push(handler);
    }),
    registerTool: vi.fn(),
  } as unknown as ExtensionAPI;

  const setHeader = vi.fn();
  const ctx = {
    hasUI: true,
    cwd: "/workspace/test-project",
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

describe("startup splash gate on screen capability", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs the startup listing on regular screen, quietly", () => {
    const { headerFactory } = startSession();
    const tui = regularTui();

    headerFactory(tui, {} as Theme);

    expect(patchStartupListing).toHaveBeenCalledTimes(1);
    expect(patchStartupListing).toHaveBeenCalledWith(tui, expect.anything(), expect.any(Object));
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("suppresses the startup listing on fullscreen screen, quietly", () => {
    const { headerFactory } = startSession();

    headerFactory(viewportTui(), {} as Theme);

    expect(patchStartupListing).not.toHaveBeenCalled();
    // Suppressing is a promise, not a defect: no diagnostic about it.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps rendering our header on fullscreen screen, where only the listing is gated", () => {
    const { headerFactory } = startSession();

    const comp = headerFactory(viewportTui(), {} as Theme);

    // ctx.ui.setHeader() is screen-mode independent: the header component is
    // still ours and still draws; it just has no captured sections to show.
    expect(comp.render(80)).toEqual(["header line"]);
    expect(patchStartupListing).not.toHaveBeenCalled();
  });

  it("re-reads the screen per call instead of caching the first renderer", () => {
    const { headerFactory } = startSession();

    // Same factory, renderer swapped underneath it — what switchTuiMode()
    // effectively does by handing the factory a brand new TUI.
    headerFactory(regularTui(), {} as Theme);
    expect(patchStartupListing).toHaveBeenCalledTimes(1);

    headerFactory(viewportTui(), {} as Theme);
    expect(patchStartupListing).toHaveBeenCalledTimes(1);

    headerFactory(regularTui(), {} as Theme);
    expect(patchStartupListing).toHaveBeenCalledTimes(2);
  });
});
