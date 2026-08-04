#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline/promises");
const { spawnSync } = require("child_process");
const VERSION = require("./package.json").version;

// ─────────────────────────────────────────────────────────
// ANSI Color Palette
// ─────────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";

const FGBLACK = "\x1b[38;5;0m";
const FGWHITE = "\x1b[38;5;255m";
const FGGRAY = "\x1b[38;5;250m";
const FGSILVER = "\x1b[38;5;145m";
const FGRED = "\x1b[38;5;203m";
const FGPINK = "\x1b[38;5;218m";
const FGMAGENTA = "\x1b[38;5;177m";
const FGPURPLE = "\x1b[38;5;141m";
const FGBLUE = "\x1b[38;5;75m";
const FGCYAN = "\x1b[38;5;117m";
const FGGREEN = "\x1b[38;5;114m";
const FGLIME = "\x1b[38;5;154m";
const FGYELLOW = "\x1b[38;5;229m";
const FGORANGE = "\x1b[38;5;215m";
const FGAMBER = "\x1b[38;5;222m";

// Semantic aliases
const C = {
  header: FGBLUE,
  title: FGPURPLE,
  success: FGGREEN,
  warning: FGYELLOW,
  danger: FGRED,
  info: FGCYAN,
  muted: FGGRAY,
  dim: FGSILVER,
  pkgName: FGAMBER,
  version: FGCYAN,
  update: FGLIME,
  reset: RESET,
  bold: BOLD,
  dimStyle: DIM,
};

// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────
let mode = "local";
let bypassMinReleaseAge = false;
let inquirerPromise = null;
const LAYOUT = {
  headerGutter: "  ",
  ruleWidth: 68,
  columnGap: "  ",
};

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
// npm can include color and cursor-control sequences when its output is
// captured on Windows (notably when launched from MSYS2).  Remove the whole
// escape sequence rather than just SGR color codes so parsing and table-width
// calculations see the same text a user sees in a terminal.
const stripAnsi = (text) =>
  String(text)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "") // OSC sequences
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""); // CSI sequences
const padRight = (text, width) => {
  const visible = stripAnsi(text).length;
  const padding = Math.max(0, width - visible);
  return String(text) + " ".repeat(padding);
};
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const HEADER_LABEL_W = 8;

