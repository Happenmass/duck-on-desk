const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");

const DEFAULT_TEST_TIMEOUT_MS = 120000;

// Without a per-test timeout a hung test is not a failure: `node --test` waits
// on it forever, the remaining files never run, and no summary is printed -- so
// a regression that deadlocks one test reads as "the suite is still going"
// locally and as a stalled job in CI. A generous ceiling turns that into a
// normal red. Raise it with CLAWD_TEST_TIMEOUT_MS if a legitimately slow test
// ever needs more; 0 disables it.
function resolveTimeoutArgs(env = process.env) {
  // Number("") is 0, and 0 means "no timeout" -- so an empty or whitespace
  // override would silently remove the protection instead of falling back.
  const raw = env.CLAWD_TEST_TIMEOUT_MS;
  const configured = raw === undefined || String(raw).trim() === "" ? NaN : Number(raw);
  const timeoutMs = Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_TEST_TIMEOUT_MS;
  return timeoutMs > 0 ? [`--test-timeout=${timeoutMs}`] : [];
}

module.exports = { DEFAULT_TEST_TIMEOUT_MS, resolveTimeoutArgs };

// Requiring this file must not scan the directory or exit the process.
if (require.main !== module) return;

const testDir = __dirname;
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(testDir, name));

if (files.length === 0) {
  console.error("No test/*.test.js files found.");
  process.exit(1);
}

// Without a per-test timeout a hung test is not a failure: `node --test` waits
// on it forever, the remaining files never run, and no summary is printed -- so
// a regression that deadlocks one test reads as "the suite is still going"
// locally and as a stalled job in CI. A generous ceiling turns that into a
// normal red. Raise it with CLAWD_TEST_TIMEOUT_MS if a legitimately slow test
// ever needs more; 0 disables it.
const result = spawnSync(process.execPath, ["--test", ...resolveTimeoutArgs(), ...files], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
