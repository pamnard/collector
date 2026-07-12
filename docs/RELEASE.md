# Release process

We ship **only** what passed local verification. GitHub Actions builds artifacts; it does **not** replace the pre-release gate.

## Before every release

From repo root:

```bash
npm run verify:release
```

This runs, in order:

| Step | What |
|------|------|
| typecheck | TS across workspaces + app |
| test | `@collector/db`, `@collector/core` |
| test:startup | broken index → rebuild path |
| build | packages + Vite production bundle |
| cargo check | Rust side compiles |
| tauri build | release binary + bundles (see signing below) |
| release smoke | headless run; **any** JS runtime error in `smoke-errors.log` or non-whitelisted stderr → fail |
| deb check (Linux) | `scripts/verify-deb-packaging.sh` on built `.deb` |

If any step fails — **no tag, no push, no release**.

### Signing key (local)

CI needs `TAURI_SIGNING_PRIVATE_KEY`. Locally:

- **With key** (recommended for final sign-off before tag): export `TAURI_SIGNING_PRIVATE_KEY`, then `npm run verify:release` must exit 0 including updater artifact signing.
- **Without key**: build may exit non-zero at the signing step; the script continues if the release binary exists. Use this for day-to-day dev, not as the final check before publish.

Linux default is `tauri build --bundles deb` (fast). For all CI-parity bundles before publish:

```bash
TAURI_BUNDLE_ARGS="--bundles deb,rpm,appimage" npm run verify:release
```

See [UPDATES.md](./UPDATES.md) for key generation and GitHub secret setup.

### Skip flags (not for publish)

```bash
SKIP_TAURI_BUILD=1 npm run verify:release    # faster; no binary smoke/deb check
SKIP_RELEASE_SMOKE=1 npm run verify:release  # no xvfb headless run
```

Do not tag a release after using skip flags unless you re-ran the full gate without them.

## Tag and publish

1. Bump version consistently:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Commit: `release: vX.Y.Z`
3. `npm run verify:release` — must pass (full run, signing key set if you publish updates)
4. Tag: `git tag vX.Y.Z`
5. Push branch + tag: `git push && git push origin vX.Y.Z`
6. Wait for [release workflow](../.github/workflows/release.yml) (draft release + artifacts)
7. On Linux maintainer machine: optional second `verify-deb-packaging.sh` on CI `.deb` download
8. Smoke: install build → add item → upgrade path if version bump (see [PACKAGING.md](./PACKAGING.md))
9. Publish draft release on GitHub when satisfied

## What we do not do

- Use a GitHub release or CI green check to **discover** whether a bug is fixed
- Tag before local `verify:release` passes
- Stack SQLite column migrations for disposable index data (see [DATABASE.md](./DATABASE.md))

## Bugfix workflow (reminder)

1. Reproduce locally (or automated test)
2. Fix
3. Re-run repro + `npm run verify:release` (or at minimum affected tests)
4. Commit
5. Release only when explicitly requested — after step 3
