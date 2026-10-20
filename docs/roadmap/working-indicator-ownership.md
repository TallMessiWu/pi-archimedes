---
status: approved
issue: https://github.com/danielcherubini/pi-archimedes/issues/147#issuecomment-6290421504
done-when: "`pnpm -r exec -- tsc --noEmit` and `pnpm test` are green, and a pty run against real pi shows archimedes loaded next to a sibling extension that sets `setWorkingIndicator({ frames, intervalMs })` on `session_start` with `archimedes.ui.editorSpinBorder: false` — the sibling's custom frames still animate during a prompt (on `main`, pi's default spinner appears instead)."
---

# Stop wiping other extensions' working indicator (ADR 0031, #147)

## Problem

`packages/ui/src/index.ts` calls `ctx.ui.setWorkingIndicator(undefined)` twice — once in `session_start` (`:327`) and once in `session_shutdown` (`:148`) — unconditionally. The code comment justifies it as handing the indicator back to pi "so the row a user does see is pi's default down to its spinner".

That call is not neutral. In pi it is an unskeyed overwrite:

```js
setWorkingIndicator(options) {
    this.workingIndicatorOptions = options;          // interactive-mode.js:1832
    if (this.activeStatusIndicator?.kind === "working") {
        this.activeStatusIndicator.setIndicator(options);
    }
    this.ui.requestRender();
}
```

`undefined` means "pi's default animated spinner" and the last writer wins — there is no key, no scoping, no ownership. So any extension that called `setWorkingIndicator({ frames, intervalMs })` before us loses its spinner. Reported in #147 against the published `pi-archimedes@2.11.1`; the local `main` (v2.11.1, `a44f942`) has the same two call sites, so the fix lands here.

Two facts make the call pure downside:

1. **We never configure an indicator.** Both call sites pass `undefined`, and no key in `archimedes.ui` (`packages/ui/src/config.ts`) touches frames or interval. We assert a state no user asked archimedes to control.
2. **pi already performs the handback.** `resetExtensionUI()` calls `setWorkingIndicator()` (`:1922`) and runs on every session replacement — `/new`, `/resume`, `/fork` (via `beforeSessionInvalidate`, `agent-session-runtime.js:111`) — and on `/reload` (`interactive-mode.js:5378`). Any extension wanting custom frames must re-apply per session regardless of what we do; that obligation is pi's contract, not something our call was enforcing.

The same `session_start` block also asserts `ctx.ui.setWorkingVisible(!spinFlag)` (`:326`). The `false` direction is legitimately ours — `editorSpinBorder` on means our border spinner owns the busy announcement, and ADR 0014 says the row is hidden while it runs. The `true` direction is not: it un-hides pi's row for a user who never asked us to touch it, and for any extension that deliberately hid the row to draw its own spinner. Fixing only the indicator would leave that user with a doubled "Working" row instead of a missing spinner.

### What is *not* the cause, and must not be "fixed"

**Handler order is not something we can win.** pi does not sort extension files — zero `sort()` calls in `core/extensions/loader.js`; discovery is raw `readdirSync` order over project `extensions/`, then global `extensions/`, then configured paths (`loader.js:677-695`). "archimedes runs last" is an accident of filesystem order, so any design that depends on being last, or that tries to move our call later, is unsound. This rules out the issue's alternative suggestion of documenting that extension authors should re-apply on `before_agent_start`: that event fires per prompt, not per session, so it is a workaround, not a contract.

**`session_shutdown` could not have caused #147.** All extensions' `session_start` handlers run together in load order, so our call there can beat a sibling's. `session_shutdown` is different: pi always emits it, then runs `resetExtensionUI()`, then builds the next session and emits its `session_start` (`agent-session-runtime.js:106-111` → `agent-session.js:2651`). Anything a sibling re-applies in the new session wins over our shutdown call no matter what. Guarding the shutdown line is about telling the truth — restore what we took, don't assert a default — not about patching a second wipe site. Say that plainly in the code comment; do not let the diff imply we fixed two causes.

## Design

One rule, recorded as **ADR 0031** (cross-referenced by an amendment to ADR 0014):

> Assert only `ctx.ui` state that an archimedes setting asks us to change; for state a setting does govern, write only the direction it demands; and restore — never assert — what we merely took.

### Behaviour

`session_start` (`packages/ui/src/index.ts:326-327`) — two calls become one conditional:

```ts
// Only the direction `editorSpinBorder` asks for. The row's resting state and
// pi's own indicator belong to pi: `resetExtensionUI()` restores both
// (`workingVisible = true` :1921, `setWorkingIndicator()` :1922) on startup,
// on `/new` / `/resume` / `/fork` and on `/reload`.
if (spinFlag) ctx.ui.setWorkingVisible(false);
```

`session_shutdown` (`:143-149`) — the row comes back only if we hid it:

```ts
if (spinFlag) targetCtx.ui.setWorkingVisible(true);
```

