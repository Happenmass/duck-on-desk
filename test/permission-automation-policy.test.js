"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  PERMISSION_AUTOMATION_MODE,
  INTERACTION_INTENT,
  AUTOMATION_ACTION,
  classifyPermissionInteraction,
  evaluatePermissionAutomation,
  isValidInteraction,
  isDecisionInteraction,
} = require("../src/permission-automation-policy");

function evaluate(mode, interaction) {
  return evaluatePermissionAutomation({ mode, interaction });
}

describe("permission automation interaction classifier", () => {
  it("classifies Claude tool, question, and plan interactions", () => {
    const tool = classifyPermissionInteraction({
      agentId: "claude-code",
      toolName: "Bash",
    });
    const question = classifyPermissionInteraction({
      agentId: "claude-code",
      toolName: "AskUserQuestion",
    });
    const plan = classifyPermissionInteraction({
      agentId: "claude-code",
      toolName: "ExitPlanMode",
    });

    assert.strictEqual(tool.intent, INTERACTION_INTENT.TOOL_APPROVAL);
    assert.strictEqual(tool.automationEligibility.autoTools, true);
    assert.strictEqual(question.intent, INTERACTION_INTENT.HUMAN_QUESTION);
    assert.strictEqual(question.capabilities.answerQuestions, true);
    assert.strictEqual(plan.intent, INTERACTION_INTENT.PLAN_REVIEW);
    assert.strictEqual(plan.capabilities.planFeedback, true);
  });

  it("normalizes reviewed decision names across casing and Tool suffix aliases", () => {
    const cases = [
      {
        agentId: "claude-code",
        toolNames: ["AskUserQuestion", "askuserquestion", "AskUserQuestionTool"],
        intent: INTERACTION_INTENT.HUMAN_QUESTION,
        unattendedAction: AUTOMATION_ACTION.AUTO_ANSWER,
      },
      {
        agentId: "claude-code",
        toolNames: ["ExitPlanMode", "exitplanmode", "ExitPlanModeTool"],
        intent: INTERACTION_INTENT.PLAN_REVIEW,
        unattendedAction: AUTOMATION_ACTION.AUTO_ALLOW,
      },
    ];

    for (const testCase of cases) {
      for (const toolName of testCase.toolNames) {
        const interaction = classifyPermissionInteraction({
          agentId: testCase.agentId,
          toolName,
        });
        assert.strictEqual(interaction.intent, testCase.intent, `${testCase.agentId}:${toolName}`);
        assert.strictEqual(
          evaluate(PERMISSION_AUTOMATION_MODE.AUTO_TOOLS, interaction),
          AUTOMATION_ACTION.DEFER,
          `${testCase.agentId}:${toolName}:auto-tools`
        );
        assert.strictEqual(
          evaluate(PERMISSION_AUTOMATION_MODE.UNATTENDED, interaction),
          testCase.unattendedAction,
          `${testCase.agentId}:${toolName}:unattended`
        );
      }
    }
  });

  it("never lets a reviewed decision alias fall through as an ordinary tool approval", () => {
    const aliases = [
      "askuserquestion",
      "AskUserQuestionTool",
      "exitplanmode",
      "ExitPlanModeTool",
    ];
    for (const agentId of [
      "claude-code",
      "codex",
      "opencode",
    ]) {
      for (const toolName of aliases) {
        const interaction = classifyPermissionInteraction({ agentId, toolName });
        assert.notStrictEqual(
          interaction.intent,
          INTERACTION_INTENT.TOOL_APPROVAL,
          `${agentId}:${toolName}`
        );
      }
    }
  });

  it("keeps Codex native user input and passive notifications out of automation", () => {
    const nativeQuestion = classifyPermissionInteraction({
      agentId: "codex",
      eventKind: "native-question",
      toolName: "CodexUserInput",
    });
    const notification = classifyPermissionInteraction({
      agentId: "codex",
      eventKind: "notification",
      toolName: "PermissionRequest",
    });

    assert.strictEqual(nativeQuestion.intent, INTERACTION_INTENT.NOTIFICATION);
    assert.strictEqual(nativeQuestion.automationEligibility.autoTools, false);
    assert.strictEqual(nativeQuestion.capabilities.nativeFallback, true);
    assert.strictEqual(notification.intent, INTERACTION_INTENT.NOTIFICATION);
  });

  it("never gives Claude plan-review capabilities to a tool-name collision", () => {
    for (const agentId of [
      "codex",
      "opencode",
    ]) {
      for (const toolName of ["ExitPlanMode", "exitplanmode", "ExitPlanModeTool"]) {
        const interaction = classifyPermissionInteraction({
          agentId,
          toolName,
        });
        assert.strictEqual(interaction.intent, INTERACTION_INTENT.UNKNOWN, `${agentId}:${toolName}`);
        assert.strictEqual(interaction.capabilities.planFeedback, false, `${agentId}:${toolName}`);
        assert.strictEqual(interaction.automationEligibility.autoTools, false, `${agentId}:${toolName}`);
        assert.strictEqual(interaction.automationEligibility.unattended, false, `${agentId}:${toolName}`);
      }
    }
  });

  it("defaults unknown agents to unknown with no automation eligibility", () => {
    const interaction = classifyPermissionInteraction({
      agentId: "future-agent",
      toolName: "Bash",
    });
    assert.strictEqual(interaction.intent, INTERACTION_INTENT.UNKNOWN);
    assert.deepStrictEqual(
      { ...interaction.automationEligibility },
      { autoTools: false, unattended: false }
    );
  });

  it("fails closed for missing or placeholder tool names from known agents", () => {
    for (const agentId of [
      "claude-code",
      "codex",
      "opencode",
    ]) {
      for (const toolName of [undefined, null, "", "  ", "Unknown", "unknown"]) {
        const interaction = classifyPermissionInteraction({ agentId, toolName });
        assert.strictEqual(interaction.intent, INTERACTION_INTENT.UNKNOWN);
        assert.strictEqual(interaction.automationEligibility.autoTools, false);
        assert.strictEqual(interaction.automationEligibility.unattended, false);
        assert.strictEqual(
          interaction.capabilities.allowDeny,
          true,
          `${agentId} missing-name manual capability`
        );
        assert.strictEqual(
          evaluatePermissionAutomation({
            mode: PERMISSION_AUTOMATION_MODE.AUTO_TOOLS,
            interaction,
          }),
          AUTOMATION_ACTION.DEFER
        );
        assert.strictEqual(
          evaluatePermissionAutomation({
            mode: PERMISSION_AUTOMATION_MODE.UNATTENDED,
            interaction,
          }),
          AUTOMATION_ACTION.DEFER
        );
      }
    }
  });

  it("fails closed in auto-tools but preserves unattended for a non-empty unreviewed Claude-compatible tool", () => {
    for (const agentId of ["claude-code"]) {
      const interaction = classifyPermissionInteraction({
        agentId,
        toolName: "RequestUserChoiceV2",
      });
      assert.strictEqual(interaction.intent, INTERACTION_INTENT.UNKNOWN);
      assert.strictEqual(
        evaluatePermissionAutomation({
          mode: PERMISSION_AUTOMATION_MODE.AUTO_TOOLS,
          interaction,
        }),
          AUTOMATION_ACTION.DEFER
      );
      assert.strictEqual(interaction.automationEligibility.unattended, true);
      assert.strictEqual(interaction.capabilities.allowDeny, true);
      assert.strictEqual(
        evaluatePermissionAutomation({
          mode: PERMISSION_AUTOMATION_MODE.UNATTENDED,
          interaction,
        }),
        AUTOMATION_ACTION.AUTO_ALLOW
      );
    }
  });

  it("keeps reviewed current Claude tools, compatibility aliases, and namespaced MCP calls eligible", () => {
    for (const toolName of [
      "Bash",
      "BashOutput",
      "BashOutputTool",
      "SlashCommand",
      "SlashCommandTool",
      "write_file",
      "ListMcpResourcesTool",
      "ReadMcpResourceTool",
      "Monitor",
      "EnterWorktree",
      "ShareOnboardingGuide",
      "Workflow",
      "MCP__SERVER__DO_THING",
    ]) {
      const interaction = classifyPermissionInteraction({
        agentId: "claude-code",
        toolName,
      });
      assert.strictEqual(interaction.intent, INTERACTION_INTENT.TOOL_APPROVAL);
      assert.strictEqual(interaction.automationEligibility.autoTools, true);
    }
  });

  it("ignores payload-shaped interaction fields because they are not classifier inputs", () => {
    const interaction = classifyPermissionInteraction({
      agentId: "future-agent",
      toolName: "Unknown",
      interaction: {
        intent: INTERACTION_INTENT.TOOL_APPROVAL,
        automationEligibility: { autoTools: true, unattended: true },
      },
    });
    assert.strictEqual(interaction.intent, INTERACTION_INTENT.UNKNOWN);
  });
});

