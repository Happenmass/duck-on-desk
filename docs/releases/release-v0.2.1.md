# v0.2.1

A fix for the duck freezing after a restart, and new step sounds.

- The 3D duck no longer stands still after the app restarts or the renderer reloads while a session is already working: main now re-sends the current state once the renderer's MuJoCo/ONNX runtime is listening, instead of the on-load message being dropped and the duck waiting on a 9.75 s retry that could be dropped too
- Steps and landings are now single moves of a real hobby servo ("Small servo (arduino)" by gpag1, CC0 on freesound) instead of the Kenney footstep and thump samples; NOTICE and the READMEs credit the new source, and the "Duck footsteps" setting describes the servo whine
- A test pins that every servo take the audio adapter can pick is shipped, since a missing take only logs a warning

macOS (arm64/x64 dmg+zip) and Windows (x64/arm64 NSIS).

**Full Changelog**: https://github.com/Happenmass/duck-on-desk/compare/v0.2.0...v0.2.1
