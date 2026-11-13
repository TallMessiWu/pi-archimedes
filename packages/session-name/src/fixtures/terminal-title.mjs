// Child-only fixture: stdout is a captured pipe, never the user's terminal.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [host, entry, rawOptions] = process.argv.slice(2);
const options = JSON.parse(rawOptions);
Object.defineProperty(process.stdin, "isTTY", { value: options.stdinTTY ?? true });
Object.defineProperty(process.stdout, "isTTY", { value: options.stdoutTTY ?? true });
const write = fs.writeSync;
fs.writeSync = (fd, data, ...args) => {
  if ((options.failSave && data === "\x1b[22;0t")
    || (options.failRestore && (data === "\x1b[23;0t" || data === "\x1b]0;\x07"))) {
    throw new Error("Mock tty failure");
  }
  return write(fd, data, ...args);
};
syncBuiltinESMExports();

const { loadExtensionsCached } = await import(pathToFileURL(join(host, "core/extensions/loader.js")));
const { InteractiveMode } = await import(pathToFileURL(join(host, "modes/interactive/interactive-mode.js")));
const ctx = { mode: options.mode ?? "tui", hasUI: options.mode !== "print" && options.mode !== "json" };
const before = process.listenerCount("exit");
let extension;
async function load() {
  const loaded = await loadExtensionsCached([entry], process.env.PI_CODING_AGENT_DIR);
  assert.deepEqual(loaded.errors, []);
  extension = loaded.extensions[0];
}
function emit(type, reason) {
  for (const fn of extension.handlers.get(type) ?? []) {
    assert.equal(fn({ type, reason }, ctx), undefined);
  }
}
const interactive = {
  session: {},
  programStatus: { reset() {} },
  applyRuntimeSettings() {},
  bindCurrentSessionExtensions: async () => emit("session_start", options.startReason ?? "startup"),
  subscribeToAgent() {},
  updateAvailableProviderCount: async () => {},
  updateEditorBorderColor() {},
  updateTerminalTitle: InteractiveMode.prototype.updateTerminalTitle,
  sessionManager: { getCwd: () => "/test/project", getSessionName: () => "测试标题" },
  ui: { terminal: { setTitle: title => write(1, `\x1b]0;${title}\x07`) } },
};
await load();
// Exercise the real host's startup ordering, not a hand-ordered title write.
await InteractiveMode.prototype.rebindCurrentSession.call(interactive);
for (const reason of options.replacements ?? []) {
  emit("session_shutdown", reason);
  await load();
  emit("session_start", reason);
  interactive.updateTerminalTitle();
}
if (options.repeatStartup) emit("session_start", "startup");
assert.equal(process.listenerCount("exit") - before, options.expectedListeners ?? 1);
if (!options.skipShutdown) {
  emit("session_shutdown", "quit");
  // Another extension may still touch the title after our shutdown handler.
  interactive.ui.terminal.setTitle("late shutdown title");
}
write(1, "<before-exit>");
process.exit(options.exitCode ?? 0);
