---
status: live
last-verified: 2026-10-23
---

# Early session naming (fork branch)

The `session-name-early` branch names sessions on the first non-empty user input.
It does not wait for an assistant response or `agent_end`. The root manifest
loads only `packages/session-name/src/index.ts`; helper imports resolve to the
fork's `file:packages/core` dependency, not an upstream npm installation.

## Lifecycle

- `input` captures the current text before Pi persists it. An unnamed resumed
  session uses its first historical user text instead. Text is limited to 500
  characters and JSON-encoded as data for a separate title request.
- The handler returns synchronously; one background request runs at a time.
- Existing names skip generation. Results re-check the name before writing, with
  no await between that check and `pi.setSessionName`.
- `session_start` creates fresh state. `session_shutdown` marks old state inactive
  and aborts its request. Captured state, abort signal, and session-ID checks
  reject late results. An old request's cleanup cannot clear a new pending one.
- No calls to terminal-title, progress, or working-indicator APIs. Pi's native
  `session_info_changed` behavior updates its own title.

## Failure policy

Failures retry on later inputs, at most three per runtime, then warn once when
there is a UI and the session is still unnamed. Empty output is a logged failure.
Diagnostic details use `diag`/`describeError` and optional `PI_ARCHIMEDES_LOG`,
never console output. Notification failures cannot reject the background task.

Cancelled requests, missing auth/model, and stale contexts do not spend the
failure budget. Ephemeral, blank/image-only, and extension-generated inputs are
skipped. Shutdown does not wait for naming to complete, including in print mode.

## Settings and request isolation

`archimedes.sessionName.model` defaults to the current model. Reasoning defaults
to `minimal`; `resolveTitleReasoning` validates hand-edited values before Pi
clamps them for the model. `off`/`null` request no thinking but can clamp upward
on models that exclude it. Only a clamped `off` omits the reasoning option.

Title calls use `cacheRetention: "none"`, a fresh request session ID, and an abort
signal. They are separate potentially billed calls, outside main footer totals.
Titles are normalized and limited to 80 Unicode code points.

## Verification

`npm run typecheck`, `npm test`, and `npm run test:production` verify the focused
naming surface. Tests use the real Pi loader and mocked providers, including
race guards, lifecycle cancellation, settings resolution, title/progress
ownership, and a production-only offline install without upstream npm packages.
See [README](../../README.md) for install/update/migration commands.