| working-row state | before | after | who restores it now |
|---|---|---|---|
| indicator | asserted `undefined` every session, both handlers | never written by us | pi's `resetExtensionUI()` (`:1922`) |
| visibility, spinner on | `setWorkingVisible(false)` | unchanged — still ours to assert | — |
| visibility, spinner off | `setWorkingVisible(true)` | not written | pi's `resetExtensionUI()` (`:1921`) |
| visibility, shutdown | `setWorkingVisible(true)` | only if `spinFlag` | pi's reset in between sessions |

`setHiddenThinkingLabel(undefined)` and `setEditorComponent(undefined)` stay exactly as they are: `labelText` is a real setting and the editor component is ours outright, so both calls undo state we demonstrably took. `setHiddenThinkingLabel(config.labelText.trim() || undefined)` at `session_start` (`:332`) also stays.

### Deliberate limitation, named not fixed

Another extension calling `setHiddenThinkingLabel` still loses to our `labelText` default at `session_start`. The only guard expressible today duplicates pi's *private* default (`defaultHiddenThinkingLabel = "Thinking..."`, `interactive-mode.js:272`, no accessor) as a literal in our source; when pi changes that string the guard silently inverts and we are wiping again — the same bug, latent. Weights are also not ours to set. Record the limitation in `docs/features/ui.md` and revisit only if pi exposes the default or an accessor.

### Where the rule reaches beyond this package

ADR 0029's consequences list says thinking's "label, collapse, working indicator" move onto `ctx.ui.setHiddenThinkingLabel()`, `setWorkingIndicator()`, and pi's own `hideThinkingBlock`. That sentence stays true as a statement about which API to use *when* we customise something; ADR 0031 narrows *whether* we do, and for the indicator the answer is now never. Do not edit 0029 (append-only) — ADR 0031 is the later word and says so.

## Tests

`packages/ui/src/index.test.ts` currently pins the wipe as intended behaviour, so those assertions are the bug's spec and must change:

- `:370`, `:435`, `:499-500`, `:511` — `expect(ui.setWorkingIndicator).toHaveBeenCalledWith(undefined)` → `expect(ui.setWorkingIndicator).not.toHaveBeenCalled()`, in the spinner-on case too. The spinner-on assertion is the one that holds the fix.
- `:476` (shutdown handback test) — drop the indicator assertion; keep `setHiddenThinkingLabel` / `setWorkingVisible` handbacks asserted.
- `:515-531` — **"re-reads the setting for every session, so a replaced session gets the row back"** asserts `[true]` for the spinner-off session, which after the fix is *no call*. Rewrite it: spinner-on session → `setWorkingVisible` calls `[false]`; spinner-off session → `[]`; and move the "the row comes back" claim into a comment naming `resetExtensionUI()` as the owner. Keeping the old test name would be false.

Two additions, because the bug was cross-extension and nothing covers that shape today:

1. **Regression for #147, in-process.** Register a `session_start` handler that calls `ctx.ui.setWorkingIndicator({ frames: ["◐"], intervalMs: 80 })` *before* `registerUI` registers ours (standing in for the sibling extension), trigger `session_start`, assert our handler made no `setWorkingIndicator` call. Red on `main`, green after — the direct proof for the issue.
2. **Shutdown does not un-hide what we never hid.** `editorSpinBorder: false`, `session_start` then `session_shutdown` → `setWorkingVisible` never called. Covers the guarded-handback half, currently untested.

`index.screen-mode.test.ts:123` and `startup-splash-gate.test.ts:150,465` declare the `setWorkingIndicator` spy in a fake ctx and never assert on it — no edit needed, but re-run them: they must stay green, which is the check that nothing else depended on the deleted calls.

## Docs

- `docs/decisions/0031-assert-only-ui-state-our-settings-ask-for.md` — the rule, the rejected options (indicator-only fix; the `labelText` guard; handler ordering), and the consequences. **Written.**
- `docs/decisions/0014-prompt-slot-spinner.md` — 2026-10-20 amendment naming the unconditional handback as the regression, keeping the hide-while-spinning stance. **Written.**
- `docs/features/ui.md:39` — the "One busy announcement, in one place" bullet states the wiped behaviour as the feature ("indicator restored with `setWorkingIndicator(undefined)`, so pi's default spinner runs"). Rewrite to the new rule in present tense and name the thinking-label limitation. Bump `last-verified`.
- `README.md` — no change: the working row is not documented there as a feature, and the user-visible change is "your custom spinner survives", which needs no new docs.

## Out of scope

- Any guard on `setHiddenThinkingLabel` (see Deliberate limitation).
- The other open issues in the 2026-10-14 cluster (#113 dead bridge handle, #116 pi's console prints, #124 cursor position) — unrelated to the working row.
- No new setting. There is nothing to configure: the fix is that we stop touching something.

## Release shape

`fix:` for #147. `2.11.1` is already published carrying the regression, so this wants its own patch release (`2.11.2`) rather than waiting behind other open work; note in the release notes that the fix restores a customised pi spinner for users of other extensions.
