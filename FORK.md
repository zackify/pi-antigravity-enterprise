# zackify/pi-antigravity fork

Fork of [Rahularya01/pi-antigravity](https://github.com/Rahularya01/pi-antigravity).

## Changes vs upstream

- Provider id is `antigravity-work` (name "Antigravity Work"), so models are
  `antigravity-work/<model>` and credentials live under `antigravity-work` in `auth.json`.
- Gemini Enterprise model catalog: when enterprise routing is on, models come from the
  license's `:fetchConfig` experiences (Neon, Argon, Carbon, ...) instead of the consumer
  `fetchAvailableModels` catalog. Runtime model lookup uses the same source.
- Enterprise request labels with invalid values (e.g. `model_enum=MODEL_PLACEHOLDER_*`)
  are dropped; the enterprise API rejects uppercase label values.
- Enterprise config can live in `~/.pi/agent/settings.json` (env vars still win):

  ```json
  {
    "antigravity": {
      "enterprise": {
        "enabled": true,
        "project": "my-gcp-project",
        "location": "us",
        "userTier": "gcp-ge-plus-tier"
      }
    }
  }
  ```

## Install

```sh
pi install git:github.com/zackify/pi-antigravity
```

## Pull upstream updates

```sh
git fetch upstream
git merge upstream/main     # resolve conflicts, keep PROVIDER_ID = "antigravity-work"
yarn install && yarn typecheck && yarn test
git push origin main
```

Pi reconciles git packages to the remote branch on start / `/reload`, so every machine
picks up the push automatically.
