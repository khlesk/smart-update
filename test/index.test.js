const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getBlockedInstallScriptPackages,
  getInstallScriptApprovalCommands,
  getInstallScriptApprovalChoices,
  stripAnsi,
} = require("../index.js");

test("stripAnsi removes color, cursor, and OSC sequences", () => {
  const input = "\x1b[31mred\x1b[0m\x1b[2K\x1b]0;title\x07plain";
  assert.equal(stripAnsi(input), "redplain");
});

test("blocked install-script warnings include scoped packages and versions", () => {
  const result = {
    stdout: "",
    stderr: [
      "\x1b[33mnpm warn install-scripts   esbuild@0.25.0 (postinstall: node install.js)\x1b[0m\r",
      "npm warn install-scripts   @scope/native@2.3.4 (install: node-gyp rebuild)\r",
      "npm warn install-scripts   esbuild@0.25.0 (postinstall: duplicate)\r",
    ].join("\n"),
  };

  assert.deepEqual(getBlockedInstallScriptPackages(result), [
    ["esbuild", "0.25.0"],
    ["@scope/native", "2.3.4"],
  ]);
});

test("blocked install-script warnings support legacy allow-scripts output", () => {
  const result = {
    stdout: "",
    stderr: [
      "npm warn allow-scripts 2 packages have install scripts not yet covered by allowScripts:",
      "npm warn allow-scripts   opencode-ai@1.18.27 (postinstall: node ./postinstall.mjs)",
      "npm warn allow-scripts   @anthropic-ai/claude-code@2.1.261 (postinstall: node install.cjs)",
      "npm warn allow-scripts Run `npm install -g --allow-scripts=opencode-ai,@anthropic-ai/claude-code` to allow these scripts once",
    ].join("\n"),
  };

  assert.deepEqual(getBlockedInstallScriptPackages(result), [
    ["opencode-ai", "1.18.27"],
    ["@anthropic-ai/claude-code", "2.1.261"],
  ]);
});

test("approval choices depend on install mode", () => {
  assert.deepEqual(
    getInstallScriptApprovalChoices("local").map(({ value }) => value),
    ["skip", "approve"]
  );
  assert.match(
    getInstallScriptApprovalChoices("local")[1].name,
    /in this project/
  );
  assert.equal(
    getInstallScriptApprovalChoices("global")[1].name,
    "Select packages to allow once and reinstall"
  );
});

test("local approval records policy before rebuilding", () => {
  assert.deepEqual(
    getInstallScriptApprovalCommands(
      "local",
      ["top-level-package"],
      ["esbuild", "@scope/native"],
      [],
      []
    ),
    [
      ["install-scripts", "approve", "esbuild", "@scope/native"],
      ["rebuild", "esbuild", "@scope/native"],
    ]
  );
});

test("global approval reinstalls selected packages with a one-time allowlist", () => {
  assert.deepEqual(
    getInstallScriptApprovalCommands(
      "global",
      ["top-one", "top-two"],
      ["esbuild", "sharp"],
      ["-g"],
      ["--min-release-age=0"]
    ),
    [
      [
        "install",
        "-g",
        "--min-release-age=0",
        "--allow-scripts=esbuild,sharp",
        "top-one",
        "top-two",
      ],
    ]
  );
});
