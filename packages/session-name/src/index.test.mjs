import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use Pi's real extension loader, but never real credentials or model requests.
const agentDir = process.env.PI_TEST_AGENT_DIR ?? join(homedir(), ".pi/agent");
let host = process.env.PI_TEST_HOST_DIR;
if (!host) {
  try {
    host = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  } catch {
    const version = readFileSync(join(agentDir, "install/current-version"), "utf8").trim();
    host = join(agentDir, "install/releases", version, "node_modules/@earendil-works/pi-coding-agent/dist");
  }
}
// PI_TEST_HOST_DIR, when set, points to pi-coding-agent/dist.
const sandbox = mkdtempSync(join(tmpdir(), "pi-session-name-early-test-"));
process.env.PI_OFFLINE = "1";
process.env.PI_ARCHIMEDES_LOG = "";
process.env.PI_CODING_AGENT_DIR = sandbox;
const { loadExtensionsCached } = await import(pathToFileURL(join(host, "core/extensions/loader.js")));
const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
after(() => rmSync(sandbox, { recursive: true, force: true }));
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (text = '"测试会话命名"', stopReason = "stop") => ({
  content: [{ type: "text", text }], stopReason,
});

async function harness({ name, branch = [], persistent = true, auth = true, settings = {} } = {}) {
  writeFileSync(join(sandbox, "settings.json"), JSON.stringify(settings));
  const loaded = await loadExtensionsCached([entry], sandbox);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const calls = [], names = [], notices = [];
  let id = "session-a";
  loaded.runtime.getSessionName = () => name;
  loaded.runtime.setSessionName = title => { name = title; names.push(title); };
  const ctx = {
    hasUI: true,
    model: { id: "main", provider: "test", reasoning: true },
    sessionManager: {
      getSessionFile: () => persistent ? "/test/session.jsonl" : undefined,
      getSessionId: () => id,
      getBranch: () => branch,
    },
    modelRegistry: {
      getAll: () => [ctx.model, { id: "cheap", provider: "test", reasoning: true }].filter(Boolean),
      hasConfiguredAuth: () => auth,
      streamSimple: (model, context, options) => {
        let resolve, reject;
        const result = new Promise((yes, no) => { resolve = yes; reject = no; });
        calls.push({ model, context, options, resolve, reject });
        return { result: () => result };
      },
    },
    ui: {
      notify: (...args) => notices.push(args),
      setTitle: () => assert.fail("Must not replace Pi's native title"),
      setWorkingIndicator: () => assert.fail("Must not replace Pi's native spinner"),
    },
  };
  function emit(type, data = {}) {
    const results = (extension.handlers.get(type) ?? []).map(fn => fn({ type, ...data }, ctx));
    for (const result of results) assert.equal(result, undefined, "Handlers must not await naming");
  }
  emit("session_start");
  return { calls, names, notices, ctx, extension, runtime: loaded.runtime, emit,
    input: (text = "实现首次输入后立即命名", source = "interactive") => emit("input", { text, source }),
    rename: title => { name = title; },
    switchId: value => { id = value; },
  };
}

test("starts at input before history or agent events; one in-flight request; no title/spinner hooks", async () => {
  const h = await harness();
  assert.deepEqual([...h.extension.handlers.keys()].sort(), ["input", "session_shutdown", "session_start"]);
  h.input();
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.parse(h.calls[0].context.messages[0].content).originalUserInput, "实现首次输入后立即命名");
  assert.equal(h.calls[0].options.reasoning, "minimal");
  assert.equal(h.calls[0].options.cacheRetention, "none");
  assert.equal(h.calls[0].context.tools, undefined);
  h.input("第二条消息");
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve(response());
  await flush();
  assert.deepEqual(h.names, ["测试会话命名"]);
  h.input();
  assert.equal(h.calls.length, 1);
});

test("existing and in-flight manual names win", async () => {
  const named = await harness({ name: "原有名字" });
  named.input();
  assert.equal(named.calls.length, 0);
  const h = await harness();
  h.input();
  h.rename("手动名字");
  h.calls[0].resolve(response());
  await flush();
  assert.deepEqual(h.names, []);
});

