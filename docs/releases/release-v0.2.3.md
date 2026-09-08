# v0.2.3

Checking for updates works. It never had, in any release of this fork.

- The update check asked GitHub for releases of `rullerzhou-afk/duck-on-desk`.
  That repository does not exist — the owner was inherited from the upstream
  project this fork is derived from and left hardcoded, while the builds were
  published here. Every check got a 404, which the app reported as "Duck 更新时
  遇到未知错误 / No releases found". Checks now go to `Happenmass/duck-on-desk`,
  where the releases actually are
- Settings -> About linked the same nonexistent repository. It now points at
  this fork's source, which is what a user needs for the build they are running.
  The upstream author credit, copyright and AGPL-3.0 license are unchanged
- A test now ties the update URL to the `build.publish` target in
  `package.json`, so the two cannot drift apart again

**Updating from 0.2.2 or earlier has to be done once by hand.** The fix lives in
the new build, so an installed 0.2.2 still asks the dead repository and still
reports the same error — it cannot see this release. Download the installer
below once; automatic checks work from 0.2.3 onward.

No behaviour, rendering or physics changes in this release.

macOS (arm64/x64 dmg+zip) and Windows (x64/arm64 NSIS).

Not real-machine validated on Windows or Linux for this release; the update
check was verified against the live GitHub API and the smoke pass was done on
macOS arm64.

**Full Changelog**: https://github.com/Happenmass/duck-on-desk/compare/v0.2.2...v0.2.3