function fitText(text, width) {
  const value = String(text);
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function writeLines(stream, text = "", prefix = "") {
  for (const line of String(text).split("\n")) {
    stream.write(`${prefix}${line}\n`);
  }
}

function writeHeaderLine(text = "") {
  process.stdout.write(`${LAYOUT.headerGutter}${text}\n`);
}

function shortenHomePath(filePath) {
  if (!filePath) return "";
  const homeDir = os.homedir();
  if (filePath === homeDir) return "~";
  if (filePath.startsWith(`${homeDir}${path.sep}`)) {
    return `~${filePath.slice(homeDir.length)}`;
  }
  return filePath;
}

function headerRow(label, value, detail = "") {
  const left = `${C.muted}${padRight(label, HEADER_LABEL_W)}${C.reset} `;
  const middle = detail ? `${value} ${detail}` : value;
  writeHeaderLine(`${left}${middle}`);
}

function statusTag(label, color) {
  return `${color}[${label}]${C.reset}`;
}

function writeStatus(stream, label, color, ...args) {
  const lines = args.join(" ").split("\n");
  const indent = `${" ".repeat(String(label).length + 3)} `;

  lines.forEach((line, index) => {
    const prefix = index === 0 ? `${statusTag(label, color)} ` : indent;
    stream.write(`${prefix}${line}\n`);
  });
}

function getColumnWidths(headers, rows, limits = []) {
  return headers.map((header, index) => {
    const maxWidth = Math.max(
      String(header).length,
      ...rows.map((row) => String(row[index] ?? "").length)
    );
    const limit = limits[index];
    return typeof limit === "number" ? Math.min(maxWidth, limit) : maxWidth - 1;
  });
}

function renderRow(row, widths, formatters = []) {
  return row
    .map((value, index) => {
      const fitted = fitText(String(value ?? ""), widths[index]);
      const padded =
        index === row.length - 1 ? fitted : padRight(fitted, widths[index]);
      return formatters[index] ? formatters[index](padded, value) : padded;
    })
    .join(LAYOUT.columnGap);
}

function hr(char = "─", len = LAYOUT.ruleWidth) {
  process.stdout.write(`${C.muted}${char.repeat(len)}${C.reset}\n`);
}

function hrLabel(label, char = "─", len = LAYOUT.ruleWidth) {
  const text = ` ${label} `;
  const rightLen = Math.max(0, len - text.length - 2);
  process.stdout.write(
    `${C.muted}${char.repeat(2)}${C.reset}${C.dim}${text}${C.reset}${C.muted}${char.repeat(rightLen)}${C.reset}\n`
  );
}

function blank(lines = 1) {
  for (let i = 0; i < lines; i += 1) {
    process.stdout.write("\n");
  }
}

// ─────────────────────────────────────────────────────────
// Output utilities
// ─────────────────────────────────────────────────────────
function log(...args) {
  writeLines(process.stdout, args.join(" "));
}

function logError(...args) {
  writeStatus(process.stderr, "ERROR", C.danger, ...args);
}

function logSuccess(...args) {
  writeStatus(process.stdout, "OK", C.success, ...args);
}

function logWarn(...args) {
  writeStatus(process.stdout, "WARN", C.warning, ...args);
}

function logInfo(...args) {
  writeStatus(process.stdout, "INFO", C.info, ...args);
}

function logDetail(...args) {
  writeLines(process.stdout, args.join(" "), "  ");
}

function section(title) {
  blank();
  log(`${C.bold}${C.header}${title}${C.reset}`);
  hr();
}

function banner(lines) {
  blank();
  for (const line of lines) {
    log(`${C.bold}${C.title}${line}${C.reset}`);
  }
  blank();
}

function usage() {
  const cmd = path.basename(process.argv[1] || "npm-updater");
  const rows = [
    [`${cmd}    [ --local ]`, "Local project mode"],
    [`${cmd} -g | --global`, "Global package mode"],
    [`${cmd} -b | --bypass-age`, "Bypass min-release-age check"],
    [`${cmd} -h | --help`, "Show help"],
    [`${cmd} -v | --version`, "Show version"],
  ];
  const widths = getColumnWidths(["Command", "Description"], rows);

  blank();
  writeHeaderLine(`${C.bold}${C.header}NPM Smart Update — Usage${C.reset}`);
  blank();

  for (const [command, description] of rows) {
    const idx = command.indexOf(" ");
    const bin = idx === -1 ? command : command.slice(0, idx);
    const flags = idx === -1 ? "" : command.slice(idx + 1);
    const row = [
      `${C.bold}${bin}${C.reset}${flags ? ` ${C.info}${flags}${C.reset}` : ""}`,
      `${C.dim}${description}${C.reset}`,
    ];
    log(padRight(row[0], widths[0] + 1), row[1]);
  }
  blank();
}

function fail(message) {
  logError(message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────
// Inquirer helpers
// ─────────────────────────────────────────────────────────
async function getInquirer() {
  if (!inquirerPromise) {
    inquirerPromise = import("inquirer")
      .then((mod) => mod.default || mod)
      .catch(() => null);
  }
  return inquirerPromise;
}

async function promptNumber(question, defaultValue) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const line = await rl.question(
    `${LAYOUT.headerGutter}${question} ${C.dim}[${defaultValue}]${C.reset} `
  );
  rl.close();
  const answer = line.trim();
  if (!answer) return defaultValue;
  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 0) {
    logWarn(`Invalid number, using default: ${defaultValue}`);
    return defaultValue;
  }
  return num;
}

// ─────────────────────────────────────────────────────────
// JSON helpers
// ─────────────────────────────────────────────────────────
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureJsonFileHasContent(file) {
  const current = fs.readFileSync(file, "utf8");
  if (!current.trim()) fs.writeFileSync(file, "{}");
}

// ─────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────
function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v(?=\d)/, "");
}

