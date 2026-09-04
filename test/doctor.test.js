const { describe, it } = require("node:test");
const assert = require("node:assert");
const { computeOverall, runDoctorChecks } = require("../src/doctor");

describe("doctor aggregate checks", () => {
  it("computes red overall when any check is critical", () => {
    assert.deepStrictEqual(
      computeOverall([
        { status: "pass" },
        { status: "fail", level: "critical" },
        { status: "fail", level: "warning" },
      ]),
      { status: "critical", level: "critical", issueCount: 2 }
    );
  });

  it("computes yellow overall when warnings exist without critical failures", () => {
    assert.deepStrictEqual(
      computeOverall([
        { status: "pass" },
        { status: "fail", level: "warning" },
      ]),
      { status: "warning", level: "warning", issueCount: 1 }
    );
  });

  it("computes green overall when all checks pass or info", () => {
    assert.deepStrictEqual(
      computeOverall([
        { status: "pass" },
        { status: "suppressed-by-dnd", level: "info" },
      ]),
      { status: "pass", level: null, issueCount: 0 }
    );
  });

  it("runs all checks through injectable dependencies", () => {
    const result = runDoctorChecks({
      prefs: { theme: "duck" },
      checkPrefsReadability: () => ({ id: "prefs-readability", status: "pass", level: null }),
      checkLocalServer: () => ({ id: "local-server", status: "pass", level: null }),
      checkAgentIntegrations: () => ({ id: "agent-integrations", status: "pass", level: null, details: [] }),
      checkPermissionBubblePolicy: () => ({ id: "permission-bubble-policy", status: "pass", level: null }),
      checkThemeHealth: () => ({ id: "theme-health", status: "pass", level: null }),
    });

    assert.strictEqual(result.overall.status, "pass");
    assert.deepStrictEqual(result.checks.map((check) => check.id), [
      "prefs-readability",
      "local-server",
      "agent-integrations",
      "permission-bubble-policy",
      "theme-health",
    ]);
  });

  it("surfaces unreadable preferences as critical", () => {
    const result = runDoctorChecks({
      prefsReadFailure: true,
      checkLocalServer: () => ({ id: "local-server", status: "pass" }),
      checkAgentIntegrations: () => ({ id: "agent-integrations", status: "pass" }),
      checkPermissionBubblePolicy: () => ({ id: "permission-bubble-policy", status: "pass" }),
      checkThemeHealth: () => ({ id: "theme-health", status: "pass" }),
    });

    const prefs = result.checks.find((check) => check.id === "prefs-readability");
    assert.strictEqual(prefs.status, "critical");
    assert.strictEqual(result.overall.status, "critical");
    assert.strictEqual(result.overall.issueCount, 1);
  });

  it("surfaces a recovered malformed prefs snapshot as non-authoritative", () => {
    const result = runDoctorChecks({
      prefsRecovered: true,
      checkLocalServer: () => ({ id: "local-server", status: "pass" }),
      checkAgentIntegrations: () => ({ id: "agent-integrations", status: "pass" }),
      checkPermissionBubblePolicy: () => ({ id: "permission-bubble-policy", status: "pass" }),
      checkThemeHealth: () => ({ id: "theme-health", status: "pass" }),
    });
    const prefs = result.checks.find((check) => check.id === "prefs-readability");
    assert.strictEqual(prefs.status, "critical");
    assert.strictEqual(prefs.reason, "prefs-recovered");
    assert.match(prefs.detail, /duck-prefs\.json\.bak/);
    assert.match(prefs.detail, /paused for this launch/i);
  });

  it("does not claim an invalid prefs backup exists when backup creation failed", () => {
    const result = runDoctorChecks({
      prefsReadFailure: true,
      prefsRecoveryBackupFailed: true,
      checkLocalServer: () => ({ id: "local-server", status: "pass" }),
      checkAgentIntegrations: () => ({ id: "agent-integrations", status: "pass" }),
      checkPermissionBubblePolicy: () => ({ id: "permission-bubble-policy", status: "pass" }),
      checkThemeHealth: () => ({ id: "theme-health", status: "pass" }),
    });
    const prefs = result.checks.find((check) => check.id === "prefs-readability");
    assert.strictEqual(prefs.reason, "prefs-recovery-backup-failed");
    assert.match(prefs.detail, /kept unchanged/i);
    assert.doesNotMatch(prefs.detail, /backed up as/i);
  });

});
