# Release Process

This fork's release flow is defined by `.github/workflows/build.yml`. Targets are macOS x64/arm64 (DMG and updater ZIP) and Windows x64/arm64 (NSIS). The app ID remains `com.guhappen.duck-on-desk`; updates are read from `Happenmass/duck-on-desk`.

## Before Tagging

1. Update package.json and both root version fields in package-lock.json. Update this checklist and `docs/releases/release-vX.Y.Z.md`.
2. Run `npm test`, `npm run verify:release`, `npm run audit:assets`, and `npm run build:renderer`.
3. Commit the release implementation to main and push. Wait for both platform jobs in the branch build to pass before tagging that same commit.
4. Push `vX.Y.Z`. CI repeats the build and creates a draft, using the committed release notes. No publication is implied by a successful build alone.

CI verifies the actual files against updater metadata before uploading artifacts. The release job downloads macOS and Windows separately and sequentially, then checks sizes and SHA-512 again. It must not use a merged parallel artifact extraction: that silently truncated the Windows payload for v0.2.3. Upload ZIP blockmaps alongside the applications and latest*.yml.

## Draft Release

1.1.1 defaults the hold lesson to 30 simulated seconds per reset, with a visible 0–1000 second input. Validate the 1500-step boundary, zero disabling resets, per-lesson drafts, and unchanged historical resume settings. Packages contain no ONNX weights; pinned models download on demand to the user cache.

### Historical v1.1.0 Local Test Checklist

- v1.1.0 was local-only. The user authorized publication of the subsequent 1.1.1 release on 2026-09-09. Pass `--publish never` during local verification.
- For this machine, use `.release-reviews/v1.1.0/local-build.cjs` to write `dist/local-1.1.0` and omit copied weights; resolve policies from the existing global Hugging Face cache.
- Verify the packaged Robot Lab tutorial, joint controls, charts, optional preview, MPS recipe and direction-aware reward. Validate the external packaged MCP server, then replace the local installed bundle.
- Keep the verified 1.0.0 ZIP for rollback. Test packaged modules using a virtual-only harness; do not load `src/main.js` or hardware adapters for smoke checks.

### v1.1.1 Draft Smoke Checklist

- Confirm the packaged app shows `1.1.1` metadata and Settings -> About shows `v1.1.1`, sourced from app.getVersion().
- Inspect actual package resources: Robot Lab page, preload, external MCP scripts/dependencies and native MuJoCo MJCF/meshes must be present.
- On an isolated virtual profile, verify About's developer mode defaults off, saves on/off, opens and closes the lab, and offers re-entry after window close. Author/maintainer/contributor are Happenmass; upstream credits remain available.
- Verify script authoring, real MPS training, candidate evaluation, ONNX export, actual pet renderer activation and rollback using a virtual-only test process. Do not load hardware adapters merely to validate the release UI.
- Run `scripts/verify-updater-metadata.js` for both downloaded draft platform sets with the current package.json; verify ZIP blockmaps and preserve every metadata-listed artifact.
- Preserve app ID and preference locations. Verify older settings acquire developerMode=false without losing agent integrations or robot selections.
- Record unavailable Windows/CUDA hardware validation honestly. macOS currently uses ad-hoc signing; do not claim Developer ID signing or notarization. See `docs/guides/release-signing.md` for a separately authorized future signing setup.

After the draft is verified, publish it under the user's release authorization. Attach the existing `duck-on-desk-demo.mp4` asset because both READMEs link to releases/latest/download. Copy it from the previous verified release if it has not changed. Verify every published asset's digest/size and latest*.yml again.

v0.2.3 points at this fork and can discover the new release. v0.2.2 and older have a broken hardcoded upstream URL and require one manual download. Package verification and virtual tests do not validate physical robot hardware.