function getDependencyGroups(installedData) {
  const manifestPath =
    mode === "local" ? path.join(process.cwd(), "package.json") : null;
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return {
      runtime: new Set(Object.keys(installedData.dependencies || {})),
      dev: new Set(),
    };
  }

  const manifest = readJson(manifestPath);
  return {
    runtime: new Set([
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.optionalDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}),
    ]),
    dev: new Set(Object.keys(manifest.devDependencies || {})),
  };
}

function parseOverview(installedData, outdatedData) {
  const installed = installedData.dependencies || {};
  const groups = getDependencyGroups(installedData);
  return Object.keys(installed)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const current = installed[name]?.version || "(unknown)";
      const pkg = outdatedData[name] || {};
      const wanted = pkg.wanted || pkg.latest || "-";
      const update =
        normalizeVersion(wanted) !== normalizeVersion(current) ? wanted : "-";
      const dependencyType =
        groups.runtime.has(name) || !groups.dev.has(name) ? "runtime" : "dev";
      return [name, current, update, dependencyType];
    });
}

function parseChanges(beforeData, afterData) {
  const before = beforeData.dependencies || {};
  const after = afterData.dependencies || {};
  const names = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort((a, b) => a.localeCompare(b));
  return names
    .map((name) => [
      name,
      before[name]?.version || null,
      after[name]?.version || null,
    ])
    .filter(([, bv, av]) => bv !== av)
    .map(([name, bv, av]) => [
      name,
      bv || "(not installed)",
      av || "(removed)",
    ]);
}

function parseInstallScripts(afterData, packageNames, blockedInfo) {
  const after = afterData.dependencies || {};
  const infoMap = new Map(blockedInfo || []);
  return [...packageNames]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => [
      name,
      after[name]?.version || infoMap.get(name) || "(unknown)",
    ]);
}

// ─────────────────────────────────────────────────────────
// Command execution
// ─────────────────────────────────────────────────────────
function wrapWindows(command, args) {
  if (process.platform !== "win32") return { command, args };
  return { command: "cmd", args: ["/c", command, ...args] };
}

function runSpawn(command, args, options) {
  const { command: cmd, args: cmdArgs } = wrapWindows(command, args);
  return spawnSync(cmd, cmdArgs, options);
}

function needCmd(command) {
  const { command: cmd, args } = wrapWindows(command, ["--version"]);

  const result = spawnSync(cmd, args, {
    stdio: "ignore",
  });
  if (result.status !== 0) {
    fail(`Required command not found: ${C.bold}${command}${C.reset}`);
  }
}

function getNpmVersion() {
  const { command: cmd, args } = wrapWindows("npm", ["--version"]);

  const result = spawnSync(cmd, args, {
    encoding: "utf8",
  });
  if (result.status !== 0 || result.error) {
    return null;
  }
  return result.stdout.trim();
}

function isNpmVersionAtLeast(targetVersion) {
  const npmVersion = getNpmVersion();
  if (!npmVersion) return false;

  const [targetMajor, targetMinor, targetPatch] = targetVersion
    .split(".")
    .map(Number);
  const [npmMajor, npmMinor, npmPatch] = npmVersion.split(".").map(Number);

  if (npmMajor > targetMajor) return true;
  if (npmMajor < targetMajor) return false;
  if (npmMinor > targetMinor) return true;
  if (npmMinor < targetMinor) return false;
  return npmPatch >= targetPatch;
}

function runCommand(command, args, options = {}) {
  const { command: cmd, args: cmdArgs } = wrapWindows(command, args);
  const result = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    cwd: options.cwd,
    env: options.forceColor
      ? { ...process.env, npm_config_color: "always" }
      : undefined,
  });
  if (result.error) fail(`Failed to run: ${C.bold}${command}${C.reset}`);
  if (!options.allowFailure && result.status !== 0)
    process.exit(result.status || 1);
  return result;
}

function writeCommandOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function getBlockedInstallScriptPackages(result) {
  const output = stripAnsi(
    `${result.stdout || ""}\n${result.stderr || ""}`
  ).replace(/\r/g, "");
  const packages = [];
  const seen = new Set();

  for (const line of output.split("\n")) {
    const match = line.match(
      /\bnpm\s+warn\s+(?:install-scripts|allow-scripts)\s+(.+?)@([^@\s]+)\s+\(/i
    );
    if (!match) continue;
    const name = match[1];
    const version = match[2];
    if (seen.has(name)) continue;
    seen.add(name);
    packages.push([name, version]);
  }

  return packages;
}

function getInstallScriptApprovalChoices(currentMode) {
  const choices = [{ name: "Keep scripts blocked", value: "skip" }];

  if (currentMode === "global") {
    choices.push({
      name: "Select packages to allow once and reinstall",
      value: "approve",
    });
  } else {
    choices.push({
      name: "Approve in this project and rebuild affected packages",
      value: "approve",
    });
  }

  return choices;
}

function getInstallScriptApprovalCommands(
  currentMode,
  selectedPackages,
  packagesToAllow,
  npmCommandFlags,
  extraArgs
) {
  if (currentMode === "local") {
    return [
      ["install-scripts", "approve", ...packagesToAllow],
      ["rebuild", ...packagesToAllow],
    ];
  }

  return [
    [
      "install",
      ...npmCommandFlags,
      ...extraArgs,
      `--allow-scripts=${packagesToAllow.join(",")}`,
      ...selectedPackages,
    ],
  ];
}

function writeCommandJson(file, command, args, options = {}) {
  const result = runCommand(command, args, {
    capture: true,
    allowFailure: options.allowFailure,
  });
  const output = result.stdout && result.stdout.trim() ? result.stdout : "";

  if (!output) {
    if (result.status !== 0) {
      const details =
        result.stderr && result.stderr.trim()
          ? `\n${C.dim}${result.stderr.trim()}${C.reset}`
          : "";
      fail(`Failed to read npm package data.${details}`);
    }

    fs.writeFileSync(file, "{}\n");
    return result;
  }

  try {
    JSON.parse(output);
  } catch {
    const commandText = [command, ...args].join(" ");
    fail(`Invalid JSON returned by: ${C.bold}${commandText}${C.reset}`);
  }

  fs.writeFileSync(file, output);
  return result;
}

// ─────────────────────────────────────────────────────────
// Display functions
// ─────────────────────────────────────────────────────────
function printOverview(installedFile, outdatedFile) {
  const rows = parseOverview(readJson(installedFile), readJson(outdatedFile));

  if (!rows.length) {
    log(`${C.muted}No packages found.${C.reset}`);
    return;
  }

  const headers = ["Package", "Installed", "Latest"];
  const widths = getColumnWidths(headers, rows, [34, 20, 20]);

  const runtimeRows = rows.filter(
    ([, , , dependencyType]) => dependencyType !== "dev"
  );
  const devRows = rows.filter(
    ([, , , dependencyType]) => dependencyType === "dev"
  );
  const visibleRows = [...runtimeRows, ...devRows];

  log(`${C.bold}${renderRow(headers, widths)}${C.reset}`);
  if (runtimeRows.length > 0) hr();

  for (const [
    index,
    [name, current, update, dependencyType],
  ] of visibleRows.entries()) {
    if (dependencyType === "dev" && index === runtimeRows.length) {
      hrLabel("dev");
    }

    const currentColor = update === "-" ? C.success : C.danger;
    const updateColor = update === "-" ? C.muted : C.update;
    log(
      renderRow([name, current, update], widths, [
        (padded) => `${C.pkgName}${padded}${C.reset}`,
        (padded) => `${currentColor}${padded}${C.reset}`,
        (padded) => `${updateColor}${padded}${C.reset}`,
      ])
    );
  }
  hr();
  blank();
}

function printChanges(beforeFile, afterFile, title) {
  const rows = parseChanges(readJson(beforeFile), readJson(afterFile));
  blank();
  log(`${C.bold}${C.header}${title}${C.reset}`);

  if (!rows.length) {
    log(`${C.muted}No version changes detected.${C.reset}`);
    return;
  }

  const headers = ["Package", "Before", "After"];
  const widths = getColumnWidths(headers, rows, [30, 22, 22]);

  log(`${C.bold}${renderRow(headers, widths)}${C.reset}`);

  for (const [name, beforeVersion, afterVersion] of rows) {
    log(
      renderRow([name, beforeVersion, afterVersion], widths, [
        (padded) => `${C.pkgName}${padded}${C.reset}`,
        (padded) => `${C.danger}${padded}${C.reset}`,
        (padded) => `${C.success}${padded}${C.reset}`,
      ])
    );
  }
  blank();
}

function printInstallScripts(afterFile, packageNames, blockedInfo, title) {
  const rows = parseInstallScripts(
    readJson(afterFile),
    packageNames,
    blockedInfo
  );
  blank();
  log(`${C.bold}${C.header}${title}${C.reset}`);

  if (!rows.length) {
    log(`${C.muted}No install scripts executed.${C.reset}`);
    return;
  }

  const headers = ["Package", "Version"];
  const widths = getColumnWidths(headers, rows, [30, 22]);

  log(`${C.bold}${renderRow(headers, widths)}${C.reset}`);

  for (const [name, version] of rows) {
    log(
      renderRow([name, version], widths, [
        (padded) => `${C.pkgName}${padded}${C.reset}`,
        (padded) => `${C.version}${padded}${C.reset}`,
      ])
    );
  }
  blank();
}

// ─────────────────────────────────────────────────────────
// Interactive selection
// ─────────────────────────────────────────────────────────
async function promptAction(inquirer, minReleaseAgeSet, supportsMinReleaseAge) {
  if (!inquirer) return null;

  const choices = [
    { name: "Update all packages", value: "update-all" },
    { name: "Update selected packages", value: "update-selected" },
    { name: "Uninstall selected packages", value: "uninstall-selected" },
  ];

  if (!minReleaseAgeSet && supportsMinReleaseAge) {
    choices.push({
      name: "Set min-release-age (recommended — protects against supply chain attacks)",
      value: "set-min-release-age",
    });
  }

  choices.push({ name: "Quit", value: "quit" });

  const { action } = await inquirer.prompt([
    {
      type: "rawlist",
      name: "action",
      message: "Select an action",
      choices,
    },
  ]);

  return action || "quit";
}

async function selectPackages(
  inquirer,
  rows,
  message = "Select packages",
  defaultChecked = true
) {
  if (!rows.length) {
    log(`${C.muted}No packages available.${C.reset}`);
    return [];
  }

  if (!inquirer) {
    logError(
      `Local ${C.bold}inquirer${C.reset} dependency is required for interactive selection.`
    );
    log(
      `${C.dim}Run this tool from the project with dependencies installed.${C.reset}`
    );
    return [];
  }

  const nameWidth = clamp(
    Math.max(...rows.map(([name]) => name.length), 7),
    7,
    28
  );
  const versionWidth = clamp(
    Math.max(...rows.map(([, current]) => current.length), 1),
    1,
    18
  );

  const { packages } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "packages",
      message,
      choices: rows.map(([name, current, update]) => ({
        name:
          `${C.pkgName}${fitText(name, nameWidth)}${C.reset} ` +
          `${C.dim}${padRight(fitText(current, versionWidth), versionWidth)}${C.reset} ${C.muted}->${C.reset} ` +
          `${update === "-" ? C.muted : C.update}${update}${C.reset}`,
        value: name,
        checked: defaultChecked,
      })),
      pageSize: 12,
    },
  ]);

  return packages || [];
}

