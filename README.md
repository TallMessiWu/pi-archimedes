# Pi session-name — early naming fork

A standalone session-naming fork of [danielcherubini/pi-archimedes](https://github.com/danielcherubini/pi-archimedes), based on **v2.11.2**.

**Starts naming in the background on the first user input, without waiting for the assistant's answer.** Keeps Pi's native `π - name - directory` terminal title and progress spinner. Existing and in-flight manual names win.

- Fork branch: **`session-name-early`**. `main` remains the upstream mirror.
- Loads **only session-name**, not the rest of the Archimedes suite.
- **No upstream Archimedes npm dependency.** Core helpers come from `file:packages/core` in this same Git checkout. Pi APIs come from the running host.
- Tested with **Pi 1.4.0**, Node.js ≥ 22.19.0. No build step.

## Install / migrate

Run in your shell:

```sh
# Remove the original standalone npm plugin (also handles extensions: [] entries).
pi remove npm:@pi-archimedes/session-name

# Install this fork's naming-only branch, NOT main.
pi install git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

If you previously installed the local `session-name-early` adapter, remove it
**after the Git install succeeds, before reloading**. This deletes only that old
adapter directory (inspect it first if you have since edited it):

```sh
rm -r ~/.pi/agent/extensions/session-name-early
```

Then run `/reload` inside Pi, or restart Pi. A new unnamed session will start
naming after its first non-empty text input; the title appears when that separate
request finishes, not necessarily instantly.

Do not keep two auto-naming extensions enabled. If you use the **full upstream
suite** instead of the standalone npm plugin, turn its Session Name component off
via `/plugins` and reload; do not remove the other components you still use.
The standalone fork itself does not install `/plugins` or `/archimedes`.

Existing `archimedes.sessionName` settings continue working. Authentication,
sessions, theme, and terminal-progress settings do not need to change.

## Update / uninstall

```sh
pi update git:github.com/TallMessiWu/pi-archimedes@session-name-early
# Then /reload inside Pi.

pi remove git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

The named branch follows our commits when explicitly updated. To freeze a tested
version instead, install `git:github.com/TallMessiWu/pi-archimedes@<full-commit-sha>`.
Do not install both references at once.

## Settings

In `~/.pi/agent/settings.json`, keep your other keys and optionally add:

```json
{
  "archimedes.sessionName": {
    "model": "provider/model-id",
    "reasoning": "minimal"
  }
}
```

- **`model`**: defaults to the current model. Canonical `provider/id`, unambiguous
  bare IDs, and `:thinking` suffixes resolve case-insensitively. An unknown model
  reference falls back to the current model, as upstream does.
- **`reasoning`**: defaults to `minimal`. Accepts `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max`, `off`, or `null`; casing/padding are tolerated. Invalid values
  fall back to the default. Pi clamps the request to the model's supported level;
  `off`/`null` therefore do not guarantee zero reasoning on every model.
- Naming is a **separate potentially billed model call**, not included in the main
  footer totals. Configure a cheaper model if desired.
- Optional diagnostics: `PI_ARCHIMEDES_LOG=/path/to/log pi`. No console logging.

## Behavior and safeguards

- Uses the original user text, up to 500 characters; no assistant response is
  needed. Resumed unnamed sessions use their first historical user text.
- One request at a time; input handlers never await the title request.
- Never replaces an existing name or a name set manually while a request runs.
- Shutdown/reload/session replacement aborts pending work; stale results cannot
  name another session.
- Retries only on later user inputs, up to three failures per runtime, then warns
  once. No automatic retry loop. Missing auth/model and cancellations do not
  spend the failure budget.
- Skips ephemeral sessions, blank/image-only inputs, and extension-generated
  inputs. Persistent print/RPC sessions can initiate naming too, but shutdown
  cancels pending work rather than delaying process exit.
- Titles are capped at 80 Unicode code points. Only `pi.setSessionName` is used;
  the fork never takes over terminal titles, progress, or working indicators.

## Development and verification

```sh
git clone --branch session-name-early https://github.com/TallMessiWu/pi-archimedes.git
cd pi-archimedes
npm ci --ignore-scripts --legacy-peer-deps
npm run typecheck
npm test
npm run test:production
```

Tests use Pi's real extension loader with mocked model calls. They do not use
real credentials or send prompts to providers. The production smoke test installs
into a temporary directory with dev/peer dependencies omitted and npm offline,
then runs the same tests against that isolated copy. Only local core is installed.

`npm test` uses the development Pi installation, or falls back to the personal
Pi managed installation. `PI_TEST_HOST_DIR` can select an explicit
`@earendil-works/pi-coding-agent/dist` directory.

### Layout and upstream sync

- `packages/session-name/src/index.ts`: forked naming implementation.
- `packages/core/src/{settings-io,log}.ts`: unchanged, in-repo helpers.
- Root `package.json`: naming-only Pi entry and local core dependency.
- Other upstream sources/docs remain for history and future merges; they are not
  loaded, installed, or covered by this branch's focused test commands.
- Root installation/CI uses npm rather than the upstream pnpm workspace. There
  is no npm publishing workflow on this branch.

To inspect an upstream update, fetch `upstream`, review the changes, and merge or
cherry-pick deliberately onto `session-name-early`. Preserve the naming-only
manifest and lifecycle guards, rerun all three checks, then push this branch.
Do not develop on `main`, and do not automatically replace this branch with it.

## License

MIT; upstream attribution and [LICENSE](LICENSE) are retained.