test("session shutdown cancels and a late old result cannot rename the new session", async () => {
  const h = await harness();
  h.input("旧会话");
  h.emit("session_shutdown");
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.switchId("session-b");
  h.emit("session_start");
  h.input("新会话");
  h.calls[0].resolve(response("旧标题"));
  await flush();
  h.input("重复消息");
  assert.equal(h.calls.length, 2, "Old completion must not clear the new pending request");
  h.calls[1].resolve(response("新标题"));
  await flush();
  assert.deepEqual(h.names, ["新标题"]);
});

test("session identity guard rejects changed sessions even without shutdown", async () => {
  const h = await harness();
  h.input();
  h.switchId("different-session");
  h.calls[0].resolve(response());
  await flush();
  assert.deepEqual(h.names, []);
});

test("runtime invalidation rejects late writes quietly", async () => {
  const h = await harness();
  h.input();
  h.runtime.invalidate();
  h.calls[0].resolve(response());
  await flush();
  assert.deepEqual(h.names, []);
  assert.deepEqual(h.notices, []);
});

test("ephemeral, blank and extension-generated inputs are skipped", async () => {
  const ephemeral = await harness({ persistent: false });
  ephemeral.input();
  assert.equal(ephemeral.calls.length, 0);
  const h = await harness();
  h.input("  ");
  h.input("generated", "extension");
  assert.equal(h.calls.length, 0);
  h.input("RPC prompt", "rpc");
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve(response());
  await flush();
});

test("unnamed resumed sessions keep their original prompt, not the follow-up", async () => {
  const h = await harness({ branch: [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "原始主题" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "旧回答" }] } },
  ] });
  h.input("继续");
  assert.equal(JSON.parse(h.calls[0].context.messages[0].content).originalUserInput, "原始主题");
  assert.ok(!JSON.stringify(h.calls[0].context).includes("旧回答"));
  h.calls[0].resolve(response());
  await flush();
});

test("three failures retry on later inputs, keep first prompt, then warn only once", async () => {
  const h = await harness();
  for (let i = 0; i < 3; i++) {
    h.input(i === 0 ? "最初主题" : "跟进");
    assert.equal(JSON.parse(h.calls[i].context.messages[0].content).originalUserInput, "最初主题");
    if (i === 0) h.calls[i].resolve(response("", "error"));
    else if (i === 1) h.calls[i].resolve(response(""));
    else h.calls[i].reject(new Error("Mock provider failed"));
    await flush();
  }
  h.input();
  assert.equal(h.calls.length, 3);
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0][1], "warning");
});

test("aborted requests do not exhaust the failure budget", async () => {
  const h = await harness();
  for (let i = 0; i < 4; i++) {
    h.input();
    h.calls[i].resolve(response("", "aborted"));
    await flush();
  }
  h.input();
  h.calls[4].resolve(response());
  await flush();
  assert.equal(h.names.length, 1);
  assert.equal(h.notices.length, 0);
});

test("missing model/auth skips without warnings and releases pending state", async () => {
  const h = await harness({ auth: false });
  for (let i = 0; i < 4; i++) h.input();
  assert.equal(h.calls.length, 0);
  assert.equal(h.notices.length, 0);
  h.ctx.modelRegistry.hasConfiguredAuth = () => true;
  h.input();
  h.calls[0].resolve(response());
  await flush();
  assert.equal(h.names.length, 1);
  const missing = await harness();
  missing.ctx.model = undefined;
  missing.input();
  assert.equal(missing.calls.length, 0);
});

test("retains archimedes model and reasoning settings", async () => {
  const h = await harness({ settings: { "archimedes.sessionName": { model: "TEST/CHEAP:high", reasoning: " off " } } });
  h.input();
  assert.equal(h.calls[0].model.id, "cheap");
  assert.equal("reasoning" in h.calls[0].options, false);
  h.calls[0].resolve(response());
  await flush();
});