describe("evaluatePermissionAutomation", () => {
  const claudeTool = classifyPermissionInteraction({
    agentId: "claude-code",
    toolName: "Bash",
  });
  const claudeQuestion = classifyPermissionInteraction({
    agentId: "claude-code",
    toolName: "AskUserQuestion",
  });
  const claudePlan = classifyPermissionInteraction({
    agentId: "claude-code",
    toolName: "ExitPlanMode",
  });

  it("always defers while off", () => {
    for (const interaction of [claudeTool, claudeQuestion, claudePlan]) {
      assert.strictEqual(
        evaluate(PERMISSION_AUTOMATION_MODE.OFF, interaction),
        AUTOMATION_ACTION.DEFER
      );
    }
  });

  it("auto-tools allows only eligible tool approvals", () => {
    assert.strictEqual(
      evaluate(PERMISSION_AUTOMATION_MODE.AUTO_TOOLS, claudeTool),
      AUTOMATION_ACTION.AUTO_ALLOW
    );
    assert.strictEqual(
      evaluate(PERMISSION_AUTOMATION_MODE.AUTO_TOOLS, claudeQuestion),
      AUTOMATION_ACTION.DEFER
    );
    assert.strictEqual(
      evaluate(PERMISSION_AUTOMATION_MODE.AUTO_TOOLS, claudePlan),
      AUTOMATION_ACTION.DEFER
    );
  });

  it("unattended preserves supported tool, answer, and plan automation", () => {
    assert.strictEqual(
      evaluate(PERMISSION_AUTOMATION_MODE.UNATTENDED, claudeTool),
      AUTOMATION_ACTION.AUTO_ALLOW
    );
    assert.strictEqual(
      evaluate(PERMISSION_AUTOMATION_MODE.UNATTENDED, claudeQuestion),
      AUTOMATION_ACTION.AUTO_ANSWER
    );
    assert.strictEqual(
      evaluate(PERMISSION_AUTOMATION_MODE.UNATTENDED, claudePlan),
      AUTOMATION_ACTION.AUTO_ALLOW
    );
  });

  it("fails safe for invalid mode, missing interaction, and malformed capabilities", () => {
    assert.strictEqual(evaluate("future", claudeTool), AUTOMATION_ACTION.DEFER);
    assert.strictEqual(evaluate(PERMISSION_AUTOMATION_MODE.AUTO_TOOLS, null), AUTOMATION_ACTION.DEFER);
    assert.strictEqual(
      evaluate(PERMISSION_AUTOMATION_MODE.UNATTENDED, {
        ...claudeTool,
        capabilities: { allowDeny: "yes" },
      }),
      AUTOMATION_ACTION.DEFER
    );
    assert.strictEqual(isValidInteraction(null), false);
  });

});
