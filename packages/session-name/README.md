# Session-name: early naming fork

This branch starts background naming at the first non-empty user `input`, not
`agent_end`. It preserves Pi's native `π` terminal title and progress spinner.

Install the **repository root**, which provides the local core dependency:

```sh
pi install git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

Do not install the upstream npm package to get this behavior, and do not install
this subdirectory alone. Its original workspace manifest is retained as upstream
reference; the fork's distribution manifest is the root `package.json`.

See the [root README](../../README.md) for migration from the npm plugin/local
adapter, settings, costs, safeguards, updates, and verification commands.

The `archimedes.sessionName` settings namespace is unchanged: `model` defaults to
the current model and `reasoning` defaults to `minimal`, validated and clamped to
the selected model. The standalone fork does not load the suite's settings UI.
