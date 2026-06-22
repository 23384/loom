"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => loomPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");
var import_state = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var import_path7 = require("path");

// src/execution/containerRunner.ts
var import_obsidian = require("obsidian");
var import_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_path2 = require("path");

// src/execution/processRunner.ts
var import_promises = require("fs/promises");
var import_os = require("os");
var import_path = require("path");
var import_child_process = require("child_process");
async function withNamedTempSourceFile(fileName, source, callback) {
  const tempDir = await (0, import_promises.mkdtemp)((0, import_path.join)((0, import_os.tmpdir)(), "loom-"));
  const tempFile = (0, import_path.join)(tempDir, fileName);
  try {
    await (0, import_promises.writeFile)(tempFile, normalizeExecutableSource(source), "utf8");
    return await callback({ tempDir, tempFile });
  } finally {
    await (0, import_promises.rm)(tempDir, { recursive: true, force: true });
  }
}
async function withTempSourceFile(fileExtension, source, callback) {
  return withNamedTempSourceFile(`snippet${fileExtension}`, source, callback);
}
function normalizeExecutableSource(source) {
  const lines = source.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (!nonEmptyLines.length) {
    return source;
  }
  let sharedIndent = getLeadingWhitespace(nonEmptyLines[0]);
  for (const line of nonEmptyLines.slice(1)) {
    sharedIndent = sharedWhitespacePrefix(sharedIndent, getLeadingWhitespace(line));
    if (!sharedIndent) {
      return source;
    }
  }
  if (!sharedIndent) {
    return source;
  }
  return lines.map((line) => line.trim().length === 0 ? line : line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line).join("\n");
}
function getLeadingWhitespace(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function sharedWhitespacePrefix(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return left.slice(0, index);
}
async function runProcess(spec) {
  const startedAt = /* @__PURE__ */ new Date();
  let stdout = "";
  let stderr = "";
  let exitCode = null;
  let timedOut = false;
  let cancelled = false;
  let child = null;
  let timeoutHandle = null;
  let abortHandler = null;
  try {
    await new Promise((resolve, reject) => {
      child = (0, import_child_process.spawn)(spec.executable, spec.args, {
        cwd: spec.workingDirectory,
        shell: false,
        env: {
          ...process.env,
          ...spec.env
        }
      });
      const abort = () => {
        cancelled = true;
        child?.kill("SIGTERM");
      };
      abortHandler = abort;
      if (spec.signal.aborted) {
        abort();
      } else {
        spec.signal.addEventListener("abort", abort, { once: true });
      }
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child?.kill("SIGTERM");
      }, spec.timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        exitCode = code;
        resolve();
      });
    });
  } catch (error) {
    stderr = stderr || formatProcessError(error, spec.executable);
    exitCode = exitCode ?? -1;
  } finally {
    if (abortHandler) {
      spec.signal.removeEventListener("abort", abortHandler);
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  const finishedAt = /* @__PURE__ */ new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const success = !timedOut && !cancelled && exitCode === 0;
  return {
    runnerId: spec.runnerId,
    runnerName: spec.runnerName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    exitCode,
    stdout,
    stderr,
    success,
    timedOut,
    cancelled
  };
}
function formatProcessError(error, executable) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return `Executable not found: ${executable}`;
  }
  return error instanceof Error ? error.message : String(error);
}
async function runTempFileProcess(spec) {
  return withTempSourceFile(
    spec.fileExtension,
    spec.source,
    async ({ tempFile, tempDir }) => runProcess({
      runnerId: spec.runnerId,
      runnerName: spec.runnerName,
      executable: spec.executable,
      args: spec.args.map((value) => value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir)),
      workingDirectory: spec.workingDirectory,
      timeoutMs: spec.timeoutMs,
      signal: spec.signal,
      env: expandTemplatedEnv(spec.env, tempFile, tempDir)
    })
  );
}
function expandTemplatedEnv(env, tempFile, tempDir) {
  if (!env) {
    return void 0;
  }
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir) : value
    ])
  );
}

// src/utils/command.ts
function splitCommandLine(input) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