// ─────────────────────────────────────────────────────────
// npm config helpers
// ─────────────────────────────────────────────────────────
function getNpmGlobalConfigPath() {
  const { command, args } = wrapWindows("npm", [
    "config",
    "get",
    "globalconfig",
  ]);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value === "undefined" || value === "null" || value === ""
    ? null
    : value;
}

function getNpmUserConfigPath() {
  const { command, args } = wrapWindows("npm", ["config", "get", "userconfig"]);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (result.status !== 0) return path.join(os.homedir(), ".npmrc");
  const value = result.stdout.trim();
  return value === "undefined" || value === "null" || value === ""
    ? path.join(os.homedir(), ".npmrc")
    : value;
}

function readNpmConfigValue(filePath, key) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "").trim();
      if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#"))
        continue;
      const match = trimmed.match(/^([^=]+?)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      if (match[1].trim() !== key) continue;
      return match[2].trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

function checkMinReleaseAge(globalMode) {
  const localConfigPath = path.join(process.cwd(), ".npmrc");
  const userConfigPath = getNpmUserConfigPath();
  const globalConfigPath = getNpmGlobalConfigPath();
  const sources = globalMode
    ? [
        { filePath: userConfigPath, source: "global" },
        { filePath: globalConfigPath, source: "system" },
      ]
    : [
        { filePath: localConfigPath, source: "local" },
        { filePath: userConfigPath, source: "global" },
        { filePath: globalConfigPath, source: "system" },
      ];

  for (const { filePath, source } of sources) {
    if (!filePath) continue;
    const value = readNpmConfigValue(filePath, "min-release-age");
    if (value !== null) return { value, filePath, source };
  }
  return null;
}

function setNpmConfig(key, value, globalMode = false) {
  const args = globalMode
    ? ["config", "set", "-g", key, String(value)]
    : ["config", "set", key, String(value)];
  const { command, args: cmdArgs } = wrapWindows("npm", args);
  const result = spawnSync(command, cmdArgs, {
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status === 0;
}

// ─────────────────────────────────────────────────────────
// Mode configuration
// ─────────────────────────────────────────────────────────
function getModeConfig(currentMode) {
  const minReleaseAgeFlag = bypassMinReleaseAge ? ["--min-release-age=0"] : [];

  if (currentMode === "global") {
    return {
      title: "Global top-level packages",
      npmFlags: ["-g"],
      listArgs: ["ls", "-g", "--depth=0", "--json"],
      outdatedArgs: [
        "outdated",
        "-g",
        "--depth=0",
        "--json",
        ...minReleaseAgeFlag,
      ],
    };
  }

  return {
    title: "Local top-level packages",
    npmFlags: [],
    listArgs: ["ls", "--depth=0", "--json"],
    outdatedArgs: ["outdated", "--depth=0", "--json", ...minReleaseAgeFlag],
  };
}

// ─────────────────────────────────────────────────────────
// Core operation
// ─────────────────────────────────────────────────────────
async function runPackageCommand(
  command,
  selectedPackages,
  npmCommandFlags,
  beforeJson,
  afterJson,
  listArgs,
  inquirer,
  currentMode
) {
  const flagText = npmCommandFlags.length
    ? ` ${npmCommandFlags.join(" ")}`
    : "";
  const extraArgs =
    bypassMinReleaseAge && command !== "uninstall"
      ? ["--min-release-age=0"]
      : [];

  blank();
  log(
    `${C.bold}${C.header}${command === "uninstall" ? "Removing packages" : "Updating packages"}${C.reset}`
  );

  log(
    `${C.dim}$ npm ${command}${flagText}${extraArgs.length ? " --min-release-age=0" : ""} ${selectedPackages.join(" ")}${C.reset}`
  );
  blank();

  const commandArgs = [
    command,
    ...npmCommandFlags,
    ...extraArgs,
    ...selectedPackages,
  ];
  let result = runCommand("npm", commandArgs, {
    capture: true,
    allowFailure: true,
    forceColor: true,
  });
  writeCommandOutput(result);

  if (result.status !== 0) process.exit(result.status || 1);

  const blockedPackages =
    command === "update" ? getBlockedInstallScriptPackages(result) : [];
  let executedInstallScripts = [];

  if (blockedPackages.length > 0) {
    blank();
    logWarn(
      `${blockedPackages.length} package(s) had install scripts blocked by npm.`
    );
    logDetail(
      `${C.dim}Only allow install scripts from packages you trust.${C.reset}`
    );
    blank();

    const { allowAction } = await inquirer.prompt([
      {
        type: "select",
        name: "allowAction",
        message: "How should npm handle these install scripts?",
        default: "skip",
        choices: getInstallScriptApprovalChoices(currentMode),
      },
    ]);

    if (allowAction !== "skip") {
      const { packagesToAllow } = await inquirer.prompt([
        {
          type: "checkbox",
          name: "packagesToAllow",
          message: "Select packages whose install scripts you trust",
          choices: blockedPackages.map(([packageName]) => ({
            name: packageName,
            value: packageName,
            checked: false,
          })),
          pageSize: 12,
        },
      ]);

      if (!packagesToAllow.length) {
        logInfo("No install scripts selected — keeping all scripts blocked.");
      } else {
        const approvalCommands = getInstallScriptApprovalCommands(
          currentMode,
          selectedPackages,
          packagesToAllow,
          npmCommandFlags,
          extraArgs
        );

        for (const approvalArgs of approvalCommands) {
          blank();
          log(`${C.dim}$ npm ${approvalArgs.join(" ")}${C.reset}`);
          blank();
          result = runCommand("npm", approvalArgs, {
            capture: true,
            allowFailure: true,
            forceColor: true,
          });
          writeCommandOutput(result);
          if (result.status !== 0) process.exit(result.status || 1);
        }
        executedInstallScripts = packagesToAllow;
      }
    }
  }

  writeCommandJson(afterJson, "npm", listArgs);

  printChanges(
    beforeJson,
    afterJson,
    command === "uninstall" ? "Removed packages" : "Updated packages"
  );

  if (executedInstallScripts.length > 0) {
    printInstallScripts(
      afterJson,
      executedInstallScripts,
      blockedPackages,
      "Install scripts executed"
    );
  }

  logSuccess("Operation completed successfully.");
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
async function main() {
  needCmd("npm");
  needCmd("node");

  // ── Validate environment ──
  if (
    mode === "local" &&
    !fs.existsSync(path.join(process.cwd(), "package.json"))
  ) {
    fail(
      `No package.json found in this directory.\n${C.dim}Tip: run inside a Node project, or use ${C.bold}-g${C.reset} ${C.dim}for global mode.${C.reset}`
    );
  }

  // ── Setup temp directory ──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-updater-"));
  const beforeJson = path.join(tmpDir, "before.json");
  const afterJson = path.join(tmpDir, "after.json");
  const outdatedJson = path.join(tmpDir, "outdated.json");

  process.on("exit", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const modeConfig = getModeConfig(mode);

  // ── min-release-age status ──
  const minReleaseAgeResult = checkMinReleaseAge(mode === "global");
  const minReleaseAgeSet = minReleaseAgeResult !== null;
  const minReleaseAgeValue = minReleaseAgeSet
    ? minReleaseAgeResult.value
    : null;

  // ── Header ──
  blank();
  writeHeaderLine(
    `${C.bold}${C.header}NPM Smart Update ${VERSION}${C.reset}`
  );
  headerRow(
    "Mode:",
    mode === "local"
      ? `${C.info}${modeConfig.title}${C.reset}`
      : `${C.info}${modeConfig.title}${C.reset}`,
    mode === "local"
      ? `${C.dim}${shortenHomePath(process.cwd())}${C.reset}`
      : ""
  );
  if (bypassMinReleaseAge) {
    headerRow("Min age:", `${C.warning}bypassed for this run${C.reset}`);
  } else if (!minReleaseAgeSet) {
    headerRow("Min age:", `${C.warning}not configured${C.reset}`);
  } else {
    headerRow(
      "Min age:",
      `${C.info}${minReleaseAgeValue} day(s)${C.reset}`,
      `${C.dim}(${minReleaseAgeResult.source})${C.reset}`
    );
  }
  blank();

  // ── Collect state ──
  const beforeResult = writeCommandJson(
    beforeJson,
    "npm",
    modeConfig.listArgs,
    { allowFailure: true }
  );
  if (beforeResult.status !== 0) {
    const nodeModulesDir = path.join(process.cwd(), "node_modules");
    if (!fs.existsSync(nodeModulesDir)) {
      fail(
        `No node_modules directory found.\n${C.dim}Tip: run ${C.bold}npm install${C.reset} ${C.dim}first.${C.reset}`
      );
    }
    ensureJsonFileHasContent(beforeJson);
  }

  const outdatedResult = writeCommandJson(
    outdatedJson,
    "npm",
    modeConfig.outdatedArgs,
    { allowFailure: true }
  );
  if (outdatedResult.status !== 0) ensureJsonFileHasContent(outdatedJson);

  // ── Show overview ──
  printOverview(beforeJson, outdatedJson);

  const overviewRows = parseOverview(
    readJson(beforeJson),
    readJson(outdatedJson)
  );
  const updateRows = overviewRows.filter(([, current, update]) => {
    return (
      update !== "-" && normalizeVersion(update) !== normalizeVersion(current)
    );
  });

  // ── Nothing outdated ──
  if (updateRows.length === 0) {
    logSuccess("All packages are already up to date.");
    process.exit(0);
  }

  writeStatus(
    process.stdout,
    "UPDATE",
    C.warning,
    `${updateRows.length} package(s) have updates available.`
  );
  blank();

  // ── Interactive or batch mode ──
  const inquirer = await getInquirer();

  if (!inquirer) {
    fail(
      `Local ${C.bold}inquirer${C.reset} dependency is missing.\n${C.dim}Run this tool from the repo with dependencies installed.${C.reset}`
    );
  }

  const supportsMinReleaseAge = isNpmVersionAtLeast("11.10.0");
  const action = await promptAction(
    inquirer,
    minReleaseAgeSet,
    supportsMinReleaseAge
  );

  if (action === "quit") {
    logInfo("Exiting. No changes made.");
    process.exit(0);
  }

  if (action === "set-min-release-age") {
    const targetFile = getNpmGlobalConfigPath() || "~/.npmrc";

    blank();
    log(`${C.bold}${C.header}Configure min-release-age${C.reset}`);
    log(
      `${C.dim}This setting prevents npm from installing packages published less than${C.reset}`
    );
    log(
      `${C.dim}N days ago. Recommended value: ${C.bold}1${C.reset}${C.dim} (gives time for malicious packages to be detected).${C.reset}`
    );
    log(
      `${C.dim}This tool saves min-release-age to npm global config, shared across projects.${C.reset}`
    );
    log(`${C.dim}Will be saved to: ${targetFile}${C.reset}`);
    blank();

    const days = await promptNumber("Enter number of days (0 to disable):", 1);

    if (setNpmConfig("min-release-age", days, true)) {
      blank();
      logSuccess(`min-release-age set to: ${C.bold}${days} day(s)${C.reset}`);
      logDetail(`${C.dim}Saved to: ${targetFile}${C.reset}`);
      logDetail(`${C.dim}Re-run this tool to continue.${C.reset}`);
    } else {
      blank();
      logError("Failed to set min-release-age.");
    }
    process.exit(0);
  }

  let command = "update";
  let selectedPackages = [];

  if (action === "update-all") {
    selectedPackages = updateRows.map(([name]) => name);
  } else if (action === "update-selected") {
    selectedPackages = await selectPackages(
      inquirer,
      updateRows,
      "Select packages to update"
    );
  } else if (action === "uninstall-selected") {
    command = "uninstall";
    selectedPackages = await selectPackages(
      inquirer,
      overviewRows,
      "Select packages to uninstall",
      false
    );
  }

  if (!selectedPackages.length) {
    logInfo("No packages selected — exiting.");
    process.exit(0);
  }

  await runPackageCommand(
    command,
    selectedPackages,
    modeConfig.npmFlags,
    beforeJson,
    afterJson,
    modeConfig.listArgs,
    inquirer,
    mode
  );
}

// ─────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────
if (require.main === module) {
  for (const arg of process.argv.slice(2)) {
    switch (arg) {
      case "-g":
      case "--global":
        mode = "global";
        break;
      case "--local":
        mode = "local";
        break;
      case "-b":
      case "--bypass-age":
        bypassMinReleaseAge = true;
        break;
      case "-v":
      case "--version":
        log(VERSION);
        process.exit(0);
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      default:
        logError(`Unknown option: ${C.bold}${arg}${C.reset}`);
        usage();
        process.exit(1);
    }
  }

  main().catch((error) => {
    fail(error?.message || error);
  });
}

module.exports = {
  getBlockedInstallScriptPackages,
  getInstallScriptApprovalCommands,
  getInstallScriptApprovalChoices,
  stripAnsi,
};
