# Release Process

This fork's release flow is defined by `.github/workflows/build.yml`. Targets are macOS x64/arm64 (DMG and updater ZIP) and Windows x64/arm64 (NSIS). The app ID remains `com.guhappen.duck-on-desk`; updates are read from `Happenmass/duck-on-desk`.

## Before Tagging

1. Update package.json and both root version fields in package-lock.json. Update this checklist and `docs/releases/release-vX.Y.Z.md`.
2. Run `npm test`, `npm run verify:release`, `npm run audit:assets`, and `npm run build:renderer`.
3. Commit the release implementation to main and push. Wait for both platform jobs in the branch build to pass before tagging that same commit.
4. Push `vX.Y.Z`. CI repeats the build and creates a draft, using the committed release notes. No publication is implied by a successful build alone.

CI verifies the actual files against updater metadata before uploading artifacts. The release job downloads macOS and Windows separately and sequentially, then checks sizes and SHA-512 again. It must not use a merged parallel artifact extraction: that silently truncated the Windows payload for v0.2.3. Upload ZIP blockmaps alongside the applications and latest*.yml.

## Draft Release

1.1.4 changes the hold lesson from a static two-second headstand to a tip-over/recover cycle. Its reward, reference state initialization, exploration noise hold and acceptance metric all changed together; the old `supported_headstand` criterion cannot register the new behaviour and now serves lesson 3 only. The reward is verified by a CEM-MPC planner from both a balanced and a collapsed start, and is NOT verified by training: no local MPS run produced the behaviour. Do not describe this lesson as trained or working. Historical runs keep their own reward and reset rules on resume.

1.1.3 removes application-imposed training parameter caps and the two-hour cutoff. Validate large iteration/environment/rollout settings through UI, IPC and MCP; new and resumed runs must preserve requested values. Run `smoke-lab-training-limit.cjs` on the actual packaged app and `test_parameter_freedom.py` for real short training/export. Keep necessary numeric validation and model/algorithm constraints.

1.1.2 fixes cold-cache training and adds managed Python setup. CI must run `smoke-training-setup.cjs` before model prefetch and again with `--packaged`; both execute real CPU training and ONNX export on the host platform. Check the UI preparation state and automatic/custom Python paths. CUDA hardware remains a separate validation gate.

1.1.1 defaults the hold lesson to 30 simulated seconds per reset, with a visible 0–1000 second input. Validate the 1500-step boundary, zero disabling resets, per-lesson drafts, and unchanged historical resume settings. Packages contain no ONNX weights; pinned models download on demand to the user cache.

### Historical v1.1.0 Local Test Checklist

- v1.1.0 was local-only. The user authorized publication of the subsequent 1.1.1 release on 2026-09-09. Pass `--publish never` during local verification.
- For this machine, use `.release-reviews/v1.1.0/local-build.cjs` to write `dist/local-1.1.0` and omit copied weights; resolve policies from the existing global Hugging Face cache.
- Verify the packaged Robot Lab tutorial, joint controls, charts, optional preview, MPS recipe and direction-aware reward. Validate the external packaged MCP server, then replace the local installed bundle.
- Keep the verified 1.0.0 ZIP for rollback. Test packaged modules using a virtual-only harness; do not load `src/main.js` or hardware adapters for smoke checks.

### v1.1.4 Draft Smoke Checklist

- Confirm the packaged app shows `1.1.4` metadata and Settings -> About shows `v1.1.4`, sourced from app.getVersion().
- Verify lesson 2 copy describes the cycle, not a two-second hold, and that its defaults read `hold_episode_steps` 120, random start on, exploration hold 4.
- Start a short lesson-2 run in the packaged app and confirm the evaluation reports `head_down_percent`, `lying_percent`, `recoveries` and `longest_head_down_seconds`, and that `evaluation_version` is `headstand-cycle-v1`.
- Judge learning only from the no-reset evaluation, never from the training `goal` component: reference state initialization inflates it. A folded duck and the target pose are both near `upright` -0.9; only trunk height separates them (0.04 vs 0.078).
- Confirm resuming a pre-1.1.4 hold run keeps its original reward, reset rules and episode length, and that changed reward or new fields are rejected rather than silently applied.
- Lesson 2 reproduced the behaviour on MPS in only 1 of 3 seeds (~1.4M steps); the other two fold onto their own head at 0.050-0.054 trunk height and never get back up. Do not describe training as reliable.
- When evaluating a checkpoint outside the trainer, load the whole actor state dict. Randomly initialised runs use identity input normalisation, and rebuilding the actor from the walking ONNX silently keeps the walking mean/scale, which inverts which policy looks good.
- Judge lesson 2 only by `success` from the knock-down evaluation, never by `head_down_percent` alone: a folded duck reaches upright -0.86 with the head down and scores 52% on time-in-pose while being unable to recover at all.

### v1.1.3 Draft Smoke Checklist

- Confirm the packaged app shows `1.1.3` metadata and Settings -> About shows `v1.1.3`, sourced from app.getVersion().
- Inspect actual package resources: Robot Lab page, preload, external MCP scripts/dependencies and native MuJoCo MJCF/meshes must be present.
- On an isolated virtual profile, verify About's developer mode defaults off, saves on/off, opens and closes the lab, and offers re-entry after window close. Author/maintainer/contributor are Happenmass; upstream credits remain available.
- Verify script authoring, real MPS training, candidate evaluation, ONNX export, actual pet renderer activation and rollback using a virtual-only test process. Do not load hardware adapters merely to validate the release UI.
- Run `scripts/verify-updater-metadata.js` for both downloaded draft platform sets with the current package.json; verify ZIP blockmaps and preserve every metadata-listed artifact.
- Preserve app ID and preference locations. Verify older settings acquire developerMode=false without losing agent integrations or robot selections.
- Record unavailable Windows/CUDA hardware validation honestly. macOS currently uses ad-hoc signing; do not claim Developer ID signing or notarization. See `docs/guides/release-signing.md` for a separately authorized future signing setup.

After the draft is verified, publish it under the user's release authorization. Attach the existing `duck-on-desk-demo.mp4` asset because both READMEs link to releases/latest/download. Copy it from the previous verified release if it has not changed. Verify every published asset's digest/size and latest*.yml again.

v0.2.3 points at this fork and can discover the new release. v0.2.2 and older have a broken hardcoded upstream URL and require one manual download. Package verification and virtual tests do not validate physical robot hardware.
