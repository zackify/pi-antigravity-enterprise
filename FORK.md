# pi-antigravity-enterprise

Fork of [Rahularya01/pi-antigravity](https://github.com/Rahularya01/pi-antigravity) with
Gemini Enterprise fixes.

## Changes vs upstream

- Provider id is `antigravity-work` (name "Antigravity Work"), so models are
  `antigravity-work/<model>` and credentials live under `antigravity-work` in `auth.json`.
- Gemini Enterprise model catalog: when enterprise routing is on, models come from the
  license's `:fetchConfig` experiences (Neon, Argon, Carbon, ...) instead of the consumer
  `fetchAvailableModels` catalog. Runtime model lookup uses the same source.
- Enterprise request labels with invalid values (e.g. `model_enum=MODEL_PLACEHOLDER_*`)
  are dropped; the enterprise API rejects uppercase label values.
- Enterprise config can live in a file instead of env vars (env vars still win). First match:
  1. `~/.pi/agent/antigravity-work.json` → `{ "enterprise": { ... } }`
  2. `~/.pi/agent/settings.json` → `{ "antigravity": { "enterprise": { ... } } }`

  ```json
  {
    "enterprise": {
      "enabled": true,
      "project": "my-gcp-project",
      "location": "us",
      "userTier": "gcp-ge-plus-tier"
    }
  }
  ```

  `project`, `location`, and `userTier` come from the license selected in the `agy` CLI.

## Install

Either clone into the auto-discovered extensions folder (works with a synced `~/.pi`):

```sh
git clone https://github.com/zackify/pi-antigravity-enterprise ~/.pi/agent/extensions/pi-antigravity-enterprise
cd ~/.pi/agent/extensions/pi-antigravity-enterprise && yarn workspaces focus --production
```

or install as a git package: `pi install git:github.com/zackify/pi-antigravity-enterprise`.

Do not also install `npm:pi-antigravity`; both register the same tools and commands.

## Pull upstream updates

```sh
git fetch upstream
git merge upstream/main     # keep PROVIDER_ID = "antigravity-work" and the package name
yarn install && yarn typecheck && yarn test   # tests auto-isolate from ~/.pi/agent
yarn workspaces focus --production   # drop dev deps again before syncing
git push origin main
```
