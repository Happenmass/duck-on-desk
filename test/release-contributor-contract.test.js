"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  githubHandleForIdentity,
  parseReleaseIdentities,
  previousReleaseTag,
  verifyReleaseContributors,
} = require("../scripts/verify-release-contributors");

test("release contributor audit selects the newest tag below the package version", () => {
  assert.strictEqual(
    previousReleaseTag("0.16.0", ["v0.14.0", "v0.15.0", "v0.16.0", "not-a-release"]),
    "v0.15.0",
  );
});

test("release contributor audit maps noreply, direct-email, and co-author identities", () => {
  const records = [
    "134911580+Cobb04@users.noreply.github.com\x00ShannonC\x00feature\x1e",
    "rullerzhou@gmail.com\x00rullerzhou-afk\x00merge\n\nCo-authored-by: Zamaniego <luis@aumentra.com>\x1e",
  ].join("");
  const identities = parseReleaseIdentities(records);
  assert.deepStrictEqual(
    identities.map((identity) => githubHandleForIdentity(identity.name, identity.email)),
    ["Cobb04", null, "Zamaniego"],
  );
});

test("unknown direct-email authors cannot silently bypass contributor credit", () => {
  assert.strictEqual(githubHandleForIdentity("New Person", "new@example.com"), undefined);
});

test("a project's first release passes with no previous tag to diff against", () => {
  const calls = [];
  const result = verifyReleaseContributors({
    version: "0.1.0",
    runGit: (args) => {
      calls.push(args);
      if (args[0] === "tag") return "";
      if (args[0] === "log") return "";
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.previousTag, "");
  assert.deepStrictEqual(result.handles, []);
  assert.deepStrictEqual(calls[1], ["log", "HEAD", "--format=%aE%x00%aN%x00%B%x1e"]);
});
