# Updates

Collector uses the Tauri updater plugin with **GitHub Releases** as the update channel.

## How it works

1. App checks `https://github.com/pamnard/collector/releases/latest/download/latest.json`
2. `latest.json` is generated automatically by CI (`tauri-action`) on each tagged release
3. Bundles are signed; the app verifies signatures with the public key in `src-tauri/tauri.conf.json`

## User-facing controls

- **Settings → Обновления → Проверить** — manual check
- **Проверять при запуске** — optional startup check (off by default, stored in `localStorage`)

## Signing keys (maintainers)

Generate once (private key stays outside the repo):

```bash
npm run tauri signer generate -- -w ~/.tauri/collector.key
```

- **Public key** (`~/.tauri/collector.key.pub`) → paste into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- **Private key** → GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` (file content or path)

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/collector.key
```

If the private key is lost, existing installs can no longer receive trusted updates.

## CI requirements

`.github/workflows/release.yml` expects:

| Secret | Purpose |
|--------|---------|
| `GITHUB_TOKEN` | Provided by Actions; needs **Read and write** workflow permissions |
| `TAURI_SIGNING_PRIVATE_KEY` | Signs update bundles and `.sig` files |

`bundle.createUpdaterArtifacts` must be `true` in `tauri.conf.json`.

## Release checklist (packaging)

Before publishing a draft release:

1. **`npm run verify:release` passes locally** — see [RELEASE.md](./RELEASE.md)
2. Linux artifact passes `scripts/verify-deb-packaging.sh` (included in verify on Linux)
3. No `postRemoveScript` in `tauri.conf.json` → `bundle.linux.deb`
4. Smoke-test: upgrade preserves vault data ([PACKAGING.md](./PACKAGING.md))

## Testing updates

1. Ensure `TAURI_SIGNING_PRIVATE_KEY` is set in repo secrets
2. Tag a version **newer** than the installed app, e.g. `v0.1.1`
3. Publish the GitHub Release (draft → Publish)
4. In the installed app: **Settings → Проверить**

For a dry run without publishing, leave the release as draft — the updater will not see it as `latest`.

## Local dev

`npm run tauri dev` does not use signed release artifacts. Updater checks may fail or return no update; this is expected.
