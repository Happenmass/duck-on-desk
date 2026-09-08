# v0.2.2

The 3D pet costs about half the CPU it used to while it is just standing there.

- The renderer ran at whatever the display offered — 120 fps on a ProMotion
  panel — and drew all 70 rig meshes a second time every frame for a real
  shadow map. Both robot runtimes now render at 30 fps, and the shadow map is
  replaced by a painted blob under the feet at the same size and weight
- Measured on an M-series Mac with a 120 Hz display, the duck idling: total app
  CPU 53.8% of a core -> 26.5% (2 samples before, 10 after; before was tight at
  53.3-54.2%, after spreads 23.2-30.5% because the remaining cost now tracks
  what the duck is doing rather than the frame rate). The GPU process alone
  falls 25.5% -> 8.4%. The win is smaller on a 60 Hz display, where the frame
  cap has half as much to remove. Memory is unchanged
- The physics and the control policy were never the expensive part: MuJoCo plus
  the ONNX policy measure ~1.1% of a core together, so nothing about how the
  duck balances, walks, falls or gets picked up has changed
- The camera's ease-down after the duck is dropped is now driven by elapsed
  time instead of by frame count. It had been a flat factor per rendered frame,
  which silently tied the settle to the display's refresh rate and would have
  stretched it four-fold under the new frame cap

macOS (arm64/x64 dmg+zip) and Windows (x64/arm64 NSIS).

Not real-machine validated on Windows or Linux for this release; the
measurements and the smoke pass were done on macOS arm64.

**Full Changelog**: https://github.com/Happenmass/duck-on-desk/compare/v0.2.1...v0.2.2
