const { describe, it } = require("node:test");
const assert = require("node:assert");
const { findHookCommands } = require("../hooks/json-utils");

describe("findHookCommands", () => {
  it("finds flat command hooks containing the marker", () => {
    const settings = {
      hooks: {
        stop: [
          { command: '"/usr/local/bin/node" "/app/hooks/cursor-hook.js"' },
          { command: '"/usr/local/bin/node" "/app/hooks/other-hook.js"' },
        ],
      },
    };

    assert.deepStrictEqual(
      findHookCommands(settings, "cursor-hook.js"),
      ['"/usr/local/bin/node" "/app/hooks/cursor-hook.js"']
    );
  });

  it("finds nested command hooks only when requested", () => {
    const settings = {
      hooks: {
        Stop: [{
          matcher: "",
          hooks: [
            { type: "command", command: '"/opt/node" "/app/hooks/agent-a-hook.js"' },
          ],
        }],
      },
    };

    assert.deepStrictEqual(findHookCommands(settings, "agent-a-hook.js"), []);
    assert.deepStrictEqual(
      findHookCommands(settings, "agent-a-hook.js", { nested: true }),
      ['"/opt/node" "/app/hooks/agent-a-hook.js"']
    );
  });

  it("returns all matching commands across events", () => {
    const settings = {
      hooks: {
        SessionStart: [{ command: '"node" "/app/hooks/agent-d-hook.js"' }],
        Stop: [{ command: '"/usr/bin/node" "/app/hooks/agent-d-hook.js"' }],
      },
    };

    assert.deepStrictEqual(
      findHookCommands(settings, "agent-d-hook.js"),
      [
        '"node" "/app/hooks/agent-d-hook.js"',
        '"/usr/bin/node" "/app/hooks/agent-d-hook.js"',
      ]
    );
  });

  it("ignores malformed entries and missing command fields", () => {
    const settings = {
      hooks: {
        Stop: [
          null,
          "bad",
          { type: "command" },
          { command: 123 },
          { hooks: [{ command: '"/node" "/app/hooks/agent-e-hook.js"' }] },
        ],
      },
    };

    assert.deepStrictEqual(findHookCommands(settings, "agent-e-hook.js"), []);
  });
});
