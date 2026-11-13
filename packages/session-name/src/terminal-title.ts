import { writeSync } from "node:fs";
import { diag, describeError } from "@pi-archimedes/core/log";

// Pi sets both the icon and window title via OSC 0. Use xterm's title stack
// where available, without querying stdin or learning the title's contents.
const PUSH_TITLE = "\x1b[22;0t";
const POP_TITLE = "\x1b[23;0t";
// Windows Terminal ignores the title stack. An empty OSC title clears the
// application override and exposes its retained starting title (profile/title).
// This restores a configured fixed title, not an arbitrary pre-Pi OSC title.
const RESET_WINDOWS_TITLE = "\x1b]0;\x07";
const TITLE_SAVED = Symbol.for("@tallmessiwu/pi-session-name-early/title-saved");
const lifetime = process as typeof process & { [TITLE_SAVED]?: true };

/** Called only on TUI startup, before Pi first sets its native title. */
export function preserveTerminalTitle(): void {
  if (lifetime[TITLE_SAVED] || !process.stdin.isTTY || !process.stdout.isTTY
    || process.env.TERM === "dumb") return;

  const fd = process.stdout.fd;
  const restore = process.env.WT_SESSION ? RESET_WINDOWS_TITLE : POP_TITLE;
  if (restore === POP_TITLE) {
    try {
      writeSync(fd, PUSH_TITLE);
    } catch (error) {
      diag("session-name", `Saving terminal title failed: ${describeError(error)}`);
      return;
    }
  }
  lifetime[TITLE_SAVED] = true;

  // This belongs to the process, not a session/extension runtime. Keep the
  // restoration strategy across /reload, session replacement, and unloading.
  // Restore after all session_shutdown handlers, which may still change titles.
  // Synchronous output is required: exit listeners cannot flush async writes.
  process.once("exit", () => {
    try {
      writeSync(fd, restore);
    } catch (error) {
      diag("session-name", `Restoring terminal title failed: ${describeError(error)}`);
    }
  });
}
