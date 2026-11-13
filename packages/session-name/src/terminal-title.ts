import { writeSync } from "node:fs";
import { diag, describeError } from "@pi-archimedes/core/log";

// Pi sets both the icon and window title via OSC 0. Save/restore both with
// xterm's title stack, without querying stdin or learning the title's contents.
const PUSH_TITLE = "\x1b[22;0t";
const POP_TITLE = "\x1b[23;0t";
const TITLE_SAVED = Symbol.for("@tallmessiwu/pi-session-name-early/title-saved");
const lifetime = process as typeof process & { [TITLE_SAVED]?: true };

/** Called only on TUI startup, before Pi first sets its native title. */
export function preserveTerminalTitle(): void {
  if (lifetime[TITLE_SAVED] || !process.stdin.isTTY || !process.stdout.isTTY
    || process.env.TERM === "dumb") return;

  const fd = process.stdout.fd;
  try {
    writeSync(fd, PUSH_TITLE);
  } catch (error) {
    diag("session-name", `Saving terminal title failed: ${describeError(error)}`);
    return;
  }
  lifetime[TITLE_SAVED] = true;

  // This belongs to the process, not a session/extension runtime. Keep the
  // original stack entry across /reload, session replacement, and unloading.
  // Restore after all session_shutdown handlers, which may still change titles.
  // Synchronous output is required: exit listeners cannot flush async writes.
  process.once("exit", () => {
    try {
      writeSync(fd, POP_TITLE);
    } catch (error) {
      diag("session-name", `Restoring terminal title failed: ${describeError(error)}`);
    }
  });
}