test("bounds first input and title length, including surrogate pairs", async () => {
  const h = await harness();
  h.input("x".repeat(700));
  assert.equal(JSON.parse(h.calls[0].context.messages[0].content).originalUserInput.length, 500);
  h.calls[0].resolve(response("😀".repeat(90)));
  await flush();
  assert.equal(Array.from(h.names[0]).length, 80);
  assert.equal(h.names[0].isWellFormed(), true);
});

test("production manifest loads only naming and uses the fork's local core", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.pi, {
    extensions: ["packages/session-name/src/index.ts"], skills: [], prompts: [], themes: [],
  });
  assert.deepEqual(manifest.dependencies, { "@pi-archimedes/core": "file:packages/core" });
  assert.equal(manifest.workspaces, undefined);
  assert.equal(manifest.scripts.preinstall, undefined);
});

for (const [raw, expected] of [
  [undefined, "minimal"], [null, undefined], ["off", undefined],
  [" Minimal ", "minimal"], ["HIGH", "high"], ["xhigh", "high"], ["max", "high"],
  ["ultra", "minimal"], [42, "minimal"], [true, "minimal"], [{}, "minimal"], [[], "minimal"],
]) {
  test(`validates and clamps reasoning ${JSON.stringify(raw)}`, async () => {
    const h = await harness({ settings: { "archimedes.sessionName": { reasoning: raw } } });
    h.input();
    assert.equal(h.calls[0].options.reasoning, expected);
    h.calls[0].resolve(response());
    await flush();
  });
}

for (const raw of ["off", null]) {
  test(`clamps ${raw} when the model excludes off`, async () => {
    const h = await harness({ settings: { "archimedes.sessionName": { reasoning: raw } } });
    h.ctx.model.thinkingLevelMap = { off: null };
    h.input();
    assert.equal(h.calls[0].options.reasoning, "minimal");
    h.calls[0].resolve(response());
    await flush();
  });
}

test("non-reasoning models receive no reasoning option", async () => {
  const h = await harness();
  h.ctx.model.reasoning = false;
  h.input();
  assert.equal("reasoning" in h.calls[0].options, false);
  h.calls[0].resolve(response());
  await flush();
});

for (const [reference, expected] of [
  ["test/cheap", "cheap"], ["CHEAP:high", "cheap"], [" main ", "main"],
  ["not-found", "main"], ["", "main"],
]) {
  test(`resolves model reference ${JSON.stringify(reference)}`, async () => {
    const h = await harness({ settings: { "archimedes.sessionName": { model: reference } } });
    h.input();
    assert.equal(h.calls[0].model.id, expected);
    h.calls[0].resolve(response());
    await flush();
  });
}

test("ambiguous bare model IDs fall back to the current model", async () => {
  const h = await harness({ settings: { "archimedes.sessionName": { model: "cheap" } } });
  h.ctx.modelRegistry.getAll = () => [
    h.ctx.model, { id: "cheap", provider: "one" }, { id: "cheap", provider: "two" },
  ];
  h.input();
  assert.equal(h.calls[0].model.id, "main");
  h.calls[0].resolve(response());
  await flush();
});

for (const mode of ["headless", "broken UI"]) {
  test(`exhaustion is safe with ${mode}`, async () => {
    const h = await harness();
    h.ctx.hasUI = mode !== "headless";
    h.ctx.ui.notify = () => { throw new Error("UI unavailable"); };
    for (let i = 0; i < 3; i++) {
      h.input();
      h.calls[i].reject(new Error("Mock provider failed"));
      await flush();
    }
    h.input();
    assert.equal(h.calls.length, 3);
  });
}

test("Pi's native title formatter preserves π and does not touch terminal progress", async () => {
  const { InteractiveMode } = await import(pathToFileURL(join(host, "modes/interactive/interactive-mode.js")));
  const titles = [];
  InteractiveMode.prototype.updateTerminalTitle.call({
    sessionManager: { getCwd: () => "/test/project", getSessionName: () => "测试标题" },
    ui: { terminal: { setTitle: title => titles.push(title), setProgress: () => assert.fail("Progress changed") } },
  });
  assert.deepEqual(titles, ["π - 测试标题 - project"]);
});