// src/execution/containerRunner.ts
var loomContainerRunner = class {
  constructor(app, pluginDir) {
    this.app = app;
    this.pluginDir = pluginDir;
    this.builtImages = /* @__PURE__ */ new Set();
  }
  getContainerGroupName(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["loom-container"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  async getGroupSummaries() {
    const containersPath = this.getContainersPath();
    if (!(0, import_fs.existsSync)(containersPath)) {
      return [];
    }
    const { readdir } = await import("fs/promises");
    const entries = await readdir(containersPath, { withFileTypes: true });
    return Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const groupPath = (0, import_path2.join)(containersPath, entry.name);
        const hasConfig = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "config.json"));
        const hasDockerfile = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"));
        if (!hasConfig) {
          return {
            name: entry.name,
            status: "missing config.json"
          };
        }
        try {
          const config = await this.readConfig(groupPath);
          const pieces = [`runtime: ${config.runtime}`];
          if ((config.runtime === "docker" || config.runtime === "podman") && hasDockerfile) {
            pieces.push("Dockerfile");
          }
          if (config.runtime === "qemu" && config.qemu?.sshTarget) {
            pieces.push(`ssh: ${config.qemu.sshTarget}`);
          }
          if (config.runtime === "custom" && config.custom?.executable) {
            pieces.push(`wrapper: ${config.custom.executable}`);
          }
          const languageCount = Object.keys(config.languages).length;
          pieces.push(`${languageCount} language${languageCount === 1 ? "" : "s"}`);
          return {
            name: entry.name,
            status: pieces.join(", ")
          };
        } catch (error) {
          return {
            name: entry.name,
            status: `invalid config.json: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      })
    );
  }
  async run(block, context, settings, groupName) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const language = config.languages[block.language] ?? config.languages[block.languageAlias];
    if (!language) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = (0, import_path2.join)(groupPath, tempFileName);
    try {
      await (0, import_promises2.writeFile)(tempFilePath, block.content, "utf8");
      switch (config.runtime) {
        case "docker":
        case "podman":
          return await this.runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings);
        case "qemu":
          return await this.runQemu(groupName, groupPath, config, language, tempFileName, context);
        case "custom":
          return await this.runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context);
      }
    } finally {
      await (0, import_promises2.rm)(tempFilePath, { force: true });
    }
  }
  async buildGroup(groupName, timeoutMs, signal) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    switch (config.runtime) {
      case "docker":
      case "podman":
        return this.buildImage(groupName, groupPath, config, timeoutMs, signal);
      case "qemu":
        return this.buildQemu(groupName, groupPath, config, timeoutMs, signal);
      case "custom":
        return this.runCustomWrapper(groupName, groupPath, config, this.createCustomRequest("build", groupName, groupPath, config, timeoutMs), timeoutMs, signal);
    }
  }
  async runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings) {
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const command = splitCommandLine(language.command.replaceAll("{file}", tempFileName));
    if (!command.length) {
      throw new Error("Container command is empty.");
    }
    return await runProcess({
      runnerId: `container:${groupName}`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName}`,
      executable: this.runtimeExecutable(config),
      args: [
        "run",
        "--rm",
        "-v",
        `${groupPath}:/workspace`,
        "-w",
        "/workspace",
        image,
        ...command
      ],
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  async runQemu(groupName, groupPath, config, language, tempFileName, context) {
    const qemu = this.requireQemuConfig(config);
    await this.runOptionalCommand(qemu.startCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:start`, `QEMU ${groupName} start`);
    await this.runHealthCheck(qemu.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:health`, `QEMU ${groupName} health check`);
    try {
      const remoteFile = import_path2.posix.join(qemu.remoteWorkspace, tempFileName);
      const remoteCommand = language.command.replaceAll("{file}", shellQuote(remoteFile));
      if (!remoteCommand.trim()) {
        throw new Error("QEMU command is empty.");
      }
      return await runProcess({
        runnerId: `container:${groupName}:qemu`,
        runnerName: `QEMU ${groupName}`,
        executable: qemu.sshExecutable || "ssh",
        args: [
          ...splitCommandLine(qemu.sshArgs || ""),
          qemu.sshTarget,
          `cd ${shellQuote(qemu.remoteWorkspace)} && ${remoteCommand}`
        ],
        workingDirectory: groupPath,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    } finally {
      await this.runOptionalCommand(qemu.teardownCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:teardown`, `QEMU ${groupName} teardown`);
    }
  }
  async runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context) {
    const command = language.command.replaceAll("{file}", tempFileName);
    const result = await this.runCustomWrapper(
      groupName,
      groupPath,
      config,
      this.createCustomRequest("run", groupName, groupPath, config, context.timeoutMs, {
        language: block.language,
        languageAlias: block.languageAlias,
        fileName: tempFileName,
        filePath: tempFilePath,
        command
      }),
      context.timeoutMs,
      context.signal
    );
    if (config.custom?.teardown) {
      const teardown = await this.runCustomWrapper(
        groupName,
        groupPath,
        config,
        this.createCustomRequest("teardown", groupName, groupPath, config, context.timeoutMs, {
          language: block.language,
          languageAlias: block.languageAlias,
          fileName: tempFileName,
          filePath: tempFilePath,
          command
        }),
        context.timeoutMs,
        context.signal
      );
      if (!teardown.success) {
        result.warning = `Custom runtime teardown failed: ${teardown.stderr || teardown.stdout || `exit ${teardown.exitCode}`}`;
      }
    }
    return result;
  }
  async resolveImage(groupName, groupPath, config, context, settings) {
    const dockerfile = (0, import_path2.join)(groupPath, "Dockerfile");
    if (!(0, import_fs.existsSync)(dockerfile)) {
      return config.image || "ubuntu:latest";
    }
    const image = this.imageNameForGroup(groupName);
    const cacheKey = `${this.runtimeExecutable(config)}:${image}`;
    if (this.builtImages.has(cacheKey)) {
      return image;
    }
    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 12e4), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `${runtimeLabel(config.runtime)} build failed for ${groupName}.`);
    }
    this.builtImages.add(cacheKey);
    return image;
  }
  async buildImage(groupName, groupPath, config, timeoutMs, signal) {
    const image = this.imageNameForGroup(groupName);
    if (!(0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"))) {
      return this.createSyntheticResult(
        `container:${groupName}:build`,
        `${runtimeLabel(config.runtime)} ${groupName} build`,
        `No Dockerfile configured. Using image ${config.image || "ubuntu:latest"}.
`
      );
    }
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName} build`,
      executable: this.runtimeExecutable(config),
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal
    });
  }
  async buildQemu(groupName, groupPath, config, timeoutMs, signal) {
    const qemu = this.requireQemuConfig(config);
    if (!qemu.buildCommand?.trim()) {
      return this.createSyntheticResult(`container:${groupName}:qemu:build`, `QEMU ${groupName} build`, "No QEMU build command configured.\n");
    }
    return this.runCommandLine(qemu.buildCommand, groupPath, timeoutMs, signal, `container:${groupName}:qemu:build`, `QEMU ${groupName} build`);
  }
  async readConfig(groupPath) {
    const configPath = (0, import_path2.join)(groupPath, "config.json");
    let raw;
    try {
      raw = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read container config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Container config must be an object.");
    }
    const data = raw;
    const runtime = this.readRuntime(data.runtime);
    if (data.executable != null && typeof data.executable !== "string") {
      throw new Error("Container config executable must be a string.");
    }
    if (data.image != null && typeof data.image !== "string") {
      throw new Error("Container config image must be a string.");
    }
    if (!data.languages || typeof data.languages !== "object" || Array.isArray(data.languages)) {
      throw new Error("Container config languages must be an object.");
    }
    const languages = {};
    for (const [language, value] of Object.entries(data.languages)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Container language ${language} must be an object.`);
      }
      const languageConfig = value;
      if (typeof languageConfig.command !== "string" || !languageConfig.command.trim()) {
        throw new Error(`Container language ${language} must define command.`);
      }
      languages[language] = {
        command: languageConfig.command,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : `.${language}`
      };
    }
    return {
      runtime,
      executable: typeof data.executable === "string" && data.executable.trim() ? data.executable.trim() : void 0,
      image: typeof data.image === "string" ? data.image : void 0,
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config healthCheck"),
      qemu: this.readQemuConfig(data.qemu),
      custom: this.readCustomConfig(data.custom),
      languages
    };
  }
  readRuntime(value) {
    if (value == null) {
      return "docker";
    }
    if (value === "docker" || value === "podman" || value === "qemu" || value === "custom") {
      return value;
    }
    throw new Error("Container config runtime must be docker, podman, qemu, or custom.");
  }
  readQemuConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu must be an object.");
    }
    const data = value;
    if (typeof data.sshTarget !== "string" || !data.sshTarget.trim()) {
      throw new Error("Container config qemu.sshTarget must be a string.");
    }
    if (typeof data.remoteWorkspace !== "string" || !data.remoteWorkspace.trim()) {
      throw new Error("Container config qemu.remoteWorkspace must be a string.");
    }
    return {
      sshTarget: data.sshTarget.trim(),
      remoteWorkspace: data.remoteWorkspace.trim(),
      sshExecutable: optionalString(data.sshExecutable),
      sshArgs: optionalString(data.sshArgs),
      startCommand: optionalString(data.startCommand),
      buildCommand: optionalString(data.buildCommand),
      teardownCommand: optionalString(data.teardownCommand),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config qemu.healthCheck")
    };
  }
  readCustomConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config custom must be an object.");
    }
    const data = value;
    if (typeof data.executable !== "string" || !data.executable.trim()) {
      throw new Error("Container config custom.executable must be a string.");
    }
    return {
      executable: data.executable.trim(),
      args: optionalString(data.args),
      build: optionalString(data.build),
      commandStructure: optionalString(data.commandStructure),
      teardown: optionalString(data.teardown),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config custom.healthCheck")
    };
  }
  readHealthCheck(value, label) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    const data = value;
    if (typeof data.command !== "string" || !data.command.trim()) {
      throw new Error(`${label}.command must be a string.`);
    }
    return {
      command: data.command.trim(),
      positiveResponse: optionalString(data.positiveResponse ?? data.positive_response ?? data["positive response"] ?? data.possitiveResponse),
      negativeResponse: optionalString(data.negativeResponse ?? data.negative_response ?? data["negative response"])
    };
  }
  requireQemuConfig(config) {
    if (!config.qemu) {
      throw new Error("QEMU runtime requires a qemu config object.");
    }
    return config.qemu;
  }
  requireCustomConfig(config) {
    if (!config.custom) {
      throw new Error("Custom runtime requires a custom config object.");
    }
    return config.custom;
  }
  runtimeExecutable(config) {
    if (config.executable?.trim()) {
      return config.executable.trim();
    }
    return config.runtime === "podman" ? "podman" : "docker";
  }
  async runHealthCheck(healthCheck, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!healthCheck) {
      return;
    }
    const result = await this.runCommandLine(healthCheck.command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    const combinedOutput = `${result.stdout}
${result.stderr}`;
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
    if (healthCheck.negativeResponse && combinedOutput.includes(healthCheck.negativeResponse)) {
      throw new Error(`${runnerName} returned negative response: ${healthCheck.negativeResponse}`);
    }
    if (healthCheck.positiveResponse && !combinedOutput.includes(healthCheck.positiveResponse)) {
      throw new Error(`${runnerName} did not return positive response: ${healthCheck.positiveResponse}`);
    }
  }
  async runOptionalCommand(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!command?.trim()) {
      return;
    }
    const result = await this.runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }
  async runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    const parts = splitCommandLine(command);
    if (!parts.length) {
      throw new Error(`${runnerName} command is empty.`);
    }
    return runProcess({
      runnerId,
      runnerName,
      executable: parts[0],
      args: parts.slice(1),
      workingDirectory,
      timeoutMs,
      signal
    });
  }
  async runCustomWrapper(groupName, groupPath, config, request, timeoutMs, signal) {
    const custom = this.requireCustomConfig(config);
    await this.runHealthCheck(custom.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:custom:health`, `Custom ${groupName} health check`);
    const requestFileName = `request_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    const requestPath = (0, import_path2.join)(groupPath, requestFileName);
    try {
      await (0, import_promises2.writeFile)(requestPath, `${JSON.stringify(request, null, 2)}
`, "utf8");
      const args = splitCommandLine(custom.args || "{request}").map(
        (arg) => arg.replaceAll("{request}", requestPath).replaceAll("{group}", groupName).replaceAll("{groupPath}", groupPath)
      );
      return await runProcess({
        runnerId: `container:${groupName}:custom:${request.action}`,
        runnerName: `Custom ${groupName} ${request.action}`,
        executable: custom.executable,
        args,
        workingDirectory: groupPath,
        timeoutMs,
        signal
      });
    } finally {
      await (0, import_promises2.rm)(requestPath, { force: true });
    }
  }
  createCustomRequest(action, groupName, groupPath, config, timeoutMs, extra = {}) {
    return {
      action,
      groupName,
      groupPath,
      runtime: config.runtime,
      image: config.image,
      build: config.custom?.build,
      commandStructure: config.custom?.commandStructure,
      teardown: config.custom?.teardown,
      timeoutMs,
      config: {
        executable: config.executable,
        custom: config.custom,
        qemu: config.qemu,
        healthCheck: config.healthCheck
      },
      ...extra
    };
  }
  createSyntheticResult(runnerId, runnerName, stdout, success = true) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      runnerId,
      runnerName,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      exitCode: success ? 0 : -1,
      stdout,
      stderr: "",
      success,
      timedOut: false,
      cancelled: false
    };
  }
  getContainersPath() {
    const adapterBasePath = this.app.vault.adapter.basePath ?? "";
    return (0, import_path2.normalize)((0, import_path2.join)(adapterBasePath, this.pluginDir, "containers"));
  }
  resolveGroupPath(groupName) {
    const safeName = (0, import_path2.basename)(groupName);
    if (!safeName || safeName !== groupName) {
      throw new Error(`Invalid container group name: ${groupName}`);
    }
    return (0, import_path2.normalize)((0, import_path2.join)(this.getContainersPath(), safeName));
  }
  imageNameForGroup(groupName) {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
};
function normalizeExtension(extension) {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function runtimeLabel(runtime) {
  switch (runtime) {
    case "docker":
      return "Docker";
    case "podman":
      return "Podman";
    case "qemu":
      return "QEMU";
    case "custom":
      return "Custom";
  }
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// src/llvmHighlight.ts
var import_view = require("@codemirror/view");
var LLVM_KEYWORDS = new Map([
  ...mapWords("loom-llvm-keyword-control", [
    "ret",
    "br",
    "switch",
    "indirectbr",
    "invoke",
    "callbr",
    "resume",
    "unreachable",
    "cleanupret",
    "catchret",
    "catchswitch"
  ]),
  ...mapWords("loom-llvm-keyword-declaration", [
    "define",
    "declare",
    "type",
    "global",
    "constant",
    "alias",
    "ifunc",
    "comdat",
    "attributes",
    "section",
    "gc",
    "prefix",
    "prologue",
    "personality",
    "uselistorder",
    "uselistorder_bb",
    "module",
    "asm",
    "source_filename",
    "target"
  ]),
  ...mapWords("loom-llvm-keyword-memory", [
    "alloca",
    "load",
    "store",
    "getelementptr",
    "fence",
    "cmpxchg",
    "atomicrmw",
    "extractvalue",
    "insertvalue",
    "extractelement",
    "insertelement",
    "shufflevector"
  ]),
  ...mapWords("loom-llvm-keyword-arithmetic", [
    "add",
    "sub",
    "mul",
    "udiv",
    "sdiv",
    "urem",
    "srem",
    "shl",
    "lshr",
    "ashr",
    "and",
    "or",
    "xor",
    "fneg",
    "fadd",
    "fsub",
    "fmul",
    "fdiv",
    "frem"
  ]),
  ...mapWords("loom-llvm-keyword-comparison", ["icmp", "fcmp"]),
  ...mapWords("loom-llvm-keyword-cast", [
    "trunc",
    "zext",
    "sext",
    "fptrunc",
    "fpext",
    "fptoui",
    "fptosi",
    "uitofp",
    "sitofp",
    "ptrtoint",
    "inttoptr",
    "bitcast",
    "addrspacecast"
  ]),
  ...mapWords("loom-llvm-keyword-other", ["phi", "select", "freeze", "call", "landingpad", "catchpad", "cleanuppad", "va_arg"]),
  ...mapWords("loom-llvm-keyword-modifier", [
    "private",
    "internal",
    "available_externally",
    "linkonce",
    "weak",
    "common",
    "appending",
    "extern_weak",
    "linkonce_odr",
    "weak_odr",
    "external",
    "default",
    "hidden",
    "protected",
    "dllimport",
    "dllexport",
    "dso_local",
    "dso_preemptable",
    "externally_initialized",
    "thread_local",
    "localdynamic",
    "initialexec",
    "localexec",
    "unnamed_addr",
    "local_unnamed_addr",
    "atomic",
    "unordered",
    "monotonic",
    "acquire",
    "release",
    "acq_rel",
    "seq_cst",
    "syncscope",
    "volatile",
    "singlethread",
    "ccc",
    "fastcc",
    "coldcc",
    "webkit_jscc",
    "anyregcc",
    "preserve_mostcc",
    "preserve_allcc",
    "cxx_fast_tlscc",
    "swiftcc",
    "tailcc",
    "cfguard_checkcc",
    "tail",
    "musttail",
    "notail",
    "fast",
    "nnan",
    "ninf",
    "nsz",
    "arcp",
    "contract",
    "afn",
    "reassoc",
    "nuw",
    "nsw",
    "exact",
    "inbounds",
    "to",
    "x"
  ]),
  ...mapWords("loom-llvm-predicate", [
    "eq",
    "ne",
    "ugt",
    "uge",
    "ult",
    "ule",
    "sgt",
    "sge",
    "slt",
    "sle",
    "oeq",
    "ogt",
    "oge",
    "olt",
    "ole",
    "one",
    "ord",
    "ueq",
    "une",
    "uno"
  ]),
  ...mapWords("loom-llvm-attribute", [
    "alwaysinline",
    "argmemonly",
    "builtin",
    "byref",
    "byval",
    "cold",
    "convergent",
    "dereferenceable",
    "dereferenceable_or_null",
    "distinct",
    "immarg",
    "inalloca",
    "inreg",
    "mustprogress",
    "nest",
    "noalias",
    "nocallback",
    "nocapture",
    "nofree",
    "noinline",
    "nonlazybind",
    "nonnull",
    "norecurse",
    "noredzone",
    "noreturn",
    "nosync",
    "nounwind",
    "null_pointer_is_valid",
    "opaque",
    "optnone",
    "optsize",
    "preallocated",
    "readnone",
    "readonly",
    "returned",
    "returns_twice",
    "sanitize_address",
    "sanitize_hwaddress",
    "sanitize_memory",
    "sanitize_thread",
    "signext",
    "speculatable",
    "sret",
    "ssp",
    "sspreq",
    "sspstrong",
    "swiftasync",
    "swiftself",
    "swifterror",
    "uwtable",
    "willreturn",
    "writeonly",
    "zeroext"
  ]),
  ...mapWords("loom-llvm-constant", ["true", "false", "null", "none", "undef", "poison", "zeroinitializer"])
]);
var LLVM_PRIMITIVE_TYPES = /* @__PURE__ */ new Set([
  "void",
  "label",
  "token",
  "metadata",
  "x86_mmx",
  "x86_amx",
  "half",
  "bfloat",
  "float",
  "double",
  "fp128",
  "x86_fp80",
  "ppc_fp128",
  "ptr"
]);
var PUNCTUATION_CLASS = "loom-llvm-punctuation";
function highlightLlvmElement(codeElement, source) {
  codeElement.empty();
  codeElement.addClass("loom-llvm-code");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    appendHighlightedLine(codeElement, line);
    if (index < lines.length - 1) {
      codeElement.appendText("\n");
    }
  });
}
function addLlvmDecorations(builder, view, block) {
  const contentLineCount = getContentLineCount(block);
  if (!contentLineCount) {
    return;
  }
  const lines = block.content.split("\n");
  for (let index = 0; index < contentLineCount; index += 1) {
    const line = lines[index] ?? "";
    const tokens = tokenizeLlvmLine(line);
    if (!tokens.length) {
      continue;
    }
    const docLine = view.state.doc.line(block.startLine + 2 + index);
    for (const token of tokens) {
      if (token.from === token.to) {
        continue;
      }
      builder.add(
        docLine.from + token.from,
        docLine.from + token.to,
        import_view.Decoration.mark({ class: token.className })
      );
    }
  }
}
function appendHighlightedLine(container, line) {
  let cursor = 0;
  for (const token of tokenizeLlvmLine(line)) {
    if (token.from > cursor) {
      container.appendText(line.slice(cursor, token.from));
    }
    const span = container.createSpan({ cls: token.className });
    span.setText(line.slice(token.from, token.to));
    cursor = token.to;
  }
  if (cursor < line.length) {
    container.appendText(line.slice(cursor));
  }
}
function tokenizeLlvmLine(line) {
  const tokens = [];
  let index = 0;
  addLabelToken(line, tokens);
  while (index < line.length) {
    const current = line[index];
    if (current === ";") {
      tokens.push({ from: index, to: line.length, className: "loom-llvm-comment" });
      break;
    }
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    const stringToken = readStringToken(line, index);
    if (stringToken) {
      if (stringToken.prefixEnd > index) {
        tokens.push({ from: index, to: stringToken.prefixEnd, className: "loom-llvm-string-prefix" });
      }
      tokens.push({ from: stringToken.valueStart, to: stringToken.valueEnd, className: "loom-llvm-string" });
      index = stringToken.valueEnd;
      continue;
    }
    const matched = matchRegexToken(line, index, /@llvm\.[A-Za-z$._0-9]+/y, "loom-llvm-intrinsic", tokens) || matchRegexToken(line, index, /@[A-Za-z$._-][A-Za-z$._0-9-]*|@\d+\b/y, "loom-llvm-global", tokens) || matchRegexToken(line, index, /%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+\b/y, "loom-llvm-local", tokens) || matchRegexToken(line, index, /![A-Za-z$._-][A-Za-z$._0-9-]*|!\d+\b/y, "loom-llvm-metadata", tokens) || matchRegexToken(line, index, /\$[A-Za-z$._-][A-Za-z$._0-9-]*/y, "loom-llvm-comdat", tokens) || matchRegexToken(line, index, /#\d+\b/y, "loom-llvm-attribute-group", tokens) || matchRegexToken(line, index, /\baddrspace\s*\(\s*\d+\s*\)/y, "loom-llvm-type", tokens) || matchRegexToken(line, index, /[-+]?0x[0-9A-Fa-f]+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?\d+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /\.\.\./y, "loom-llvm-punctuation", tokens);
    if (matched) {
      index = matched;
      continue;
    }
    const word = readWord(line, index);
    if (word) {
      tokens.push({
        from: index,
        to: word.end,
        className: classifyWord(word.value)
      });
      index = word.end;
      continue;
    }
    if ("()[]{}<>,:=*".includes(current)) {
      tokens.push({ from: index, to: index + 1, className: PUNCTUATION_CLASS });
      index += 1;
      continue;
    }
    index += 1;
  }
  return normalizeTokens(tokens);
}
function addLabelToken(line, tokens) {
  const match = line.match(/^(\s*)(?:([A-Za-z$._-][A-Za-z$._0-9-]*|\d+)|(%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+))(:)/);
  if (!match || match.index == null) {
    return;
  }
  const labelStart = match[1].length;
  const labelText = match[2] ?? match[3];
  if (!labelText) {
    return;
  }
  tokens.push({
    from: labelStart,
    to: labelStart + labelText.length,
    className: "loom-llvm-label"
  });
  tokens.push({
    from: labelStart + labelText.length,
    to: labelStart + labelText.length + 1,
    className: PUNCTUATION_CLASS
  });
}
function classifyWord(word) {
  if (/^i\d+$/.test(word) || LLVM_PRIMITIVE_TYPES.has(word)) {
    return "loom-llvm-type";
  }
  return LLVM_KEYWORDS.get(word) ?? "loom-llvm-plain";
}
function readWord(line, index) {
  const match = /[A-Za-z_][A-Za-z0-9_.-]*/y;
  match.lastIndex = index;
  const result = match.exec(line);
  if (!result) {
    return null;
  }
  return {
    value: result[0],
    end: match.lastIndex
  };
}
function readStringToken(line, index) {
  let cursor = index;
  if (line[cursor] === "c" && line[cursor + 1] === '"') {
    cursor += 1;
  }
  if (line[cursor] !== '"') {
    return null;
  }
  const valueStart = cursor;
  cursor += 1;
  while (cursor < line.length) {
    if (line[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (line[cursor] === '"') {
      cursor += 1;
      break;
    }
    cursor += 1;
  }
  return {
    prefixEnd: valueStart,
    valueStart,
    valueEnd: cursor
  };
}
function matchRegexToken(line, index, regex, className, tokens) {
  regex.lastIndex = index;
  const match = regex.exec(line);
  if (!match) {
    return null;
  }
  tokens.push({ from: index, to: regex.lastIndex, className });
  return regex.lastIndex;
}
function normalizeTokens(tokens) {
  tokens.sort((left, right) => left.from - right.from || left.to - right.to);
  const normalized = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.to <= cursor) {
      continue;
    }
    const from = Math.max(token.from, cursor);
    normalized.push({ ...token, from });
    cursor = token.to;
  }
  return normalized;
}
function getContentLineCount(block) {
  if (block.endLine === block.startLine) {
    return 0;
  }
  if (block.content.length === 0) {
    return block.endLine > block.startLine + 1 ? 1 : 0;
  }
  return block.content.split("\n").length;
}
function mapWords(className, words) {
  return words.map((word) => [word, className]);
}

// src/utils/hash.ts
var import_crypto = require("crypto");
function shortHash(input) {
  return (0, import_crypto.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}

// src/parser.ts
var LANGUAGE_ALIASES = {
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  ocaml: "ocaml",
  ml: "ocaml",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  "c++": "cpp",
  shell: "shell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ruby: "ruby",
  rb: "ruby",
  perl: "perl",
  pl: "perl",
  lua: "lua",
  php: "php",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  haskell: "haskell",
  hs: "haskell",
  java: "java",
  llvm: "llvm-ir",
  llvmir: "llvm-ir",
  "llvm-ir": "llvm-ir",
  ll: "llvm-ir",
  lean: "lean",
  lean4: "lean",
  coq: "coq",
  v: "coq",
  smt: "smtlib",
  smt2: "smtlib",
  smtlib: "smtlib",
  "smt-lib": "smtlib",
  z3: "smtlib"
};
var OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
var OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?.*$/;
function normalizeLanguage(rawLanguage, settings) {
  const normalized = rawLanguage.trim().toLowerCase();
  for (const language of settings?.customLanguages ?? []) {
    const name = language.name.trim().toLowerCase();
    const aliases = parseAliasList(language.aliases);
    if (name && (name === normalized || aliases.includes(normalized))) {
      return language.name.trim();
    }
  }
  return LANGUAGE_ALIASES[normalized] ?? null;
}
function getSupportedLanguageAliases(settings) {
  return [
    ...Object.keys(LANGUAGE_ALIASES),
    ...(settings?.customLanguages ?? []).flatMap((language) => [language.name, ...parseAliasList(language.aliases)])
  ].map((alias) => alias.toLowerCase());
}
function parseMarkdownCodeBlocks(filePath, source, settings) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let ordinal = 0;
  let insideManagedOutput = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (insideManagedOutput) {
      if (OUTPUT_END.test(line.trim())) {
        insideManagedOutput = false;
      }
      continue;
    }
    if (OUTPUT_START.test(line.trim())) {
      insideManagedOutput = true;
      continue;
    }
    const fenceMatch = line.match(FENCE_START);
    if (!fenceMatch) {
      continue;
    }
    const startLine = i;
    const fenceIndent = getLeadingWhitespace2(line);
    const fenceToken = fenceMatch[1];
    const sourceLanguage = (fenceMatch[2] ?? "").trim();
    const language = normalizeLanguage(sourceLanguage, settings);
    let endLine = i;
    const contentLines = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const innerLine = lines[j];
      const trimmed = innerLine.trim();
      if (trimmed.startsWith(fenceToken) && /^(```+|~~~+)\s*$/.test(trimmed)) {
        endLine = j;
        i = j;
        break;
      }
      contentLines.push(stripFenceIndent(innerLine, fenceIndent));
      endLine = j;
    }
    if (!language) {
      continue;
    }
    ordinal += 1;
    const content = contentLines.join("\n");
    const contentHash = shortHash(content);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      startLine,
      endLine,
      fenceStart: 0,
      fenceEnd: 0
    });
  }
  return blocks;
}
function parseAliasList(value) {
  return value.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
}
function findBlockAtLine(blocks, line) {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine) ?? null;
}
function getLeadingWhitespace2(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function stripFenceIndent(line, fenceIndent) {
  if (!fenceIndent) {
    return line;
  }
  let index = 0;
  while (index < fenceIndent.length && index < line.length && line[index] === fenceIndent[index]) {
    index += 1;
  }
  return line.slice(index);
}

// src/runners/node.ts
var NodeRunner = class {
  constructor() {
    this.id = "node";
    this.displayName = "Node.js";
    this.languages = ["javascript", "typescript"];
  }
  canRun(block, settings) {
    if (block.language === "javascript") {
      return Boolean(settings.nodeExecutable.trim());
    }
    return Boolean(settings.typescriptTranspilerExecutable.trim());
  }
  async run(block, context, settings) {
    if (block.language === "javascript") {
      return runTempFileProcess({
        runnerId: this.id,
        runnerName: this.displayName,
        executable: settings.nodeExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".js",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    const executable = settings.typescriptTranspilerExecutable.trim();
    const runnerName = settings.typescriptMode === "tsx" ? "TypeScript (tsx)" : "TypeScript (ts-node)";
    return runTempFileProcess({
      runnerId: `${this.id}:${settings.typescriptMode}`,
      runnerName,
      executable,
      args: ["{file}"],
      fileExtension: ".ts",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
};

// src/runners/custom.ts
var CustomLanguageRunner = class {
  constructor() {
    this.id = "custom";
    this.displayName = "Custom language";
    this.languages = [];
  }
  canRun(block, settings) {
    return Boolean(this.getCustomLanguage(block, settings)?.executable.trim());
  }
  run(block, context, settings) {
    const language = this.getCustomLanguage(block, settings);
    if (!language) {
      throw new Error(`Unsupported custom language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${language.name}`,
      runnerName: language.name,
      executable: language.executable.trim(),
      args: splitCommandLine(language.args || "{file}"),
      fileExtension: normalizeExtension2(language.extension, language.name),
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  getCustomLanguage(block, settings) {
    const normalized = block.language.trim().toLowerCase();
    return settings.customLanguages.find((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
  }
};
function normalizeExtension2(extension, name) {
  const trimmed = extension.trim();
  if (!trimmed) {
    return `.${name}`;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

// src/runners/interpreted.ts
var INTERPRETED_SPECS = [
  {
    language: "shell",
    displayName: "Shell",
    executable: (settings) => settings.shellExecutable,
    fileExtension: ".sh"
  },
  {
    language: "ruby",
    displayName: "Ruby",
    executable: (settings) => settings.rubyExecutable,
    fileExtension: ".rb"
  },
  {
    language: "perl",
    displayName: "Perl",
    executable: (settings) => settings.perlExecutable,
    fileExtension: ".pl"
  },
  {
    language: "lua",
    displayName: "Lua",
    executable: (settings) => settings.luaExecutable,
    fileExtension: ".lua"
  },
  {
    language: "php",
    displayName: "PHP",
    executable: (settings) => settings.phpExecutable,
    fileExtension: ".php"
  },
  {
    language: "go",
    displayName: "Go",
    executable: (settings) => settings.goExecutable,
    fileExtension: ".go",
    args: ["run", "{file}"],
    env: {
      GOCACHE: "{tempDir}/gocache"
    },
    minimumTimeoutMs: 3e4
  },
  {
    language: "haskell",
    displayName: "Haskell",
    executable: (settings) => settings.haskellExecutable,
    fileExtension: ".hs",
    minimumTimeoutMs: 3e4
  }
];
var InterpretedRunner = class {
  constructor() {
    this.id = "interpreted";
    this.displayName = "Interpreted";
    this.languages = INTERPRETED_SPECS.map((spec) => spec.language);
  }
  canRun(block, settings) {
    const spec = this.getSpec(block.language);
    return Boolean(spec?.executable(settings).trim());
  }
  run(block, context, settings) {
    const spec = this.getSpec(block.language);
    if (!spec) {
      throw new Error(`Unsupported language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${block.language}`,
      runnerName: spec.displayName,
      executable: spec.executable(settings).trim(),
      args: spec.args ?? ["{file}"],
      fileExtension: spec.fileExtension,
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, spec.minimumTimeoutMs ?? 0),
      signal: context.signal,
      env: spec.env
    });
  }
  getSpec(language) {
    return INTERPRETED_SPECS.find((spec) => spec.language === language);
  }
};

// src/runners/llvm.ts
var LlvmRunner = class {
  constructor() {
    this.id = "llvm-ir";
    this.displayName = "LLVM IR";
    this.languages = ["llvm-ir"];
  }
  canRun(block, settings) {
    return block.language === "llvm-ir" && Boolean(settings.llvmInterpreterExecutable.trim());
  }
  async run(block, context, settings) {
    const result = await runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.llvmInterpreterExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".ll",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    if (!result.timedOut && !result.cancelled && result.exitCode != null && !result.stderr.trim()) {
      if (result.exitCode !== 0) {
        result.success = true;
        result.warning = `Program returned i32 ${result.exitCode}. Under lli, that becomes the process exit status.`;
      }
      if (!result.stdout.trim()) {
        result.stdout = result.exitCode === 0 ? "LLVM program exited with code 0." : `LLVM program returned i32 ${result.exitCode}.
Use stdout in the IR itself if you want printable program output.`;
      }
    }
    return result;
  }
};

// src/runners/managedCompiled.ts
var import_path3 = require("path");
var ManagedCompiledRunner = class {
  constructor() {
    this.id = "managed-compiled";
    this.displayName = "Managed compiler";
    this.languages = ["rust", "java"];
  }
  canRun(block, settings) {
    if (block.language === "rust") {
      return Boolean(settings.rustExecutable.trim());
    }
    if (block.language === "java") {
      return Boolean(settings.javaExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    if (block.language === "rust") {
      return this.runRust(block, context, settings);
    }
    if (block.language === "java") {
      return this.runJava(block, context, settings);
    }
    throw new Error(`Unsupported language: ${block.language}`);
  }
  async runRust(block, context, settings) {
    return withTempSourceFile(".rs", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path3.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:rust:compile`,
        runnerName: "Rust",
        executable: settings.rustExecutable.trim(),
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:rust:run`,
        runnerName: "Rust",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
  async runJava(block, context, settings) {
    return withNamedTempSourceFile("Main.java", block.content, async ({ tempDir, tempFile }) => {
      if (!settings.javaCompilerExecutable.trim()) {
        return runProcess({
          runnerId: `${this.id}:java:source`,
          runnerName: "Java",
          executable: settings.javaExecutable.trim(),
          args: [tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 3e4),
          signal: context.signal
        });
      }
      const compileResult = await runProcess({
        runnerId: `${this.id}:java:compile`,
        runnerName: "Java",
        executable: settings.javaCompilerExecutable.trim(),
        args: [tempFile],
        workingDirectory: tempDir,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:java:run`,
        runnerName: "Java",
        executable: settings.javaExecutable.trim(),
        args: ["-cp", tempDir, "Main"],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
};

// src/runners/nativeCompiled.ts
var import_path4 = require("path");
var NativeCompiledRunner = class {
  constructor() {
    this.id = "native-compiled";
    this.displayName = "Native compiler";
    this.languages = ["c", "cpp"];
  }
  canRun(block, settings) {
    if (block.language === "c") {
      return Boolean(settings.cExecutable.trim());
    }
    if (block.language === "cpp") {
      return Boolean(settings.cppExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    const executable = block.language === "c" ? settings.cExecutable.trim() : settings.cppExecutable.trim();
    const fileExtension = block.language === "c" ? ".c" : ".cpp";
    const runnerName = block.language === "c" ? "C (GCC)" : "C++ (G++)";
    return withTempSourceFile(fileExtension, block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path4.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:${block.language}:compile`,
        runnerName,
        executable,
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:${block.language}:run`,
        runnerName,
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
};

// src/runners/ocaml.ts
var import_path5 = require("path");
var OcamlRunner = class {
  constructor() {
    this.id = "ocaml";
    this.displayName = "OCaml";
    this.languages = ["ocaml"];
  }
  canRun(block, settings) {
    return block.language === "ocaml" && Boolean(settings.ocamlExecutable.trim());
  }
  async run(block, context, settings) {
    const mode = settings.ocamlMode;
    const executable = settings.ocamlExecutable.trim();
    if (mode === "ocaml") {
      return runTempFileProcess({
        runnerId: `${this.id}:ocaml`,
        runnerName: "OCaml",
        executable,
        args: ["{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    if (mode === "dune") {
      return runTempFileProcess({
        runnerId: `${this.id}:dune`,
        runnerName: "Dune / OCaml",
        executable,
        args: ["exec", "--", "ocaml", "{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    return withTempSourceFile(".ml", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path5.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:ocamlc-compile`,
        runnerName: "OCamlc",
        executable,
        args: ["-o", binaryPath, tempFile],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:ocamlc-run`,
        runnerName: "OCamlc",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    });
  }
};

// src/runners/python.ts
var PythonRunner = class {
  constructor() {
    this.id = "python";
    this.displayName = "Python";
    this.languages = ["python"];
  }
  canRun(block, settings) {
    return block.language === "python" && Boolean(settings.pythonExecutable.trim());
  }
  run(block, context, settings) {
    return runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.pythonExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".py",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
};

// src/runners/proof.ts
var import_fs2 = require("fs");
var import_path6 = require("path");
var ProofRunner = class {
  constructor() {
    this.id = "proof";
    this.displayName = "Proof checker";
    this.languages = ["lean", "coq", "smtlib"];
  }
  canRun(block, settings) {
    if (block.language === "lean") {
      return Boolean(settings.leanExecutable.trim());
    }
    if (block.language === "coq") {
      return Boolean(resolveCoqExecutable(settings).trim());
    }
    if (block.language === "smtlib") {
      return Boolean(settings.smtExecutable.trim());
    }
    return false;
  }
  run(block, context, settings) {
    if (block.language === "lean") {
      return runTempFileProcess({
        runnerId: `${this.id}:lean`,
        runnerName: "Lean",
        executable: settings.leanExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".lean",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    if (block.language === "coq") {
      return runTempFileProcess({
        runnerId: `${this.id}:coq`,
        runnerName: "Coq",
        executable: resolveCoqExecutable(settings),
        args: ["-q", "{file}"],
        fileExtension: ".v",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    if (block.language === "smtlib") {
      return runTempFileProcess({
        runnerId: `${this.id}:smtlib`,
        runnerName: "SMT-LIB (Z3)",
        executable: settings.smtExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".smt2",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    throw new Error(`Unsupported proof language: ${block.language}`);
  }
};
function resolveCoqExecutable(settings) {
  const configured = settings.coqExecutable.trim();
  if (configured && configured !== "coqc") {
    return configured;
  }
  const opamCoqc = (0, import_path6.join)(process.env.HOME ?? "", ".opam", "default", "bin", "coqc");
  return (0, import_fs2.existsSync)(opamCoqc) ? opamCoqc : configured || "coqc";
}

// src/runners/registry.ts
var loomRunnerRegistry = class {
  constructor(runners) {
    this.runners = runners;
  }
  getRunnerForBlock(block, settings) {
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }
  getSupportedLanguages() {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  enableLocalExecution: false,
  hasAcknowledgedExecutionRisk: false,
  preserveSourceMode: true,
  defaultTimeoutMs: 8e3,
  workingDirectory: "",
  pythonExecutable: "python3",
  nodeExecutable: "node",
  typescriptMode: "ts-node",
  typescriptTranspilerExecutable: "ts-node",
  ocamlMode: "ocaml",
  ocamlExecutable: "ocaml",
  cExecutable: "gcc",
  cppExecutable: "g++",
  shellExecutable: "bash",
  rubyExecutable: "ruby",
  perlExecutable: "perl",
  luaExecutable: "lua",
  phpExecutable: "php",
  goExecutable: "go",
  rustExecutable: "rustc",
  haskellExecutable: "runghc",
  javaCompilerExecutable: "",
  javaExecutable: "java",
  llvmInterpreterExecutable: "lli",
  leanExecutable: "lean",
  coqExecutable: "coqc",
  smtExecutable: "z3",
  writeOutputToNote: false,
  autoRunOnFileOpen: false,
  customLanguages: [],
  pdfExportMode: "both"
};
var loomSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(loomPlugin2) {
    super(loomPlugin2.app, loomPlugin2);
    this.loomPlugin = loomPlugin2;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "loom" });
    containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });
    this.renderGeneralSettings(this.createSection(containerEl, "General Settings", true));
    this.renderBuiltInRuntimes(this.createSection(containerEl, "Built-in Runtimes"));
    this.renderCustomLanguages(this.createSection(containerEl, "Custom Languages"));
    void this.renderContainerGroups(this.createSection(containerEl, "Containerization Groups"));
  }
  createSection(containerEl, title, open = false) {
    const details = containerEl.createEl("details", { cls: "loom-settings-section" });
    details.open = open;
    details.createEl("summary", { text: title, cls: "loom-settings-summary" });
    return details.createDiv({ cls: "loom-settings-section-body" });
  }
  renderGeneralSettings(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Enable local execution").setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
        this.loomPlugin.settings.enableLocalExecution = value;
        if (value) {
          this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
        }
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Keep loom notes in source mode").setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
        this.loomPlugin.settings.preserveSourceMode = value;
        await this.loomPlugin.saveSettings();
        void this.loomPlugin.enforceSourceModeForActiveView();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Default timeout").setDesc("Maximum execution time in milliseconds before loom terminates the process.").addText(
      (text) => text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.loomPlugin.settings.defaultTimeoutMs = parsed;
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Working directory").setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.").addText(
      (text) => text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
        this.loomPlugin.settings.workingDirectory = value.trim() ? (0, import_obsidian2.normalizePath)(value.trim()) : "";
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Write output back to note").setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
        this.loomPlugin.settings.writeOutputToNote = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Auto-run on file open").setDesc("Run all supported blocks in the active note when it opens. Disabled by default.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
        this.loomPlugin.settings.autoRunOnFileOpen = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("PDF export mode").setDesc("Choose what to include when exporting notes containing loom code blocks to PDF.").addDropdown(
      (dropdown) => dropdown.addOption("both", "Both Code and Output").addOption("code", "Code Block Only").addOption("output", "Output Only").setValue(this.loomPlugin.settings.pdfExportMode || "both").onChange(async (value) => {
        this.loomPlugin.settings.pdfExportMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
  }
  renderBuiltInRuntimes(containerEl) {
    this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");
    new import_obsidian2.Setting(containerEl).setName("TypeScript runner mode").setDesc("Use ts-node or tsx for TypeScript blocks.").addDropdown(
      (dropdown) => dropdown.addOption("ts-node", "ts-node").addOption("tsx", "tsx").setValue(this.loomPlugin.settings.typescriptMode).onChange(async (value) => {
        this.loomPlugin.settings.typescriptMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");
    new import_obsidian2.Setting(containerEl).setName("OCaml mode").setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.").addDropdown(
      (dropdown) => dropdown.addOption("ocaml", "ocaml").addOption("ocamlc", "ocamlc").addOption("dune", "dune").setValue(this.loomPlugin.settings.ocamlMode).onChange(async (value) => {
        this.loomPlugin.settings.ocamlMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    this.addTextSetting(containerEl, "OCaml executable", "Command or path for ocaml, ocamlc, or dune depending on the selected mode.", "ocamlExecutable");
    this.addTextSetting(containerEl, "C compiler", "Command or path for compiling C blocks.", "cExecutable");
    this.addTextSetting(containerEl, "C++ compiler", "Command or path for compiling C++ blocks.", "cppExecutable");
    this.addTextSetting(containerEl, "Shell executable", "Command or path for Shell, Bash, and sh blocks.", "shellExecutable");
    this.addTextSetting(containerEl, "Ruby executable", "Command or path for Ruby blocks.", "rubyExecutable");
    this.addTextSetting(containerEl, "Perl executable", "Command or path for Perl blocks.", "perlExecutable");
    this.addTextSetting(containerEl, "Lua executable", "Command or path for Lua blocks.", "luaExecutable");
    this.addTextSetting(containerEl, "PHP executable", "Command or path for PHP blocks.", "phpExecutable");
    this.addTextSetting(containerEl, "Go executable", "Command or path for Go blocks.", "goExecutable");
    this.addTextSetting(containerEl, "Rust compiler", "Command or path for compiling Rust blocks.", "rustExecutable");
    this.addTextSetting(containerEl, "Haskell executable", "Command or path for Haskell blocks. Defaults to runghc.", "haskellExecutable");
    this.addTextSetting(containerEl, "Java compiler", "Optional command or path for javac. Leave empty to use Java source-file mode.", "javaCompilerExecutable");
    this.addTextSetting(containerEl, "Java executable", "Command or path for running compiled Java blocks.", "javaExecutable");
    this.addTextSetting(containerEl, "LLVM IR interpreter", "Command or path for running LLVM IR blocks with lli.", "llvmInterpreterExecutable");
    this.addTextSetting(containerEl, "Lean executable", "Command or path for checking Lean blocks.", "leanExecutable");
    this.addTextSetting(containerEl, "Coq executable", "Command or path for checking Coq blocks with coqc.", "coqExecutable");
    this.addTextSetting(containerEl, "SMT solver", "Command or path for SMT-LIB blocks. Defaults to z3.", "smtExecutable");
  }
  renderCustomLanguages(containerEl) {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);
    new import_obsidian2.Setting(containerEl).setName("Add custom language").setDesc("Create a new local command-backed language.").addButton(
      (button) => button.setButtonText("+").onClick(async () => {
        this.loomPlugin.settings.customLanguages.push({
          name: "custom-language",
          aliases: "",
          executable: "",
          args: "{file}",
          extension: ".txt"
        });
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
  }
  renderCustomLanguageList(containerEl) {
    containerEl.empty();
    if (!this.loomPlugin.settings.customLanguages.length) {
      containerEl.createEl("p", {
        text: "No custom languages configured.",
        cls: "setting-item-description"
      });
      return;
    }
    this.loomPlugin.settings.customLanguages.forEach((language, index) => {
      const details = containerEl.createEl("details", { cls: "loom-custom-language" });
      details.open = true;
      details.createEl("summary", { text: language.name || `Custom language ${index + 1}` });
      const body = details.createDiv({ cls: "loom-custom-language-body" });
      this.addCustomLanguageTextSetting(body, language, "Name", "Normalized language id used by loom.", "name");
      this.addCustomLanguageTextSetting(body, language, "Aliases", "Comma-separated fence aliases.", "aliases");
      this.addCustomLanguageTextSetting(body, language, "Executable", "Local command or absolute executable path.", "executable");
      this.addCustomLanguageTextSetting(body, language, "Arguments", "Space-separated arguments. Use {file} for the temp source file.", "args");
      this.addCustomLanguageTextSetting(body, language, "Extension", "Temp source file extension, for example .py.", "extension");
      new import_obsidian2.Setting(body).setName("Delete language").setDesc("Remove this custom language.").addButton(
        (button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          this.loomPlugin.settings.customLanguages.splice(index, 1);
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
    });
  }
  async renderContainerGroups(containerEl) {
    const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
    listEl.setText("Scanning container groups...");
    const groups = await this.loomPlugin.getContainerGroupSummaries();
    listEl.empty();
    if (!groups.length) {
      listEl.createEl("p", {
        text: "No container groups found in .obsidian/plugins/loom/containers.",
        cls: "setting-item-description"
      });
      return;
    }
    for (const group of groups) {
      new import_obsidian2.Setting(listEl).setName(group.name).setDesc(group.status).addButton(
        (button) => button.setButtonText("Build / rebuild").onClick(async () => {
          await this.loomPlugin.buildContainerGroup(group.name);
        })
      );
    }
  }
  addTextSetting(containerEl, name, description, key) {
    new import_obsidian2.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
        this.loomPlugin.settings[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
  addCustomLanguageTextSetting(containerEl, language, name, description, key) {
    new import_obsidian2.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(language[key]).onChange(async (value) => {
        language[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
};
function showExecutionDisabledNotice() {
  new import_obsidian2.Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}

// src/ui/codeBlockToolbar.ts
var import_obsidian3 = require("obsidian");
function createCodeBlockToolbar(blockId, isRunning, handlers) {
  const toolbar = document.createElement("div");
  toolbar.className = "loom-code-toolbar";
  toolbar.dataset.loomBlockId = blockId;
  toolbar.appendChild(createButton("Run block", isRunning ? "loader-circle" : "play", handlers.onRun, isRunning));
  toolbar.appendChild(createButton("Copy code", "copy", handlers.onCopy, false));
  toolbar.appendChild(createButton("Remove snippet", "trash-2", handlers.onRemove, false));
  toolbar.appendChild(createButton("Toggle output", "panel-bottom-open", handlers.onToggleOutput, false));
  return toolbar;
}
function createButton(label, iconName, onClick, spinning) {
  const button = document.createElement("button");
  button.className = `loom-toolbar-button${spinning ? " is-running" : ""}`;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  (0, import_obsidian3.setIcon)(button, iconName);
  return button;
}

// src/ui/outputPanel.ts
var import_obsidian4 = require("obsidian");
function getStatusKind(output) {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }
  return "failure";
}
function createOutputPanel(output) {
  const panel = document.createElement("div");
  panel.className = `loom-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.loomBlockId = output.blockId;
  renderOutputPanel(panel, output);
  return panel;
}
function renderOutputPanel(panel, output) {
  const kind = getStatusKind(output);
  panel.className = `loom-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();
  const header = panel.createDiv({ cls: "loom-output-header" });
  const badge = header.createDiv({ cls: "loom-output-badge" });
  (0, import_obsidian4.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText(`${output.result.runnerName} \xB7 exit ${output.result.exitCode ?? "?"}`);
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText(`${output.result.durationMs} ms \xB7 ${new Date(output.result.finishedAt).toLocaleTimeString()}`);
  const body = panel.createDiv({ cls: "loom-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  section.createDiv({ cls: "loom-output-stream-label", text: label });
  section.createEl("pre", { cls: "loom-output-pre", text: content });
}
function createRunningPanel() {
  const panel = document.createElement("div");
  panel.className = "loom-output-panel is-running";
  const header = panel.createDiv({ cls: "loom-output-header" });
  const spinner = header.createDiv({ cls: "loom-spinner" });
  (0, import_obsidian4.setIcon)(spinner, "loader-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");
  return panel;
}

// src/main.ts
var loomRefreshEffect = import_state.StateEffect.define();
var ExecutionConsentModal = class extends import_obsidian5.Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Enable loom local execution?" });
    contentEl.createEl("p", {
      text: "loom runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process."
    });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const enableButton = actions.createEl("button", { text: "Enable and run", cls: "mod-cta" });
    cancelButton.addEventListener("click", () => this.close());
    enableButton.addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });
  }
};
var loomToolbarRenderChild = class extends import_obsidian5.MarkdownRenderChild {
  constructor(containerEl, plugin, block, codeElement) {
    super(containerEl);
    this.plugin = plugin;
    this.block = block;
    this.codeElement = codeElement;
    this.panelContainer = null;
    this.unregisterOutputListener = null;
  }
  onload() {
    this.codeElement.parentElement?.addClass("loom-codeblock-shell");
    this.codeElement.parentElement?.appendChild(this.plugin.createToolbarElement(this.block));
    if (this.plugin.settings.pdfExportMode === "output") {
      this.codeElement.classList.add("loom-print-hide-code");
    }
    const hostClasses = ["loom-inline-output-host"];
    if (this.plugin.settings.pdfExportMode === "code") {
      hostClasses.push("loom-print-hide-output");
    }
    this.panelContainer = this.containerEl.createDiv({ cls: hostClasses.join(" ") });
    this.plugin.renderOutputInto(this.block.id, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block.id, this.panelContainer);
      }
    });
  }
  onunload() {
    this.unregisterOutputListener?.();
  }
};
var loomToolbarWidget = class extends import_view2.WidgetType {
  constructor(plugin, block) {
    super();
    this.plugin = plugin;
    this.block = block;
  }
  eq(other) {
    return other.block.id === this.block.id && other.plugin.isBlockRunning(this.block.id) === this.plugin.isBlockRunning(this.block.id);
  }
  toDOM() {
    return this.plugin.createToolbarElement(this.block);
  }
};
var loomOutputWidget = class extends import_view2.WidgetType {
  constructor(plugin, blockId) {
    super();
    this.plugin = plugin;
    this.blockId = blockId;
  }
  eq(other) {
    return false;
  }
  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "loom-inline-output-host";
    this.plugin.renderOutputInto(this.blockId, wrapper);
    return wrapper;
  }
};
var loomPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.registry = new loomRunnerRegistry([
      new PythonRunner(),
      new NodeRunner(),
      new OcamlRunner(),
      new NativeCompiledRunner(),
      new InterpretedRunner(),
      new ManagedCompiledRunner(),
      new LlvmRunner(),
      new ProofRunner(),
      new CustomLanguageRunner()
    ]);
    this.containerRunner = new loomContainerRunner(this.app, this.manifest.dir ?? ".obsidian/plugins/loom");
    this.registeredCodeBlockAliases = /* @__PURE__ */ new Set();
    this.outputs = /* @__PURE__ */ new Map();
    this.running = /* @__PURE__ */ new Map();
    this.outputListeners = /* @__PURE__ */ new Map();
    this.editorViews = /* @__PURE__ */ new Set();
    this.lastMarkdownFilePath = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new loomSettingTab(this));
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
      void this.enforceSourceModeForActiveView();
    });
    this.addCommand({
      id: "loom-run-current-code-block",
      name: "loom: Run Current Code Block",
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          return;
        }
        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block) {
          new import_obsidian5.Notice("No supported loom block at the current cursor.");
          return;
        }
        await this.runBlock(file, block);
      }
    });
    this.addCommand({
      id: "loom-run-all-code-blocks",
      name: "loom: Run All Supported Code Blocks in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.runAllBlocksInFile(file);
        }
        return true;
      }
    });
    this.addCommand({
      id: "loom-clear-note-outputs",
      name: "loom: Clear loom Outputs in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.clearOutputsForFile(file);
        }
        return true;
      }
    });
    this.registerCodeBlockProcessors();
    this.registerEditorExtension(this.createLivePreviewExtension());
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.lastMarkdownFilePath = file?.path ?? this.lastMarkdownFilePath;
        this.refreshAllViews();
        void this.enforceSourceModeForActiveView();
        if (file && this.settings.autoRunOnFileOpen) {
          void this.runAllBlocksInFile(file);
        }
      })
    );
    this.addCommand({
      id: "loom-validate-container-groups",
      name: "loom: Validate Container Groups",
      callback: async () => {
        const groups = await this.getContainerGroupSummaries();
        new import_obsidian5.Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No loom container groups found.", 8e3);
      }
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
        void this.enforceSourceModeForActiveView();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, ctx) => {
        if (ctx instanceof import_obsidian5.MarkdownView) {
          void this.enforceSourceModeForLeaf(ctx.leaf);
        }
      })
    );
  }
  onunload() {
    for (const controller of this.running.values()) {
      controller.abort();
    }
  }
  async loadSettings() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...await this.loadData()
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.registerCodeBlockProcessors();
    this.refreshAllViews();
  }
  isBlockRunning(blockId) {
    return this.running.has(blockId);
  }
  registerOutputListener(blockId, listener) {
    if (!this.outputListeners.has(blockId)) {
      this.outputListeners.set(blockId, /* @__PURE__ */ new Set());
    }
    this.outputListeners.get(blockId)?.add(listener);
    return () => {
      this.outputListeners.get(blockId)?.delete(listener);
    };
  }
  createToolbarElement(block) {
    return createCodeBlockToolbar(block.id, this.isBlockRunning(block.id), {
      onRun: () => void this.runActiveBlockById(block.id),
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(block.content);
          new import_obsidian5.Notice("Code copied");
        } catch {
          new import_obsidian5.Notice("Clipboard write failed.");
        }
      },
      onRemove: () => void this.removeSnippetById(block.id),
      onToggleOutput: () => {
        const output = this.outputs.get(block.id);
        if (!output) {
          return;
        }
        output.visible = !output.visible;
        this.notifyOutputChanged(block.id);
      }
    });
  }
  renderOutputInto(blockId, container) {
    container.empty();
    const output = this.outputs.get(blockId);
    if (this.running.has(blockId)) {
      container.appendChild(createRunningPanel());
      return;
    }
    if (!output || !output.visible) {
      return;
    }
    container.appendChild(createOutputPanel(output));
  }
  async runActiveBlockById(blockId) {
    const block = this.findActiveBlockById(blockId);
    const file = this.getActiveMarkdownFile();
    if (!block || !file) {
      return;
    }
    await this.runBlock(file, block);
  }
  async removeSnippetById(blockId) {
    const block = this.findActiveBlockById(blockId);
    if (!block) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof import_obsidian5.TFile)) {
      return;
    }
    this.running.get(blockId)?.abort();
    this.running.delete(blockId);
    this.outputs.delete(blockId);
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === blockId);
      if (!currentBlock) {
        return content;
      }
      const managedRange = this.findManagedOutputRange(lines, blockId);
      const removalStart = currentBlock.startLine;
      const removalEnd = managedRange ? managedRange.end : currentBlock.endLine;
      lines.splice(removalStart, removalEnd - removalStart + 1);
      while (removalStart < lines.length - 1 && lines[removalStart] === "" && lines[removalStart + 1] === "") {
        lines.splice(removalStart, 1);
      }
      return lines.join("\n");
    });
    this.notifyOutputChanged(blockId);
    this.updateStatusBar();
    new import_obsidian5.Notice("loom snippet removed.");
  }
  async runAllBlocksInFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const containerGroup = this.containerRunner.getContainerGroupName(file);
    const supportedBlocks = containerGroup ? blocks : blocks.filter((block) => this.registry.getRunnerForBlock(block, this.settings));
    if (!supportedBlocks.length) {
      new import_obsidian5.Notice("No supported loom blocks found in the current note.");
      return;
    }
    for (const block of supportedBlocks) {
      await this.runBlock(file, block);
    }
  }
  async clearOutputsForFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    for (const block of blocks) {
      this.outputs.delete(block.id);
      this.notifyOutputChanged(block.id);
      await this.removeManagedOutputBlock(file.path, block.id);
    }
    new import_obsidian5.Notice("loom outputs cleared.");
  }
  async runBlock(file, block) {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new import_obsidian5.Notice("This loom block is already running.");
      return;
    }
    if (!await this.ensureExecutionEnabled()) {
      showExecutionDisabledNotice();
      return;
    }
    const workingDirectory = this.resolveWorkingDirectory(file);
    const containerGroup = this.containerRunner.getContainerGroupName(file);
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new import_obsidian5.Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }
    const controller = new AbortController();
    const runContext = {
      file,
      workingDirectory,
      timeoutMs: this.settings.defaultTimeoutMs,
      signal: controller.signal
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();
    try {
      const result = containerGroup ? await this.containerRunner.run(block, runContext, this.settings, containerGroup) : await runner.run(block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        collapsed: false,
        visible: true
      });
      if (this.settings.writeOutputToNote) {
        await this.writeManagedOutputBlock(file, block, result);
      }
      const runnerName = containerGroup ? `container ${containerGroup}` : runner.displayName;
      new import_obsidian5.Notice(result.success ? `loom ran ${runnerName} block.` : `loom run failed for ${runnerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        collapsed: false,
        visible: true,
        result: {
          runnerId: containerGroup ? `container:${containerGroup}` : runner?.id ?? "unknown",
          runnerName: containerGroup ? `Container ${containerGroup}` : runner?.displayName ?? "Unknown",
          startedAt: (/* @__PURE__ */ new Date()).toISOString(),
          finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          durationMs: 0,
          exitCode: -1,
          stdout: "",
          stderr: message,
          success: false,
          timedOut: false,
          cancelled: false
        }
      });
      new import_obsidian5.Notice(`loom error: ${message}`);
    } finally {
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
  }
  async ensureExecutionEnabled() {
    if (this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk) {
      return true;
    }
    return await new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const modal = new ExecutionConsentModal(this.app, async () => {
        this.settings.enableLocalExecution = true;
        this.settings.hasAcknowledgedExecutionRisk = true;
        await this.saveSettings();
        settle(true);
      });
      const originalClose = modal.close.bind(modal);
      modal.close = () => {
        originalClose();
        settle(this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk);
      };
      modal.open();
    });
  }
  resolveWorkingDirectory(file) {
    if (this.settings.workingDirectory.trim()) {
      return this.settings.workingDirectory.trim();
    }
    const adapterBasePath = this.app.vault.adapter.basePath ?? "";
    const fileFolder = (0, import_path7.dirname)(file.path);
    const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
    return resolved || process.cwd();
  }
  async getContainerGroupSummaries() {
    return this.containerRunner.getGroupSummaries();
  }
  async buildContainerGroup(name) {
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 12e4), controller.signal);
    new import_obsidian5.Notice(result.success ? `loom built container group ${name}.` : `loom container build failed for ${name}.`, 8e3);
  }
  registerCodeBlockProcessors() {
    for (const alias of getSupportedLanguageAliases(this.settings)) {
      const normalizedAlias = alias.toLowerCase();
      if (this.registeredCodeBlockAliases.has(normalizedAlias)) {
        continue;
      }
      if (/[^a-zA-Z0-9_-]/.test(normalizedAlias)) {
        continue;
      }
      this.registeredCodeBlockAliases.add(normalizedAlias);
      this.registerMarkdownCodeBlockProcessor(normalizedAlias, async (source, el, ctx) => {
        const filePath = ctx.sourcePath;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof import_obsidian5.TFile)) {
          return;
        }
        const fullText = await this.app.vault.cachedRead(file);
        const blocks = parseMarkdownCodeBlocks(filePath, fullText, this.settings);
        const section = ctx && typeof ctx.getSectionInfo === "function" ? ctx.getSectionInfo(el) : null;
        let block;
        if (section) {
          const lineStart = section.lineStart;
          block = blocks.find((candidate) => candidate.startLine === lineStart && candidate.content === source);
        } else {
          block = blocks.find((candidate) => candidate.content === source);
        }
        if (!block) {
          return;
        }
        let pre = el.querySelector("pre");
        if (!pre) {
          pre = el.createEl("pre");
          pre.addClass(`language-${normalizedAlias}`);
          const code = pre.createEl("code");
          code.addClass(`language-${normalizedAlias}`);
          code.setText(source);
        }
        if (block.language === "llvm-ir") {
          const code = pre.querySelector("code") ?? pre;
          highlightLlvmElement(code, source);
        }
        ctx.addChild(new loomToolbarRenderChild(el, this, block, pre));
      });
    }
  }
  updateStatusBar() {
    const activeRuns = this.running.size;
    this.statusBarItemEl.setText(activeRuns ? `loom: ${activeRuns} Active Run${activeRuns === 1 ? "" : "s"}` : "loom: Idle");
  }
  notifyOutputChanged(blockId) {
    this.outputListeners.get(blockId)?.forEach((listener) => listener());
    this.refreshAllViews();
  }
  refreshAllViews() {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view;
      const previewMode = view.previewMode;
      previewMode?.rerender?.(true);
    });
    for (const editorView of this.editorViews) {
      editorView.dispatch({ effects: loomRefreshEffect.of(void 0) });
    }
  }
  getActiveMarkdownFile() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    return view?.file ?? null;
  }
  getCurrentEditorFilePath() {
    return this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
  }
  async enforceSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (!view) {
      return;
    }
    await this.enforceSourceModeForLeaf(view.leaf);
  }
  async enforceSourceModeForLeaf(leaf) {
    if (!this.settings.preserveSourceMode) {
      return;
    }
    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }
    const view = leaf.view;
    if (!(view instanceof import_obsidian5.MarkdownView) || !view.file) {
      return;
    }
    const source = view.editor?.getValue?.() ?? await this.app.vault.cachedRead(view.file);
    const blocks = parseMarkdownCodeBlocks(view.file.path, source, this.settings);
    if (!blocks.length) {
      return;
    }
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      return;
    }
    state.mode = "source";
    state.source = true;
    await leaf.setViewState({
      ...viewState,
      state
    });
  }
  findActiveBlockById(blockId) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) {
      return this.outputs.get(blockId)?.block ?? null;
    }
    const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
    return blocks.find((block) => block.id === blockId) ?? this.outputs.get(blockId)?.block ?? null;
  }
  createLivePreviewExtension() {
    const plugin = this;
    return import_view2.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          plugin.editorViews.add(view);
          this.decorations = this.buildDecorations();
        }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(loomRefreshEffect)))) {
            this.decorations = this.buildDecorations();
          }
        }
        destroy() {
          plugin.editorViews.delete(this.view);
        }
        buildDecorations() {
          const filePath = plugin.getCurrentEditorFilePath();
          if (!filePath) {
            return import_view2.Decoration.none;
          }
          const source = this.view.state.doc.toString();
          const blocks = parseMarkdownCodeBlocks(filePath, source, plugin.settings);
          const builder = new import_state.RangeSetBuilder();
          for (const block of blocks) {
            const startLine = this.view.state.doc.line(block.startLine + 1);
            builder.add(
              startLine.from,
              startLine.from,
              import_view2.Decoration.widget({
                widget: new loomToolbarWidget(plugin, block),
                side: -1
              })
            );
            if (plugin.outputs.has(block.id) || plugin.running.has(block.id)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                import_view2.Decoration.widget({
                  widget: new loomOutputWidget(plugin, block.id),
                  side: 1
                })
              );
            }
            if (block.language === "llvm-ir") {
              addLlvmDecorations(builder, this.view, block);
            }
          }
          return builder.finish();
        }
      },
      {
        decorations: (value) => value.decorations
      }
    );
  }
  async writeManagedOutputBlock(file, block, result) {
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === block.id);
      const rendered = this.renderManagedOutputMarkdown(block.id, result);
      const existingRange = this.findManagedOutputRange(lines, block.id);
      if (existingRange) {
        lines.splice(existingRange.start, existingRange.end - existingRange.start + 1, ...rendered);
        return lines.join("\n");
      }
      if (!currentBlock) {
        return content;
      }
      lines.splice(currentBlock.endLine + 1, 0, ...rendered);
      return lines.join("\n");
    });
  }
  async removeManagedOutputBlock(filePath, blockId) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian5.TFile)) {
      return;
    }
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const range = this.findManagedOutputRange(lines, blockId);
      if (!range) {
        return content;
      }
      lines.splice(range.start, range.end - range.start + 1);
      return lines.join("\n");
    });
  }
  renderManagedOutputMarkdown(blockId, result) {
    const body = [
      `runner=${result.runnerName}`,
      `exit=${result.exitCode ?? "?"}`,
      `duration=${result.durationMs}ms`,
      `timestamp=${result.finishedAt}`,
      result.stdout ? `stdout:
${result.stdout}` : "",
      result.warning ? `warning:
${result.warning}` : "",
      result.stderr ? `stderr:
${result.stderr}` : ""
    ].filter(Boolean).join("\n\n");
    return [
      `<!-- loom:output:start id=${blockId} -->`,
      "```text",
      body,
      "```",
      "<!-- loom:output:end -->"
    ];
  }
  findManagedOutputRange(lines, blockId) {
    const startMarker = `<!-- loom:output:start id=${blockId} -->`;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== startMarker) {
        continue;
      }
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "<!-- loom:output:end -->") {
          return { start: i, end: j };
        }
      }
    }
    return null;
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL3J1bm5lcnMvbm9kZS50cyIsICJzcmMvcnVubmVycy9jdXN0b20udHMiLCAic3JjL3J1bm5lcnMvaW50ZXJwcmV0ZWQudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvdWkvY29kZUJsb2NrVG9vbGJhci50cyIsICJzcmMvdWkvb3V0cHV0UGFuZWwudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUmVuZGVyQ2hpbGQsXG4gIE1hcmtkb3duVmlldyxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgeyBEZWNvcmF0aW9uLCBFZGl0b3JWaWV3LCBWaWV3UGx1Z2luLCBWaWV3VXBkYXRlLCBXaWRnZXRUeXBlIH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbG9vbUNvbnRhaW5lclJ1bm5lciB9IGZyb20gXCIuL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXJcIjtcbmltcG9ydCB7IGFkZExsdm1EZWNvcmF0aW9ucywgaGlnaGxpZ2h0TGx2bUVsZW1lbnQgfSBmcm9tIFwiLi9sbHZtSGlnaGxpZ2h0XCI7XG5pbXBvcnQgeyBmaW5kQmxvY2tBdExpbmUsIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcywgcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcbmltcG9ydCB7IEN1c3RvbUxhbmd1YWdlUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9jdXN0b21cIjtcbmltcG9ydCB7IEludGVycHJldGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9pbnRlcnByZXRlZFwiO1xuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xuaW1wb3J0IHsgTWFuYWdlZENvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9tYW5hZ2VkQ29tcGlsZWRcIjtcbmltcG9ydCB7IE5hdGl2ZUNvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9uYXRpdmVDb21waWxlZFwiO1xuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XG5pbXBvcnQgeyBQeXRob25SdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3B5dGhvblwiO1xuaW1wb3J0IHsgUHJvb2ZSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3Byb29mXCI7XG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XG5pbXBvcnQgeyBERUZBVUxUX1NFVFRJTkdTLCBsb29tU2V0dGluZ1RhYiwgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7IGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIgfSBmcm9tIFwiLi91aS9jb2RlQmxvY2tUb29sYmFyXCI7XG5pbXBvcnQgeyBjcmVhdGVPdXRwdXRQYW5lbCwgY3JlYXRlUnVubmluZ1BhbmVsIH0gZnJvbSBcIi4vdWkvb3V0cHV0UGFuZWxcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgbG9vbVJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8dm9pZD4oKTtcblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbVRvb2xiYXJXaWRnZXQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIucGx1Z2luLmlzQmxvY2tSdW5uaW5nKHRoaXMuYmxvY2suaWQpID09PSB0aGlzLnBsdWdpbi5pc0Jsb2NrUnVubmluZyh0aGlzLmJsb2NrLmlkKTtcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jayk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbU91dHB1dFdpZGdldCBleHRlbmRzIFdpZGdldFR5cGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrSWQ6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9ja0lkLCB3cmFwcGVyKTtcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBsb29tUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXG4gICAgbmV3IFB5dGhvblJ1bm5lcigpLFxuICAgIG5ldyBOb2RlUnVubmVyKCksXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXG4gICAgbmV3IE5hdGl2ZUNvbXBpbGVkUnVubmVyKCksXG4gICAgbmV3IEludGVycHJldGVkUnVubmVyKCksXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbnRhaW5lclJ1bm5lciA9IG5ldyBsb29tQ29udGFpbmVyUnVubmVyKHRoaXMuYXBwLCB0aGlzLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIik7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRzID0gbmV3IE1hcDxzdHJpbmcsIGxvb21TdG9yZWRPdXRwdXQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcnVubmluZyA9IG5ldyBNYXA8c3RyaW5nLCBBYm9ydENvbnRyb2xsZXI+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0TGlzdGVuZXJzID0gbmV3IE1hcDxzdHJpbmcsIFNldDwoKSA9PiB2b2lkPj4oKTtcbiAgcHJpdmF0ZSBzdGF0dXNCYXJJdGVtRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBlZGl0b3JWaWV3cyA9IG5ldyBTZXQ8RWRpdG9yVmlldz4oKTtcbiAgcHJpdmF0ZSBsYXN0TWFya2Rvd25GaWxlUGF0aDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBsb29tU2V0dGluZ1RhYih0aGlzKSk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwgPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tY3VycmVudC1jb2RlLWJsb2NrXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBDdXJyZW50IENvZGUgQmxvY2tcIixcbiAgICAgIGVkaXRvckNhbGxiYWNrOiBhc3luYyAoZWRpdG9yLCB2aWV3KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB2aWV3LmZpbGU7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgZWRpdG9yLmdldFZhbHVlKCksIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBibG9jayA9IGZpbmRCbG9ja0F0TGluZShibG9ja3MsIGVkaXRvci5nZXRDdXJzb3IoKS5saW5lKTtcbiAgICAgICAgaWYgKCFibG9jaykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9jayBhdCB0aGUgY3VycmVudCBjdXJzb3IuXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tYWxsLWNvZGUtYmxvY2tzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBBbGwgU3VwcG9ydGVkIENvZGUgQmxvY2tzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tY2xlYXItbm90ZS1vdXRwdXRzXCIsXG4gICAgICBuYW1lOiBcImxvb206IENsZWFyIGxvb20gT3V0cHV0cyBpbiBDdXJyZW50IE5vdGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMuY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbih0aGlzLmNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkpO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgaWYgKGZpbGUgJiYgdGhpcy5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS12YWxpZGF0ZS1jb250YWluZXItZ3JvdXBzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFZhbGlkYXRlIENvbnRhaW5lciBHcm91cHNcIixcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMuZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcbiAgICAgICAgbmV3IE5vdGljZShncm91cHMubGVuZ3RoID8gZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGAke2dyb3VwLm5hbWV9OiAke2dyb3VwLnN0YXR1c31gKS5qb2luKFwiXFxuXCIpIDogXCJObyBsb29tIGNvbnRhaW5lciBncm91cHMgZm91bmQuXCIsIDgwMDApO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItY2hhbmdlXCIsIChfZWRpdG9yLCBjdHgpID0+IHtcbiAgICAgICAgaWYgKGN0eCBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykge1xuICAgICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYoY3R4LmxlYWYpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIHRoaXMucnVubmluZy52YWx1ZXMoKSkge1xuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0ge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIC4uLihhd2FpdCB0aGlzLmxvYWREYXRhKCkpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBpc0Jsb2NrUnVubmluZyhibG9ja0lkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcbiAgfVxuXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgIGlmICghdGhpcy5vdXRwdXRMaXN0ZW5lcnMuaGFzKGJsb2NrSWQpKSB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5zZXQoYmxvY2tJZCwgbmV3IFNldCgpKTtcbiAgICB9XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfVxuXG4gIGNyZWF0ZVRvb2xiYXJFbGVtZW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKGJsb2NrLmlkLCB0aGlzLmlzQmxvY2tSdW5uaW5nKGJsb2NrLmlkKSwge1xuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxuICAgICAgb25Db3B5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNvZGUgY29waWVkXCIpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dCA9IHRoaXMub3V0cHV0cy5nZXQoYmxvY2suaWQpO1xuICAgICAgICBpZiAoIW91dHB1dCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBvdXRwdXQudmlzaWJsZSA9ICFvdXRwdXQudmlzaWJsZTtcbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZW5kZXJPdXRwdXRJbnRvKGJsb2NrSWQ6IHN0cmluZywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZVJ1bm5pbmdQYW5lbCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0KSk7XG4gIH1cblxuICBhc3luYyBydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgaWYgKCFibG9jayB8fCAhZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGlmICghYmxvY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGJsb2NrLmZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5ydW5uaW5nLmdldChibG9ja0lkKT8uYWJvcnQoKTtcbiAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrSWQpO1xuICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2tJZCk7XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrSWQpO1xuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hbmFnZWRSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBjb25zdCByZW1vdmFsU3RhcnQgPSBjdXJyZW50QmxvY2suc3RhcnRMaW5lO1xuICAgICAgY29uc3QgcmVtb3ZhbEVuZCA9IG1hbmFnZWRSYW5nZSA/IG1hbmFnZWRSYW5nZS5lbmQgOiBjdXJyZW50QmxvY2suZW5kTGluZTtcbiAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIHJlbW92YWxFbmQgLSByZW1vdmFsU3RhcnQgKyAxKTtcblxuICAgICAgd2hpbGUgKHJlbW92YWxTdGFydCA8IGxpbmVzLmxlbmd0aCAtIDEgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0XSA9PT0gXCJcIiAmJiBsaW5lc1tyZW1vdmFsU3RhcnQgKyAxXSA9PT0gXCJcIikge1xuICAgICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCAxKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICBuZXcgTm90aWNlKFwibG9vbSBzbmlwcGV0IHJlbW92ZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWxsQmxvY2tzSW5GaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRDb250YWluZXJHcm91cE5hbWUoZmlsZSk7XG4gICAgY29uc3Qgc3VwcG9ydGVkQmxvY2tzID0gY29udGFpbmVyR3JvdXAgPyBibG9ja3MgOiBibG9ja3MuZmlsdGVyKChibG9jaykgPT4gdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncykpO1xuXG4gICAgaWYgKCFzdXBwb3J0ZWRCbG9ja3MubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2Ygc3VwcG9ydGVkQmxvY2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFwibG9vbSBvdXRwdXRzIGNsZWFyZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGxvb20gYmxvY2sgaXMgYWxyZWFkeSBydW5uaW5nLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcbiAgICAgIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSB0aGlzLnJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGUpO1xuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGUpO1xuICAgIGNvbnN0IHJ1bm5lciA9IGNvbnRhaW5lckdyb3VwID8gbnVsbCA6IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBpZiAoIWNvbnRhaW5lckdyb3VwKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYE5vIGNvbmZpZ3VyZWQgcnVubmVyIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3QgcnVuQ29udGV4dCA9IHtcbiAgICAgIGZpbGUsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiB0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgIH07XG4gICAgdGhpcy5ydW5uaW5nLnNldChibG9jay5pZCwgY29udHJvbGxlcik7XG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRhaW5lckdyb3VwXG4gICAgICAgID8gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIucnVuKGJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncyk7XG5cbiAgICAgIGlmIChyZXN1bHQudGltZWRPdXQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgYEV4ZWN1dGlvbiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXN9IG1zLmA7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgXCJFeGVjdXRpb24gY2FuY2VsbGVkLlwiO1xuICAgICAgfSBlbHNlIGlmICghcmVzdWx0LnN1Y2Nlc3MgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBjb250YWluZXJHcm91cCA/IGBjb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyIS5kaXNwbGF5TmFtZTtcbiAgICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSByYW4gJHtydW5uZXJOYW1lfSBibG9jay5gIDogYGxvb20gcnVuIGZhaWxlZCBmb3IgJHtydW5uZXJOYW1lfS5gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBydW5uZXJJZDogY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyOiR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uaWQgPz8gXCJ1bmtub3duXCIsXG4gICAgICAgICAgcnVubmVyTmFtZTogY29udGFpbmVyR3JvdXAgPyBgQ29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uZGlzcGxheU5hbWUgPz8gXCJVbmtub3duXCIsXG4gICAgICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZmluaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICAgIHN0ZG91dDogXCJcIixcbiAgICAgICAgICBzdGRlcnI6IG1lc3NhZ2UsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIG5ldyBOb3RpY2UoYGxvb20gZXJyb3I6ICR7bWVzc2FnZX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IHtcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBzZXR0bGUgPSAodmFsdWU6IGJvb2xlYW4pID0+IHtcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vZGFsID0gbmV3IEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgc2V0dGxlKHRydWUpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG9yaWdpbmFsQ2xvc2UgPSBtb2RhbC5jbG9zZS5iaW5kKG1vZGFsKTtcbiAgICAgIG1vZGFsLmNsb3NlID0gKCkgPT4ge1xuICAgICAgICBvcmlnaW5hbENsb3NlKCk7XG4gICAgICAgIHNldHRsZSh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayk7XG4gICAgICB9O1xuICAgICAgbW9kYWwub3BlbigpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlV29ya2luZ0RpcmVjdG9yeShmaWxlOiBURmlsZSk6IHN0cmluZyB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgICBjb25zdCBmaWxlRm9sZGVyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gZmlsZUZvbGRlciA9PT0gXCIuXCIgPyBhZGFwdGVyQmFzZVBhdGggOiBgJHthZGFwdGVyQmFzZVBhdGh9LyR7ZmlsZUZvbGRlcn1gO1xuICAgIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xuICB9XG5cbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0R3JvdXBTdW1tYXJpZXMoKTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkQ29udGFpbmVyR3JvdXAobmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcbiAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gYnVpbHQgY29udGFpbmVyIGdyb3VwICR7bmFtZX0uYCA6IGBsb29tIGNvbnRhaW5lciBidWlsZCBmYWlsZWQgZm9yICR7bmFtZX0uYCwgODAwMCk7XG4gIH1cblxuICByZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBhbGlhcyBvZiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXModGhpcy5zZXR0aW5ncykpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5oYXMobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKC9bXmEtekEtWjAtOV8tXS8udGVzdChub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xuICAgICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duQ29kZUJsb2NrUHJvY2Vzc29yKG5vcm1hbGl6ZWRBbGlhcywgYXN5bmMgKHNvdXJjZSwgZWwsIGN0eCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGN0eC5zb3VyY2VQYXRoO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IChjdHggJiYgdHlwZW9mIGN0eC5nZXRTZWN0aW9uSW5mbyA9PT0gXCJmdW5jdGlvblwiKSA/IGN0eC5nZXRTZWN0aW9uSW5mbyhlbCkgOiBudWxsO1xuICAgICAgICBsZXQgYmxvY2s6IGxvb21Db2RlQmxvY2sgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChzZWN0aW9uKSB7XG4gICAgICAgICAgY29uc3QgbGluZVN0YXJ0ID0gc2VjdGlvbi5saW5lU3RhcnQ7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuc3RhcnRMaW5lID09PSBsaW5lU3RhcnQgJiYgY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCJwcmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXByZSkge1xuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xuICAgICAgICAgIHByZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29uc3QgY29kZSA9IHByZS5jcmVhdGVFbChcImNvZGVcIik7XG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29kZS5zZXRUZXh0KHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgY29uc3QgY29kZSA9IChwcmUucXVlcnlTZWxlY3RvcihcImNvZGVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBwcmU7XG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsLnNldFRleHQoYWN0aXZlUnVucyA/IGBsb29tOiAke2FjdGl2ZVJ1bnN9IEFjdGl2ZSBSdW4ke2FjdGl2ZVJ1bnMgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCA6IFwibG9vbTogSWRsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmZvckVhY2goKGxpc3RlbmVyKSA9PiBsaXN0ZW5lcigpKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgTWFya2Rvd25WaWV3O1xuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcbiAgICAgIHByZXZpZXdNb2RlPy5yZXJlbmRlcj8uKHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBlZGl0b3JWaWV3IG9mIHRoaXMuZWRpdG9yVmlld3MpIHtcbiAgICAgIGVkaXRvclZpZXcuZGlzcGF0Y2goeyBlZmZlY3RzOiBsb29tUmVmcmVzaEVmZmVjdC5vZih1bmRlZmluZWQpIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgcmV0dXJuIHZpZXc/LmZpbGUgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gIH1cblxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGxlYWY6IFdvcmtzcGFjZUxlYWYpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xuICAgICAgYXdhaXQgbGVhZi5sb2FkSWZEZWZlcnJlZCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgfHwgIXZpZXcuZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3Modmlldy5maWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFibG9ja3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcbiAgICBzdGF0ZS5zb3VyY2UgPSB0cnVlO1xuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgc3RhdGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWZpbGUgfHwgIWVkaXRvcikge1xuICAgICAgcmV0dXJuIHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXM7XG5cbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgICBjbGFzcyB7XG4gICAgICAgIGRlY29yYXRpb25zO1xuXG4gICAgICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdmlldzogRWRpdG9yVmlldykge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5hZGQodmlldyk7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgICAgIGlmICh1cGRhdGUuZG9jQ2hhbmdlZCB8fCB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8IHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMobG9vbVJlZnJlc2hFZmZlY3QpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5kZWxldGUodGhpcy52aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaXZhdGUgYnVpbGREZWNvcmF0aW9ucygpIHtcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBsdWdpbi5nZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTtcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MudG9TdHJpbmcoKTtcbiAgICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgc291cmNlLCBwbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xuICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21Ub29sYmFyV2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGlmIChwbHVnaW4ub3V0cHV0cy5oYXMoYmxvY2suaWQpIHx8IHBsdWdpbi5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2suaWQpLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2suaWQpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0aGlzLnJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9jay5pZCwgcmVzdWx0KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcblxuICAgICAgaWYgKGV4aXN0aW5nUmFuZ2UpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBsaW5lcy5zcGxpY2UoY3VycmVudEJsb2NrLmVuZExpbmUgKyAxLCAwLCAuLi5yZW5kZXJlZCk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoLCBwb3NpeCBhcyBwb3NpeFBhdGggfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgbG9vbUNvbnRhaW5lclJ1bnRpbWUgPSBcImRvY2tlclwiIHwgXCJwb2RtYW5cIiB8IFwicWVtdVwiIHwgXCJjdXN0b21cIjtcblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgZXh0ZW5zaW9uOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBwb3NpdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xuICBuZWdhdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgbG9vbVFlbXVDb25maWcge1xuICBzc2hUYXJnZXQ6IHN0cmluZztcbiAgcmVtb3RlV29ya3NwYWNlOiBzdHJpbmc7XG4gIHNzaEV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIHNzaEFyZ3M/OiBzdHJpbmc7XG4gIHN0YXJ0Q29tbWFuZD86IHN0cmluZztcbiAgYnVpbGRDb21tYW5kPzogc3RyaW5nO1xuICB0ZWFyZG93bkNvbW1hbmQ/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHtcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbn1cblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJDb25maWcge1xuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcbiAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgcWVtdT86IGxvb21RZW11Q29uZmlnO1xuICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+O1xufVxuXG5pbnRlcmZhY2UgbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0IHtcbiAgYWN0aW9uOiBcImJ1aWxkXCIgfCBcInJ1blwiIHwgXCJ0ZWFyZG93blwiO1xuICBncm91cE5hbWU6IHN0cmluZztcbiAgZ3JvdXBQYXRoOiBzdHJpbmc7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBpbWFnZT86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBsYW5ndWFnZT86IHN0cmluZztcbiAgbGFuZ3VhZ2VBbGlhcz86IHN0cmluZztcbiAgZmlsZU5hbWU/OiBzdHJpbmc7XG4gIGZpbGVQYXRoPzogc3RyaW5nO1xuICBjb21tYW5kPzogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgY29uZmlnOiB7XG4gICAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gICAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgbG9vbUNvbnRhaW5lclJ1bm5lciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVpbHRJbWFnZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICkge31cblxuICBnZXRDb250YWluZXJHcm91cE5hbWUoZmlsZTogVEZpbGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIGNvbnN0IGNvbnRhaW5lcnNQYXRoID0gdGhpcy5nZXRDb250YWluZXJzUGF0aCgpO1xuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHJlYWRkaXIgfSA9IGF3YWl0IGltcG9ydChcImZzL3Byb21pc2VzXCIpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGNvbnRhaW5lcnNQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgZW50cmllc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgICAgICBjb25zdCBncm91cFBhdGggPSBqb2luKGNvbnRhaW5lcnNQYXRoLCBlbnRyeS5uYW1lKTtcbiAgICAgICAgICBjb25zdCBoYXNDb25maWcgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpKTtcbiAgICAgICAgICBjb25zdCBoYXNEb2NrZXJmaWxlID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKTtcbiAgICAgICAgICBpZiAoIWhhc0NvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBcIm1pc3NpbmcgY29uZmlnLmpzb25cIixcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IHBpZWNlcyA9IFtgcnVudGltZTogJHtjb25maWcucnVudGltZX1gXTtcbiAgICAgICAgICAgIGlmICgoY29uZmlnLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpICYmIGhhc0RvY2tlcmZpbGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goXCJEb2NrZXJmaWxlXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8uc3NoVGFyZ2V0KSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBzc2g6ICR7Y29uZmlnLnFlbXUuc3NoVGFyZ2V0fWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcImN1c3RvbVwiICYmIGNvbmZpZy5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHdyYXBwZXI6ICR7Y29uZmlnLmN1c3RvbS5leGVjdXRhYmxlfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgbGFuZ3VhZ2VDb3VudCA9IE9iamVjdC5rZXlzKGNvbmZpZy5sYW5ndWFnZXMpLmxlbmd0aDtcbiAgICAgICAgICAgIHBpZWNlcy5wdXNoKGAke2xhbmd1YWdlQ291bnR9IGxhbmd1YWdlJHtsYW5ndWFnZUNvdW50ID09PSAxID8gXCJcIiA6IFwic1wifWApO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBwaWVjZXMuam9pbihcIiwgXCIpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBgaW52YWxpZCBjb25maWcuanNvbjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgZ3JvdXBOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VdID8/IGNvbmZpZy5sYW5ndWFnZXNbYmxvY2subGFuZ3VhZ2VBbGlhc107XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgZ3JvdXAgJHtncm91cE5hbWV9IGhhcyBubyBjb21tYW5kIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICB9XG5cbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgY29uc3QgdGVtcEZpbGVOYW1lID0gYHRlbXBfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfSR7bm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbil9YDtcbiAgICBjb25zdCB0ZW1wRmlsZVBhdGggPSBqb2luKGdyb3VwUGF0aCwgdGVtcEZpbGVOYW1lKTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGVQYXRoLCBibG9jay5jb250ZW50LCBcInV0ZjhcIik7XG4gICAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bk9jaUNvbnRhaW5lcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bkN1c3RvbShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBibG9jaywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgdGVtcEZpbGVQYXRoLCBjb250ZXh0KTtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0odGVtcEZpbGVQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGJ1aWxkR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZ3JvdXBQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZEltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwiYnVpbGRcIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zKSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT2NpQ29udGFpbmVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gYXdhaXQgdGhpcy5yZXNvbHZlSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmNvbW1hbmQucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpKTtcbiAgICBpZiAoIWNvbW1hbmQubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXG4gICAgICAgIFwicnVuXCIsXG4gICAgICAgIFwiLS1ybVwiLFxuICAgICAgICBcIi12XCIsXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXG4gICAgICAgIFwiLXdcIixcbiAgICAgICAgXCIvd29ya3NwYWNlXCIsXG4gICAgICAgIGltYWdlLFxuICAgICAgICAuLi5jb21tYW5kLFxuICAgICAgXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5RZW11KFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBxZW11ID0gdGhpcy5yZXF1aXJlUWVtdUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUuc3RhcnRDb21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzdGFydGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBzdGFydGApO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6aGVhbHRoYCwgYFFFTVUgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlbW90ZUZpbGUgPSBwb3NpeFBhdGguam9pbihxZW11LnJlbW90ZVdvcmtzcGFjZSwgdGVtcEZpbGVOYW1lKTtcbiAgICAgIGNvbnN0IHJlbW90ZUNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgc2hlbGxRdW90ZShyZW1vdGVGaWxlKSk7XG4gICAgICBpZiAoIXJlbW90ZUNvbW1hbmQudHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXVgLFxuICAgICAgICBydW5uZXJOYW1lOiBgUUVNVSAke2dyb3VwTmFtZX1gLFxuICAgICAgICBleGVjdXRhYmxlOiBxZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJzc2hcIixcbiAgICAgICAgYXJnczogW1xuICAgICAgICAgIC4uLnNwbGl0Q29tbWFuZExpbmUocWVtdS5zc2hBcmdzIHx8IFwiXCIpLFxuICAgICAgICAgIHFlbXUuc3NoVGFyZ2V0LFxuICAgICAgICAgIGBjZCAke3NoZWxsUXVvdGUocWVtdS5yZW1vdGVXb3Jrc3BhY2UpfSAmJiAke3JlbW90ZUNvbW1hbmR9YCxcbiAgICAgICAgXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUudGVhcmRvd25Db21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTp0ZWFyZG93bmAsIGBRRU1VICR7Z3JvdXBOYW1lfSB0ZWFyZG93bmApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIHRlbXBGaWxlUGF0aDogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZC5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgZ3JvdXBOYW1lLFxuICAgICAgZ3JvdXBQYXRoLFxuICAgICAgY29uZmlnLFxuICAgICAgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwicnVuXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQudGltZW91dE1zLCB7XG4gICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcbiAgICAgICAgZmlsZU5hbWU6IHRlbXBGaWxlTmFtZSxcbiAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgY29tbWFuZCxcbiAgICAgIH0pLFxuICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICApO1xuXG4gICAgaWYgKGNvbmZpZy5jdXN0b20/LnRlYXJkb3duKSB7XG4gICAgICBjb25zdCB0ZWFyZG93biA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tV3JhcHBlcihcbiAgICAgICAgZ3JvdXBOYW1lLFxuICAgICAgICBncm91cFBhdGgsXG4gICAgICAgIGNvbmZpZyxcbiAgICAgICAgdGhpcy5jcmVhdGVDdXN0b21SZXF1ZXN0KFwidGVhcmRvd25cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgICAgbGFuZ3VhZ2VBbGlhczogYmxvY2subGFuZ3VhZ2VBbGlhcyxcbiAgICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXG4gICAgICAgICAgY29tbWFuZCxcbiAgICAgICAgfSksXG4gICAgICAgIGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBjb250ZXh0LnNpZ25hbCxcbiAgICAgICk7XG4gICAgICBpZiAoIXRlYXJkb3duLnN1Y2Nlc3MpIHtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgQ3VzdG9tIHJ1bnRpbWUgdGVhcmRvd24gZmFpbGVkOiAke3RlYXJkb3duLnN0ZGVyciB8fCB0ZWFyZG93bi5zdGRvdXQgfHwgYGV4aXQgJHt0ZWFyZG93bi5leGl0Q29kZX1gfWA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGRvY2tlcmZpbGUgPSBqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpO1xuICAgIGlmICghZXhpc3RzU3luYyhkb2NrZXJmaWxlKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIjtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjYWNoZUtleSA9IGAke3RoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKX06JHtpbWFnZX1gO1xuICAgIGlmICh0aGlzLmJ1aWx0SW1hZ2VzLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgIHJldHVybiBpbWFnZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSBidWlsZCBmYWlsZWQgZm9yICR7Z3JvdXBOYW1lfS5gKTtcbiAgICB9XG5cbiAgICB0aGlzLmJ1aWx0SW1hZ2VzLmFkZChjYWNoZUtleSk7XG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZEltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgICBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICBgTm8gRG9ja2VyZmlsZSBjb25maWd1cmVkLiBVc2luZyBpbWFnZSAke2NvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIn0uXFxuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1wiYnVpbGRcIiwgXCItdFwiLCBpbWFnZSwgZ3JvdXBQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgaWYgKCFxZW11LmJ1aWxkQ29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGAsIFwiTm8gUUVNVSBidWlsZCBjb21tYW5kIGNvbmZpZ3VyZWQuXFxuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5Db21tYW5kTGluZShxZW11LmJ1aWxkQ29tbWFuZCwgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQ29uZmlnKGdyb3VwUGF0aDogc3RyaW5nKTogUHJvbWlzZTxsb29tQ29udGFpbmVyQ29uZmlnPiB7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpO1xuICAgIGxldCByYXc6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIHJhdyA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgXCJ1dGY4XCIpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcmVhZCBjb250YWluZXIgY29uZmlnICR7Y29uZmlnUGF0aH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cblxuICAgIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gcmF3IGFzIHtcbiAgICAgIHJ1bnRpbWU/OiB1bmtub3duO1xuICAgICAgZXhlY3V0YWJsZT86IHVua25vd247XG4gICAgICBpbWFnZT86IHVua25vd247XG4gICAgICBoZWFsdGhDaGVjaz86IHVua25vd247XG4gICAgICBxZW11PzogdW5rbm93bjtcbiAgICAgIGN1c3RvbT86IHVua25vd247XG4gICAgICBsYW5ndWFnZXM/OiB1bmtub3duO1xuICAgIH07XG4gICAgY29uc3QgcnVudGltZSA9IHRoaXMucmVhZFJ1bnRpbWUoZGF0YS5ydW50aW1lKTtcbiAgICBpZiAoZGF0YS5leGVjdXRhYmxlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBleGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoZGF0YS5pbWFnZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmltYWdlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGltYWdlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoIWRhdGEubGFuZ3VhZ2VzIHx8IHR5cGVvZiBkYXRhLmxhbmd1YWdlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRhdGEubGFuZ3VhZ2VzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBsYW5ndWFnZXMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPiA9IHt9O1xuICAgIGZvciAoY29uc3QgW2xhbmd1YWdlLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZGF0YS5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XG4gICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxhbmd1YWdlQ29uZmlnID0gdmFsdWUgYXMgeyBjb21tYW5kPzogdW5rbm93bjsgZXh0ZW5zaW9uPzogdW5rbm93biB9O1xuICAgICAgaWYgKHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFsYW5ndWFnZUNvbmZpZy5jb21tYW5kLnRyaW0oKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGRlZmluZSBjb21tYW5kLmApO1xuICAgICAgfVxuICAgICAgbGFuZ3VhZ2VzW2xhbmd1YWdlXSA9IHtcbiAgICAgICAgY29tbWFuZDogbGFuZ3VhZ2VDb25maWcuY29tbWFuZCxcbiAgICAgICAgZXh0ZW5zaW9uOiB0eXBlb2YgbGFuZ3VhZ2VDb25maWcuZXh0ZW5zaW9uID09PSBcInN0cmluZ1wiID8gbGFuZ3VhZ2VDb25maWcuZXh0ZW5zaW9uIDogYC4ke2xhbmd1YWdlfWAsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBydW50aW1lLFxuICAgICAgZXhlY3V0YWJsZTogdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSA9PT0gXCJzdHJpbmdcIiAmJiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpID8gZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIGltYWdlOiB0eXBlb2YgZGF0YS5pbWFnZSA9PT0gXCJzdHJpbmdcIiA/IGRhdGEuaW1hZ2UgOiB1bmRlZmluZWQsXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIGhlYWx0aENoZWNrXCIpLFxuICAgICAgcWVtdTogdGhpcy5yZWFkUWVtdUNvbmZpZyhkYXRhLnFlbXUpLFxuICAgICAgY3VzdG9tOiB0aGlzLnJlYWRDdXN0b21Db25maWcoZGF0YS5jdXN0b20pLFxuICAgICAgbGFuZ3VhZ2VzLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRSdW50aW1lKHZhbHVlOiB1bmtub3duKTogbG9vbUNvbnRhaW5lclJ1bnRpbWUge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gXCJkb2NrZXJcIjtcbiAgICB9XG4gICAgaWYgKHZhbHVlID09PSBcImRvY2tlclwiIHx8IHZhbHVlID09PSBcInBvZG1hblwiIHx8IHZhbHVlID09PSBcInFlbXVcIiB8fCB2YWx1ZSA9PT0gXCJjdXN0b21cIikge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHJ1bnRpbWUgbXVzdCBiZSBkb2NrZXIsIHBvZG1hbiwgcWVtdSwgb3IgY3VzdG9tLlwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNzaFRhcmdldCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5zc2hUYXJnZXQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUuc3NoVGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGRhdGEucmVtb3RlV29ya3NwYWNlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5yZW1vdGVXb3Jrc3BhY2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxuICAgICAgcmVtb3RlV29ya3NwYWNlOiBkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCksXG4gICAgICBzc2hFeGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEV4ZWN1dGFibGUpLFxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcbiAgICAgIHN0YXJ0Q29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zdGFydENvbW1hbmQpLFxuICAgICAgYnVpbGRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkQ29tbWFuZCksXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5oZWFsdGhDaGVja1wiKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkQ3VzdG9tQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20gbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuZXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmV4ZWN1dGFibGUgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBleGVjdXRhYmxlOiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5hcmdzKSxcbiAgICAgIGJ1aWxkOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkKSxcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuY29tbWFuZFN0cnVjdHVyZSksXG4gICAgICB0ZWFyZG93bjogb3B0aW9uYWxTdHJpbmcoZGF0YS50ZWFyZG93biksXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIGN1c3RvbS5oZWFsdGhDaGVja1wiKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkSGVhbHRoQ2hlY2sodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhbiBvYmplY3QuYCk7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuY29tbWFuZCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5jb21tYW5kLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfS5jb21tYW5kIG11c3QgYmUgYSBzdHJpbmcuYCk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBjb21tYW5kOiBkYXRhLmNvbW1hbmQudHJpbSgpLFxuICAgICAgcG9zaXRpdmVSZXNwb25zZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5wb3NpdGl2ZVJlc3BvbnNlID8/IGRhdGEucG9zaXRpdmVfcmVzcG9uc2UgPz8gZGF0YVtcInBvc2l0aXZlIHJlc3BvbnNlXCJdID8/IGRhdGEucG9zc2l0aXZlUmVzcG9uc2UpLFxuICAgICAgbmVnYXRpdmVSZXNwb25zZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5uZWdhdGl2ZVJlc3BvbnNlID8/IGRhdGEubmVnYXRpdmVfcmVzcG9uc2UgPz8gZGF0YVtcIm5lZ2F0aXZlIHJlc3BvbnNlXCJdKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZXF1aXJlUWVtdUNvbmZpZyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBsb29tUWVtdUNvbmZpZyB7XG4gICAgaWYgKCFjb25maWcucWVtdSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUUVNVSBydW50aW1lIHJlcXVpcmVzIGEgcWVtdSBjb25maWcgb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5xZW11O1xuICB9XG5cbiAgcHJpdmF0ZSByZXF1aXJlQ3VzdG9tQ29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5jdXN0b20pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1c3RvbSBydW50aW1lIHJlcXVpcmVzIGEgY3VzdG9tIGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLmN1c3RvbTtcbiAgfVxuXG4gIHByaXZhdGUgcnVudGltZUV4ZWN1dGFibGUoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogc3RyaW5nIHtcbiAgICBpZiAoY29uZmlnLmV4ZWN1dGFibGU/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5leGVjdXRhYmxlLnRyaW0oKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiID8gXCJwb2RtYW5cIiA6IFwiZG9ja2VyXCI7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkhlYWx0aENoZWNrKFxuICAgIGhlYWx0aENoZWNrOiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHwgdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWhlYWx0aENoZWNrKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShoZWFsdGhDaGVjay5jb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xuICAgIGNvbnN0IGNvbWJpbmVkT3V0cHV0ID0gYCR7cmVzdWx0LnN0ZG91dH1cXG4ke3Jlc3VsdC5zdGRlcnJ9YDtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgICBpZiAoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSAmJiBjb21iaW5lZE91dHB1dC5pbmNsdWRlcyhoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IHJldHVybmVkIG5lZ2F0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2V9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlICYmICFjb21iaW5lZE91dHB1dC5pbmNsdWRlcyhoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGRpZCBub3QgcmV0dXJuIHBvc2l0aXZlIHJlc3BvbnNlOiAke2hlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2V9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PcHRpb25hbENvbW1hbmQoXG4gICAgY29tbWFuZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWNvbW1hbmQ/LnRyaW0oKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYGV4aXQgJHtyZXN1bHQuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkNvbW1hbmRMaW5lKFxuICAgIGNvbW1hbmQ6IHN0cmluZyxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcGFydHMgPSBzcGxpdENvbW1hbmRMaW5lKGNvbW1hbmQpO1xuICAgIGlmICghcGFydHMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gY29tbWFuZCBpcyBlbXB0eS5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogcGFydHNbMF0sXG4gICAgICBhcmdzOiBwYXJ0cy5zbGljZSgxKSxcbiAgICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBzaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHJlcXVlc3Q6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBjdXN0b20gPSB0aGlzLnJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGN1c3RvbS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOmhlYWx0aGAsIGBDdXN0b20gJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuXG4gICAgY29uc3QgcmVxdWVzdEZpbGVOYW1lID0gYHJlcXVlc3RfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfS5qc29uYDtcbiAgICBjb25zdCByZXF1ZXN0UGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCByZXF1ZXN0RmlsZU5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdFBhdGgsIGAke0pTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpfVxcbmAsIFwidXRmOFwiKTtcbiAgICAgIGNvbnN0IGFyZ3MgPSBzcGxpdENvbW1hbmRMaW5lKGN1c3RvbS5hcmdzIHx8IFwie3JlcXVlc3R9XCIpLm1hcCgoYXJnKSA9PlxuICAgICAgICBhcmdcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntyZXF1ZXN0fVwiLCByZXF1ZXN0UGF0aClcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cH1cIiwgZ3JvdXBOYW1lKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwUGF0aH1cIiwgZ3JvdXBQYXRoKSxcbiAgICAgICk7XG4gICAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206JHtyZXF1ZXN0LmFjdGlvbn1gLFxuICAgICAgICBydW5uZXJOYW1lOiBgQ3VzdG9tICR7Z3JvdXBOYW1lfSAke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IGN1c3RvbS5leGVjdXRhYmxlLFxuICAgICAgICBhcmdzLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHJtKHJlcXVlc3RQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQ3VzdG9tUmVxdWVzdChcbiAgICBhY3Rpb246IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdFtcImFjdGlvblwiXSxcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgZXh0cmE6IFBhcnRpYWw8bG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0PiA9IHt9LFxuICApOiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICAgIHJldHVybiB7XG4gICAgICBhY3Rpb24sXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBydW50aW1lOiBjb25maWcucnVudGltZSxcbiAgICAgIGltYWdlOiBjb25maWcuaW1hZ2UsXG4gICAgICBidWlsZDogY29uZmlnLmN1c3RvbT8uYnVpbGQsXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBjb25maWcuY3VzdG9tPy5jb21tYW5kU3RydWN0dXJlLFxuICAgICAgdGVhcmRvd246IGNvbmZpZy5jdXN0b20/LnRlYXJkb3duLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgY29uZmlnOiB7XG4gICAgICAgIGV4ZWN1dGFibGU6IGNvbmZpZy5leGVjdXRhYmxlLFxuICAgICAgICBjdXN0b206IGNvbmZpZy5jdXN0b20sXG4gICAgICAgIHFlbXU6IGNvbmZpZy5xZW11LFxuICAgICAgICBoZWFsdGhDaGVjazogY29uZmlnLmhlYWx0aENoZWNrLFxuICAgICAgfSxcbiAgICAgIC4uLmV4dHJhLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChydW5uZXJJZDogc3RyaW5nLCBydW5uZXJOYW1lOiBzdHJpbmcsIHN0ZG91dDogc3RyaW5nLCBzdWNjZXNzID0gdHJ1ZSk6IGxvb21SdW5SZXN1bHQge1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICByZXR1cm4ge1xuICAgICAgcnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgc3RhcnRlZEF0OiBub3csXG4gICAgICBmaW5pc2hlZEF0OiBub3csXG4gICAgICBkdXJhdGlvbk1zOiAwLFxuICAgICAgZXhpdENvZGU6IHN1Y2Nlc3MgPyAwIDogLTEsXG4gICAgICBzdGRvdXQsXG4gICAgICBzdGRlcnI6IFwiXCIsXG4gICAgICBzdWNjZXNzLFxuICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgY2FuY2VsbGVkOiBmYWxzZSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDb250YWluZXJzUGF0aCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4oYWRhcHRlckJhc2VQYXRoLCB0aGlzLnBsdWdpbkRpciwgXCJjb250YWluZXJzXCIpKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZU5hbWUgPSBiYXNlbmFtZShncm91cE5hbWUpO1xuICAgIGlmICghc2FmZU5hbWUgfHwgc2FmZU5hbWUgIT09IGdyb3VwTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNvbnRhaW5lciBncm91cCBuYW1lOiAke2dyb3VwTmFtZX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKHRoaXMuZ2V0Q29udGFpbmVyc1BhdGgoKSwgc2FmZU5hbWUpKTtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RG9ja2VyTm90aWNlKG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICBuZXcgTm90aWNlKG1lc3NhZ2UsIDgwMDApO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBydW50aW1lTGFiZWwocnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKHJ1bnRpbWUpIHtcbiAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICByZXR1cm4gXCJEb2NrZXJcIjtcbiAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICByZXR1cm4gXCJQb2RtYW5cIjtcbiAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgcmV0dXJuIFwiUUVNVVwiO1xuICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgIHJldHVybiBcIkN1c3RvbVwiO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsUXVvdGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZUFsbChcIidcIiwgXCInXFxcXCcnXCIpfSdgO1xufVxuIiwgImltcG9ydCB7IG1rZHRlbXAsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gXCJvc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21SdW5SZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tUHJvY2Vzc1NwZWMge1xuICBydW5uZXJJZDogc3RyaW5nO1xuICBydW5uZXJOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG4gIHNpZ25hbDogQWJvcnRTaWduYWw7XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlU3BlYyBleHRlbmRzIGxvb21Qcm9jZXNzU3BlYyB7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRlbXBTb3VyY2VIYW5kbGUge1xuICB0ZW1wRGlyOiBzdHJpbmc7XG4gIHRlbXBGaWxlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZTxUPihcbiAgZmlsZU5hbWU6IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tXCIpKTtcbiAgY29uc3QgdGVtcEZpbGUgPSBqb2luKHRlbXBEaXIsIGZpbGVOYW1lKTtcblxuICB0cnkge1xuICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZSwgbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2UpLCBcInV0ZjhcIik7XG4gICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKHsgdGVtcERpciwgdGVtcEZpbGUgfSk7XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVFeHRlbnNpb246IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoYHNuaXBwZXQke2ZpbGVFeHRlbnNpb259YCwgc291cmNlLCBjYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcbiAgY29uc3Qgbm9uRW1wdHlMaW5lcyA9IGxpbmVzLmZpbHRlcigobGluZSkgPT4gbGluZS50cmltKCkubGVuZ3RoID4gMCk7XG4gIGlmICghbm9uRW1wdHlMaW5lcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgbGV0IHNoYXJlZEluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKG5vbkVtcHR5TGluZXNbMF0pO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygbm9uRW1wdHlMaW5lcy5zbGljZSgxKSkge1xuICAgIHNoYXJlZEluZGVudCA9IHNoYXJlZFdoaXRlc3BhY2VQcmVmaXgoc2hhcmVkSW5kZW50LCBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKSk7XG4gICAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICAgIHJldHVybiBzb3VyY2U7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgcmV0dXJuIGxpbmVzXG4gICAgLm1hcCgobGluZSkgPT4gKGxpbmUudHJpbSgpLmxlbmd0aCA9PT0gMCA/IGxpbmUgOiBsaW5lLnN0YXJ0c1dpdGgoc2hhcmVkSW5kZW50KSA/IGxpbmUuc2xpY2Uoc2hhcmVkSW5kZW50Lmxlbmd0aCkgOiBsaW5lKSlcbiAgICAuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eW1xcdCBdKi8pO1xuICByZXR1cm4gbWF0Y2g/LlswXSA/PyBcIlwiO1xufVxuXG5mdW5jdGlvbiBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KGxlZnQ6IHN0cmluZywgcmlnaHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBpbmRleCA9IDA7XG4gIHdoaWxlIChpbmRleCA8IGxlZnQubGVuZ3RoICYmIGluZGV4IDwgcmlnaHQubGVuZ3RoICYmIGxlZnRbaW5kZXhdID09PSByaWdodFtpbmRleF0pIHtcbiAgICBpbmRleCArPSAxO1xuICB9XG4gIHJldHVybiBsZWZ0LnNsaWNlKDAsIGluZGV4KTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blByb2Nlc3Moc3BlYzogbG9vbVByb2Nlc3NTcGVjKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gIGNvbnN0IHN0YXJ0ZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGxldCBzdGRvdXQgPSBcIlwiO1xuICBsZXQgc3RkZXJyID0gXCJcIjtcbiAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVkT3V0ID0gZmFsc2U7XG4gIGxldCBjYW5jZWxsZWQgPSBmYWxzZTtcbiAgbGV0IGNoaWxkOiBSZXR1cm5UeXBlPHR5cGVvZiBzcGF3bj4gfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVvdXRIYW5kbGU6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIGxldCBhYm9ydEhhbmRsZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY2hpbGQgPSBzcGF3bihzcGVjLmV4ZWN1dGFibGUsIHNwZWMuYXJncywge1xuICAgICAgICBjd2Q6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgc2hlbGw6IGZhbHNlLFxuICAgICAgICBlbnY6IHtcbiAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAuLi5zcGVjLmVudixcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcbiAgICAgICAgY2FuY2VsbGVkID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfTtcbiAgICAgIGFib3J0SGFuZGxlciA9IGFib3J0O1xuXG4gICAgICBpZiAoc3BlYy5zaWduYWwuYWJvcnRlZCkge1xuICAgICAgICBhYm9ydCgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3BlYy5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XG4gICAgICB9XG5cbiAgICAgIHRpbWVvdXRIYW5kbGUgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGltZWRPdXQgPSB0cnVlO1xuICAgICAgICBjaGlsZD8ua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICB9LCBzcGVjLnRpbWVvdXRNcyk7XG5cbiAgICAgIGNoaWxkLnN0ZG91dD8ub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgICBzdGRvdXQgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5zdGRlcnI/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3RkZXJyICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XG4gICAgICAgIGV4aXRDb2RlID0gY29kZTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgc3RkZXJyID0gc3RkZXJyIHx8IGZvcm1hdFByb2Nlc3NFcnJvcihlcnJvciwgc3BlYy5leGVjdXRhYmxlKTtcbiAgICBleGl0Q29kZSA9IGV4aXRDb2RlID8/IC0xO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChhYm9ydEhhbmRsZXIpIHtcbiAgICAgIHNwZWMuc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydEhhbmRsZXIpO1xuICAgIH1cbiAgICBpZiAodGltZW91dEhhbmRsZSkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXRIYW5kbGUpO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGZpbmlzaGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBkdXJhdGlvbk1zID0gZmluaXNoZWRBdC5nZXRUaW1lKCkgLSBzdGFydGVkQXQuZ2V0VGltZSgpO1xuICBjb25zdCBzdWNjZXNzID0gIXRpbWVkT3V0ICYmICFjYW5jZWxsZWQgJiYgZXhpdENvZGUgPT09IDA7XG5cbiAgcmV0dXJuIHtcbiAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICBydW5uZXJOYW1lOiBzcGVjLnJ1bm5lck5hbWUsXG4gICAgc3RhcnRlZEF0OiBzdGFydGVkQXQudG9JU09TdHJpbmcoKSxcbiAgICBmaW5pc2hlZEF0OiBmaW5pc2hlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZHVyYXRpb25NcyxcbiAgICBleGl0Q29kZSxcbiAgICBzdGRvdXQsXG4gICAgc3RkZXJyLFxuICAgIHN1Y2Nlc3MsXG4gICAgdGltZWRPdXQsXG4gICAgY2FuY2VsbGVkLFxuICB9O1xufVxuXG5mdW5jdGlvbiBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3I6IHVua25vd24sIGV4ZWN1dGFibGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIFwiY29kZVwiIGluIGVycm9yICYmIChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICByZXR1cm4gYEV4ZWN1dGFibGUgbm90IGZvdW5kOiAke2V4ZWN1dGFibGV9YDtcbiAgfVxuXG4gIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UZW1wRmlsZVByb2Nlc3Moc3BlYzogbG9vbVRlbXBTb3VyY2VTcGVjKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoc3BlYy5maWxlRXh0ZW5zaW9uLCBzcGVjLnNvdXJjZSwgYXN5bmMgKHsgdGVtcEZpbGUsIHRlbXBEaXIgfSkgPT5cbiAgICBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBzcGVjLnJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc3BlYy5leGVjdXRhYmxlLFxuICAgICAgYXJnczogc3BlYy5hcmdzLm1hcCgodmFsdWUpID0+IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogc3BlYy53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBzcGVjLnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogc3BlYy5zaWduYWwsXG4gICAgICBlbnY6IGV4cGFuZFRlbXBsYXRlZEVudihzcGVjLmVudiwgdGVtcEZpbGUsIHRlbXBEaXIpLFxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBleHBhbmRUZW1wbGF0ZWRFbnYoZW52OiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCwgdGVtcEZpbGU6IHN0cmluZywgdGVtcERpcjogc3RyaW5nKTogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQge1xuICBpZiAoIWVudikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGVudikubWFwKChba2V5LCB2YWx1ZV0pID0+IFtcbiAgICAgIGtleSxcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikgOiB2YWx1ZSxcbiAgICBdKSxcbiAgKTtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gc3BsaXRDb21tYW5kTGluZShpbnB1dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICBsZXQgcXVvdGU6IFwiJ1wiIHwgXCJcXFwiXCIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGVzY2FwaW5nID0gZmFsc2U7XG5cbiAgZm9yIChjb25zdCBjaGFyIG9mIGlucHV0LnRyaW0oKSkge1xuICAgIGlmIChlc2NhcGluZykge1xuICAgICAgY3VycmVudCArPSBjaGFyO1xuICAgICAgZXNjYXBpbmcgPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBcIlxcXFxcIikge1xuICAgICAgZXNjYXBpbmcgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKChjaGFyID09PSBcIidcIiB8fCBjaGFyID09PSBcIlxcXCJcIikgJiYgIXF1b3RlKSB7XG4gICAgICBxdW90ZSA9IGNoYXI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGNoYXIpICYmICFxdW90ZSkge1xuICAgICAgaWYgKGN1cnJlbnQpIHtcbiAgICAgICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9IFwiXCI7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjdXJyZW50ICs9IGNoYXI7XG4gIH1cblxuICBpZiAoY3VycmVudCkge1xuICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG4iLCAiaW1wb3J0IHsgRGVjb3JhdGlvbiwgdHlwZSBFZGl0b3JWaWV3IH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB0eXBlIHsgUmFuZ2VTZXRCdWlsZGVyIH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2sgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgTGx2bVRva2VuIHtcbiAgZnJvbTogbnVtYmVyO1xuICB0bzogbnVtYmVyO1xuICBjbGFzc05hbWU6IHN0cmluZztcbn1cblxuY29uc3QgTExWTV9LRVlXT1JEUyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KFtcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jb250cm9sXCIsIFtcbiAgICBcInJldFwiLCBcImJyXCIsIFwic3dpdGNoXCIsIFwiaW5kaXJlY3RiclwiLCBcImludm9rZVwiLCBcImNhbGxiclwiLCBcInJlc3VtZVwiLCBcInVucmVhY2hhYmxlXCIsIFwiY2xlYW51cHJldFwiLCBcImNhdGNocmV0XCIsIFwiY2F0Y2hzd2l0Y2hcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtZGVjbGFyYXRpb25cIiwgW1xuICAgIFwiZGVmaW5lXCIsIFwiZGVjbGFyZVwiLCBcInR5cGVcIiwgXCJnbG9iYWxcIiwgXCJjb25zdGFudFwiLCBcImFsaWFzXCIsIFwiaWZ1bmNcIiwgXCJjb21kYXRcIiwgXCJhdHRyaWJ1dGVzXCIsIFwic2VjdGlvblwiLCBcImdjXCIsIFwicHJlZml4XCIsIFwicHJvbG9ndWVcIixcbiAgICBcInBlcnNvbmFsaXR5XCIsIFwidXNlbGlzdG9yZGVyXCIsIFwidXNlbGlzdG9yZGVyX2JiXCIsIFwibW9kdWxlXCIsIFwiYXNtXCIsIFwic291cmNlX2ZpbGVuYW1lXCIsIFwidGFyZ2V0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW1lbW9yeVwiLCBbXG4gICAgXCJhbGxvY2FcIiwgXCJsb2FkXCIsIFwic3RvcmVcIiwgXCJnZXRlbGVtZW50cHRyXCIsIFwiZmVuY2VcIiwgXCJjbXB4Y2hnXCIsIFwiYXRvbWljcm13XCIsIFwiZXh0cmFjdHZhbHVlXCIsIFwiaW5zZXJ0dmFsdWVcIiwgXCJleHRyYWN0ZWxlbWVudFwiLFxuICAgIFwiaW5zZXJ0ZWxlbWVudFwiLCBcInNodWZmbGV2ZWN0b3JcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtYXJpdGhtZXRpY1wiLCBbXG4gICAgXCJhZGRcIiwgXCJzdWJcIiwgXCJtdWxcIiwgXCJ1ZGl2XCIsIFwic2RpdlwiLCBcInVyZW1cIiwgXCJzcmVtXCIsIFwic2hsXCIsIFwibHNoclwiLCBcImFzaHJcIiwgXCJhbmRcIiwgXCJvclwiLCBcInhvclwiLCBcImZuZWdcIiwgXCJmYWRkXCIsIFwiZnN1YlwiLCBcImZtdWxcIixcbiAgICBcImZkaXZcIiwgXCJmcmVtXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbXBhcmlzb25cIiwgW1wiaWNtcFwiLCBcImZjbXBcIl0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNhc3RcIiwgW1xuICAgIFwidHJ1bmNcIiwgXCJ6ZXh0XCIsIFwic2V4dFwiLCBcImZwdHJ1bmNcIiwgXCJmcGV4dFwiLCBcImZwdG91aVwiLCBcImZwdG9zaVwiLCBcInVpdG9mcFwiLCBcInNpdG9mcFwiLCBcInB0cnRvaW50XCIsIFwiaW50dG9wdHJcIiwgXCJiaXRjYXN0XCIsIFwiYWRkcnNwYWNlY2FzdFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1vdGhlclwiLCBbXCJwaGlcIiwgXCJzZWxlY3RcIiwgXCJmcmVlemVcIiwgXCJjYWxsXCIsIFwibGFuZGluZ3BhZFwiLCBcImNhdGNocGFkXCIsIFwiY2xlYW51cHBhZFwiLCBcInZhX2FyZ1wiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbW9kaWZpZXJcIiwgW1xuICAgIFwicHJpdmF0ZVwiLCBcImludGVybmFsXCIsIFwiYXZhaWxhYmxlX2V4dGVybmFsbHlcIiwgXCJsaW5rb25jZVwiLCBcIndlYWtcIiwgXCJjb21tb25cIiwgXCJhcHBlbmRpbmdcIiwgXCJleHRlcm5fd2Vha1wiLCBcImxpbmtvbmNlX29kclwiLCBcIndlYWtfb2RyXCIsXG4gICAgXCJleHRlcm5hbFwiLCBcImRlZmF1bHRcIiwgXCJoaWRkZW5cIiwgXCJwcm90ZWN0ZWRcIiwgXCJkbGxpbXBvcnRcIiwgXCJkbGxleHBvcnRcIiwgXCJkc29fbG9jYWxcIiwgXCJkc29fcHJlZW1wdGFibGVcIiwgXCJleHRlcm5hbGx5X2luaXRpYWxpemVkXCIsXG4gICAgXCJ0aHJlYWRfbG9jYWxcIiwgXCJsb2NhbGR5bmFtaWNcIiwgXCJpbml0aWFsZXhlY1wiLCBcImxvY2FsZXhlY1wiLCBcInVubmFtZWRfYWRkclwiLCBcImxvY2FsX3VubmFtZWRfYWRkclwiLCBcImF0b21pY1wiLCBcInVub3JkZXJlZFwiLCBcIm1vbm90b25pY1wiLFxuICAgIFwiYWNxdWlyZVwiLCBcInJlbGVhc2VcIiwgXCJhY3FfcmVsXCIsIFwic2VxX2NzdFwiLCBcInN5bmNzY29wZVwiLCBcInZvbGF0aWxlXCIsIFwic2luZ2xldGhyZWFkXCIsIFwiY2NjXCIsIFwiZmFzdGNjXCIsIFwiY29sZGNjXCIsIFwid2Via2l0X2pzY2NcIixcbiAgICBcImFueXJlZ2NjXCIsIFwicHJlc2VydmVfbW9zdGNjXCIsIFwicHJlc2VydmVfYWxsY2NcIiwgXCJjeHhfZmFzdF90bHNjY1wiLCBcInN3aWZ0Y2NcIiwgXCJ0YWlsY2NcIiwgXCJjZmd1YXJkX2NoZWNrY2NcIiwgXCJ0YWlsXCIsIFwibXVzdHRhaWxcIiwgXCJub3RhaWxcIixcbiAgICBcImZhc3RcIiwgXCJubmFuXCIsIFwibmluZlwiLCBcIm5zelwiLCBcImFyY3BcIiwgXCJjb250cmFjdFwiLCBcImFmblwiLCBcInJlYXNzb2NcIiwgXCJudXdcIiwgXCJuc3dcIiwgXCJleGFjdFwiLCBcImluYm91bmRzXCIsIFwidG9cIiwgXCJ4XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1wcmVkaWNhdGVcIiwgW1xuICAgIFwiZXFcIiwgXCJuZVwiLCBcInVndFwiLCBcInVnZVwiLCBcInVsdFwiLCBcInVsZVwiLCBcInNndFwiLCBcInNnZVwiLCBcInNsdFwiLCBcInNsZVwiLCBcIm9lcVwiLCBcIm9ndFwiLCBcIm9nZVwiLCBcIm9sdFwiLCBcIm9sZVwiLCBcIm9uZVwiLCBcIm9yZFwiLCBcInVlcVwiLCBcInVuZVwiLFxuICAgIFwidW5vXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1hdHRyaWJ1dGVcIiwgW1xuICAgIFwiYWx3YXlzaW5saW5lXCIsIFwiYXJnbWVtb25seVwiLCBcImJ1aWx0aW5cIiwgXCJieXJlZlwiLCBcImJ5dmFsXCIsIFwiY29sZFwiLCBcImNvbnZlcmdlbnRcIiwgXCJkZXJlZmVyZW5jZWFibGVcIiwgXCJkZXJlZmVyZW5jZWFibGVfb3JfbnVsbFwiLCBcImRpc3RpbmN0XCIsXG4gICAgXCJpbW1hcmdcIiwgXCJpbmFsbG9jYVwiLCBcImlucmVnXCIsIFwibXVzdHByb2dyZXNzXCIsIFwibmVzdFwiLCBcIm5vYWxpYXNcIiwgXCJub2NhbGxiYWNrXCIsIFwibm9jYXB0dXJlXCIsIFwibm9mcmVlXCIsIFwibm9pbmxpbmVcIiwgXCJub25sYXp5YmluZFwiLFxuICAgIFwibm9ubnVsbFwiLCBcIm5vcmVjdXJzZVwiLCBcIm5vcmVkem9uZVwiLCBcIm5vcmV0dXJuXCIsIFwibm9zeW5jXCIsIFwibm91bndpbmRcIiwgXCJudWxsX3BvaW50ZXJfaXNfdmFsaWRcIiwgXCJvcGFxdWVcIiwgXCJvcHRub25lXCIsIFwib3B0c2l6ZVwiLFxuICAgIFwicHJlYWxsb2NhdGVkXCIsIFwicmVhZG5vbmVcIiwgXCJyZWFkb25seVwiLCBcInJldHVybmVkXCIsIFwicmV0dXJuc190d2ljZVwiLCBcInNhbml0aXplX2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9od2FkZHJlc3NcIiwgXCJzYW5pdGl6ZV9tZW1vcnlcIixcbiAgICBcInNhbml0aXplX3RocmVhZFwiLCBcInNpZ25leHRcIiwgXCJzcGVjdWxhdGFibGVcIiwgXCJzcmV0XCIsIFwic3NwXCIsIFwic3NwcmVxXCIsIFwic3Nwc3Ryb25nXCIsIFwic3dpZnRhc3luY1wiLCBcInN3aWZ0c2VsZlwiLCBcInN3aWZ0ZXJyb3JcIiwgXCJ1d3RhYmxlXCIsXG4gICAgXCJ3aWxscmV0dXJuXCIsIFwid3JpdGVvbmx5XCIsIFwiemVyb2V4dFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tY29uc3RhbnRcIiwgW1widHJ1ZVwiLCBcImZhbHNlXCIsIFwibnVsbFwiLCBcIm5vbmVcIiwgXCJ1bmRlZlwiLCBcInBvaXNvblwiLCBcInplcm9pbml0aWFsaXplclwiXSksXG5dKTtcblxuY29uc3QgTExWTV9QUklNSVRJVkVfVFlQRVMgPSBuZXcgU2V0KFtcbiAgXCJ2b2lkXCIsIFwibGFiZWxcIiwgXCJ0b2tlblwiLCBcIm1ldGFkYXRhXCIsIFwieDg2X21teFwiLCBcIng4Nl9hbXhcIiwgXCJoYWxmXCIsIFwiYmZsb2F0XCIsIFwiZmxvYXRcIiwgXCJkb3VibGVcIiwgXCJmcDEyOFwiLCBcIng4Nl9mcDgwXCIsIFwicHBjX2ZwMTI4XCIsIFwicHRyXCIsXG5dKTtcblxuY29uc3QgUFVOQ1RVQVRJT05fQ0xBU1MgPSBcImxvb20tbGx2bS1wdW5jdHVhdGlvblwiO1xuXG5leHBvcnQgZnVuY3Rpb24gaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZUVsZW1lbnQ6IEhUTUxFbGVtZW50LCBzb3VyY2U6IHN0cmluZyk6IHZvaWQge1xuICBjb2RlRWxlbWVudC5lbXB0eSgpO1xuICBjb2RlRWxlbWVudC5hZGRDbGFzcyhcImxvb20tbGx2bS1jb2RlXCIpO1xuXG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KFwiXFxuXCIpO1xuICBsaW5lcy5mb3JFYWNoKChsaW5lLCBpbmRleCkgPT4ge1xuICAgIGFwcGVuZEhpZ2hsaWdodGVkTGluZShjb2RlRWxlbWVudCwgbGluZSk7XG4gICAgaWYgKGluZGV4IDwgbGluZXMubGVuZ3RoIC0gMSkge1xuICAgICAgY29kZUVsZW1lbnQuYXBwZW5kVGV4dChcIlxcblwiKTtcbiAgICB9XG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkTGx2bURlY29yYXRpb25zKFxuICBidWlsZGVyOiBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4sXG4gIHZpZXc6IEVkaXRvclZpZXcsXG4gIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuKTogdm9pZCB7XG4gIGNvbnN0IGNvbnRlbnRMaW5lQ291bnQgPSBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrKTtcbiAgaWYgKCFjb250ZW50TGluZUNvdW50KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgbGluZXMgPSBibG9jay5jb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY29udGVudExpbmVDb3VudDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF0gPz8gXCJcIjtcbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZUxsdm1MaW5lKGxpbmUpO1xuICAgIGlmICghdG9rZW5zLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZG9jTGluZSA9IHZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMiArIGluZGV4KTtcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xuICAgICAgaWYgKHRva2VuLmZyb20gPT09IHRva2VuLnRvKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgIGRvY0xpbmUuZnJvbSArIHRva2VuLmZyb20sXG4gICAgICAgIGRvY0xpbmUuZnJvbSArIHRva2VuLnRvLFxuICAgICAgICBEZWNvcmF0aW9uLm1hcmsoeyBjbGFzczogdG9rZW4uY2xhc3NOYW1lIH0pLFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxpbmU6IHN0cmluZyk6IHZvaWQge1xuICBsZXQgY3Vyc29yID0gMDtcblxuICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2VuaXplTGx2bUxpbmUobGluZSkpIHtcbiAgICBpZiAodG9rZW4uZnJvbSA+IGN1cnNvcikge1xuICAgICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IsIHRva2VuLmZyb20pKTtcbiAgICB9XG5cbiAgICBjb25zdCBzcGFuID0gY29udGFpbmVyLmNyZWF0ZVNwYW4oeyBjbHM6IHRva2VuLmNsYXNzTmFtZSB9KTtcbiAgICBzcGFuLnNldFRleHQobGluZS5zbGljZSh0b2tlbi5mcm9tLCB0b2tlbi50bykpO1xuICAgIGN1cnNvciA9IHRva2VuLnRvO1xuICB9XG5cbiAgaWYgKGN1cnNvciA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29udGFpbmVyLmFwcGVuZFRleHQobGluZS5zbGljZShjdXJzb3IpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB0b2tlbml6ZUxsdm1MaW5lKGxpbmU6IHN0cmluZyk6IExsdm1Ub2tlbltdIHtcbiAgY29uc3QgdG9rZW5zOiBMbHZtVG9rZW5bXSA9IFtdO1xuICBsZXQgaW5kZXggPSAwO1xuXG4gIGFkZExhYmVsVG9rZW4obGluZSwgdG9rZW5zKTtcblxuICB3aGlsZSAoaW5kZXggPCBsaW5lLmxlbmd0aCkge1xuICAgIGNvbnN0IGN1cnJlbnQgPSBsaW5lW2luZGV4XTtcbiAgICBpZiAoY3VycmVudCA9PT0gXCI7XCIpIHtcbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBsaW5lLmxlbmd0aCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1jb21tZW50XCIgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjdXJyZW50KSkge1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0cmluZ1Rva2VuID0gcmVhZFN0cmluZ1Rva2VuKGxpbmUsIGluZGV4KTtcbiAgICBpZiAoc3RyaW5nVG9rZW4pIHtcbiAgICAgIGlmIChzdHJpbmdUb2tlbi5wcmVmaXhFbmQgPiBpbmRleCkge1xuICAgICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogc3RyaW5nVG9rZW4ucHJlZml4RW5kLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLXN0cmluZy1wcmVmaXhcIiB9KTtcbiAgICAgIH1cbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogc3RyaW5nVG9rZW4udmFsdWVTdGFydCwgdG86IHN0cmluZ1Rva2VuLnZhbHVlRW5kLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLXN0cmluZ1wiIH0pO1xuICAgICAgaW5kZXggPSBzdHJpbmdUb2tlbi52YWx1ZUVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoZWQgPVxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQGxsdm1cXC5bQS1aYS16JC5fMC05XSsveSwgXCJsb29tLWxsdm0taW50cmluc2ljXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL0BbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfEBcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWdsb2JhbFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8lW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkK1xcYi95LCBcImxvb20tbGx2bS1sb2NhbFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8hW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwhXFxkK1xcYi95LCBcImxvb20tbGx2bS1tZXRhZGF0YVwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXCRbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qL3ksIFwibG9vbS1sbHZtLWNvbWRhdFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC8jXFxkK1xcYi95LCBcImxvb20tbGx2bS1hdHRyaWJ1dGUtZ3JvdXBcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFxiYWRkcnNwYWNlXFxzKlxcKFxccypcXGQrXFxzKlxcKS95LCBcImxvb20tbGx2bS10eXBlXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/MHhbMC05QS1GYS1mXStcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkK3xcXGQrKSg/OltlRV1bLStdP1xcZCspXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCspXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdP1xcZCtcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcLlxcLlxcLi95LCBcImxvb20tbGx2bS1wdW5jdHVhdGlvblwiLCB0b2tlbnMpO1xuXG4gICAgaWYgKG1hdGNoZWQpIHtcbiAgICAgIGluZGV4ID0gbWF0Y2hlZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmQgPSByZWFkV29yZChsaW5lLCBpbmRleCk7XG4gICAgaWYgKHdvcmQpIHtcbiAgICAgIHRva2Vucy5wdXNoKHtcbiAgICAgICAgZnJvbTogaW5kZXgsXG4gICAgICAgIHRvOiB3b3JkLmVuZCxcbiAgICAgICAgY2xhc3NOYW1lOiBjbGFzc2lmeVdvcmQod29yZC52YWx1ZSksXG4gICAgICB9KTtcbiAgICAgIGluZGV4ID0gd29yZC5lbmQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoXCIoKVtde308Piw6PSpcIi5pbmNsdWRlcyhjdXJyZW50KSkge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGluZGV4ICsgMSwgY2xhc3NOYW1lOiBQVU5DVFVBVElPTl9DTEFTUyB9KTtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpbmRleCArPSAxO1xuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnMpO1xufVxuXG5mdW5jdGlvbiBhZGRMYWJlbFRva2VuKGxpbmU6IHN0cmluZywgdG9rZW5zOiBMbHZtVG9rZW5bXSk6IHZvaWQge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxzKikoPzooW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnxcXGQrKXwoJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCspKSg6KS8pO1xuICBpZiAoIW1hdGNoIHx8IG1hdGNoLmluZGV4ID09IG51bGwpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsYWJlbFN0YXJ0ID0gbWF0Y2hbMV0ubGVuZ3RoO1xuICBjb25zdCBsYWJlbFRleHQgPSBtYXRjaFsyXSA/PyBtYXRjaFszXTtcbiAgaWYgKCFsYWJlbFRleHQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCxcbiAgICB0bzogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1sYWJlbFwiLFxuICB9KTtcbiAgdG9rZW5zLnB1c2goe1xuICAgIGZyb206IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoLFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCArIDEsXG4gICAgY2xhc3NOYW1lOiBQVU5DVFVBVElPTl9DTEFTUyxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5V29yZCh3b3JkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoL15pXFxkKyQvLnRlc3Qod29yZCkgfHwgTExWTV9QUklNSVRJVkVfVFlQRVMuaGFzKHdvcmQpKSB7XG4gICAgcmV0dXJuIFwibG9vbS1sbHZtLXR5cGVcIjtcbiAgfVxuXG4gIHJldHVybiBMTFZNX0tFWVdPUkRTLmdldCh3b3JkKSA/PyBcImxvb20tbGx2bS1wbGFpblwiO1xufVxuXG5mdW5jdGlvbiByZWFkV29yZChsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHZhbHVlOiBzdHJpbmc7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSAvW0EtWmEtel9dW0EtWmEtejAtOV8uLV0qL3k7XG4gIG1hdGNoLmxhc3RJbmRleCA9IGluZGV4O1xuICBjb25zdCByZXN1bHQgPSBtYXRjaC5leGVjKGxpbmUpO1xuICBpZiAoIXJlc3VsdCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB2YWx1ZTogcmVzdWx0WzBdLFxuICAgIGVuZDogbWF0Y2gubGFzdEluZGV4LFxuICB9O1xufVxuXG5mdW5jdGlvbiByZWFkU3RyaW5nVG9rZW4obGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogeyBwcmVmaXhFbmQ6IG51bWJlcjsgdmFsdWVTdGFydDogbnVtYmVyOyB2YWx1ZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgbGV0IGN1cnNvciA9IGluZGV4O1xuICBpZiAobGluZVtjdXJzb3JdID09PSBcImNcIiAmJiBsaW5lW2N1cnNvciArIDFdID09PSBcIlxcXCJcIikge1xuICAgIGN1cnNvciArPSAxO1xuICB9XG5cbiAgaWYgKGxpbmVbY3Vyc29yXSAhPT0gXCJcXFwiXCIpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHZhbHVlU3RhcnQgPSBjdXJzb3I7XG4gIGN1cnNvciArPSAxO1xuICB3aGlsZSAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXFxcIikge1xuICAgICAgY3Vyc29yICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJcXFwiXCIpIHtcbiAgICAgIGN1cnNvciArPSAxO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGN1cnNvciArPSAxO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBwcmVmaXhFbmQ6IHZhbHVlU3RhcnQsXG4gICAgdmFsdWVTdGFydCxcbiAgICB2YWx1ZUVuZDogY3Vyc29yLFxuICB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaFJlZ2V4VG9rZW4oXG4gIGxpbmU6IHN0cmluZyxcbiAgaW5kZXg6IG51bWJlcixcbiAgcmVnZXg6IFJlZ0V4cCxcbiAgY2xhc3NOYW1lOiBzdHJpbmcsXG4gIHRva2VuczogTGx2bVRva2VuW10sXG4pOiBudW1iZXIgfCBudWxsIHtcbiAgcmVnZXgubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IG1hdGNoID0gcmVnZXguZXhlYyhsaW5lKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IHJlZ2V4Lmxhc3RJbmRleCwgY2xhc3NOYW1lIH0pO1xuICByZXR1cm4gcmVnZXgubGFzdEluZGV4O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVUb2tlbnModG9rZW5zOiBMbHZtVG9rZW5bXSk6IExsdm1Ub2tlbltdIHtcbiAgdG9rZW5zLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LmZyb20gLSByaWdodC5mcm9tIHx8IGxlZnQudG8gLSByaWdodC50byk7XG4gIGNvbnN0IG5vcm1hbGl6ZWQ6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgaWYgKHRva2VuLnRvIDw9IGN1cnNvcikge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZnJvbSA9IE1hdGgubWF4KHRva2VuLmZyb20sIGN1cnNvcik7XG4gICAgbm9ybWFsaXplZC5wdXNoKHsgLi4udG9rZW4sIGZyb20gfSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZDtcbn1cblxuZnVuY3Rpb24gZ2V0Q29udGVudExpbmVDb3VudChibG9jazogbG9vbUNvZGVCbG9jayk6IG51bWJlciB7XG4gIGlmIChibG9jay5lbmRMaW5lID09PSBibG9jay5zdGFydExpbmUpIHtcbiAgICByZXR1cm4gMDtcbiAgfVxuXG4gIGlmIChibG9jay5jb250ZW50Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBibG9jay5lbmRMaW5lID4gYmxvY2suc3RhcnRMaW5lICsgMSA/IDEgOiAwO1xuICB9XG5cbiAgcmV0dXJuIGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIikubGVuZ3RoO1xufVxuXG5mdW5jdGlvbiBtYXBXb3JkcyhjbGFzc05hbWU6IHN0cmluZywgd29yZHM6IHN0cmluZ1tdKTogQXJyYXk8W3N0cmluZywgc3RyaW5nXT4ge1xuICByZXR1cm4gd29yZHMubWFwKCh3b3JkKSA9PiBbd29yZCwgY2xhc3NOYW1lXSk7XG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJjcnlwdG9cIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHNob3J0SGFzaChpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKGlucHV0KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMTYpO1xufVxuIiwgImltcG9ydCB7IHNob3J0SGFzaCB9IGZyb20gXCIuL3V0aWxzL2hhc2hcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgTEFOR1VBR0VfQUxJQVNFUzogUmVjb3JkPHN0cmluZywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZT4gPSB7XG4gIHB5dGhvbjogXCJweXRob25cIixcbiAgcHk6IFwicHl0aG9uXCIsXG4gIGphdmFzY3JpcHQ6IFwiamF2YXNjcmlwdFwiLFxuICBqczogXCJqYXZhc2NyaXB0XCIsXG4gIHR5cGVzY3JpcHQ6IFwidHlwZXNjcmlwdFwiLFxuICB0czogXCJ0eXBlc2NyaXB0XCIsXG4gIG9jYW1sOiBcIm9jYW1sXCIsXG4gIG1sOiBcIm9jYW1sXCIsXG4gIGM6IFwiY1wiLFxuICBoOiBcImNcIixcbiAgY3BwOiBcImNwcFwiLFxuICBjeHg6IFwiY3BwXCIsXG4gIGNjOiBcImNwcFwiLFxuICBcImMrK1wiOiBcImNwcFwiLFxuICBzaGVsbDogXCJzaGVsbFwiLFxuICBzaDogXCJzaGVsbFwiLFxuICBiYXNoOiBcInNoZWxsXCIsXG4gIHpzaDogXCJzaGVsbFwiLFxuICBydWJ5OiBcInJ1YnlcIixcbiAgcmI6IFwicnVieVwiLFxuICBwZXJsOiBcInBlcmxcIixcbiAgcGw6IFwicGVybFwiLFxuICBsdWE6IFwibHVhXCIsXG4gIHBocDogXCJwaHBcIixcbiAgZ286IFwiZ29cIixcbiAgZ29sYW5nOiBcImdvXCIsXG4gIHJ1c3Q6IFwicnVzdFwiLFxuICByczogXCJydXN0XCIsXG4gIGhhc2tlbGw6IFwiaGFza2VsbFwiLFxuICBoczogXCJoYXNrZWxsXCIsXG4gIGphdmE6IFwiamF2YVwiLFxuICBsbHZtOiBcImxsdm0taXJcIixcbiAgbGx2bWlyOiBcImxsdm0taXJcIixcbiAgXCJsbHZtLWlyXCI6IFwibGx2bS1pclwiLFxuICBsbDogXCJsbHZtLWlyXCIsXG4gIGxlYW46IFwibGVhblwiLFxuICBsZWFuNDogXCJsZWFuXCIsXG4gIGNvcTogXCJjb3FcIixcbiAgdjogXCJjb3FcIixcbiAgc210OiBcInNtdGxpYlwiLFxuICBzbXQyOiBcInNtdGxpYlwiLFxuICBzbXRsaWI6IFwic210bGliXCIsXG4gIFwic210LWxpYlwiOiBcInNtdGxpYlwiLFxuICB6MzogXCJzbXRsaWJcIixcbn07XG5cbmNvbnN0IE9VVFBVVF9TVEFSVCA9IC9ePCEtLVxccypsb29tOm91dHB1dDpzdGFydFxccytpZD0oW2EtZjAtOV0rKVxccyotLT4kL2k7XG5jb25zdCBPVVRQVVRfRU5EID0gL148IS0tXFxzKmxvb206b3V0cHV0OmVuZFxccyotLT4kL2k7XG5jb25zdCBGRU5DRV9TVEFSVCA9IC9eKGBgYCt8fn5+KylcXHMqKFteXFxzYF0qKT8uKiQvO1xuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTGFuZ3VhZ2UocmF3TGFuZ3VhZ2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTm9ybWFsaXplZExhbmd1YWdlIHwgbnVsbCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSByYXdMYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcblxuICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHNldHRpbmdzPy5jdXN0b21MYW5ndWFnZXMgPz8gW10pIHtcbiAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBhbGlhc2VzID0gcGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyk7XG4gICAgaWYgKG5hbWUgJiYgKG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKSkpIHtcbiAgICAgIHJldHVybiBsYW5ndWFnZS5uYW1lLnRyaW0oKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gTEFOR1VBR0VfQUxJQVNFU1tub3JtYWxpemVkXSA/PyBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nW10ge1xuICByZXR1cm4gW1xuICAgIC4uLk9iamVjdC5rZXlzKExBTkdVQUdFX0FMSUFTRVMpLFxuICAgIC4uLihzZXR0aW5ncz8uY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKS5mbGF0TWFwKChsYW5ndWFnZSkgPT4gW2xhbmd1YWdlLm5hbWUsIC4uLnBhcnNlQWxpYXNMaXN0KGxhbmd1YWdlLmFsaWFzZXMpXSksXG4gIF0ubWFwKChhbGlhcykgPT4gYWxpYXMudG9Mb3dlckNhc2UoKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aDogc3RyaW5nLCBzb3VyY2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29kZUJsb2NrW10ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBibG9ja3M6IGxvb21Db2RlQmxvY2tbXSA9IFtdO1xuICBsZXQgb3JkaW5hbCA9IDA7XG4gIGxldCBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXTtcblxuICAgIGlmIChpbnNpZGVNYW5hZ2VkT3V0cHV0KSB7XG4gICAgICBpZiAoT1VUUFVUX0VORC50ZXN0KGxpbmUudHJpbSgpKSkge1xuICAgICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoT1VUUFVUX1NUQVJULnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZlbmNlTWF0Y2ggPSBsaW5lLm1hdGNoKEZFTkNFX1NUQVJUKTtcbiAgICBpZiAoIWZlbmNlTWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0TGluZSA9IGk7XG4gICAgY29uc3QgZmVuY2VJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKTtcbiAgICBjb25zdCBmZW5jZVRva2VuID0gZmVuY2VNYXRjaFsxXTtcbiAgICBjb25zdCBzb3VyY2VMYW5ndWFnZSA9IChmZW5jZU1hdGNoWzJdID8/IFwiXCIpLnRyaW0oKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IG5vcm1hbGl6ZUxhbmd1YWdlKHNvdXJjZUxhbmd1YWdlLCBzZXR0aW5ncyk7XG5cbiAgICBsZXQgZW5kTGluZSA9IGk7XG4gICAgY29uc3QgY29udGVudExpbmVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgIGNvbnN0IGlubmVyTGluZSA9IGxpbmVzW2pdO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyTGluZS50cmltKCk7XG5cbiAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoZmVuY2VUb2tlbikgJiYgL14oYGBgK3x+fn4rKVxccyokLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICAgIGVuZExpbmUgPSBqO1xuICAgICAgICBpID0gajtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnRlbnRMaW5lcy5wdXNoKHN0cmlwRmVuY2VJbmRlbnQoaW5uZXJMaW5lLCBmZW5jZUluZGVudCkpO1xuICAgICAgZW5kTGluZSA9IGo7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgb3JkaW5hbCArPSAxO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBjb250ZW50TGluZXMuam9pbihcIlxcblwiKTtcbiAgICBjb25zdCBjb250ZW50SGFzaCA9IHNob3J0SGFzaChjb250ZW50KTtcbiAgICBjb25zdCBpZCA9IHNob3J0SGFzaChgJHtmaWxlUGF0aH06JHtvcmRpbmFsfToke2xhbmd1YWdlfToke2NvbnRlbnRIYXNofWApO1xuXG4gICAgYmxvY2tzLnB1c2goe1xuICAgICAgaWQsXG4gICAgICBvcmRpbmFsLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGxhbmd1YWdlQWxpYXM6IHNvdXJjZUxhbmd1YWdlLnRvTG93ZXJDYXNlKCksXG4gICAgICBzb3VyY2VMYW5ndWFnZSxcbiAgICAgIGNvbnRlbnQsXG4gICAgICBzdGFydExpbmUsXG4gICAgICBlbmRMaW5lLFxuICAgICAgZmVuY2VTdGFydDogMCxcbiAgICAgIGZlbmNlRW5kOiAwLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGJsb2Nrcztcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGlhc0xpc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZmluZEJsb2NrQXRMaW5lKGJsb2NrczogbG9vbUNvZGVCbG9ja1tdLCBsaW5lOiBudW1iZXIpOiBsb29tQ29kZUJsb2NrIHwgbnVsbCB7XG4gIHJldHVybiBibG9ja3MuZmluZCgoYmxvY2spID0+IGxpbmUgPj0gYmxvY2suc3RhcnRMaW5lICYmIGxpbmUgPD0gYmxvY2suZW5kTGluZSkgPz8gbnVsbDtcbn1cblxuZnVuY3Rpb24gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eW1xcdCBdKi8pO1xuICByZXR1cm4gbWF0Y2g/LlswXSA/PyBcIlwiO1xufVxuXG5mdW5jdGlvbiBzdHJpcEZlbmNlSW5kZW50KGxpbmU6IHN0cmluZywgZmVuY2VJbmRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghZmVuY2VJbmRlbnQpIHtcbiAgICByZXR1cm4gbGluZTtcbiAgfVxuXG4gIGxldCBpbmRleCA9IDA7XG4gIHdoaWxlIChpbmRleCA8IGZlbmNlSW5kZW50Lmxlbmd0aCAmJiBpbmRleCA8IGxpbmUubGVuZ3RoICYmIGxpbmVbaW5kZXhdID09PSBmZW5jZUluZGVudFtpbmRleF0pIHtcbiAgICBpbmRleCArPSAxO1xuICB9XG5cbiAgcmV0dXJuIGxpbmUuc2xpY2UoaW5kZXgpO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBOb2RlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJub2RlXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJOb2RlLmpzXCI7XG4gIGxhbmd1YWdlcyA9IFtcImphdmFzY3JpcHRcIiwgXCJ0eXBlc2NyaXB0XCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuanNcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPT09IFwidHN4XCIgPyBcIlR5cGVTY3JpcHQgKHRzeClcIiA6IFwiVHlwZVNjcmlwdCAodHMtbm9kZSlcIjtcblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7c2V0dGluZ3MudHlwZXNjcmlwdE1vZGV9YCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbUN1c3RvbUxhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBDdXN0b21MYW5ndWFnZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiY3VzdG9tXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJDdXN0b20gbGFuZ3VhZ2VcIjtcbiAgbGFuZ3VhZ2VzID0gW10gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpPy5leGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSB0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk7XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBjdXN0b20gbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtsYW5ndWFnZS5uYW1lfWAsXG4gICAgICBydW5uZXJOYW1lOiBsYW5ndWFnZS5uYW1lLFxuICAgICAgZXhlY3V0YWJsZTogbGFuZ3VhZ2UuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmFyZ3MgfHwgXCJ7ZmlsZX1cIiksXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uLCBsYW5ndWFnZS5uYW1lKSxcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZShibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21DdXN0b21MYW5ndWFnZSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIHJldHVybiBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgobGFuZ3VhZ2UpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGxhbmd1YWdlLmFsaWFzZXNcbiAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICByZXR1cm4gbmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIGlmICghdHJpbW1lZCkge1xuICAgIHJldHVybiBgLiR7bmFtZX1gO1xuICB9XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIEludGVycHJldGVkU3BlYyB7XG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncykgPT4gc3RyaW5nO1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG4gIG1pbmltdW1UaW1lb3V0TXM/OiBudW1iZXI7XG59XG5cbmNvbnN0IElOVEVSUFJFVEVEX1NQRUNTOiBJbnRlcnByZXRlZFNwZWNbXSA9IFtcbiAge1xuICAgIGxhbmd1YWdlOiBcInNoZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiU2hlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnNoZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zaFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicnVieVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlJ1YnlcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnJiXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwZXJsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUGVybFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGVybEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGxcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImx1YVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkx1YVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MubHVhRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sdWFcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBocFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBIUFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGhwRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImdvXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiR29cIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmdvRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5nb1wiLFxuICAgIGFyZ3M6IFtcInJ1blwiLCBcIntmaWxlfVwiXSxcbiAgICBlbnY6IHtcbiAgICAgIEdPQ0FDSEU6IFwie3RlbXBEaXJ9L2dvY2FjaGVcIixcbiAgICB9LFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJIYXNrZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbl07XG5cbmV4cG9ydCBjbGFzcyBJbnRlcnByZXRlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiaW50ZXJwcmV0ZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkludGVycHJldGVkXCI7XG4gIGxhbmd1YWdlcyA9IElOVEVSUFJFVEVEX1NQRUNTLm1hcCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSk7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgcmV0dXJuIEJvb2xlYW4oc3BlYz8uZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICBpZiAoIXNwZWMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX1gLFxuICAgICAgcnVubmVyTmFtZTogc3BlYy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpLFxuICAgICAgYXJnczogc3BlYy5hcmdzID8/IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IHNwZWMuZmlsZUV4dGVuc2lvbixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNwZWMubWluaW11bVRpbWVvdXRNcyA/PyAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBlbnY6IHNwZWMuZW52LFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRTcGVjKGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogSW50ZXJwcmV0ZWRTcGVjIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gSU5URVJQUkVURURfU1BFQ1MuZmluZCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSA9PT0gbGFuZ3VhZ2UpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIExsdm1SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImxsdm0taXJcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkxMVk0gSVJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGx2bS1pclwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiICYmIEJvb2xlYW4oc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxsXCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmICghcmVzdWx0LnRpbWVkT3V0ICYmICFyZXN1bHQuY2FuY2VsbGVkICYmIHJlc3VsdC5leGl0Q29kZSAhPSBudWxsICYmICFyZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgICAgaWYgKHJlc3VsdC5leGl0Q29kZSAhPT0gMCkge1xuICAgICAgICByZXN1bHQuc3VjY2VzcyA9IHRydWU7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gYFByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS4gVW5kZXIgbGxpLCB0aGF0IGJlY29tZXMgdGhlIHByb2Nlc3MgZXhpdCBzdGF0dXMuYDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFyZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgICAgICByZXN1bHQuc3Rkb3V0ID0gcmVzdWx0LmV4aXRDb2RlID09PSAwXG4gICAgICAgICAgPyBcIkxMVk0gcHJvZ3JhbSBleGl0ZWQgd2l0aCBjb2RlIDAuXCJcbiAgICAgICAgICA6IGBMTFZNIHByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS5cXG5Vc2Ugc3Rkb3V0IGluIHRoZSBJUiBpdHNlbGYgaWYgeW91IHdhbnQgcHJpbnRhYmxlIHByb2dyYW0gb3V0cHV0LmA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm1hbmFnZWQtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk1hbmFnZWQgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wicnVzdFwiLCBcImphdmFcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5SdXN0KGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuSmF2YShibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blJ1c3QoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5yc1wiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSmF2YShibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoXCJNYWluLmphdmFcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgaWYgKCFzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6c291cmNlYCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiB0ZW1wRGlyLFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIi1jcFwiLCB0ZW1wRGlyLCBcIk1haW5cIl0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTmF0aXZlQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5hdGl2ZS1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTmF0aXZlIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImNcIiwgXCJjcHBcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY3BwXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSA6IHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IGZpbGVFeHRlbnNpb24gPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIi5jXCIgOiBcIi5jcHBcIjtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCJDIChHQ0MpXCIgOiBcIkMrKyAoRysrKVwiO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShmaWxlRXh0ZW5zaW9uLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHJ1blRlbXBGaWxlUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE9jYW1sUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJvY2FtbFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiT0NhbWxcIjtcbiAgbGFuZ3VhZ2VzID0gW1wib2NhbWxcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcIm9jYW1sXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gc2V0dGluZ3Mub2NhbWxNb2RlO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpO1xuXG4gICAgaWYgKG1vZGUgPT09IFwib2NhbWxcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChtb2RlID09PSBcImR1bmVcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpkdW5lYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJEdW5lIC8gT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiZXhlY1wiLCBcIi0tXCIsIFwib2NhbWxcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5tbFwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLWNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCItb1wiLCBiaW5hcnlQYXRoLCB0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLXJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQeXRob25SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInB5dGhvblwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHl0aG9uXCI7XG4gIGxhbmd1YWdlcyA9IFtcInB5dGhvblwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnB5XCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFByb29mUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJwcm9vZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHJvb2YgY2hlY2tlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJsZWFuXCIsIFwiY29xXCIsIFwic210bGliXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihyZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpsZWFuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJMZWFuXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNvcWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiQ29xXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKSxcbiAgICAgICAgYXJnczogW1wiLXFcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnZcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06c210bGliYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJTTVQtTElCIChaMylcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuc210MlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvb2YgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKTtcbiAgaWYgKGNvbmZpZ3VyZWQgJiYgY29uZmlndXJlZCAhPT0gXCJjb3FjXCIpIHtcbiAgICByZXR1cm4gY29uZmlndXJlZDtcbiAgfVxuXG4gIGNvbnN0IG9wYW1Db3FjID0gam9pbihwcm9jZXNzLmVudi5IT01FID8/IFwiXCIsIFwiLm9wYW1cIiwgXCJkZWZhdWx0XCIsIFwiYmluXCIsIFwiY29xY1wiKTtcbiAgcmV0dXJuIGV4aXN0c1N5bmMob3BhbUNvcWMpID8gb3BhbUNvcWMgOiBjb25maWd1cmVkIHx8IFwiY29xY1wiO1xufVxuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBsb29tUnVubmVyUmVnaXN0cnkge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHJ1bm5lcnM6IGxvb21SdW5uZXJbXSkge31cblxuICBnZXRSdW5uZXJGb3JCbG9jayhibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21SdW5uZXIgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uZXJzLmZpbmQoKHJ1bm5lcikgPT4gKCFydW5uZXIubGFuZ3VhZ2VzLmxlbmd0aCB8fCBydW5uZXIubGFuZ3VhZ2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlKSkgJiYgcnVubmVyLmNhblJ1bihibG9jaywgc2V0dGluZ3MpKSA/PyBudWxsO1xuICB9XG5cbiAgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQodGhpcy5ydW5uZXJzLmZsYXRNYXAoKHJ1bm5lcikgPT4gcnVubmVyLmxhbmd1YWdlcykpXTtcbiAgfVxufVxuIiwgImltcG9ydCB7IE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZywgbm9ybWFsaXplUGF0aCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgbG9vbVBsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IHtcbiAgZW5hYmxlTG9jYWxFeGVjdXRpb246IGZhbHNlLFxuICBoYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrOiBmYWxzZSxcbiAgcHJlc2VydmVTb3VyY2VNb2RlOiB0cnVlLFxuICBkZWZhdWx0VGltZW91dE1zOiA4MDAwLFxuICB3b3JraW5nRGlyZWN0b3J5OiBcIlwiLFxuICBweXRob25FeGVjdXRhYmxlOiBcInB5dGhvbjNcIixcbiAgbm9kZUV4ZWN1dGFibGU6IFwibm9kZVwiLFxuICB0eXBlc2NyaXB0TW9kZTogXCJ0cy1ub2RlXCIsXG4gIHR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZTogXCJ0cy1ub2RlXCIsXG4gIG9jYW1sTW9kZTogXCJvY2FtbFwiLFxuICBvY2FtbEV4ZWN1dGFibGU6IFwib2NhbWxcIixcbiAgY0V4ZWN1dGFibGU6IFwiZ2NjXCIsXG4gIGNwcEV4ZWN1dGFibGU6IFwiZysrXCIsXG4gIHNoZWxsRXhlY3V0YWJsZTogXCJiYXNoXCIsXG4gIHJ1YnlFeGVjdXRhYmxlOiBcInJ1YnlcIixcbiAgcGVybEV4ZWN1dGFibGU6IFwicGVybFwiLFxuICBsdWFFeGVjdXRhYmxlOiBcImx1YVwiLFxuICBwaHBFeGVjdXRhYmxlOiBcInBocFwiLFxuICBnb0V4ZWN1dGFibGU6IFwiZ29cIixcbiAgcnVzdEV4ZWN1dGFibGU6IFwicnVzdGNcIixcbiAgaGFza2VsbEV4ZWN1dGFibGU6IFwicnVuZ2hjXCIsXG4gIGphdmFDb21waWxlckV4ZWN1dGFibGU6IFwiXCIsXG4gIGphdmFFeGVjdXRhYmxlOiBcImphdmFcIixcbiAgbGx2bUludGVycHJldGVyRXhlY3V0YWJsZTogXCJsbGlcIixcbiAgbGVhbkV4ZWN1dGFibGU6IFwibGVhblwiLFxuICBjb3FFeGVjdXRhYmxlOiBcImNvcWNcIixcbiAgc210RXhlY3V0YWJsZTogXCJ6M1wiLFxuICB3cml0ZU91dHB1dFRvTm90ZTogZmFsc2UsXG4gIGF1dG9SdW5PbkZpbGVPcGVuOiBmYWxzZSxcbiAgY3VzdG9tTGFuZ3VhZ2VzOiBbXSxcbiAgcGRmRXhwb3J0TW9kZTogXCJib3RoXCIsXG59O1xuXG5leHBvcnQgY2xhc3MgbG9vbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luKSB7XG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHAsIGxvb21QbHVnaW4pO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwibG9vbVwiIH0pO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiUnVuIHN1cHBvcnRlZCBjb2RlIGZlbmNlcyBkaXJlY3RseSBmcm9tIG5vdGVzIHdoaWxlIHByZXNlcnZpbmcgbmF0aXZlIHN5bnRheCBoaWdobGlnaHRpbmcuXCIgfSk7XG5cbiAgICB0aGlzLnJlbmRlckdlbmVyYWxTZXR0aW5ncyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiR2VuZXJhbCBTZXR0aW5nc1wiLCB0cnVlKSk7XG4gICAgdGhpcy5yZW5kZXJCdWlsdEluUnVudGltZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkJ1aWx0LWluIFJ1bnRpbWVzXCIpKTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ3VzdG9tIExhbmd1YWdlc1wiKSk7XG4gICAgdm9pZCB0aGlzLnJlbmRlckNvbnRhaW5lckdyb3Vwcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ29udGFpbmVyaXphdGlvbiBHcm91cHNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgdGl0bGU6IHN0cmluZywgb3BlbiA9IGZhbHNlKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uXCIgfSk7XG4gICAgZGV0YWlscy5vcGVuID0gb3BlbjtcbiAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IHRpdGxlLCBjbHM6IFwibG9vbS1zZXR0aW5ncy1zdW1tYXJ5XCIgfSk7XG4gICAgcmV0dXJuIGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvbi1ib2R5XCIgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckdlbmVyYWxTZXR0aW5ncyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRW5hYmxlIGxvY2FsIGV4ZWN1dGlvblwiKVxuICAgICAgLnNldERlc2MoXCJEaXNhYmxlZCBieSBkZWZhdWx0LiBsb29tIHJ1bnMgY29kZSBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgYW5kIGRvZXMgbm90IHByb3ZpZGUgc2FuZGJveGluZy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdmFsdWU7XG4gICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgbG9vbSBub3RlcyBpbiBzb3VyY2UgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJQcmVzZXJ2ZSByYXcgZmVuY2VkIGNvZGUgaW4gdGhlIGVkaXRvciBpbnN0ZWFkIG9mIGxldHRpbmcgbGl2ZSBwcmV2aWV3IGNvbGxhcHNlIHJlc2VhcmNoIHNuaXBwZXRzLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB2b2lkIHRoaXMubG9vbVBsdWdpbi5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkRlZmF1bHQgdGltZW91dFwiKVxuICAgICAgLnNldERlc2MoXCJNYXhpbXVtIGV4ZWN1dGlvbiB0aW1lIGluIG1pbGxpc2Vjb25kcyBiZWZvcmUgbG9vbSB0ZXJtaW5hdGVzIHRoZSBwcm9jZXNzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCI4MDAwXCIpLnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcykpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMgPSBwYXJzZWQ7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV29ya2luZyBkaXJlY3RvcnlcIilcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEVtcHR5IHVzZXMgdGhlIGN1cnJlbnQgbm90ZSBmb2xkZXIgd2hlbiBwb3NzaWJsZSwgb3RoZXJ3aXNlIHRoZSB2YXVsdCByb290LlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCJWYXVsdCByb290XCIpLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSA9IHZhbHVlLnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IFwiXCI7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV3JpdGUgb3V0cHV0IGJhY2sgdG8gbm90ZVwiKVxuICAgICAgLnNldERlc2MoXCJJbnNlcnQgbWFuYWdlZCBsb29tIG91dHB1dCBzZWN0aW9ucyBiZW5lYXRoIGNvZGUgYmxvY2tzIGluc3RlYWQgb2Yga2VlcGluZyByZXN1bHRzIHB1cmVseSBpbiB0aGUgVUkuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkF1dG8tcnVuIG9uIGZpbGUgb3BlblwiKVxuICAgICAgLnNldERlc2MoXCJSdW4gYWxsIHN1cHBvcnRlZCBibG9ja3MgaW4gdGhlIGFjdGl2ZSBub3RlIHdoZW4gaXQgb3BlbnMuIERpc2FibGVkIGJ5IGRlZmF1bHQuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3BlbiA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlBERiBleHBvcnQgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2Ugd2hhdCB0byBpbmNsdWRlIHdoZW4gZXhwb3J0aW5nIG5vdGVzIGNvbnRhaW5pbmcgbG9vbSBjb2RlIGJsb2NrcyB0byBQREYuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJib3RoXCIsIFwiQm90aCBDb2RlIGFuZCBPdXRwdXRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY29kZVwiLCBcIkNvZGUgQmxvY2sgT25seVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvdXRwdXRcIiwgXCJPdXRwdXQgT25seVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSB8fCBcImJvdGhcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSA9IHZhbHVlIGFzIFwiYm90aFwiIHwgXCJjb2RlXCIgfCBcIm91dHB1dFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQnVpbHRJblJ1bnRpbWVzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUHl0aG9uIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgUHl0aG9uLlwiLCBcInB5dGhvbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJOb2RlIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgSmF2YVNjcmlwdCBleGVjdXRpb24uXCIsIFwibm9kZUV4ZWN1dGFibGVcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiVHlwZVNjcmlwdCBydW5uZXIgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJVc2UgdHMtbm9kZSBvciB0c3ggZm9yIFR5cGVTY3JpcHQgYmxvY2tzLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwidHMtbm9kZVwiLCBcInRzLW5vZGVcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwidHN4XCIsIFwidHN4XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPSB2YWx1ZSBhcyBcInRzLW5vZGVcIiB8IFwidHN4XCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJUeXBlU2NyaXB0IHRyYW5zcGlsZXIgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgdHMtbm9kZSBvciB0c3guXCIsIFwidHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIk9DYW1sIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGJldHdlZW4gdGhlIE9DYW1sIHRvcGxldmVsLCBvY2FtbGMgY29tcGlsYXRpb24sIG9yIGR1bmUgZXhlYy5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sXCIsIFwib2NhbWxcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxjXCIsIFwib2NhbWxjXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImR1bmVcIiwgXCJkdW5lXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSA9IHZhbHVlIGFzIFwib2NhbWxcIiB8IFwib2NhbWxjXCIgfCBcImR1bmVcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk9DYW1sIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIG9jYW1sLCBvY2FtbGMsIG9yIGR1bmUgZGVwZW5kaW5nIG9uIHRoZSBzZWxlY3RlZCBtb2RlLlwiLCBcIm9jYW1sRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkMgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDIGJsb2Nrcy5cIiwgXCJjRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkMrKyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMrKyBibG9ja3MuXCIsIFwiY3BwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlNoZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNoZWxsLCBCYXNoLCBhbmQgc2ggYmxvY2tzLlwiLCBcInNoZWxsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlJ1YnkgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUnVieSBibG9ja3MuXCIsIFwicnVieUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQZXJsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBlcmwgYmxvY2tzLlwiLCBcInBlcmxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTHVhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEx1YSBibG9ja3MuXCIsIFwibHVhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlBIUCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQSFAgYmxvY2tzLlwiLCBcInBocEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJHbyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBHbyBibG9ja3MuXCIsIFwiZ29FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUnVzdCBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIFJ1c3QgYmxvY2tzLlwiLCBcInJ1c3RFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSGFza2VsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBIYXNrZWxsIGJsb2Nrcy4gRGVmYXVsdHMgdG8gcnVuZ2hjLlwiLCBcImhhc2tlbGxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBjb21waWxlclwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgb3IgcGF0aCBmb3IgamF2YWMuIExlYXZlIGVtcHR5IHRvIHVzZSBKYXZhIHNvdXJjZS1maWxlIG1vZGUuXCIsIFwiamF2YUNvbXBpbGVyRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBjb21waWxlZCBKYXZhIGJsb2Nrcy5cIiwgXCJqYXZhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkxMVk0gSVIgaW50ZXJwcmV0ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgTExWTSBJUiBibG9ja3Mgd2l0aCBsbGkuXCIsIFwibGx2bUludGVycHJldGVyRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkxlYW4gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgTGVhbiBibG9ja3MuXCIsIFwibGVhbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDb3EgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgQ29xIGJsb2NrcyB3aXRoIGNvcWMuXCIsIFwiY29xRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlNNVCBzb2x2ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNNVC1MSUIgYmxvY2tzLiBEZWZhdWx0cyB0byB6My5cIiwgXCJzbXRFeGVjdXRhYmxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWxpc3RcIiB9KTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChsaXN0RWwpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkFkZCBjdXN0b20gbGFuZ3VhZ2VcIilcbiAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGxvY2FsIGNvbW1hbmQtYmFja2VkIGxhbmd1YWdlLlwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IFwiY3VzdG9tLWxhbmd1YWdlXCIsXG4gICAgICAgICAgICBhbGlhc2VzOiBcIlwiLFxuICAgICAgICAgICAgZXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGFyZ3M6IFwie2ZpbGV9XCIsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLnR4dFwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGlmICghdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gY3VzdG9tIGxhbmd1YWdlcyBjb25maWd1cmVkLlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZvckVhY2goKGxhbmd1YWdlLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZVwiIH0pO1xuICAgICAgZGV0YWlscy5vcGVuID0gdHJ1ZTtcbiAgICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogbGFuZ3VhZ2UubmFtZSB8fCBgQ3VzdG9tIGxhbmd1YWdlICR7aW5kZXggKyAxfWAgfSk7XG4gICAgICBjb25zdCBib2R5ID0gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtYm9keVwiIH0pO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiTmFtZVwiLCBcIk5vcm1hbGl6ZWQgbGFuZ3VhZ2UgaWQgdXNlZCBieSBsb29tLlwiLCBcIm5hbWVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQWxpYXNlc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBmZW5jZSBhbGlhc2VzLlwiLCBcImFsaWFzZXNcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXhlY3V0YWJsZVwiLCBcIkxvY2FsIGNvbW1hbmQgb3IgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRoLlwiLCBcImV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQXJndW1lbnRzXCIsIFwiU3BhY2Utc2VwYXJhdGVkIGFyZ3VtZW50cy4gVXNlIHtmaWxlfSBmb3IgdGhlIHRlbXAgc291cmNlIGZpbGUuXCIsIFwiYXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRlbnNpb25cIiwgXCJUZW1wIHNvdXJjZSBmaWxlIGV4dGVuc2lvbiwgZm9yIGV4YW1wbGUgLnB5LlwiLCBcImV4dGVuc2lvblwiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJEZWxldGUgbGFuZ3VhZ2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdmUgdGhpcyBjdXN0b20gbGFuZ3VhZ2UuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkRlbGV0ZVwiKS5zZXRXYXJuaW5nKCkub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyQ29udGFpbmVyR3JvdXBzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWNvbnRhaW5lci1ncm91cC1saXN0XCIgfSk7XG4gICAgbGlzdEVsLnNldFRleHQoXCJTY2FubmluZyBjb250YWluZXIgZ3JvdXBzLi4uXCIpO1xuXG4gICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5sb29tUGx1Z2luLmdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk7XG4gICAgbGlzdEVsLmVtcHR5KCk7XG5cbiAgICBpZiAoIWdyb3Vwcy5sZW5ndGgpIHtcbiAgICAgIGxpc3RFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIGNvbnRhaW5lciBncm91cHMgZm91bmQgaW4gLm9ic2lkaWFuL3BsdWdpbnMvbG9vbS9jb250YWluZXJzLlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgbmV3IFNldHRpbmcobGlzdEVsKVxuICAgICAgICAuc2V0TmFtZShncm91cC5uYW1lKVxuICAgICAgICAuc2V0RGVzYyhncm91cC5zdGF0dXMpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkJ1aWxkIC8gcmVidWlsZFwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5idWlsZENvbnRhaW5lckdyb3VwKGdyb3VwLm5hbWUpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYWRkVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21QbHVnaW5TZXR0aW5ncz4oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcsIGtleTogSyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gYXMgc3RyaW5nKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbUN1c3RvbUxhbmd1YWdlPihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgbGFuZ3VhZ2U6IGxvb21DdXN0b21MYW5ndWFnZSxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGVzY3JpcHRpb246IHN0cmluZyxcbiAgICBrZXk6IEssXG4gICk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUobGFuZ3VhZ2Vba2V5XSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgbGFuZ3VhZ2Vba2V5XSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk6IHZvaWQge1xuICBuZXcgTm90aWNlKFwibG9vbSBsb2NhbCBleGVjdXRpb24gaXMgZGlzYWJsZWQuIEVuYWJsZSBpdCBpbiBzZXR0aW5ncyBvciBjb25maXJtIHRoZSBleGVjdXRpb24gd2FybmluZyBmaXJzdC5cIik7XG59XG4iLCAiaW1wb3J0IHsgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Ub29sYmFySGFuZGxlcnMge1xuICBvblJ1bjogKCkgPT4gdm9pZDtcbiAgb25Db3B5OiAoKSA9PiB2b2lkO1xuICBvblJlbW92ZTogKCkgPT4gdm9pZDtcbiAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHZvaWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKFxuICBibG9ja0lkOiBzdHJpbmcsXG4gIGlzUnVubmluZzogYm9vbGVhbixcbiAgaGFuZGxlcnM6IGxvb21Ub29sYmFySGFuZGxlcnMsXG4pOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHRvb2xiYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICB0b29sYmFyLmNsYXNzTmFtZSA9IFwibG9vbS1jb2RlLXRvb2xiYXJcIjtcbiAgdG9vbGJhci5kYXRhc2V0Lmxvb21CbG9ja0lkID0gYmxvY2tJZDtcblxuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJ1biBibG9ja1wiLCBpc1J1bm5pbmcgPyBcImxvYWRlci1jaXJjbGVcIiA6IFwicGxheVwiLCBoYW5kbGVycy5vblJ1biwgaXNSdW5uaW5nKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiQ29weSBjb2RlXCIsIFwiY29weVwiLCBoYW5kbGVycy5vbkNvcHksIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUmVtb3ZlIHNuaXBwZXRcIiwgXCJ0cmFzaC0yXCIsIGhhbmRsZXJzLm9uUmVtb3ZlLCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlRvZ2dsZSBvdXRwdXRcIiwgXCJwYW5lbC1ib3R0b20tb3BlblwiLCBoYW5kbGVycy5vblRvZ2dsZU91dHB1dCwgZmFsc2UpKTtcblxuICByZXR1cm4gdG9vbGJhcjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQnV0dG9uKGxhYmVsOiBzdHJpbmcsIGljb25OYW1lOiBzdHJpbmcsIG9uQ2xpY2s6ICgpID0+IHZvaWQsIHNwaW5uaW5nOiBib29sZWFuKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xuICBjb25zdCBidXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICBidXR0b24uY2xhc3NOYW1lID0gYGxvb20tdG9vbGJhci1idXR0b24ke3NwaW5uaW5nID8gXCIgaXMtcnVubmluZ1wiIDogXCJcIn1gO1xuICBidXR0b24udHlwZSA9IFwiYnV0dG9uXCI7XG4gIGJ1dHRvbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGxhYmVsKTtcbiAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIG9uQ2xpY2soKTtcbiAgfSk7XG4gIHNldEljb24oYnV0dG9uLCBpY29uTmFtZSk7XG4gIHJldHVybiBidXR0b247XG59XG4iLCAiaW1wb3J0IHsgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmZ1bmN0aW9uIGdldFN0YXR1c0tpbmQob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogXCJzdWNjZXNzXCIgfCBcIndhcm5pbmdcIiB8IFwiZmFpbHVyZVwiIHtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3VjY2Vzcykge1xuICAgIHJldHVybiBvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkgfHwgb3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkgPyBcIndhcm5pbmdcIiA6IFwic3VjY2Vzc1wiO1xuICB9XG5cbiAgcmV0dXJuIFwiZmFpbHVyZVwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IGBsb29tLW91dHB1dC1wYW5lbCBpcy0ke2dldFN0YXR1c0tpbmQob3V0cHV0KX0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifWA7XG4gIHBhbmVsLmRhdGFzZXQubG9vbUJsb2NrSWQgPSBvdXRwdXQuYmxvY2tJZDtcbiAgcmVuZGVyT3V0cHV0UGFuZWwocGFuZWwsIG91dHB1dCk7XG4gIHJldHVybiBwYW5lbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsOiBIVE1MRWxlbWVudCwgb3V0cHV0OiBsb29tU3RvcmVkT3V0cHV0KTogdm9pZCB7XG4gIGNvbnN0IGtpbmQgPSBnZXRTdGF0dXNLaW5kKG91dHB1dCk7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IGBsb29tLW91dHB1dC1wYW5lbCBpcy0ke2tpbmR9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn0ke291dHB1dC5jb2xsYXBzZWQgPyBcIiBpcy1jb2xsYXBzZWRcIiA6IFwiXCJ9YDtcbiAgcGFuZWwuZW1wdHkoKTtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IGJhZGdlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1iYWRnZVwiIH0pO1xuICBzZXRJY29uKGJhZGdlLCBraW5kID09PSBcInN1Y2Nlc3NcIiA/IFwiY2hlY2stY2lyY2xlLTJcIiA6IGtpbmQgPT09IFwid2FybmluZ1wiID8gXCJhbGVydC10cmlhbmdsZVwiIDogXCJ4LWNpcmNsZVwiKTtcblxuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LnJ1bm5lck5hbWV9IFx1MDBCNyBleGl0ICR7b3V0cHV0LnJlc3VsdC5leGl0Q29kZSA/PyBcIj9cIn1gKTtcblxuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LmR1cmF0aW9uTXN9IG1zIFx1MDBCNyAke25ldyBEYXRlKG91dHB1dC5yZXN1bHQuZmluaXNoZWRBdCkudG9Mb2NhbGVUaW1lU3RyaW5nKCl9YCk7XG5cbiAgY29uc3QgYm9keSA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1ib2R5XCIgfSk7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRvdXRcIiwgb3V0cHV0LnJlc3VsdC5zdGRvdXQpO1xuICB9XG4gIGlmIChvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIldhcm5pbmdcIiwgb3V0cHV0LnJlc3VsdC53YXJuaW5nKTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3RkZXJyXCIsIG91dHB1dC5yZXN1bHQuc3RkZXJyKTtcbiAgfVxuICBpZiAoIW91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgIGNvbnN0IGVtcHR5ID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtZW1wdHlcIiB9KTtcbiAgICBlbXB0eS5zZXRUZXh0KFwiTm8gb3V0cHV0XCIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbShjb250YWluZXI6IEhUTUxFbGVtZW50LCBsYWJlbDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc2VjdGlvbiA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtXCIgfSk7XG4gIHNlY3Rpb24uY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgc2VjdGlvbi5jcmVhdGVFbChcInByZVwiLCB7IGNsczogXCJsb29tLW91dHB1dC1wcmVcIiwgdGV4dDogY29udGVudCB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJ1bm5pbmdQYW5lbCgpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gXCJsb29tLW91dHB1dC1wYW5lbCBpcy1ydW5uaW5nXCI7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBzcGlubmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNwaW5uZXJcIiB9KTtcbiAgc2V0SWNvbihzcGlubmVyLCBcImxvYWRlci1jaXJjbGVcIik7XG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KFwiUnVubmluZ1wiKTtcbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoXCJFeGVjdXRpbmcuLi5cIik7XG4gIHNwaW5uZXIuc2V0QXR0cmlidXRlKFwiYXJpYS1oaWRkZW5cIiwgXCJ0cnVlXCIpO1xuXG4gIHJldHVybiBwYW5lbDtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFRTztBQUNQLG1CQUE2QztBQUM3QyxJQUFBQyxlQUEyRTtBQUMzRSxJQUFBQyxlQUF3Qjs7O0FDWHhCLHNCQUE2QztBQUM3QyxnQkFBMkI7QUFDM0IsSUFBQUMsbUJBQStDO0FBQy9DLElBQUFDLGVBQWlGOzs7QUNIakYsc0JBQXVDO0FBQ3ZDLGdCQUF1QjtBQUN2QixrQkFBcUI7QUFDckIsMkJBQXNCO0FBd0J0QixlQUFzQix3QkFDcEIsVUFDQSxRQUNBLFVBQ1k7QUFDWixRQUFNLFVBQVUsVUFBTSw2QkFBUSxzQkFBSyxrQkFBTyxHQUFHLE9BQU8sQ0FBQztBQUNyRCxRQUFNLGVBQVcsa0JBQUssU0FBUyxRQUFRO0FBRXZDLE1BQUk7QUFDRixjQUFNLDJCQUFVLFVBQVUsMEJBQTBCLE1BQU0sR0FBRyxNQUFN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UUFBUSxPQUFPLFlBQVksR0FBRztBQUFBLE1BQzlCLFlBQVksT0FBTyxVQUFVO0FBQUEsTUFDN0IsYUFBYSxPQUFPLFVBQVU7QUFBQSxNQUM5QixPQUFPLFNBQVM7QUFBQSxFQUFZLE9BQU8sTUFBTSxLQUFLO0FBQUEsTUFDOUMsT0FBTyxVQUFVO0FBQUEsRUFBYSxPQUFPLE9BQU8sS0FBSztBQUFBLE1BQ2pELE9BQU8sU0FBUztBQUFBLEVBQVksT0FBTyxNQUFNLEtBQUs7QUFBQSxJQUNoRCxFQUNHLE9BQU8sT0FBTyxFQUNkLEtBQUssTUFBTTtBQUVkLFdBQU87QUFBQSxNQUNMLDZCQUE2QixPQUFPO0FBQUEsTUFDcEM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRVEsdUJBQXVCLE9BQWlCLFNBQXdEO0FBQ3RHLFVBQU0sY0FBYyw2QkFBNkIsT0FBTztBQUN4RCxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEMsVUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sYUFBYTtBQUNuQztBQUFBLE1BQ0Y7QUFFQSxlQUFTLElBQUksSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUM1QyxZQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSw0QkFBNEI7QUFDbEQsaUJBQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDNUI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfdmlldyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X3BhdGgiLCAicG9zaXhQYXRoIiwgIm5vcm1hbGl6ZUZzUGF0aCIsICJnZXRMZWFkaW5nV2hpdGVzcGFjZSIsICJub3JtYWxpemVFeHRlbnNpb24iLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X2ZzIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJsb29tUGx1Z2luIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iXQp9Cg==
