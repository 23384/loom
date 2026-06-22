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
var import_child_process2 = require("child_process");

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
          if (config.runtime === "qemu" && config.qemu?.manager?.enabled) {
            pieces.push(`manager: ${await this.getManagedQemuStatus(groupPath, config.qemu.manager)}`);
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
    await this.ensureManagedQemu(groupName, groupPath, qemu, context.timeoutMs, context.signal);
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
      await this.stopManagedQemuIfNeeded(groupName, groupPath, qemu, context.timeoutMs, context.signal);
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
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config qemu.healthCheck"),
      manager: this.readQemuManagerConfig(data.manager)
    };
  }
  readQemuManagerConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu.manager must be an object.");
    }
    const data = value;
    return {
      enabled: data.enabled !== false,
      executable: optionalString(data.executable),
      args: optionalString(data.args),
      image: optionalString(data.image),
      imageFormat: optionalString(data.imageFormat),
      pidFile: optionalString(data.pidFile),
      logFile: optionalString(data.logFile),
      readinessTimeoutMs: optionalPositiveInteger(data.readinessTimeoutMs, "Container config qemu.manager.readinessTimeoutMs"),
      readinessIntervalMs: optionalPositiveInteger(data.readinessIntervalMs, "Container config qemu.manager.readinessIntervalMs"),
      bootDelayMs: optionalNonNegativeInteger(data.bootDelayMs, "Container config qemu.manager.bootDelayMs"),
      shutdownCommand: optionalString(data.shutdownCommand),
      shutdownTimeoutMs: optionalPositiveInteger(data.shutdownTimeoutMs, "Container config qemu.manager.shutdownTimeoutMs"),
      killSignal: optionalSignal(data.killSignal, "Container config qemu.manager.killSignal"),
      persist: typeof data.persist === "boolean" ? data.persist : void 0
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
  async ensureManagedQemu(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const existingPid = await this.readPidFile(pidPath);
    if (existingPid && this.isProcessRunning(existingPid)) {
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
      return;
    }
    if (existingPid) {
      await (0, import_promises2.rm)(pidPath, { force: true });
    }
    const executable = manager.executable || "qemu-system-x86_64";
    const args = this.buildManagedQemuArgs(groupPath, manager);
    if (!args.length) {
      throw new Error(`QEMU manager for ${groupName} needs qemu.manager.args or qemu.manager.image.`);
    }
    const logPath = manager.logFile ? this.resolveGroupFilePath(groupPath, manager.logFile) : null;
    const logFd = logPath ? (0, import_fs.openSync)(logPath, "a") : null;
    try {
      const child = (0, import_child_process2.spawn)(executable, args, {
        cwd: groupPath,
        detached: true,
        stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"]
      });
      child.on("error", () => void 0);
      child.unref();
      if (!child.pid) {
        throw new Error(`QEMU manager for ${groupName} did not return a process id.`);
      }
      await (0, import_promises2.writeFile)(pidPath, `${child.pid}
`, "utf8");
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
    } finally {
      if (logFd != null) {
        (0, import_fs.closeSync)(logFd);
      }
    }
  }
  buildManagedQemuArgs(groupPath, manager) {
    const args = splitCommandLine(manager.args || "");
    if (manager.image) {
      const imagePath = this.resolveGroupFilePath(groupPath, manager.image);
      args.push("-drive", `file=${imagePath},if=virtio,format=${manager.imageFormat || "qcow2"}`);
    }
    return args;
  }
  async waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }
    if (!qemu.healthCheck) {
      await sleepWithSignal(manager.bootDelayMs ?? 0, signal);
      return;
    }
    const timeout = Math.min(manager.readinessTimeoutMs ?? 6e4, Math.max(timeoutMs, 1));
    const interval = manager.readinessIntervalMs ?? 1e3;
    const startedAt = Date.now();
    let lastError = "";
    while (Date.now() - startedAt <= timeout) {
      if (signal.aborted) {
        throw new Error(`QEMU ${groupName} readiness wait cancelled.`);
      }
      try {
        await this.runHealthCheck(qemu.healthCheck, groupPath, Math.min(interval, timeout), signal, `container:${groupName}:qemu:ready`, `QEMU ${groupName} readiness check`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await sleepWithSignal(interval, signal);
    }
    throw new Error(`QEMU ${groupName} did not become ready within ${timeout} ms${lastError ? `: ${lastError}` : "."}`);
  }
  async stopManagedQemuIfNeeded(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled || manager.persist !== false) {
      return;
    }
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return;
    }
    if (manager.shutdownCommand) {
      await this.runOptionalCommand(
        manager.shutdownCommand,
        groupPath,
        Math.min(manager.shutdownTimeoutMs ?? timeoutMs, timeoutMs),
        signal,
        `container:${groupName}:qemu:shutdown`,
        `QEMU ${groupName} shutdown`
      );
    } else if (this.isProcessRunning(pid)) {
      process.kill(pid, manager.killSignal || "SIGTERM");
    }
    const stopped = await this.waitForProcessExit(pid, manager.shutdownTimeoutMs ?? 1e4, signal);
    if (!stopped && this.isProcessRunning(pid)) {
      process.kill(pid, "SIGKILL");
      await this.waitForProcessExit(pid, 2e3, signal);
    }
    await (0, import_promises2.rm)(pidPath, { force: true });
  }
  async getManagedQemuStatus(groupPath, manager) {
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return "stopped";
    }
    return this.isProcessRunning(pid) ? `running pid ${pid}` : `stale pid ${pid}`;
  }
  async readPidFile(pidPath) {
    try {
      const value = (await (0, import_promises2.readFile)(pidPath, "utf8")).trim();
      const pid = Number.parseInt(value, 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  async waitForProcessExit(pid, timeoutMs, signal) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (signal.aborted) {
        return false;
      }
      if (!this.isProcessRunning(pid)) {
        return true;
      }
      await sleepWithSignal(250, signal);
    }
    return !this.isProcessRunning(pid);
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
  resolveGroupFilePath(groupPath, filePath) {
    const safePath = (0, import_path2.normalize)((0, import_path2.join)(groupPath, filePath));
    const normalizedGroupPath = (0, import_path2.normalize)(groupPath);
    if (safePath !== normalizedGroupPath && !safePath.startsWith(`${normalizedGroupPath}/`)) {
      throw new Error(`Invalid QEMU manager path outside container group: ${filePath}`);
    }
    return safePath;
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
function optionalPositiveInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}
function optionalNonNegativeInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}
function optionalSignal(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "string" || !/^SIG[A-Z0-9]+$/.test(value)) {
    throw new Error(`${label} must be a signal name like SIGTERM.`);
  }
  return value;
}
async function sleepWithSignal(durationMs, signal) {
  if (durationMs <= 0 || signal.aborted) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL3J1bm5lcnMvbm9kZS50cyIsICJzcmMvcnVubmVycy9jdXN0b20udHMiLCAic3JjL3J1bm5lcnMvaW50ZXJwcmV0ZWQudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvdWkvY29kZUJsb2NrVG9vbGJhci50cyIsICJzcmMvdWkvb3V0cHV0UGFuZWwudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUmVuZGVyQ2hpbGQsXG4gIE1hcmtkb3duVmlldyxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgeyBEZWNvcmF0aW9uLCBFZGl0b3JWaWV3LCBWaWV3UGx1Z2luLCBWaWV3VXBkYXRlLCBXaWRnZXRUeXBlIH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbG9vbUNvbnRhaW5lclJ1bm5lciB9IGZyb20gXCIuL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXJcIjtcbmltcG9ydCB7IGFkZExsdm1EZWNvcmF0aW9ucywgaGlnaGxpZ2h0TGx2bUVsZW1lbnQgfSBmcm9tIFwiLi9sbHZtSGlnaGxpZ2h0XCI7XG5pbXBvcnQgeyBmaW5kQmxvY2tBdExpbmUsIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcywgcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcbmltcG9ydCB7IEN1c3RvbUxhbmd1YWdlUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9jdXN0b21cIjtcbmltcG9ydCB7IEludGVycHJldGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9pbnRlcnByZXRlZFwiO1xuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xuaW1wb3J0IHsgTWFuYWdlZENvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9tYW5hZ2VkQ29tcGlsZWRcIjtcbmltcG9ydCB7IE5hdGl2ZUNvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9uYXRpdmVDb21waWxlZFwiO1xuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XG5pbXBvcnQgeyBQeXRob25SdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3B5dGhvblwiO1xuaW1wb3J0IHsgUHJvb2ZSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3Byb29mXCI7XG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XG5pbXBvcnQgeyBERUZBVUxUX1NFVFRJTkdTLCBsb29tU2V0dGluZ1RhYiwgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7IGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIgfSBmcm9tIFwiLi91aS9jb2RlQmxvY2tUb29sYmFyXCI7XG5pbXBvcnQgeyBjcmVhdGVPdXRwdXRQYW5lbCwgY3JlYXRlUnVubmluZ1BhbmVsIH0gZnJvbSBcIi4vdWkvb3V0cHV0UGFuZWxcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgbG9vbVJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8dm9pZD4oKTtcblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbVRvb2xiYXJXaWRnZXQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIucGx1Z2luLmlzQmxvY2tSdW5uaW5nKHRoaXMuYmxvY2suaWQpID09PSB0aGlzLnBsdWdpbi5pc0Jsb2NrUnVubmluZyh0aGlzLmJsb2NrLmlkKTtcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jayk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbU91dHB1dFdpZGdldCBleHRlbmRzIFdpZGdldFR5cGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrSWQ6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9ja0lkLCB3cmFwcGVyKTtcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBsb29tUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXG4gICAgbmV3IFB5dGhvblJ1bm5lcigpLFxuICAgIG5ldyBOb2RlUnVubmVyKCksXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXG4gICAgbmV3IE5hdGl2ZUNvbXBpbGVkUnVubmVyKCksXG4gICAgbmV3IEludGVycHJldGVkUnVubmVyKCksXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbnRhaW5lclJ1bm5lciA9IG5ldyBsb29tQ29udGFpbmVyUnVubmVyKHRoaXMuYXBwLCB0aGlzLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIik7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRzID0gbmV3IE1hcDxzdHJpbmcsIGxvb21TdG9yZWRPdXRwdXQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcnVubmluZyA9IG5ldyBNYXA8c3RyaW5nLCBBYm9ydENvbnRyb2xsZXI+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0TGlzdGVuZXJzID0gbmV3IE1hcDxzdHJpbmcsIFNldDwoKSA9PiB2b2lkPj4oKTtcbiAgcHJpdmF0ZSBzdGF0dXNCYXJJdGVtRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBlZGl0b3JWaWV3cyA9IG5ldyBTZXQ8RWRpdG9yVmlldz4oKTtcbiAgcHJpdmF0ZSBsYXN0TWFya2Rvd25GaWxlUGF0aDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBsb29tU2V0dGluZ1RhYih0aGlzKSk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwgPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tY3VycmVudC1jb2RlLWJsb2NrXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBDdXJyZW50IENvZGUgQmxvY2tcIixcbiAgICAgIGVkaXRvckNhbGxiYWNrOiBhc3luYyAoZWRpdG9yLCB2aWV3KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB2aWV3LmZpbGU7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgZWRpdG9yLmdldFZhbHVlKCksIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBibG9jayA9IGZpbmRCbG9ja0F0TGluZShibG9ja3MsIGVkaXRvci5nZXRDdXJzb3IoKS5saW5lKTtcbiAgICAgICAgaWYgKCFibG9jaykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9jayBhdCB0aGUgY3VycmVudCBjdXJzb3IuXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tYWxsLWNvZGUtYmxvY2tzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBBbGwgU3VwcG9ydGVkIENvZGUgQmxvY2tzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tY2xlYXItbm90ZS1vdXRwdXRzXCIsXG4gICAgICBuYW1lOiBcImxvb206IENsZWFyIGxvb20gT3V0cHV0cyBpbiBDdXJyZW50IE5vdGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMuY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbih0aGlzLmNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkpO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgaWYgKGZpbGUgJiYgdGhpcy5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS12YWxpZGF0ZS1jb250YWluZXItZ3JvdXBzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFZhbGlkYXRlIENvbnRhaW5lciBHcm91cHNcIixcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMuZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcbiAgICAgICAgbmV3IE5vdGljZShncm91cHMubGVuZ3RoID8gZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGAke2dyb3VwLm5hbWV9OiAke2dyb3VwLnN0YXR1c31gKS5qb2luKFwiXFxuXCIpIDogXCJObyBsb29tIGNvbnRhaW5lciBncm91cHMgZm91bmQuXCIsIDgwMDApO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItY2hhbmdlXCIsIChfZWRpdG9yLCBjdHgpID0+IHtcbiAgICAgICAgaWYgKGN0eCBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykge1xuICAgICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYoY3R4LmxlYWYpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIHRoaXMucnVubmluZy52YWx1ZXMoKSkge1xuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0ge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIC4uLihhd2FpdCB0aGlzLmxvYWREYXRhKCkpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBpc0Jsb2NrUnVubmluZyhibG9ja0lkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcbiAgfVxuXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgIGlmICghdGhpcy5vdXRwdXRMaXN0ZW5lcnMuaGFzKGJsb2NrSWQpKSB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5zZXQoYmxvY2tJZCwgbmV3IFNldCgpKTtcbiAgICB9XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfVxuXG4gIGNyZWF0ZVRvb2xiYXJFbGVtZW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKGJsb2NrLmlkLCB0aGlzLmlzQmxvY2tSdW5uaW5nKGJsb2NrLmlkKSwge1xuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxuICAgICAgb25Db3B5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNvZGUgY29waWVkXCIpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dCA9IHRoaXMub3V0cHV0cy5nZXQoYmxvY2suaWQpO1xuICAgICAgICBpZiAoIW91dHB1dCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBvdXRwdXQudmlzaWJsZSA9ICFvdXRwdXQudmlzaWJsZTtcbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZW5kZXJPdXRwdXRJbnRvKGJsb2NrSWQ6IHN0cmluZywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZVJ1bm5pbmdQYW5lbCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0KSk7XG4gIH1cblxuICBhc3luYyBydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgaWYgKCFibG9jayB8fCAhZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGlmICghYmxvY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGJsb2NrLmZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5ydW5uaW5nLmdldChibG9ja0lkKT8uYWJvcnQoKTtcbiAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrSWQpO1xuICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2tJZCk7XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrSWQpO1xuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hbmFnZWRSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBjb25zdCByZW1vdmFsU3RhcnQgPSBjdXJyZW50QmxvY2suc3RhcnRMaW5lO1xuICAgICAgY29uc3QgcmVtb3ZhbEVuZCA9IG1hbmFnZWRSYW5nZSA/IG1hbmFnZWRSYW5nZS5lbmQgOiBjdXJyZW50QmxvY2suZW5kTGluZTtcbiAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIHJlbW92YWxFbmQgLSByZW1vdmFsU3RhcnQgKyAxKTtcblxuICAgICAgd2hpbGUgKHJlbW92YWxTdGFydCA8IGxpbmVzLmxlbmd0aCAtIDEgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0XSA9PT0gXCJcIiAmJiBsaW5lc1tyZW1vdmFsU3RhcnQgKyAxXSA9PT0gXCJcIikge1xuICAgICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCAxKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICBuZXcgTm90aWNlKFwibG9vbSBzbmlwcGV0IHJlbW92ZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWxsQmxvY2tzSW5GaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRDb250YWluZXJHcm91cE5hbWUoZmlsZSk7XG4gICAgY29uc3Qgc3VwcG9ydGVkQmxvY2tzID0gY29udGFpbmVyR3JvdXAgPyBibG9ja3MgOiBibG9ja3MuZmlsdGVyKChibG9jaykgPT4gdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncykpO1xuXG4gICAgaWYgKCFzdXBwb3J0ZWRCbG9ja3MubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2Ygc3VwcG9ydGVkQmxvY2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFwibG9vbSBvdXRwdXRzIGNsZWFyZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGxvb20gYmxvY2sgaXMgYWxyZWFkeSBydW5uaW5nLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcbiAgICAgIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSB0aGlzLnJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGUpO1xuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGUpO1xuICAgIGNvbnN0IHJ1bm5lciA9IGNvbnRhaW5lckdyb3VwID8gbnVsbCA6IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBpZiAoIWNvbnRhaW5lckdyb3VwKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYE5vIGNvbmZpZ3VyZWQgcnVubmVyIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3QgcnVuQ29udGV4dCA9IHtcbiAgICAgIGZpbGUsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiB0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgIH07XG4gICAgdGhpcy5ydW5uaW5nLnNldChibG9jay5pZCwgY29udHJvbGxlcik7XG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRhaW5lckdyb3VwXG4gICAgICAgID8gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIucnVuKGJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncyk7XG5cbiAgICAgIGlmIChyZXN1bHQudGltZWRPdXQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgYEV4ZWN1dGlvbiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXN9IG1zLmA7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgXCJFeGVjdXRpb24gY2FuY2VsbGVkLlwiO1xuICAgICAgfSBlbHNlIGlmICghcmVzdWx0LnN1Y2Nlc3MgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBjb250YWluZXJHcm91cCA/IGBjb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyIS5kaXNwbGF5TmFtZTtcbiAgICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSByYW4gJHtydW5uZXJOYW1lfSBibG9jay5gIDogYGxvb20gcnVuIGZhaWxlZCBmb3IgJHtydW5uZXJOYW1lfS5gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBydW5uZXJJZDogY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyOiR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uaWQgPz8gXCJ1bmtub3duXCIsXG4gICAgICAgICAgcnVubmVyTmFtZTogY29udGFpbmVyR3JvdXAgPyBgQ29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uZGlzcGxheU5hbWUgPz8gXCJVbmtub3duXCIsXG4gICAgICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZmluaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICAgIHN0ZG91dDogXCJcIixcbiAgICAgICAgICBzdGRlcnI6IG1lc3NhZ2UsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIG5ldyBOb3RpY2UoYGxvb20gZXJyb3I6ICR7bWVzc2FnZX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IHtcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBzZXR0bGUgPSAodmFsdWU6IGJvb2xlYW4pID0+IHtcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vZGFsID0gbmV3IEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgc2V0dGxlKHRydWUpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG9yaWdpbmFsQ2xvc2UgPSBtb2RhbC5jbG9zZS5iaW5kKG1vZGFsKTtcbiAgICAgIG1vZGFsLmNsb3NlID0gKCkgPT4ge1xuICAgICAgICBvcmlnaW5hbENsb3NlKCk7XG4gICAgICAgIHNldHRsZSh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayk7XG4gICAgICB9O1xuICAgICAgbW9kYWwub3BlbigpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlV29ya2luZ0RpcmVjdG9yeShmaWxlOiBURmlsZSk6IHN0cmluZyB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgICBjb25zdCBmaWxlRm9sZGVyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gZmlsZUZvbGRlciA9PT0gXCIuXCIgPyBhZGFwdGVyQmFzZVBhdGggOiBgJHthZGFwdGVyQmFzZVBhdGh9LyR7ZmlsZUZvbGRlcn1gO1xuICAgIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xuICB9XG5cbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0R3JvdXBTdW1tYXJpZXMoKTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkQ29udGFpbmVyR3JvdXAobmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcbiAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gYnVpbHQgY29udGFpbmVyIGdyb3VwICR7bmFtZX0uYCA6IGBsb29tIGNvbnRhaW5lciBidWlsZCBmYWlsZWQgZm9yICR7bmFtZX0uYCwgODAwMCk7XG4gIH1cblxuICByZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBhbGlhcyBvZiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXModGhpcy5zZXR0aW5ncykpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5oYXMobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKC9bXmEtekEtWjAtOV8tXS8udGVzdChub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xuICAgICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duQ29kZUJsb2NrUHJvY2Vzc29yKG5vcm1hbGl6ZWRBbGlhcywgYXN5bmMgKHNvdXJjZSwgZWwsIGN0eCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGN0eC5zb3VyY2VQYXRoO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IChjdHggJiYgdHlwZW9mIGN0eC5nZXRTZWN0aW9uSW5mbyA9PT0gXCJmdW5jdGlvblwiKSA/IGN0eC5nZXRTZWN0aW9uSW5mbyhlbCkgOiBudWxsO1xuICAgICAgICBsZXQgYmxvY2s6IGxvb21Db2RlQmxvY2sgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChzZWN0aW9uKSB7XG4gICAgICAgICAgY29uc3QgbGluZVN0YXJ0ID0gc2VjdGlvbi5saW5lU3RhcnQ7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuc3RhcnRMaW5lID09PSBsaW5lU3RhcnQgJiYgY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCJwcmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXByZSkge1xuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xuICAgICAgICAgIHByZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29uc3QgY29kZSA9IHByZS5jcmVhdGVFbChcImNvZGVcIik7XG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29kZS5zZXRUZXh0KHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgY29uc3QgY29kZSA9IChwcmUucXVlcnlTZWxlY3RvcihcImNvZGVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBwcmU7XG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsLnNldFRleHQoYWN0aXZlUnVucyA/IGBsb29tOiAke2FjdGl2ZVJ1bnN9IEFjdGl2ZSBSdW4ke2FjdGl2ZVJ1bnMgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCA6IFwibG9vbTogSWRsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmZvckVhY2goKGxpc3RlbmVyKSA9PiBsaXN0ZW5lcigpKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgTWFya2Rvd25WaWV3O1xuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcbiAgICAgIHByZXZpZXdNb2RlPy5yZXJlbmRlcj8uKHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBlZGl0b3JWaWV3IG9mIHRoaXMuZWRpdG9yVmlld3MpIHtcbiAgICAgIGVkaXRvclZpZXcuZGlzcGF0Y2goeyBlZmZlY3RzOiBsb29tUmVmcmVzaEVmZmVjdC5vZih1bmRlZmluZWQpIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgcmV0dXJuIHZpZXc/LmZpbGUgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gIH1cblxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGxlYWY6IFdvcmtzcGFjZUxlYWYpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xuICAgICAgYXdhaXQgbGVhZi5sb2FkSWZEZWZlcnJlZCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgfHwgIXZpZXcuZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3Modmlldy5maWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFibG9ja3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcbiAgICBzdGF0ZS5zb3VyY2UgPSB0cnVlO1xuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgc3RhdGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWZpbGUgfHwgIWVkaXRvcikge1xuICAgICAgcmV0dXJuIHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXM7XG5cbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgICBjbGFzcyB7XG4gICAgICAgIGRlY29yYXRpb25zO1xuXG4gICAgICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdmlldzogRWRpdG9yVmlldykge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5hZGQodmlldyk7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgICAgIGlmICh1cGRhdGUuZG9jQ2hhbmdlZCB8fCB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8IHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMobG9vbVJlZnJlc2hFZmZlY3QpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5kZWxldGUodGhpcy52aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaXZhdGUgYnVpbGREZWNvcmF0aW9ucygpIHtcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBsdWdpbi5nZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTtcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MudG9TdHJpbmcoKTtcbiAgICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgc291cmNlLCBwbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xuICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21Ub29sYmFyV2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGlmIChwbHVnaW4ub3V0cHV0cy5oYXMoYmxvY2suaWQpIHx8IHBsdWdpbi5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2suaWQpLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2suaWQpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0aGlzLnJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9jay5pZCwgcmVzdWx0KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcblxuICAgICAgaWYgKGV4aXN0aW5nUmFuZ2UpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBsaW5lcy5zcGxpY2UoY3VycmVudEJsb2NrLmVuZExpbmUgKyAxLCAwLCAuLi5yZW5kZXJlZCk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG9wZW5TeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoLCBwb3NpeCBhcyBwb3NpeFBhdGggfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgbG9vbUNvbnRhaW5lclJ1bnRpbWUgPSBcImRvY2tlclwiIHwgXCJwb2RtYW5cIiB8IFwicWVtdVwiIHwgXCJjdXN0b21cIjtcblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgZXh0ZW5zaW9uOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBwb3NpdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xuICBuZWdhdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgbG9vbVFlbXVDb25maWcge1xuICBzc2hUYXJnZXQ6IHN0cmluZztcbiAgcmVtb3RlV29ya3NwYWNlOiBzdHJpbmc7XG4gIHNzaEV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIHNzaEFyZ3M/OiBzdHJpbmc7XG4gIHN0YXJ0Q29tbWFuZD86IHN0cmluZztcbiAgYnVpbGRDb21tYW5kPzogc3RyaW5nO1xuICB0ZWFyZG93bkNvbW1hbmQ/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgbWFuYWdlcj86IGxvb21RZW11TWFuYWdlckNvbmZpZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11TWFuYWdlckNvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmc7XG4gIGltYWdlPzogc3RyaW5nO1xuICBpbWFnZUZvcm1hdD86IHN0cmluZztcbiAgcGlkRmlsZT86IHN0cmluZztcbiAgbG9nRmlsZT86IHN0cmluZztcbiAgcmVhZGluZXNzVGltZW91dE1zPzogbnVtYmVyO1xuICByZWFkaW5lc3NJbnRlcnZhbE1zPzogbnVtYmVyO1xuICBib290RGVsYXlNcz86IG51bWJlcjtcbiAgc2h1dGRvd25Db21tYW5kPzogc3RyaW5nO1xuICBzaHV0ZG93blRpbWVvdXRNcz86IG51bWJlcjtcbiAga2lsbFNpZ25hbD86IE5vZGVKUy5TaWduYWxzO1xuICBwZXJzaXN0PzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHtcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbn1cblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJDb25maWcge1xuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcbiAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgcWVtdT86IGxvb21RZW11Q29uZmlnO1xuICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+O1xufVxuXG5pbnRlcmZhY2UgbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0IHtcbiAgYWN0aW9uOiBcImJ1aWxkXCIgfCBcInJ1blwiIHwgXCJ0ZWFyZG93blwiO1xuICBncm91cE5hbWU6IHN0cmluZztcbiAgZ3JvdXBQYXRoOiBzdHJpbmc7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBpbWFnZT86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBsYW5ndWFnZT86IHN0cmluZztcbiAgbGFuZ3VhZ2VBbGlhcz86IHN0cmluZztcbiAgZmlsZU5hbWU/OiBzdHJpbmc7XG4gIGZpbGVQYXRoPzogc3RyaW5nO1xuICBjb21tYW5kPzogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgY29uZmlnOiB7XG4gICAgZXhlY3V0YWJsZT86IHN0cmluZztcbiAgICBjdXN0b20/OiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZztcbiAgICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gICAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgbG9vbUNvbnRhaW5lclJ1bm5lciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVpbHRJbWFnZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICkge31cblxuICBnZXRDb250YWluZXJHcm91cE5hbWUoZmlsZTogVEZpbGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIGNvbnN0IGNvbnRhaW5lcnNQYXRoID0gdGhpcy5nZXRDb250YWluZXJzUGF0aCgpO1xuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHJlYWRkaXIgfSA9IGF3YWl0IGltcG9ydChcImZzL3Byb21pc2VzXCIpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGNvbnRhaW5lcnNQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgZW50cmllc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgICAgICBjb25zdCBncm91cFBhdGggPSBqb2luKGNvbnRhaW5lcnNQYXRoLCBlbnRyeS5uYW1lKTtcbiAgICAgICAgICBjb25zdCBoYXNDb25maWcgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpKTtcbiAgICAgICAgICBjb25zdCBoYXNEb2NrZXJmaWxlID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKTtcbiAgICAgICAgICBpZiAoIWhhc0NvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBcIm1pc3NpbmcgY29uZmlnLmpzb25cIixcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IHBpZWNlcyA9IFtgcnVudGltZTogJHtjb25maWcucnVudGltZX1gXTtcbiAgICAgICAgICAgIGlmICgoY29uZmlnLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpICYmIGhhc0RvY2tlcmZpbGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goXCJEb2NrZXJmaWxlXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8uc3NoVGFyZ2V0KSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBzc2g6ICR7Y29uZmlnLnFlbXUuc3NoVGFyZ2V0fWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8ubWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgbWFuYWdlcjogJHthd2FpdCB0aGlzLmdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aCwgY29uZmlnLnFlbXUubWFuYWdlcil9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIgJiYgY29uZmlnLmN1c3RvbT8uZXhlY3V0YWJsZSkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgd3JhcHBlcjogJHtjb25maWcuY3VzdG9tLmV4ZWN1dGFibGV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBsYW5ndWFnZUNvdW50ID0gT2JqZWN0LmtleXMoY29uZmlnLmxhbmd1YWdlcykubGVuZ3RoO1xuICAgICAgICAgICAgcGllY2VzLnB1c2goYCR7bGFuZ3VhZ2VDb3VudH0gbGFuZ3VhZ2Uke2xhbmd1YWdlQ291bnQgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCk7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IHBpZWNlcy5qb2luKFwiLCBcIiksXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IGBpbnZhbGlkIGNvbmZpZy5qc29uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBncm91cE5hbWU6IHN0cmluZyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGdyb3VwUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgIGNvbnN0IGxhbmd1YWdlID0gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZV0gPz8gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZUFsaWFzXTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBncm91cCAke2dyb3VwTmFtZX0gaGFzIG5vIGNvbW1hbmQgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgIH1cblxuICAgIGF3YWl0IG1rZGlyKGdyb3VwUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjb25maWcuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBjb25zdCB0ZW1wRmlsZU5hbWUgPSBgdGVtcF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9JHtub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uKX1gO1xuICAgIGNvbnN0IHRlbXBGaWxlUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCB0ZW1wRmlsZU5hbWUpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZVBhdGgsIGJsb2NrLmNvbnRlbnQsIFwidXRmOFwiKTtcbiAgICAgIHN3aXRjaCAoY29uZmlnLnJ1bnRpbWUpIHtcbiAgICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuT2NpQ29udGFpbmVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5RZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xuICAgICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuQ3VzdG9tKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGJsb2NrLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCB0ZW1wRmlsZVBhdGgsIGNvbnRleHQpO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybSh0ZW1wRmlsZVBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYnVpbGRHcm91cChncm91cE5hbWU6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRRZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuQ3VzdG9tV3JhcHBlcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJidWlsZFwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMpLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PY2lDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgaW1hZ2UgPSBhd2FpdCB0aGlzLnJlc29sdmVJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuY29tbWFuZC5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSkpO1xuICAgIGlmICghY29tbWFuZC5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9YCxcbiAgICAgIGV4ZWN1dGFibGU6IHRoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKSxcbiAgICAgIGFyZ3M6IFtcbiAgICAgICAgXCJydW5cIixcbiAgICAgICAgXCItLXJtXCIsXG4gICAgICAgIFwiLXZcIixcbiAgICAgICAgYCR7Z3JvdXBQYXRofTovd29ya3NwYWNlYCxcbiAgICAgICAgXCItd1wiLFxuICAgICAgICBcIi93b3Jrc3BhY2VcIixcbiAgICAgICAgaW1hZ2UsXG4gICAgICAgIC4uLmNvbW1hbmQsXG4gICAgICBdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blFlbXUoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS5zdGFydENvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnN0YXJ0YCwgYFFFTVUgJHtncm91cE5hbWV9IHN0YXJ0YCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmhlYWx0aGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZW1vdGVGaWxlID0gcG9zaXhQYXRoLmpvaW4ocWVtdS5yZW1vdGVXb3Jrc3BhY2UsIHRlbXBGaWxlTmFtZSk7XG4gICAgICBjb25zdCByZW1vdGVDb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZC5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHNoZWxsUXVvdGUocmVtb3RlRmlsZSkpO1xuICAgICAgaWYgKCFyZW1vdGVDb21tYW5kLnRyaW0oKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIGNvbW1hbmQgaXMgZW1wdHkuXCIpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11YCxcbiAgICAgICAgcnVubmVyTmFtZTogYFFFTVUgJHtncm91cE5hbWV9YCxcbiAgICAgICAgZXhlY3V0YWJsZTogcWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwic3NoXCIsXG4gICAgICAgIGFyZ3M6IFtcbiAgICAgICAgICAuLi5zcGxpdENvbW1hbmRMaW5lKHFlbXUuc3NoQXJncyB8fCBcIlwiKSxcbiAgICAgICAgICBxZW11LnNzaFRhcmdldCxcbiAgICAgICAgICBgY2QgJHtzaGVsbFF1b3RlKHFlbXUucmVtb3RlV29ya3NwYWNlKX0gJiYgJHtyZW1vdGVDb21tYW5kfWAsXG4gICAgICAgIF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChxZW11LnRlYXJkb3duQ29tbWFuZCwgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6dGVhcmRvd25gLCBgUUVNVSAke2dyb3VwTmFtZX0gdGVhcmRvd25gKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DdXN0b20oXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgdGVtcEZpbGVQYXRoOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGNvbW1hbmQgPSBsYW5ndWFnZS5jb21tYW5kLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBjb25maWcsXG4gICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJydW5cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICBjb21tYW5kLFxuICAgICAgfSksXG4gICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICk7XG5cbiAgICBpZiAoY29uZmlnLmN1c3RvbT8udGVhcmRvd24pIHtcbiAgICAgIGNvbnN0IHRlYXJkb3duID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgICBncm91cE5hbWUsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgY29uZmlnLFxuICAgICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJ0ZWFyZG93blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgICBjb21tYW5kLFxuICAgICAgICB9KSxcbiAgICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICAgKTtcbiAgICAgIGlmICghdGVhcmRvd24uc3VjY2Vzcykge1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBDdXN0b20gcnVudGltZSB0ZWFyZG93biBmYWlsZWQ6ICR7dGVhcmRvd24uc3RkZXJyIHx8IHRlYXJkb3duLnN0ZG91dCB8fCBgZXhpdCAke3RlYXJkb3duLmV4aXRDb2RlfWB9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgZG9ja2VyZmlsZSA9IGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIik7XG4gICAgaWYgKCFleGlzdHNTeW5jKGRvY2tlcmZpbGUpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwiO1xuICAgIH1cblxuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNhY2hlS2V5ID0gYCR7dGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpfToke2ltYWdlfWA7XG4gICAgaWYgKHRoaXMuYnVpbHRJbWFnZXMuaGFzKGNhY2hlS2V5KSkge1xuICAgICAgcmV0dXJuIGltYWdlO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRleHQuc2lnbmFsKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IocmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9IGJ1aWxkIGZhaWxlZCBmb3IgJHtncm91cE5hbWV9LmApO1xuICAgIH1cblxuICAgIHRoaXMuYnVpbHRJbWFnZXMuYWRkKGNhY2hlS2V5KTtcbiAgICByZXR1cm4gaW1hZ2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJ1aWxkSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGlmICghZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKSkge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICAgIGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgIGBObyBEb2NrZXJmaWxlIGNvbmZpZ3VyZWQuIFVzaW5nIGltYWdlICR7Y29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwifS5cXG5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmJ1aWxkYCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXCJidWlsZFwiLCBcIi10XCIsIGltYWdlLCBncm91cFBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcWVtdSA9IHRoaXMucmVxdWlyZVFlbXVDb25maWcoY29uZmlnKTtcbiAgICBpZiAoIXFlbXUuYnVpbGRDb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCwgXCJObyBRRU1VIGJ1aWxkIGNvbW1hbmQgY29uZmlndXJlZC5cXG5cIik7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJ1bkNvbW1hbmRMaW5lKHFlbXUuYnVpbGRDb21tYW5kLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRDb25maWcoZ3JvdXBQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGxvb21Db250YWluZXJDb25maWc+IHtcbiAgICBjb25zdCBjb25maWdQYXRoID0gam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIik7XG4gICAgbGV0IHJhdzogdW5rbm93bjtcbiAgICB0cnkge1xuICAgICAgcmF3ID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShjb25maWdQYXRoLCBcInV0ZjhcIikpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byByZWFkIGNvbnRhaW5lciBjb25maWcgJHtjb25maWdQYXRofTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSByYXcgYXMge1xuICAgICAgcnVudGltZT86IHVua25vd247XG4gICAgICBleGVjdXRhYmxlPzogdW5rbm93bjtcbiAgICAgIGltYWdlPzogdW5rbm93bjtcbiAgICAgIGhlYWx0aENoZWNrPzogdW5rbm93bjtcbiAgICAgIHFlbXU/OiB1bmtub3duO1xuICAgICAgY3VzdG9tPzogdW5rbm93bjtcbiAgICAgIGxhbmd1YWdlcz86IHVua25vd247XG4gICAgfTtcbiAgICBjb25zdCBydW50aW1lID0gdGhpcy5yZWFkUnVudGltZShkYXRhLnJ1bnRpbWUpO1xuICAgIGlmIChkYXRhLmV4ZWN1dGFibGUgIT0gbnVsbCAmJiB0eXBlb2YgZGF0YS5leGVjdXRhYmxlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGV4ZWN1dGFibGUgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmIChkYXRhLmltYWdlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuaW1hZ2UgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgaW1hZ2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmICghZGF0YS5sYW5ndWFnZXMgfHwgdHlwZW9mIGRhdGEubGFuZ3VhZ2VzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGF0YS5sYW5ndWFnZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGxhbmd1YWdlcyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuXG4gICAgY29uc3QgbGFuZ3VhZ2VzOiBSZWNvcmQ8c3RyaW5nLCBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWc+ID0ge307XG4gICAgZm9yIChjb25zdCBbbGFuZ3VhZ2UsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhkYXRhLmxhbmd1YWdlcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcbiAgICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xuICAgICAgfVxuICAgICAgY29uc3QgbGFuZ3VhZ2VDb25maWcgPSB2YWx1ZSBhcyB7IGNvbW1hbmQ/OiB1bmtub3duOyBleHRlbnNpb24/OiB1bmtub3duIH07XG4gICAgICBpZiAodHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWxhbmd1YWdlQ29uZmlnLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgZGVmaW5lIGNvbW1hbmQuYCk7XG4gICAgICB9XG4gICAgICBsYW5ndWFnZXNbbGFuZ3VhZ2VdID0ge1xuICAgICAgICBjb21tYW5kOiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kLFxuICAgICAgICBleHRlbnNpb246IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gOiBgLiR7bGFuZ3VhZ2V9YCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bnRpbWUsXG4gICAgICBleGVjdXRhYmxlOiB0eXBlb2YgZGF0YS5leGVjdXRhYmxlID09PSBcInN0cmluZ1wiICYmIGRhdGEuZXhlY3V0YWJsZS50cmltKCkgPyBkYXRhLmV4ZWN1dGFibGUudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgaW1hZ2U6IHR5cGVvZiBkYXRhLmltYWdlID09PSBcInN0cmluZ1wiID8gZGF0YS5pbWFnZSA6IHVuZGVmaW5lZCxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgaGVhbHRoQ2hlY2tcIiksXG4gICAgICBxZW11OiB0aGlzLnJlYWRRZW11Q29uZmlnKGRhdGEucWVtdSksXG4gICAgICBjdXN0b206IHRoaXMucmVhZEN1c3RvbUNvbmZpZyhkYXRhLmN1c3RvbSksXG4gICAgICBsYW5ndWFnZXMsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFJ1bnRpbWUodmFsdWU6IHVua25vd24pOiBsb29tQ29udGFpbmVyUnVudGltZSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiBcImRvY2tlclwiO1xuICAgIH1cbiAgICBpZiAodmFsdWUgPT09IFwiZG9ja2VyXCIgfHwgdmFsdWUgPT09IFwicG9kbWFuXCIgfHwgdmFsdWUgPT09IFwicWVtdVwiIHx8IHZhbHVlID09PSBcImN1c3RvbVwiKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcnVudGltZSBtdXN0IGJlIGRvY2tlciwgcG9kbWFuLCBxZW11LCBvciBjdXN0b20uXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21RZW11Q29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuc3NoVGFyZ2V0ICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnNzaFRhcmdldC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5zc2hUYXJnZXQgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgZGF0YS5yZW1vdGVXb3Jrc3BhY2UgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LnJlbW90ZVdvcmtzcGFjZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3NoVGFyZ2V0OiBkYXRhLnNzaFRhcmdldC50cmltKCksXG4gICAgICByZW1vdGVXb3Jrc3BhY2U6IGRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSxcbiAgICAgIHNzaEV4ZWN1dGFibGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuc3NoRXhlY3V0YWJsZSksXG4gICAgICBzc2hBcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEFyZ3MpLFxuICAgICAgc3RhcnRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnN0YXJ0Q29tbWFuZCksXG4gICAgICBidWlsZENvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGRDb21tYW5kKSxcbiAgICAgIHRlYXJkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS50ZWFyZG93bkNvbW1hbmQpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LmhlYWx0aENoZWNrXCIpLFxuICAgICAgbWFuYWdlcjogdGhpcy5yZWFkUWVtdU1hbmFnZXJDb25maWcoZGF0YS5tYW5hZ2VyKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdU1hbmFnZXJDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdU1hbmFnZXJDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IGRhdGEuZW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgICBleGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmV4ZWN1dGFibGUpLFxuICAgICAgYXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5hcmdzKSxcbiAgICAgIGltYWdlOiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlKSxcbiAgICAgIGltYWdlRm9ybWF0OiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlRm9ybWF0KSxcbiAgICAgIHBpZEZpbGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEucGlkRmlsZSksXG4gICAgICBsb2dGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmxvZ0ZpbGUpLFxuICAgICAgcmVhZGluZXNzVGltZW91dE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc1RpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXNcIiksXG4gICAgICByZWFkaW5lc3NJbnRlcnZhbE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc0ludGVydmFsTXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNc1wiKSxcbiAgICAgIGJvb3REZWxheU1zOiBvcHRpb25hbE5vbk5lZ2F0aXZlSW50ZWdlcihkYXRhLmJvb3REZWxheU1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLmJvb3REZWxheU1zXCIpLFxuICAgICAgc2h1dGRvd25Db21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnNodXRkb3duQ29tbWFuZCksXG4gICAgICBzaHV0ZG93blRpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5zaHV0ZG93blRpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5zaHV0ZG93blRpbWVvdXRNc1wiKSxcbiAgICAgIGtpbGxTaWduYWw6IG9wdGlvbmFsU2lnbmFsKGRhdGEua2lsbFNpZ25hbCwgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5raWxsU2lnbmFsXCIpLFxuICAgICAgcGVyc2lzdDogdHlwZW9mIGRhdGEucGVyc2lzdCA9PT0gXCJib29sZWFuXCIgPyBkYXRhLnBlcnNpc3QgOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEN1c3RvbUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5leGVjdXRhYmxlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbS5leGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgZXhlY3V0YWJsZTogZGF0YS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBidWlsZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5idWlsZCksXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBvcHRpb25hbFN0cmluZyhkYXRhLmNvbW1hbmRTdHJ1Y3R1cmUpLFxuICAgICAgdGVhcmRvd246IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd24pLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uaGVhbHRoQ2hlY2tcIiksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEhlYWx0aENoZWNrKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuY29tbWFuZC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0uY29tbWFuZCBtdXN0IGJlIGEgc3RyaW5nLmApO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgY29tbWFuZDogZGF0YS5jb21tYW5kLnRyaW0oKSxcbiAgICAgIHBvc2l0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEucG9zaXRpdmVSZXNwb25zZSA/PyBkYXRhLnBvc2l0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJwb3NpdGl2ZSByZXNwb25zZVwiXSA/PyBkYXRhLnBvc3NpdGl2ZVJlc3BvbnNlKSxcbiAgICAgIG5lZ2F0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEubmVnYXRpdmVSZXNwb25zZSA/PyBkYXRhLm5lZ2F0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJuZWdhdGl2ZSByZXNwb25zZVwiXSksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZVFlbXVDb25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbVFlbXVDb25maWcge1xuICAgIGlmICghY29uZmlnLnFlbXUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgcnVudGltZSByZXF1aXJlcyBhIHFlbXUgY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucWVtdTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gICAgaWYgKCFjb25maWcuY3VzdG9tKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gcnVudGltZSByZXF1aXJlcyBhIGN1c3RvbSBjb25maWcgb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5jdXN0b207XG4gIH1cblxuICBwcml2YXRlIHJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IHN0cmluZyB7XG4gICAgaWYgKGNvbmZpZy5leGVjdXRhYmxlPy50cmltKCkpIHtcbiAgICAgIHJldHVybiBjb25maWcuZXhlY3V0YWJsZS50cmltKCk7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucnVudGltZSA9PT0gXCJwb2RtYW5cIiA/IFwicG9kbWFuXCIgOiBcImRvY2tlclwiO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5IZWFsdGhDaGVjayhcbiAgICBoZWFsdGhDaGVjazogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFoZWFsdGhDaGVjaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoaGVhbHRoQ2hlY2suY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBjb25zdCBjb21iaW5lZE91dHB1dCA9IGAke3Jlc3VsdC5zdGRvdXR9XFxuJHtyZXN1bHQuc3RkZXJyfWA7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYGV4aXQgJHtyZXN1bHQuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UgJiYgY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSByZXR1cm5lZCBuZWdhdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgICBpZiAoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSAmJiAhY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBkaWQgbm90IHJldHVybiBwb3NpdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT3B0aW9uYWxDb21tYW5kKFxuICAgIGNvbW1hbmQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFjb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShjb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Db21tYW5kTGluZShcbiAgICBjb21tYW5kOiBzdHJpbmcsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHBhcnRzID0gc3BsaXRDb21tYW5kTGluZShjb21tYW5kKTtcbiAgICBpZiAoIXBhcnRzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGNvbW1hbmQgaXMgZW1wdHkuYCk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHBhcnRzWzBdLFxuICAgICAgYXJnczogcGFydHMuc2xpY2UoMSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBleGlzdGluZ1BpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKGV4aXN0aW5nUGlkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhleGlzdGluZ1BpZCkpIHtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nUGlkKSB7XG4gICAgICBhd2FpdCBybShwaWRQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBtYW5hZ2VyLmV4ZWN1dGFibGUgfHwgXCJxZW11LXN5c3RlbS14ODZfNjRcIjtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5idWlsZE1hbmFnZWRRZW11QXJncyhncm91cFBhdGgsIG1hbmFnZXIpO1xuICAgIGlmICghYXJncy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSBtYW5hZ2VyIGZvciAke2dyb3VwTmFtZX0gbmVlZHMgcWVtdS5tYW5hZ2VyLmFyZ3Mgb3IgcWVtdS5tYW5hZ2VyLmltYWdlLmApO1xuICAgIH1cblxuICAgIGNvbnN0IGxvZ1BhdGggPSBtYW5hZ2VyLmxvZ0ZpbGUgPyB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5sb2dGaWxlKSA6IG51bGw7XG4gICAgY29uc3QgbG9nRmQgPSBsb2dQYXRoID8gb3BlblN5bmMobG9nUGF0aCwgXCJhXCIpIDogbnVsbDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hpbGQgPSBzcGF3bihleGVjdXRhYmxlLCBhcmdzLCB7XG4gICAgICAgIGN3ZDogZ3JvdXBQYXRoLFxuICAgICAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiXSxcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsICgpID0+IHVuZGVmaW5lZCk7XG4gICAgICBjaGlsZC51bnJlZigpO1xuXG4gICAgICBpZiAoIWNoaWxkLnBpZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IGRpZCBub3QgcmV0dXJuIGEgcHJvY2VzcyBpZC5gKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgd3JpdGVGaWxlKHBpZFBhdGgsIGAke2NoaWxkLnBpZH1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAobG9nRmQgIT0gbnVsbCkge1xuICAgICAgICBjbG9zZVN5bmMobG9nRmQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShtYW5hZ2VyLmFyZ3MgfHwgXCJcIik7XG4gICAgaWYgKG1hbmFnZXIuaW1hZ2UpIHtcbiAgICAgIGNvbnN0IGltYWdlUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLmltYWdlKTtcbiAgICAgIGFyZ3MucHVzaChcIi1kcml2ZVwiLCBgZmlsZT0ke2ltYWdlUGF0aH0saWY9dmlydGlvLGZvcm1hdD0ke21hbmFnZXIuaW1hZ2VGb3JtYXQgfHwgXCJxY293MlwifWApO1xuICAgIH1cbiAgICByZXR1cm4gYXJncztcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIHFlbXU6IGxvb21RZW11Q29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFxZW11LmhlYWx0aENoZWNrKSB7XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwobWFuYWdlci5ib290RGVsYXlNcyA/PyAwLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWVvdXQgPSBNYXRoLm1pbihtYW5hZ2VyLnJlYWRpbmVzc1RpbWVvdXRNcyA/PyA2MF8wMDAsIE1hdGgubWF4KHRpbWVvdXRNcywgMSkpO1xuICAgIGNvbnN0IGludGVydmFsID0gbWFuYWdlci5yZWFkaW5lc3NJbnRlcnZhbE1zID8/IDFfMDAwO1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgbGV0IGxhc3RFcnJvciA9IFwiXCI7XG5cbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0KSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3Mgd2FpdCBjYW5jZWxsZWQuYCk7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBNYXRoLm1pbihpbnRlcnZhbCwgdGltZW91dCksIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpyZWFkeWAsIGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3MgY2hlY2tgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGFzdEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoaW50ZXJ2YWwsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSBkaWQgbm90IGJlY29tZSByZWFkeSB3aXRoaW4gJHt0aW1lb3V0fSBtcyR7bGFzdEVycm9yID8gYDogJHtsYXN0RXJyb3J9YCA6IFwiLlwifWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkIHx8IG1hbmFnZXIucGVyc2lzdCAhPT0gZmFsc2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IHBpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKCFwaWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobWFuYWdlci5zaHV0ZG93bkNvbW1hbmQpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKFxuICAgICAgICBtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCxcbiAgICAgICAgZ3JvdXBQYXRoLFxuICAgICAgICBNYXRoLm1pbihtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IHRpbWVvdXRNcywgdGltZW91dE1zKSxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnNodXRkb3duYCxcbiAgICAgICAgYFFFTVUgJHtncm91cE5hbWV9IHNodXRkb3duYCxcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgbWFuYWdlci5raWxsU2lnbmFsIHx8IFwiU0lHVEVSTVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdG9wcGVkID0gYXdhaXQgdGhpcy53YWl0Rm9yUHJvY2Vzc0V4aXQocGlkLCBtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IDEwXzAwMCwgc2lnbmFsKTtcbiAgICBpZiAoIXN0b3BwZWQgJiYgdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIFwiU0lHS0lMTFwiKTtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgMl8wMDAsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0TWFuYWdlZFFlbXVTdGF0dXMoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm4gXCJzdG9wcGVkXCI7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSA/IGBydW5uaW5nIHBpZCAke3BpZH1gIDogYHN0YWxlIHBpZCAke3BpZH1gO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkUGlkRmlsZShwaWRQYXRoOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSAoYXdhaXQgcmVhZEZpbGUocGlkUGF0aCwgXCJ1dGY4XCIpKS50cmltKCk7XG4gICAgICBjb25zdCBwaWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHBpZCkgJiYgcGlkID4gMCA/IHBpZCA6IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUHJvY2Vzc1J1bm5pbmcocGlkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICB0cnkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgMCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JQcm9jZXNzRXhpdChwaWQ6IG51bWJlciwgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0IDw9IHRpbWVvdXRNcykge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoMjUwLCBzaWduYWwpO1xuICAgIH1cbiAgICByZXR1cm4gIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DdXN0b21XcmFwcGVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICByZXF1ZXN0OiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3QsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY3VzdG9tID0gdGhpcy5yZXF1aXJlQ3VzdG9tQ29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjdXN0b20uaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbTpoZWFsdGhgLCBgQ3VzdG9tICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIGNvbnN0IHJlcXVlc3RGaWxlTmFtZSA9IGByZXF1ZXN0XyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0uanNvbmA7XG4gICAgY29uc3QgcmVxdWVzdFBhdGggPSBqb2luKGdyb3VwUGF0aCwgcmVxdWVzdEZpbGVOYW1lKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RQYXRoLCBgJHtKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKX1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShjdXN0b20uYXJncyB8fCBcIntyZXF1ZXN0fVwiKS5tYXAoKGFyZykgPT5cbiAgICAgICAgYXJnXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7cmVxdWVzdH1cIiwgcmVxdWVzdFBhdGgpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXB9XCIsIGdyb3VwTmFtZSlcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cFBhdGh9XCIsIGdyb3VwUGF0aCksXG4gICAgICApO1xuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOiR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgcnVubmVyTmFtZTogYEN1c3RvbSAke2dyb3VwTmFtZX0gJHtyZXF1ZXN0LmFjdGlvbn1gLFxuICAgICAgICBleGVjdXRhYmxlOiBjdXN0b20uZXhlY3V0YWJsZSxcbiAgICAgICAgYXJncyxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybShyZXF1ZXN0UGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUN1c3RvbVJlcXVlc3QoXG4gICAgYWN0aW9uOiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3RbXCJhY3Rpb25cIl0sXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIGV4dHJhOiBQYXJ0aWFsPGxvb21DdXN0b21SdW50aW1lUmVxdWVzdD4gPSB7fSxcbiAgKTogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0IHtcbiAgICByZXR1cm4ge1xuICAgICAgYWN0aW9uLFxuICAgICAgZ3JvdXBOYW1lLFxuICAgICAgZ3JvdXBQYXRoLFxuICAgICAgcnVudGltZTogY29uZmlnLnJ1bnRpbWUsXG4gICAgICBpbWFnZTogY29uZmlnLmltYWdlLFxuICAgICAgYnVpbGQ6IGNvbmZpZy5jdXN0b20/LmJ1aWxkLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogY29uZmlnLmN1c3RvbT8uY29tbWFuZFN0cnVjdHVyZSxcbiAgICAgIHRlYXJkb3duOiBjb25maWcuY3VzdG9tPy50ZWFyZG93bixcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIGNvbmZpZzoge1xuICAgICAgICBleGVjdXRhYmxlOiBjb25maWcuZXhlY3V0YWJsZSxcbiAgICAgICAgY3VzdG9tOiBjb25maWcuY3VzdG9tLFxuICAgICAgICBxZW11OiBjb25maWcucWVtdSxcbiAgICAgICAgaGVhbHRoQ2hlY2s6IGNvbmZpZy5oZWFsdGhDaGVjayxcbiAgICAgIH0sXG4gICAgICAuLi5leHRyYSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTeW50aGV0aWNSZXN1bHQocnVubmVySWQ6IHN0cmluZywgcnVubmVyTmFtZTogc3RyaW5nLCBzdGRvdXQ6IHN0cmluZywgc3VjY2VzcyA9IHRydWUpOiBsb29tUnVuUmVzdWx0IHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIHN0YXJ0ZWRBdDogbm93LFxuICAgICAgZmluaXNoZWRBdDogbm93LFxuICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgIGV4aXRDb2RlOiBzdWNjZXNzID8gMCA6IC0xLFxuICAgICAgc3Rkb3V0LFxuICAgICAgc3RkZXJyOiBcIlwiLFxuICAgICAgc3VjY2VzcyxcbiAgICAgIHRpbWVkT3V0OiBmYWxzZSxcbiAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q29udGFpbmVyc1BhdGgoKTogc3RyaW5nIHtcbiAgICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAodGhpcy5hcHAudmF1bHQuYWRhcHRlciBhcyB7IGJhc2VQYXRoPzogc3RyaW5nIH0pLmJhc2VQYXRoID8/IFwiXCI7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKGFkYXB0ZXJCYXNlUGF0aCwgdGhpcy5wbHVnaW5EaXIsIFwiY29udGFpbmVyc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmVOYW1lID0gYmFzZW5hbWUoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIXNhZmVOYW1lIHx8IHNhZmVOYW1lICE9PSBncm91cE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjb250YWluZXIgZ3JvdXAgbmFtZTogJHtncm91cE5hbWV9YCk7XG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbih0aGlzLmdldENvbnRhaW5lcnNQYXRoKCksIHNhZmVOYW1lKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aDogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChqb2luKGdyb3VwUGF0aCwgZmlsZVBhdGgpKTtcbiAgICBjb25zdCBub3JtYWxpemVkR3JvdXBQYXRoID0gbm9ybWFsaXplRnNQYXRoKGdyb3VwUGF0aCk7XG4gICAgaWYgKHNhZmVQYXRoICE9PSBub3JtYWxpemVkR3JvdXBQYXRoICYmICFzYWZlUGF0aC5zdGFydHNXaXRoKGAke25vcm1hbGl6ZWRHcm91cFBhdGh9L2ApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBzYWZlUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RG9ja2VyTm90aWNlKG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICBuZXcgTm90aWNlKG1lc3NhZ2UsIDgwMDApO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsTm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTaWduYWwodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBOb2RlSlMuU2lnbmFscyB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICEvXlNJR1tBLVowLTldKyQvLnRlc3QodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgc2lnbmFsIG5hbWUgbGlrZSBTSUdURVJNLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBOb2RlSlMuU2lnbmFscztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2xlZXBXaXRoU2lnbmFsKGR1cmF0aW9uTXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoZHVyYXRpb25NcyA8PSAwIHx8IHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dChyZXNvbHZlLCBkdXJhdGlvbk1zKTtcbiAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9O1xuICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJ1bnRpbWVMYWJlbChydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAocnVudGltZSkge1xuICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgIHJldHVybiBcIkRvY2tlclwiO1xuICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgIHJldHVybiBcIlBvZG1hblwiO1xuICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICByZXR1cm4gXCJRRU1VXCI7XG4gICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgcmV0dXJuIFwiQ3VzdG9tXCI7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxRdW90ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG4iLCAiaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB0eXBlIHsgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Qcm9jZXNzU3BlYyB7XG4gIHJ1bm5lcklkOiBzdHJpbmc7XG4gIHJ1bm5lck5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgc2lnbmFsOiBBYm9ydFNpZ25hbDtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRlbXBTb3VyY2VTcGVjIGV4dGVuZHMgbG9vbVByb2Nlc3NTcGVjIHtcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZUhhbmRsZSB7XG4gIHRlbXBEaXI6IHN0cmluZztcbiAgdGVtcEZpbGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlTmFtZTogc3RyaW5nLFxuICBzb3VyY2U6IHN0cmluZyxcbiAgY2FsbGJhY2s6IChoYW5kbGU6IGxvb21UZW1wU291cmNlSGFuZGxlKSA9PiBQcm9taXNlPFQ+LFxuKTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1cIikpO1xuICBjb25zdCB0ZW1wRmlsZSA9IGpvaW4odGVtcERpciwgZmlsZU5hbWUpO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlLCBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZSksIFwidXRmOFwiKTtcbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhUZW1wU291cmNlRmlsZTxUPihcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nLFxuICBzb3VyY2U6IHN0cmluZyxcbiAgY2FsbGJhY2s6IChoYW5kbGU6IGxvb21UZW1wU291cmNlSGFuZGxlKSA9PiBQcm9taXNlPFQ+LFxuKTogUHJvbWlzZTxUPiB7XG4gIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShgc25pcHBldCR7ZmlsZUV4dGVuc2lvbn1gLCBzb3VyY2UsIGNhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KFwiXFxuXCIpO1xuICBjb25zdCBub25FbXB0eUxpbmVzID0gbGluZXMuZmlsdGVyKChsaW5lKSA9PiBsaW5lLnRyaW0oKS5sZW5ndGggPiAwKTtcbiAgaWYgKCFub25FbXB0eUxpbmVzLmxlbmd0aCkge1xuICAgIHJldHVybiBzb3VyY2U7XG4gIH1cblxuICBsZXQgc2hhcmVkSW5kZW50ID0gZ2V0TGVhZGluZ1doaXRlc3BhY2Uobm9uRW1wdHlMaW5lc1swXSk7XG4gIGZvciAoY29uc3QgbGluZSBvZiBub25FbXB0eUxpbmVzLnNsaWNlKDEpKSB7XG4gICAgc2hhcmVkSW5kZW50ID0gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChzaGFyZWRJbmRlbnQsIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpKTtcbiAgICBpZiAoIXNoYXJlZEluZGVudCkge1xuICAgICAgcmV0dXJuIHNvdXJjZTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXNoYXJlZEluZGVudCkge1xuICAgIHJldHVybiBzb3VyY2U7XG4gIH1cblxuICByZXR1cm4gbGluZXNcbiAgICAubWFwKChsaW5lKSA9PiAobGluZS50cmltKCkubGVuZ3RoID09PSAwID8gbGluZSA6IGxpbmUuc3RhcnRzV2l0aChzaGFyZWRJbmRlbnQpID8gbGluZS5zbGljZShzaGFyZWRJbmRlbnQubGVuZ3RoKSA6IGxpbmUpKVxuICAgIC5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHNoYXJlZFdoaXRlc3BhY2VQcmVmaXgobGVmdDogc3RyaW5nLCByaWdodDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgbGVmdC5sZW5ndGggJiYgaW5kZXggPCByaWdodC5sZW5ndGggJiYgbGVmdFtpbmRleF0gPT09IHJpZ2h0W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cbiAgcmV0dXJuIGxlZnQuc2xpY2UoMCwgaW5kZXgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuUHJvY2VzcyhzcGVjOiBsb29tUHJvY2Vzc1NwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgY29uc3Qgc3RhcnRlZEF0ID0gbmV3IERhdGUoKTtcbiAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gIGxldCBzdGRlcnIgPSBcIlwiO1xuICBsZXQgZXhpdENvZGU6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgdGltZWRPdXQgPSBmYWxzZTtcbiAgbGV0IGNhbmNlbGxlZCA9IGZhbHNlO1xuICBsZXQgY2hpbGQ6IFJldHVyblR5cGU8dHlwZW9mIHNwYXduPiB8IG51bGwgPSBudWxsO1xuICBsZXQgdGltZW91dEhhbmRsZTogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcbiAgbGV0IGFib3J0SGFuZGxlcjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjaGlsZCA9IHNwYXduKHNwZWMuZXhlY3V0YWJsZSwgc3BlYy5hcmdzLCB7XG4gICAgICAgIGN3ZDogc3BlYy53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICBzaGVsbDogZmFsc2UsXG4gICAgICAgIGVudjoge1xuICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgIC4uLnNwZWMuZW52LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgICBjYW5jZWxsZWQgPSB0cnVlO1xuICAgICAgICBjaGlsZD8ua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICB9O1xuICAgICAgYWJvcnRIYW5kbGVyID0gYWJvcnQ7XG5cbiAgICAgIGlmIChzcGVjLnNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIGFib3J0KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGVjLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgICAgIH1cblxuICAgICAgdGltZW91dEhhbmRsZSA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aW1lZE91dCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH0sIHNwZWMudGltZW91dE1zKTtcblxuICAgICAgY2hpbGQuc3Rkb3V0Py5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZG91dCArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLnN0ZGVycj8ub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgICBzdGRlcnIgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgICAgZXhpdENvZGUgPSBjb2RlO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBzdGRlcnIgPSBzdGRlcnIgfHwgZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yLCBzcGVjLmV4ZWN1dGFibGUpO1xuICAgIGV4aXRDb2RlID0gZXhpdENvZGUgPz8gLTE7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGFib3J0SGFuZGxlcikge1xuICAgICAgc3BlYy5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0SGFuZGxlcik7XG4gICAgfVxuICAgIGlmICh0aW1lb3V0SGFuZGxlKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dEhhbmRsZSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZmluaXNoZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IGR1cmF0aW9uTXMgPSBmaW5pc2hlZEF0LmdldFRpbWUoKSAtIHN0YXJ0ZWRBdC5nZXRUaW1lKCk7XG4gIGNvbnN0IHN1Y2Nlc3MgPSAhdGltZWRPdXQgJiYgIWNhbmNlbGxlZCAmJiBleGl0Q29kZSA9PT0gMDtcblxuICByZXR1cm4ge1xuICAgIHJ1bm5lcklkOiBzcGVjLnJ1bm5lcklkLFxuICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICBzdGFydGVkQXQ6IHN0YXJ0ZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGZpbmlzaGVkQXQ6IGZpbmlzaGVkQXQudG9JU09TdHJpbmcoKSxcbiAgICBkdXJhdGlvbk1zLFxuICAgIGV4aXRDb2RlLFxuICAgIHN0ZG91dCxcbiAgICBzdGRlcnIsXG4gICAgc3VjY2VzcyxcbiAgICB0aW1lZE91dCxcbiAgICBjYW5jZWxsZWQsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFByb2Nlc3NFcnJvcihlcnJvcjogdW5rbm93biwgZXhlY3V0YWJsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgXCJjb2RlXCIgaW4gZXJyb3IgJiYgKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gXCJFTk9FTlRcIikge1xuICAgIHJldHVybiBgRXhlY3V0YWJsZSBub3QgZm91bmQ6ICR7ZXhlY3V0YWJsZX1gO1xuICB9XG5cbiAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRlbXBGaWxlUHJvY2VzcyhzcGVjOiBsb29tVGVtcFNvdXJjZVNwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShzcGVjLmZpbGVFeHRlbnNpb24sIHNwZWMuc291cmNlLCBhc3luYyAoeyB0ZW1wRmlsZSwgdGVtcERpciB9KSA9PlxuICAgIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLnJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MubWFwKCh2YWx1ZSkgPT4gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IHNwZWMudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBzcGVjLnNpZ25hbCxcbiAgICAgIGVudjogZXhwYW5kVGVtcGxhdGVkRW52KHNwZWMuZW52LCB0ZW1wRmlsZSwgdGVtcERpciksXG4gICAgfSksXG4gICk7XG59XG5cbmZ1bmN0aW9uIGV4cGFuZFRlbXBsYXRlZEVudihlbnY6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkLCB0ZW1wRmlsZTogc3RyaW5nLCB0ZW1wRGlyOiBzdHJpbmcpOiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCB7XG4gIGlmICghZW52KSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgT2JqZWN0LmVudHJpZXMoZW52KS5tYXAoKFtrZXksIHZhbHVlXSkgPT4gW1xuICAgICAga2V5LFxuICAgICAgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiID8gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSA6IHZhbHVlLFxuICAgIF0pLFxuICApO1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBzcGxpdENvbW1hbmRMaW5lKGlucHV0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudCA9IFwiXCI7XG4gIGxldCBxdW90ZTogXCInXCIgfCBcIlxcXCJcIiB8IG51bGwgPSBudWxsO1xuICBsZXQgZXNjYXBpbmcgPSBmYWxzZTtcblxuICBmb3IgKGNvbnN0IGNoYXIgb2YgaW5wdXQudHJpbSgpKSB7XG4gICAgaWYgKGVzY2FwaW5nKSB7XG4gICAgICBjdXJyZW50ICs9IGNoYXI7XG4gICAgICBlc2NhcGluZyA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IFwiXFxcXFwiKSB7XG4gICAgICBlc2NhcGluZyA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoKGNoYXIgPT09IFwiJ1wiIHx8IGNoYXIgPT09IFwiXFxcIlwiKSAmJiAhcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gY2hhcjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBxdW90ZSkge1xuICAgICAgcXVvdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKC9cXHMvLnRlc3QoY2hhcikgJiYgIXF1b3RlKSB7XG4gICAgICBpZiAoY3VycmVudCkge1xuICAgICAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgICBjdXJyZW50ID0gXCJcIjtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgfVxuXG4gIGlmIChjdXJyZW50KSB7XG4gICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgfVxuXG4gIHJldHVybiBwYXJ0cztcbn1cbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHR5cGUgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBMbHZtVG9rZW4ge1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xufVxuXG5jb25zdCBMTFZNX0tFWVdPUkRTID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oW1xuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbnRyb2xcIiwgW1xuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1kZWNsYXJhdGlvblwiLCBbXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxuICAgIFwicGVyc29uYWxpdHlcIiwgXCJ1c2VsaXN0b3JkZXJcIiwgXCJ1c2VsaXN0b3JkZXJfYmJcIiwgXCJtb2R1bGVcIiwgXCJhc21cIiwgXCJzb3VyY2VfZmlsZW5hbWVcIiwgXCJ0YXJnZXRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcbiAgICBcImFsbG9jYVwiLCBcImxvYWRcIiwgXCJzdG9yZVwiLCBcImdldGVsZW1lbnRwdHJcIiwgXCJmZW5jZVwiLCBcImNtcHhjaGdcIiwgXCJhdG9taWNybXdcIiwgXCJleHRyYWN0dmFsdWVcIiwgXCJpbnNlcnR2YWx1ZVwiLCBcImV4dHJhY3RlbGVtZW50XCIsXG4gICAgXCJpbnNlcnRlbGVtZW50XCIsIFwic2h1ZmZsZXZlY3RvclwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1hcml0aG1ldGljXCIsIFtcbiAgICBcImFkZFwiLCBcInN1YlwiLCBcIm11bFwiLCBcInVkaXZcIiwgXCJzZGl2XCIsIFwidXJlbVwiLCBcInNyZW1cIiwgXCJzaGxcIiwgXCJsc2hyXCIsIFwiYXNoclwiLCBcImFuZFwiLCBcIm9yXCIsIFwieG9yXCIsIFwiZm5lZ1wiLCBcImZhZGRcIiwgXCJmc3ViXCIsIFwiZm11bFwiLFxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29tcGFyaXNvblwiLCBbXCJpY21wXCIsIFwiZmNtcFwiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXG4gICAgXCJ0cnVuY1wiLCBcInpleHRcIiwgXCJzZXh0XCIsIFwiZnB0cnVuY1wiLCBcImZwZXh0XCIsIFwiZnB0b3VpXCIsIFwiZnB0b3NpXCIsIFwidWl0b2ZwXCIsIFwic2l0b2ZwXCIsIFwicHRydG9pbnRcIiwgXCJpbnR0b3B0clwiLCBcImJpdGNhc3RcIiwgXCJhZGRyc3BhY2VjYXN0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tb2RpZmllclwiLCBbXG4gICAgXCJwcml2YXRlXCIsIFwiaW50ZXJuYWxcIiwgXCJhdmFpbGFibGVfZXh0ZXJuYWxseVwiLCBcImxpbmtvbmNlXCIsIFwid2Vha1wiLCBcImNvbW1vblwiLCBcImFwcGVuZGluZ1wiLCBcImV4dGVybl93ZWFrXCIsIFwibGlua29uY2Vfb2RyXCIsIFwid2Vha19vZHJcIixcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcbiAgICBcInRocmVhZF9sb2NhbFwiLCBcImxvY2FsZHluYW1pY1wiLCBcImluaXRpYWxleGVjXCIsIFwibG9jYWxleGVjXCIsIFwidW5uYW1lZF9hZGRyXCIsIFwibG9jYWxfdW5uYW1lZF9hZGRyXCIsIFwiYXRvbWljXCIsIFwidW5vcmRlcmVkXCIsIFwibW9ub3RvbmljXCIsXG4gICAgXCJhY3F1aXJlXCIsIFwicmVsZWFzZVwiLCBcImFjcV9yZWxcIiwgXCJzZXFfY3N0XCIsIFwic3luY3Njb3BlXCIsIFwidm9sYXRpbGVcIiwgXCJzaW5nbGV0aHJlYWRcIiwgXCJjY2NcIiwgXCJmYXN0Y2NcIiwgXCJjb2xkY2NcIiwgXCJ3ZWJraXRfanNjY1wiLFxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxuICAgIFwiZmFzdFwiLCBcIm5uYW5cIiwgXCJuaW5mXCIsIFwibnN6XCIsIFwiYXJjcFwiLCBcImNvbnRyYWN0XCIsIFwiYWZuXCIsIFwicmVhc3NvY1wiLCBcIm51d1wiLCBcIm5zd1wiLCBcImV4YWN0XCIsIFwiaW5ib3VuZHNcIiwgXCJ0b1wiLCBcInhcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXG4gICAgXCJlcVwiLCBcIm5lXCIsIFwidWd0XCIsIFwidWdlXCIsIFwidWx0XCIsIFwidWxlXCIsIFwic2d0XCIsIFwic2dlXCIsIFwic2x0XCIsIFwic2xlXCIsIFwib2VxXCIsIFwib2d0XCIsIFwib2dlXCIsIFwib2x0XCIsIFwib2xlXCIsIFwib25lXCIsIFwib3JkXCIsIFwidWVxXCIsIFwidW5lXCIsXG4gICAgXCJ1bm9cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWF0dHJpYnV0ZVwiLCBbXG4gICAgXCJhbHdheXNpbmxpbmVcIiwgXCJhcmdtZW1vbmx5XCIsIFwiYnVpbHRpblwiLCBcImJ5cmVmXCIsIFwiYnl2YWxcIiwgXCJjb2xkXCIsIFwiY29udmVyZ2VudFwiLCBcImRlcmVmZXJlbmNlYWJsZVwiLCBcImRlcmVmZXJlbmNlYWJsZV9vcl9udWxsXCIsIFwiZGlzdGluY3RcIixcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXG4gICAgXCJub25udWxsXCIsIFwibm9yZWN1cnNlXCIsIFwibm9yZWR6b25lXCIsIFwibm9yZXR1cm5cIiwgXCJub3N5bmNcIiwgXCJub3Vud2luZFwiLCBcIm51bGxfcG9pbnRlcl9pc192YWxpZFwiLCBcIm9wYXF1ZVwiLCBcIm9wdG5vbmVcIiwgXCJvcHRzaXplXCIsXG4gICAgXCJwcmVhbGxvY2F0ZWRcIiwgXCJyZWFkbm9uZVwiLCBcInJlYWRvbmx5XCIsIFwicmV0dXJuZWRcIiwgXCJyZXR1cm5zX3R3aWNlXCIsIFwic2FuaXRpemVfYWRkcmVzc1wiLCBcInNhbml0aXplX2h3YWRkcmVzc1wiLCBcInNhbml0aXplX21lbW9yeVwiLFxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcbiAgICBcIndpbGxyZXR1cm5cIiwgXCJ3cml0ZW9ubHlcIiwgXCJ6ZXJvZXh0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcbl0pO1xuXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xuICBcInZvaWRcIiwgXCJsYWJlbFwiLCBcInRva2VuXCIsIFwibWV0YWRhdGFcIiwgXCJ4ODZfbW14XCIsIFwieDg2X2FteFwiLCBcImhhbGZcIiwgXCJiZmxvYXRcIiwgXCJmbG9hdFwiLCBcImRvdWJsZVwiLCBcImZwMTI4XCIsIFwieDg2X2ZwODBcIiwgXCJwcGNfZnAxMjhcIiwgXCJwdHJcIixcbl0pO1xuXG5jb25zdCBQVU5DVFVBVElPTl9DTEFTUyA9IFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvZGVFbGVtZW50LmVtcHR5KCk7XG4gIGNvZGVFbGVtZW50LmFkZENsYXNzKFwibG9vbS1sbHZtLWNvZGVcIik7XG5cbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGxpbmVzLmZvckVhY2goKGxpbmUsIGluZGV4KSA9PiB7XG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcbiAgICBpZiAoaW5kZXggPCBsaW5lcy5sZW5ndGggLSAxKSB7XG4gICAgICBjb2RlRWxlbWVudC5hcHBlbmRUZXh0KFwiXFxuXCIpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMbHZtRGVjb3JhdGlvbnMoXG4gIGJ1aWxkZXI6IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPixcbiAgdmlldzogRWRpdG9yVmlldyxcbiAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xuICBpZiAoIWNvbnRlbnRMaW5lQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XSA/PyBcIlwiO1xuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplTGx2bUxpbmUobGluZSk7XG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2NMaW5lID0gdmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAyICsgaW5kZXgpO1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4uZnJvbSxcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4udG8sXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xuICAgIGlmICh0b2tlbi5mcm9tID4gY3Vyc29yKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvciwgdG9rZW4uZnJvbSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBjb250YWluZXIuY3JlYXRlU3Bhbih7IGNsczogdG9rZW4uY2xhc3NOYW1lIH0pO1xuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICBpZiAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvcikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xuICBjb25zdCB0b2tlbnM6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBpbmRleCA9IDA7XG5cbiAgYWRkTGFiZWxUb2tlbihsaW5lLCB0b2tlbnMpO1xuXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29uc3QgY3VycmVudCA9IGxpbmVbaW5kZXhdO1xuICAgIGlmIChjdXJyZW50ID09PSBcIjtcIikge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGN1cnJlbnQpKSB7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xuICAgIGlmIChzdHJpbmdUb2tlbikge1xuICAgICAgaWYgKHN0cmluZ1Rva2VuLnByZWZpeEVuZCA+IGluZGV4KSB7XG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xuICAgICAgfVxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBzdHJpbmdUb2tlbi52YWx1ZVN0YXJ0LCB0bzogc3RyaW5nVG9rZW4udmFsdWVFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nXCIgfSk7XG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AbGx2bVxcLltBLVphLXokLl8wLTldKy95LCBcImxvb20tbGx2bS1pbnRyaW5zaWNcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWxvY2FsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyFbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCFcXGQrXFxiL3ksIFwibG9vbS1sbHZtLW1ldGFkYXRhXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyNcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWF0dHJpYnV0ZS1ncm91cFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXGJhZGRyc3BhY2VcXHMqXFwoXFxzKlxcZCtcXHMqXFwpL3ksIFwibG9vbS1sbHZtLXR5cGVcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrfFxcZCspKD86W2VFXVstK10/XFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwuXFwuXFwuL3ksIFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCIsIHRva2Vucyk7XG5cbiAgICBpZiAobWF0Y2hlZCkge1xuICAgICAgaW5kZXggPSBtYXRjaGVkO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgd29yZCA9IHJlYWRXb3JkKGxpbmUsIGluZGV4KTtcbiAgICBpZiAod29yZCkge1xuICAgICAgdG9rZW5zLnB1c2goe1xuICAgICAgICBmcm9tOiBpbmRleCxcbiAgICAgICAgdG86IHdvcmQuZW5kLFxuICAgICAgICBjbGFzc05hbWU6IGNsYXNzaWZ5V29yZCh3b3JkLnZhbHVlKSxcbiAgICAgIH0pO1xuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChcIigpW117fTw+LDo9KlwiLmluY2x1ZGVzKGN1cnJlbnQpKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogaW5kZXggKyAxLCBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTIH0pO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplVG9rZW5zKHRva2Vucyk7XG59XG5cbmZ1bmN0aW9uIGFkZExhYmVsVG9rZW4obGluZTogc3RyaW5nLCB0b2tlbnM6IExsdm1Ub2tlbltdKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXHMqKSg/OihbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfFxcZCspfCglW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkKykpKDopLyk7XG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxhYmVsU3RhcnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IG1hdGNoWzJdID8/IG1hdGNoWzNdO1xuICBpZiAoIWxhYmVsVGV4dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0LFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWxhYmVsXCIsXG4gIH0pO1xuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoICsgMSxcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlXb3JkKHdvcmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXmlcXGQrJC8udGVzdCh3b3JkKSB8fCBMTFZNX1BSSU1JVElWRV9UWVBFUy5oYXMod29yZCkpIHtcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xuICB9XG5cbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9bQS1aYS16X11bQS1aYS16MC05Xy4tXSoveTtcbiAgbWF0Y2gubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiByZXN1bHRbMF0sXG4gICAgZW5kOiBtYXRjaC5sYXN0SW5kZXgsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdUb2tlbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHByZWZpeEVuZDogbnVtYmVyOyB2YWx1ZVN0YXJ0OiBudW1iZXI7IHZhbHVlRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgY3Vyc29yID0gaW5kZXg7XG4gIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiY1wiICYmIGxpbmVbY3Vyc29yICsgMV0gPT09IFwiXFxcIlwiKSB7XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICBpZiAobGluZVtjdXJzb3JdICE9PSBcIlxcXCJcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcbiAgY3Vyc29yICs9IDE7XG4gIHdoaWxlIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XG4gICAgICBjdXJzb3IgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXCJcIikge1xuICAgICAgY3Vyc29yICs9IDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcbiAgICB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlRW5kOiBjdXJzb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcbiAgbGluZTogc3RyaW5nLFxuICBpbmRleDogbnVtYmVyLFxuICByZWdleDogUmVnRXhwLFxuICBjbGFzc05hbWU6IHN0cmluZyxcbiAgdG9rZW5zOiBMbHZtVG9rZW5bXSxcbik6IG51bWJlciB8IG51bGwge1xuICByZWdleC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgbWF0Y2ggPSByZWdleC5leGVjKGxpbmUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogcmVnZXgubGFzdEluZGV4LCBjbGFzc05hbWUgfSk7XG4gIHJldHVybiByZWdleC5sYXN0SW5kZXg7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnM6IExsdm1Ub2tlbltdKTogTGx2bVRva2VuW10ge1xuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcbiAgY29uc3Qgbm9ybWFsaXplZDogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBpZiAodG9rZW4udG8gPD0gY3Vyc29yKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcbiAgICBub3JtYWxpemVkLnB1c2goeyAuLi50b2tlbiwgZnJvbSB9KTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbnVtYmVyIHtcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgaWYgKGJsb2NrLmNvbnRlbnQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGJsb2NrLmVuZExpbmUgPiBibG9jay5zdGFydExpbmUgKyAxID8gMSA6IDA7XG4gIH1cblxuICByZXR1cm4gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIG1hcFdvcmRzKGNsYXNzTmFtZTogc3RyaW5nLCB3b3Jkczogc3RyaW5nW10pOiBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB7XG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvcnRIYXNoKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoaW5wdXQpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG59XG4iLCAiaW1wb3J0IHsgc2hvcnRIYXNoIH0gZnJvbSBcIi4vdXRpbHMvaGFzaFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBMQU5HVUFHRV9BTElBU0VTOiBSZWNvcmQ8c3RyaW5nLCBsb29tTm9ybWFsaXplZExhbmd1YWdlPiA9IHtcbiAgcHl0aG9uOiBcInB5dGhvblwiLFxuICBweTogXCJweXRob25cIixcbiAgamF2YXNjcmlwdDogXCJqYXZhc2NyaXB0XCIsXG4gIGpzOiBcImphdmFzY3JpcHRcIixcbiAgdHlwZXNjcmlwdDogXCJ0eXBlc2NyaXB0XCIsXG4gIHRzOiBcInR5cGVzY3JpcHRcIixcbiAgb2NhbWw6IFwib2NhbWxcIixcbiAgbWw6IFwib2NhbWxcIixcbiAgYzogXCJjXCIsXG4gIGg6IFwiY1wiLFxuICBjcHA6IFwiY3BwXCIsXG4gIGN4eDogXCJjcHBcIixcbiAgY2M6IFwiY3BwXCIsXG4gIFwiYysrXCI6IFwiY3BwXCIsXG4gIHNoZWxsOiBcInNoZWxsXCIsXG4gIHNoOiBcInNoZWxsXCIsXG4gIGJhc2g6IFwic2hlbGxcIixcbiAgenNoOiBcInNoZWxsXCIsXG4gIHJ1Ynk6IFwicnVieVwiLFxuICByYjogXCJydWJ5XCIsXG4gIHBlcmw6IFwicGVybFwiLFxuICBwbDogXCJwZXJsXCIsXG4gIGx1YTogXCJsdWFcIixcbiAgcGhwOiBcInBocFwiLFxuICBnbzogXCJnb1wiLFxuICBnb2xhbmc6IFwiZ29cIixcbiAgcnVzdDogXCJydXN0XCIsXG4gIHJzOiBcInJ1c3RcIixcbiAgaGFza2VsbDogXCJoYXNrZWxsXCIsXG4gIGhzOiBcImhhc2tlbGxcIixcbiAgamF2YTogXCJqYXZhXCIsXG4gIGxsdm06IFwibGx2bS1pclwiLFxuICBsbHZtaXI6IFwibGx2bS1pclwiLFxuICBcImxsdm0taXJcIjogXCJsbHZtLWlyXCIsXG4gIGxsOiBcImxsdm0taXJcIixcbiAgbGVhbjogXCJsZWFuXCIsXG4gIGxlYW40OiBcImxlYW5cIixcbiAgY29xOiBcImNvcVwiLFxuICB2OiBcImNvcVwiLFxuICBzbXQ6IFwic210bGliXCIsXG4gIHNtdDI6IFwic210bGliXCIsXG4gIHNtdGxpYjogXCJzbXRsaWJcIixcbiAgXCJzbXQtbGliXCI6IFwic210bGliXCIsXG4gIHozOiBcInNtdGxpYlwiLFxufTtcblxuY29uc3QgT1VUUFVUX1NUQVJUID0gL148IS0tXFxzKmxvb206b3V0cHV0OnN0YXJ0XFxzK2lkPShbYS1mMC05XSspXFxzKi0tPiQvaTtcbmNvbnN0IE9VVFBVVF9FTkQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6ZW5kXFxzKi0tPiQvaTtcbmNvbnN0IEZFTkNFX1NUQVJUID0gL14oYGBgK3x+fn4rKVxccyooW15cXHNgXSopPy4qJC87XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZShyYXdMYW5ndWFnZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfCBudWxsIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHJhd0xhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuXG4gIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2Ygc2V0dGluZ3M/LmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkge1xuICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGFsaWFzZXMgPSBwYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKTtcbiAgICBpZiAobmFtZSAmJiAobmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSkge1xuICAgICAgcmV0dXJuIGxhbmd1YWdlLm5hbWUudHJpbSgpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBMQU5HVUFHRV9BTElBU0VTW25vcm1hbGl6ZWRdID8/IG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMoc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBbXG4gICAgLi4uT2JqZWN0LmtleXMoTEFOR1VBR0VfQUxJQVNFUyksXG4gICAgLi4uKHNldHRpbmdzPy5jdXN0b21MYW5ndWFnZXMgPz8gW10pLmZsYXRNYXAoKGxhbmd1YWdlKSA9PiBbbGFuZ3VhZ2UubmFtZSwgLi4ucGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyldKSxcbiAgXS5tYXAoKGFsaWFzKSA9PiBhbGlhcy50b0xvd2VyQ2FzZSgpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Db2RlQmxvY2tbXSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IGJsb2NrczogbG9vbUNvZGVCbG9ja1tdID0gW107XG4gIGxldCBvcmRpbmFsID0gMDtcbiAgbGV0IGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xuXG4gICAgaWYgKGluc2lkZU1hbmFnZWRPdXRwdXQpIHtcbiAgICAgIGlmIChPVVRQVVRfRU5ELnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChPVVRQVVRfU1RBUlQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZmVuY2VNYXRjaCA9IGxpbmUubWF0Y2goRkVOQ0VfU1RBUlQpO1xuICAgIGlmICghZmVuY2VNYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnRMaW5lID0gaTtcbiAgICBjb25zdCBmZW5jZUluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpO1xuICAgIGNvbnN0IGZlbmNlVG9rZW4gPSBmZW5jZU1hdGNoWzFdO1xuICAgIGNvbnN0IHNvdXJjZUxhbmd1YWdlID0gKGZlbmNlTWF0Y2hbMl0gPz8gXCJcIikudHJpbSgpO1xuICAgIGNvbnN0IGxhbmd1YWdlID0gbm9ybWFsaXplTGFuZ3VhZ2Uoc291cmNlTGFuZ3VhZ2UsIHNldHRpbmdzKTtcblxuICAgIGxldCBlbmRMaW5lID0gaTtcbiAgICBjb25zdCBjb250ZW50TGluZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xuICAgICAgY29uc3QgaW5uZXJMaW5lID0gbGluZXNbal07XG4gICAgICBjb25zdCB0cmltbWVkID0gaW5uZXJMaW5lLnRyaW0oKTtcblxuICAgICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChmZW5jZVRva2VuKSAmJiAvXihgYGArfH5+fispXFxzKiQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgICAgZW5kTGluZSA9IGo7XG4gICAgICAgIGkgPSBqO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29udGVudExpbmVzLnB1c2goc3RyaXBGZW5jZUluZGVudChpbm5lckxpbmUsIGZlbmNlSW5kZW50KSk7XG4gICAgICBlbmRMaW5lID0gajtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBvcmRpbmFsICs9IDE7XG4gICAgY29uc3QgY29udGVudCA9IGNvbnRlbnRMaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gc2hvcnRIYXNoKGNvbnRlbnQpO1xuICAgIGNvbnN0IGlkID0gc2hvcnRIYXNoKGAke2ZpbGVQYXRofToke29yZGluYWx9OiR7bGFuZ3VhZ2V9OiR7Y29udGVudEhhc2h9YCk7XG5cbiAgICBibG9ja3MucHVzaCh7XG4gICAgICBpZCxcbiAgICAgIG9yZGluYWwsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgbGFuZ3VhZ2VBbGlhczogc291cmNlTGFuZ3VhZ2UudG9Mb3dlckNhc2UoKSxcbiAgICAgIHNvdXJjZUxhbmd1YWdlLFxuICAgICAgY29udGVudCxcbiAgICAgIHN0YXJ0TGluZSxcbiAgICAgIGVuZExpbmUsXG4gICAgICBmZW5jZVN0YXJ0OiAwLFxuICAgICAgZmVuY2VFbmQ6IDAsXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYmxvY2tzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsaWFzTGlzdCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQmxvY2tBdExpbmUoYmxvY2tzOiBsb29tQ29kZUJsb2NrW10sIGxpbmU6IG51bWJlcik6IGxvb21Db2RlQmxvY2sgfCBudWxsIHtcbiAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gbGluZSA+PSBibG9jay5zdGFydExpbmUgJiYgbGluZSA8PSBibG9jay5lbmRMaW5lKSA/PyBudWxsO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHN0cmlwRmVuY2VJbmRlbnQobGluZTogc3RyaW5nLCBmZW5jZUluZGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFmZW5jZUluZGVudCkge1xuICAgIHJldHVybiBsaW5lO1xuICB9XG5cbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgZmVuY2VJbmRlbnQubGVuZ3RoICYmIGluZGV4IDwgbGluZS5sZW5ndGggJiYgbGluZVtpbmRleF0gPT09IGZlbmNlSW5kZW50W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbGluZS5zbGljZShpbmRleCk7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5vZGVSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5vZGVcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5vZGUuanNcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiamF2YXNjcmlwdFwiLCBcInR5cGVzY3JpcHRcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5qc1wiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBzZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9PT0gXCJ0c3hcIiA/IFwiVHlwZVNjcmlwdCAodHN4KVwiIDogXCJUeXBlU2NyaXB0ICh0cy1ub2RlKVwiO1xuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtzZXR0aW5ncy50eXBlc2NyaXB0TW9kZX1gLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi50c1wiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIEN1c3RvbUxhbmd1YWdlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJjdXN0b21cIjtcbiAgZGlzcGxheU5hbWUgPSBcIkN1c3RvbSBsYW5ndWFnZVwiO1xuICBsYW5ndWFnZXMgPSBbXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk/LmV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBsYW5ndWFnZSA9IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGN1c3RvbSBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2xhbmd1YWdlLm5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBsYW5ndWFnZS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuYXJncyB8fCBcIntmaWxlfVwiKSxcbiAgICAgIGZpbGVFeHRlbnNpb246IG5vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24sIGxhbmd1YWdlLm5hbWUpLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldEN1c3RvbUxhbmd1YWdlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUN1c3RvbUxhbmd1YWdlIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gYmxvY2subGFuZ3VhZ2UudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgcmV0dXJuIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChsYW5ndWFnZSkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gbGFuZ3VhZ2UuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGAuJHtuYW1lfWA7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgSW50ZXJwcmV0ZWRTcGVjIHtcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKSA9PiBzdHJpbmc7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgYXJncz86IHN0cmluZ1tdO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0VudjtcbiAgbWluaW11bVRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuY29uc3QgSU5URVJQUkVURURfU1BFQ1M6IEludGVycHJldGVkU3BlY1tdID0gW1xuICB7XG4gICAgbGFuZ3VhZ2U6IFwic2hlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJTaGVsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3Muc2hlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnNoXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJydWJ5XCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUnVieVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucnVieUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucmJcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBlcmxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQZXJsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5wZXJsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5wbFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwibHVhXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTHVhXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmx1YVwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGhwXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUEhQXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5waHBFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBocFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiZ29cIixcbiAgICBkaXNwbGF5TmFtZTogXCJHb1wiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuZ29FeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmdvXCIsXG4gICAgYXJnczogW1wicnVuXCIsIFwie2ZpbGV9XCJdLFxuICAgIGVudjoge1xuICAgICAgR09DQUNIRTogXCJ7dGVtcERpcn0vZ29jYWNoZVwiLFxuICAgIH0sXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiaGFza2VsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmhhc2tlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmhzXCIsXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuXTtcblxuZXhwb3J0IGNsYXNzIEludGVycHJldGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJpbnRlcnByZXRlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiSW50ZXJwcmV0ZWRcIjtcbiAgbGFuZ3VhZ2VzID0gSU5URVJQUkVURURfU1BFQ1MubWFwKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlKTtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICByZXR1cm4gQm9vbGVhbihzcGVjPy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIGlmICghc3BlYykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfWAsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc3BlYy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCksXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MgPz8gW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogc3BlYy5maWxlRXh0ZW5zaW9uLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc3BlYy5taW5pbXVtVGltZW91dE1zID8/IDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIGVudjogc3BlYy5lbnYsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldFNwZWMobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBJbnRlcnByZXRlZFNwZWMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBJTlRFUlBSRVRFRF9TUEVDUy5maW5kKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlID09PSBsYW5ndWFnZSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTGx2bVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibGx2bS1pclwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTExWTSBJUlwiO1xuICBsYW5ndWFnZXMgPSBbXCJsbHZtLWlyXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXN1bHQudGltZWRPdXQgJiYgIXJlc3VsdC5jYW5jZWxsZWQgJiYgcmVzdWx0LmV4aXRDb2RlICE9IG51bGwgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICBpZiAocmVzdWx0LmV4aXRDb2RlICE9PSAwKSB7XG4gICAgICAgIHJlc3VsdC5zdWNjZXNzID0gdHJ1ZTtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgUHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LiBVbmRlciBsbGksIHRoYXQgYmVjb21lcyB0aGUgcHJvY2VzcyBleGl0IHN0YXR1cy5gO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRvdXQgPSByZXN1bHQuZXhpdENvZGUgPT09IDBcbiAgICAgICAgICA/IFwiTExWTSBwcm9ncmFtIGV4aXRlZCB3aXRoIGNvZGUgMC5cIlxuICAgICAgICAgIDogYExMVk0gcHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LlxcblVzZSBzdGRvdXQgaW4gdGhlIElSIGl0c2VsZiBpZiB5b3Ugd2FudCBwcmludGFibGUgcHJvZ3JhbSBvdXRwdXQuYDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoTmFtZWRUZW1wU291cmNlRmlsZSwgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE1hbmFnZWRDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibWFuYWdlZC1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTWFuYWdlZCBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJydXN0XCIsIFwiamF2YVwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1blJ1c3QoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5KYXZhKGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuUnVzdChibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLnJzXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5KYXZhKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShcIk1haW4uamF2YVwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBpZiAoIXNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpzb3VyY2VgLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHRlbXBEaXIsXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wiLWNwXCIsIHRlbXBEaXIsIFwiTWFpblwiXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBOYXRpdmVDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibmF0aXZlLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJOYXRpdmUgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiY1wiLCBcImNwcFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjcHBcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpIDogc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCk7XG4gICAgY29uc3QgZmlsZUV4dGVuc2lvbiA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiLmNcIiA6IFwiLmNwcFwiO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIkMgKEdDQylcIiA6IFwiQysrIChHKyspXCI7XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKGZpbGVFeHRlbnNpb24sIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcywgcnVuVGVtcEZpbGVQcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgT2NhbWxSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm9jYW1sXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJPQ2FtbFwiO1xuICBsYW5ndWFnZXMgPSBbXCJvY2FtbFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwib2NhbWxcIiAmJiBCb29sZWFuKHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5vY2FtbE1vZGU7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCk7XG5cbiAgICBpZiAobW9kZSA9PT0gXCJvY2FtbFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKG1vZGUgPT09IFwiZHVuZVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmR1bmVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkR1bmUgLyBPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJleGVjXCIsIFwiLS1cIiwgXCJvY2FtbFwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLm1sXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtY29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIi1vXCIsIGJpbmFyeVBhdGgsIHRlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtcnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFB5dGhvblJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHl0aG9uXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQeXRob25cIjtcbiAgbGFuZ3VhZ2VzID0gW1wicHl0aG9uXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJweXRob25cIiAmJiBCb29sZWFuKHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIucHlcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJvb2ZSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInByb29mXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQcm9vZiBjaGVja2VyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxlYW5cIiwgXCJjb3FcIiwgXCJzbXRsaWJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmxlYW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkxlYW5cIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxlYW5cIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06Y29xYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJDb3FcIixcbiAgICAgICAgZXhlY3V0YWJsZTogcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLFxuICAgICAgICBhcmdzOiBbXCItcVwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpzbXRsaWJgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlNNVC1MSUIgKFozKVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwcm9vZiBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nIHtcbiAgY29uc3QgY29uZmlndXJlZCA9IHNldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpO1xuICBpZiAoY29uZmlndXJlZCAmJiBjb25maWd1cmVkICE9PSBcImNvcWNcIikge1xuICAgIHJldHVybiBjb25maWd1cmVkO1xuICB9XG5cbiAgY29uc3Qgb3BhbUNvcWMgPSBqb2luKHByb2Nlc3MuZW52LkhPTUUgPz8gXCJcIiwgXCIub3BhbVwiLCBcImRlZmF1bHRcIiwgXCJiaW5cIiwgXCJjb3FjXCIpO1xuICByZXR1cm4gZXhpc3RzU3luYyhvcGFtQ29xYykgPyBvcGFtQ29xYyA6IGNvbmZpZ3VyZWQgfHwgXCJjb3FjXCI7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIGxvb21SdW5uZXJSZWdpc3RyeSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcnVubmVyczogbG9vbVJ1bm5lcltdKSB7fVxuXG4gIGdldFJ1bm5lckZvckJsb2NrKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbVJ1bm5lciB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnJ1bm5lcnMuZmluZCgocnVubmVyKSA9PiAoIXJ1bm5lci5sYW5ndWFnZXMubGVuZ3RoIHx8IHJ1bm5lci5sYW5ndWFnZXMuaW5jbHVkZXMoYmxvY2subGFuZ3VhZ2UpKSAmJiBydW5uZXIuY2FuUnVuKGJsb2NrLCBzZXR0aW5ncykpID8/IG51bGw7XG4gIH1cblxuICBnZXRTdXBwb3J0ZWRMYW5ndWFnZXMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldCh0aGlzLnJ1bm5lcnMuZmxhdE1hcCgocnVubmVyKSA9PiBydW5uZXIubGFuZ3VhZ2VzKSldO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgTm90aWNlLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nLCBub3JtYWxpemVQYXRoIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSBsb29tUGx1Z2luIGZyb20gXCIuL21haW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbUN1c3RvbUxhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9TRVRUSU5HUzogbG9vbVBsdWdpblNldHRpbmdzID0ge1xuICBlbmFibGVMb2NhbEV4ZWN1dGlvbjogZmFsc2UsXG4gIGhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2s6IGZhbHNlLFxuICBwcmVzZXJ2ZVNvdXJjZU1vZGU6IHRydWUsXG4gIGRlZmF1bHRUaW1lb3V0TXM6IDgwMDAsXG4gIHdvcmtpbmdEaXJlY3Rvcnk6IFwiXCIsXG4gIHB5dGhvbkV4ZWN1dGFibGU6IFwicHl0aG9uM1wiLFxuICBub2RlRXhlY3V0YWJsZTogXCJub2RlXCIsXG4gIHR5cGVzY3JpcHRNb2RlOiBcInRzLW5vZGVcIixcbiAgdHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlOiBcInRzLW5vZGVcIixcbiAgb2NhbWxNb2RlOiBcIm9jYW1sXCIsXG4gIG9jYW1sRXhlY3V0YWJsZTogXCJvY2FtbFwiLFxuICBjRXhlY3V0YWJsZTogXCJnY2NcIixcbiAgY3BwRXhlY3V0YWJsZTogXCJnKytcIixcbiAgc2hlbGxFeGVjdXRhYmxlOiBcImJhc2hcIixcbiAgcnVieUV4ZWN1dGFibGU6IFwicnVieVwiLFxuICBwZXJsRXhlY3V0YWJsZTogXCJwZXJsXCIsXG4gIGx1YUV4ZWN1dGFibGU6IFwibHVhXCIsXG4gIHBocEV4ZWN1dGFibGU6IFwicGhwXCIsXG4gIGdvRXhlY3V0YWJsZTogXCJnb1wiLFxuICBydXN0RXhlY3V0YWJsZTogXCJydXN0Y1wiLFxuICBoYXNrZWxsRXhlY3V0YWJsZTogXCJydW5naGNcIixcbiAgamF2YUNvbXBpbGVyRXhlY3V0YWJsZTogXCJcIixcbiAgamF2YUV4ZWN1dGFibGU6IFwiamF2YVwiLFxuICBsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlOiBcImxsaVwiLFxuICBsZWFuRXhlY3V0YWJsZTogXCJsZWFuXCIsXG4gIGNvcUV4ZWN1dGFibGU6IFwiY29xY1wiLFxuICBzbXRFeGVjdXRhYmxlOiBcInozXCIsXG4gIHdyaXRlT3V0cHV0VG9Ob3RlOiBmYWxzZSxcbiAgYXV0b1J1bk9uRmlsZU9wZW46IGZhbHNlLFxuICBjdXN0b21MYW5ndWFnZXM6IFtdLFxuICBwZGZFeHBvcnRNb2RlOiBcImJvdGhcIixcbn07XG5cbmV4cG9ydCBjbGFzcyBsb29tU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4pIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCwgbG9vbVBsdWdpbik7XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJsb29tXCIgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJSdW4gc3VwcG9ydGVkIGNvZGUgZmVuY2VzIGRpcmVjdGx5IGZyb20gbm90ZXMgd2hpbGUgcHJlc2VydmluZyBuYXRpdmUgc3ludGF4IGhpZ2hsaWdodGluZy5cIiB9KTtcblxuICAgIHRoaXMucmVuZGVyR2VuZXJhbFNldHRpbmdzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJHZW5lcmFsIFNldHRpbmdzXCIsIHRydWUpKTtcbiAgICB0aGlzLnJlbmRlckJ1aWx0SW5SdW50aW1lcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQnVpbHQtaW4gUnVudGltZXNcIikpO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDdXN0b20gTGFuZ3VhZ2VzXCIpKTtcbiAgICB2b2lkIHRoaXMucmVuZGVyQ29udGFpbmVyR3JvdXBzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDb250YWluZXJpemF0aW9uIEdyb3Vwc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCB0aXRsZTogc3RyaW5nLCBvcGVuID0gZmFsc2UpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb25cIiB9KTtcbiAgICBkZXRhaWxzLm9wZW4gPSBvcGVuO1xuICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogdGl0bGUsIGNsczogXCJsb29tLXNldHRpbmdzLXN1bW1hcnlcIiB9KTtcbiAgICByZXR1cm4gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uLWJvZHlcIiB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyR2VuZXJhbFNldHRpbmdzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFbmFibGUgbG9jYWwgZXhlY3V0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcIkRpc2FibGVkIGJ5IGRlZmF1bHQuIGxvb20gcnVucyBjb2RlIG9uIHlvdXIgbG9jYWwgbWFjaGluZSBhbmQgZG9lcyBub3QgcHJvdmlkZSBzYW5kYm94aW5nLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB2YWx1ZTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiS2VlcCBsb29tIG5vdGVzIGluIHNvdXJjZSBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIlByZXNlcnZlIHJhdyBmZW5jZWQgY29kZSBpbiB0aGUgZWRpdG9yIGluc3RlYWQgb2YgbGV0dGluZyBsaXZlIHByZXZpZXcgY29sbGFwc2UgcmVzZWFyY2ggc25pcHBldHMuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCB0aW1lb3V0XCIpXG4gICAgICAuc2V0RGVzYyhcIk1heGltdW0gZXhlY3V0aW9uIHRpbWUgaW4gbWlsbGlzZWNvbmRzIGJlZm9yZSBsb29tIHRlcm1pbmF0ZXMgdGhlIHByb2Nlc3MuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIjgwMDBcIikuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4ocGFyc2VkKSAmJiBwYXJzZWQgPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyA9IHBhcnNlZDtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXb3JraW5nIGRpcmVjdG9yeVwiKVxuICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gRW1wdHkgdXNlcyB0aGUgY3VycmVudCBub3RlIGZvbGRlciB3aGVuIHBvc3NpYmxlLCBvdGhlcndpc2UgdGhlIHZhdWx0IHJvb3QuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIlZhdWx0IHJvb3RcIikuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5ID0gdmFsdWUudHJpbSgpID8gbm9ybWFsaXplUGF0aCh2YWx1ZS50cmltKCkpIDogXCJcIjtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXcml0ZSBvdXRwdXQgYmFjayB0byBub3RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkluc2VydCBtYW5hZ2VkIGxvb20gb3V0cHV0IHNlY3Rpb25zIGJlbmVhdGggY29kZSBibG9ja3MgaW5zdGVhZCBvZiBrZWVwaW5nIHJlc3VsdHMgcHVyZWx5IGluIHRoZSBVSS5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQXV0by1ydW4gb24gZmlsZSBvcGVuXCIpXG4gICAgICAuc2V0RGVzYyhcIlJ1biBhbGwgc3VwcG9ydGVkIGJsb2NrcyBpbiB0aGUgYWN0aXZlIG5vdGUgd2hlbiBpdCBvcGVucy4gRGlzYWJsZWQgYnkgZGVmYXVsdC5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUERGIGV4cG9ydCBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB3aGF0IHRvIGluY2x1ZGUgd2hlbiBleHBvcnRpbmcgbm90ZXMgY29udGFpbmluZyBsb29tIGNvZGUgYmxvY2tzIHRvIFBERi5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImJvdGhcIiwgXCJCb3RoIENvZGUgYW5kIE91dHB1dFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2RlXCIsIFwiQ29kZSBCbG9jayBPbmx5XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm91dHB1dFwiLCBcIk91dHB1dCBPbmx5XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlIHx8IFwiYm90aFwiKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID0gdmFsdWUgYXMgXCJib3RoXCIgfCBcImNvZGVcIiB8IFwib3V0cHV0XCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJCdWlsdEluUnVudGltZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQeXRob24gZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBQeXRob24uXCIsIFwicHl0aG9uRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk5vZGUgZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBKYXZhU2NyaXB0IGV4ZWN1dGlvbi5cIiwgXCJub2RlRXhlY3V0YWJsZVwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJUeXBlU2NyaXB0IHJ1bm5lciBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIlVzZSB0cy1ub2RlIG9yIHRzeCBmb3IgVHlwZVNjcmlwdCBibG9ja3MuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJ0cy1ub2RlXCIsIFwidHMtbm9kZVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJ0c3hcIiwgXCJ0c3hcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9IHZhbHVlIGFzIFwidHMtbm9kZVwiIHwgXCJ0c3hcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlR5cGVTY3JpcHQgdHJhbnNwaWxlciBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciB0cy1ub2RlIG9yIHRzeC5cIiwgXCJ0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGVcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiT0NhbWwgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgYmV0d2VlbiB0aGUgT0NhbWwgdG9wbGV2ZWwsIG9jYW1sYyBjb21waWxhdGlvbiwgb3IgZHVuZSBleGVjLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxcIiwgXCJvY2FtbFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbGNcIiwgXCJvY2FtbGNcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZHVuZVwiLCBcImR1bmVcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlID0gdmFsdWUgYXMgXCJvY2FtbFwiIHwgXCJvY2FtbGNcIiB8IFwiZHVuZVwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiT0NhbWwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3Igb2NhbWwsIG9jYW1sYywgb3IgZHVuZSBkZXBlbmRpbmcgb24gdGhlIHNlbGVjdGVkIG1vZGUuXCIsIFwib2NhbWxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiQyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMgYmxvY2tzLlwiLCBcImNFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiQysrIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQysrIGJsb2Nrcy5cIiwgXCJjcHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiU2hlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU2hlbGwsIEJhc2gsIGFuZCBzaCBibG9ja3MuXCIsIFwic2hlbGxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUnVieSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBSdWJ5IGJsb2Nrcy5cIiwgXCJydWJ5RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlBlcmwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUGVybCBibG9ja3MuXCIsIFwicGVybEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMdWEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgTHVhIGJsb2Nrcy5cIiwgXCJsdWFFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUEhQIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBIUCBibG9ja3MuXCIsIFwicGhwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkdvIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEdvIGJsb2Nrcy5cIiwgXCJnb0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJSdXN0IGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgUnVzdCBibG9ja3MuXCIsIFwicnVzdEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJIYXNrZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEhhc2tlbGwgYmxvY2tzLiBEZWZhdWx0cyB0byBydW5naGMuXCIsIFwiaGFza2VsbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGNvbXBpbGVyXCIsIFwiT3B0aW9uYWwgY29tbWFuZCBvciBwYXRoIGZvciBqYXZhYy4gTGVhdmUgZW1wdHkgdG8gdXNlIEphdmEgc291cmNlLWZpbGUgbW9kZS5cIiwgXCJqYXZhQ29tcGlsZXJFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIGNvbXBpbGVkIEphdmEgYmxvY2tzLlwiLCBcImphdmFFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTExWTSBJUiBpbnRlcnByZXRlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBMTFZNIElSIGJsb2NrcyB3aXRoIGxsaS5cIiwgXCJsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTGVhbiBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBMZWFuIGJsb2Nrcy5cIiwgXCJsZWFuRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkNvcSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBDb3EgYmxvY2tzIHdpdGggY29xYy5cIiwgXCJjb3FFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiU01UIHNvbHZlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU01ULUxJQiBibG9ja3MuIERlZmF1bHRzIHRvIHozLlwiLCBcInNtdEV4ZWN1dGFibGVcIik7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtbGlzdFwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGxpc3RFbCk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQWRkIGN1c3RvbSBsYW5ndWFnZVwiKVxuICAgICAgLnNldERlc2MoXCJDcmVhdGUgYSBuZXcgbG9jYWwgY29tbWFuZC1iYWNrZWQgbGFuZ3VhZ2UuXCIpXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogXCJjdXN0b20tbGFuZ3VhZ2VcIixcbiAgICAgICAgICAgIGFsaWFzZXM6IFwiXCIsXG4gICAgICAgICAgICBleGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgYXJnczogXCJ7ZmlsZX1cIixcbiAgICAgICAgICAgIGV4dGVuc2lvbjogXCIudHh0XCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgaWYgKCF0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmxlbmd0aCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBjdXN0b20gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZm9yRWFjaCgobGFuZ3VhZ2UsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlXCIgfSk7XG4gICAgICBkZXRhaWxzLm9wZW4gPSB0cnVlO1xuICAgICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiBsYW5ndWFnZS5uYW1lIHx8IGBDdXN0b20gbGFuZ3VhZ2UgJHtpbmRleCArIDF9YCB9KTtcbiAgICAgIGNvbnN0IGJvZHkgPSBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1ib2R5XCIgfSk7XG5cbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJOYW1lXCIsIFwiTm9ybWFsaXplZCBsYW5ndWFnZSBpZCB1c2VkIGJ5IGxvb20uXCIsIFwibmFtZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBbGlhc2VzXCIsIFwiQ29tbWEtc2VwYXJhdGVkIGZlbmNlIGFsaWFzZXMuXCIsIFwiYWxpYXNlc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeGVjdXRhYmxlXCIsIFwiTG9jYWwgY29tbWFuZCBvciBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGguXCIsIFwiZXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBcmd1bWVudHNcIiwgXCJTcGFjZS1zZXBhcmF0ZWQgYXJndW1lbnRzLiBVc2Uge2ZpbGV9IGZvciB0aGUgdGVtcCBzb3VyY2UgZmlsZS5cIiwgXCJhcmdzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dGVuc2lvblwiLCBcIlRlbXAgc291cmNlIGZpbGUgZXh0ZW5zaW9uLCBmb3IgZXhhbXBsZSAucHkuXCIsIFwiZXh0ZW5zaW9uXCIpO1xuXG4gICAgICBuZXcgU2V0dGluZyhib2R5KVxuICAgICAgICAuc2V0TmFtZShcIkRlbGV0ZSBsYW5ndWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW92ZSB0aGlzIGN1c3RvbSBsYW5ndWFnZS5cIilcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRGVsZXRlXCIpLnNldFdhcm5pbmcoKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJDb250YWluZXJHcm91cHMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY29udGFpbmVyLWdyb3VwLWxpc3RcIiB9KTtcbiAgICBsaXN0RWwuc2V0VGV4dChcIlNjYW5uaW5nIGNvbnRhaW5lciBncm91cHMuLi5cIik7XG5cbiAgICBjb25zdCBncm91cHMgPSBhd2FpdCB0aGlzLmxvb21QbHVnaW4uZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcbiAgICBsaXN0RWwuZW1wdHkoKTtcblxuICAgIGlmICghZ3JvdXBzLmxlbmd0aCkge1xuICAgICAgbGlzdEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gY29udGFpbmVyIGdyb3VwcyBmb3VuZCBpbiAub2JzaWRpYW4vcGx1Z2lucy9sb29tL2NvbnRhaW5lcnMuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICBuZXcgU2V0dGluZyhsaXN0RWwpXG4gICAgICAgIC5zZXROYW1lKGdyb3VwLm5hbWUpXG4gICAgICAgIC5zZXREZXNjKGdyb3VwLnN0YXR1cylcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiQnVpbGQgLyByZWJ1aWxkXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLmJ1aWxkQ29udGFpbmVyR3JvdXAoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSBhcyBzdHJpbmcpID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tQ3VzdG9tTGFuZ3VhZ2U+KFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBsYW5ndWFnZTogbG9vbUN1c3RvbUxhbmd1YWdlLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nLFxuICAgIGtleTogSyxcbiAgKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShsYW5ndWFnZVtrZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBsYW5ndWFnZVtrZXldID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UoKTogdm9pZCB7XG4gIG5ldyBOb3RpY2UoXCJsb29tIGxvY2FsIGV4ZWN1dGlvbiBpcyBkaXNhYmxlZC4gRW5hYmxlIGl0IGluIHNldHRpbmdzIG9yIGNvbmZpcm0gdGhlIGV4ZWN1dGlvbiB3YXJuaW5nIGZpcnN0LlwiKTtcbn1cbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRvb2xiYXJIYW5kbGVycyB7XG4gIG9uUnVuOiAoKSA9PiB2b2lkO1xuICBvbkNvcHk6ICgpID0+IHZvaWQ7XG4gIG9uUmVtb3ZlOiAoKSA9PiB2b2lkO1xuICBvblRvZ2dsZU91dHB1dDogKCkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoXG4gIGJsb2NrSWQ6IHN0cmluZyxcbiAgaXNSdW5uaW5nOiBib29sZWFuLFxuICBoYW5kbGVyczogbG9vbVRvb2xiYXJIYW5kbGVycyxcbik6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgdG9vbGJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHRvb2xiYXIuY2xhc3NOYW1lID0gXCJsb29tLWNvZGUtdG9vbGJhclwiO1xuICB0b29sYmFyLmRhdGFzZXQubG9vbUJsb2NrSWQgPSBibG9ja0lkO1xuXG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUnVuIGJsb2NrXCIsIGlzUnVubmluZyA/IFwibG9hZGVyLWNpcmNsZVwiIDogXCJwbGF5XCIsIGhhbmRsZXJzLm9uUnVuLCBpc1J1bm5pbmcpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJDb3B5IGNvZGVcIiwgXCJjb3B5XCIsIGhhbmRsZXJzLm9uQ29weSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSZW1vdmUgc25pcHBldFwiLCBcInRyYXNoLTJcIiwgaGFuZGxlcnMub25SZW1vdmUsIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiVG9nZ2xlIG91dHB1dFwiLCBcInBhbmVsLWJvdHRvbS1vcGVuXCIsIGhhbmRsZXJzLm9uVG9nZ2xlT3V0cHV0LCBmYWxzZSkpO1xuXG4gIHJldHVybiB0b29sYmFyO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCdXR0b24obGFiZWw6IHN0cmluZywgaWNvbk5hbWU6IHN0cmluZywgb25DbGljazogKCkgPT4gdm9pZCwgc3Bpbm5pbmc6IGJvb2xlYW4pOiBIVE1MQnV0dG9uRWxlbWVudCB7XG4gIGNvbnN0IGJ1dHRvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gIGJ1dHRvbi5jbGFzc05hbWUgPSBgbG9vbS10b29sYmFyLWJ1dHRvbiR7c3Bpbm5pbmcgPyBcIiBpcy1ydW5uaW5nXCIgOiBcIlwifWA7XG4gIGJ1dHRvbi50eXBlID0gXCJidXR0b25cIjtcbiAgYnV0dG9uLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgbGFiZWwpO1xuICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgb25DbGljaygpO1xuICB9KTtcbiAgc2V0SWNvbihidXR0b24sIGljb25OYW1lKTtcbiAgcmV0dXJuIGJ1dHRvbjtcbn1cbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZnVuY3Rpb24gZ2V0U3RhdHVzS2luZChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBcInN1Y2Nlc3NcIiB8IFwid2FybmluZ1wiIHwgXCJmYWlsdXJlXCIge1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdWNjZXNzKSB7XG4gICAgcmV0dXJuIG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSB8fCBvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSA/IFwid2FybmluZ1wiIDogXCJzdWNjZXNzXCI7XG4gIH1cblxuICByZXR1cm4gXCJmYWlsdXJlXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7Z2V0U3RhdHVzS2luZChvdXRwdXQpfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9YDtcbiAgcGFuZWwuZGF0YXNldC5sb29tQmxvY2tJZCA9IG91dHB1dC5ibG9ja0lkO1xuICByZW5kZXJPdXRwdXRQYW5lbChwYW5lbCwgb3V0cHV0KTtcbiAgcmV0dXJuIHBhbmVsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyT3V0cHV0UGFuZWwocGFuZWw6IEhUTUxFbGVtZW50LCBvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiB2b2lkIHtcbiAgY29uc3Qga2luZCA9IGdldFN0YXR1c0tpbmQob3V0cHV0KTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7a2luZH0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifSR7b3V0cHV0LmNvbGxhcHNlZCA/IFwiIGlzLWNvbGxhcHNlZFwiIDogXCJcIn1gO1xuICBwYW5lbC5lbXB0eSgpO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3QgYmFkZ2UgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJhZGdlXCIgfSk7XG4gIHNldEljb24oYmFkZ2UsIGtpbmQgPT09IFwic3VjY2Vzc1wiID8gXCJjaGVjay1jaXJjbGUtMlwiIDoga2luZCA9PT0gXCJ3YXJuaW5nXCIgPyBcImFsZXJ0LXRyaWFuZ2xlXCIgOiBcIngtY2lyY2xlXCIpO1xuXG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQucnVubmVyTmFtZX0gXHUwMEI3IGV4aXQgJHtvdXRwdXQucmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWApO1xuXG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQuZHVyYXRpb25Nc30gbXMgXHUwMEI3ICR7bmV3IERhdGUob3V0cHV0LnJlc3VsdC5maW5pc2hlZEF0KS50b0xvY2FsZVRpbWVTdHJpbmcoKX1gKTtcblxuICBjb25zdCBib2R5ID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJvZHlcIiB9KTtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZG91dFwiLCBvdXRwdXQucmVzdWx0LnN0ZG91dCk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiV2FybmluZ1wiLCBvdXRwdXQucmVzdWx0Lndhcm5pbmcpO1xuICB9XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRlcnJcIiwgb3V0cHV0LnJlc3VsdC5zdGRlcnIpO1xuICB9XG4gIGlmICghb3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpICYmICFvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgY29uc3QgZW1wdHkgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1lbXB0eVwiIH0pO1xuICAgIGVtcHR5LnNldFRleHQoXCJObyBvdXRwdXRcIik7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxhYmVsOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBzZWN0aW9uID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW1cIiB9KTtcbiAgc2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICBzZWN0aW9uLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZVwiLCB0ZXh0OiBjb250ZW50IH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUnVubmluZ1BhbmVsKCk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBcImxvb20tb3V0cHV0LXBhbmVsIGlzLXJ1bm5pbmdcIjtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IHNwaW5uZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc3Bpbm5lclwiIH0pO1xuICBzZXRJY29uKHNwaW5uZXIsIFwibG9hZGVyLWNpcmNsZVwiKTtcbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoXCJSdW5uaW5nXCIpO1xuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChcIkV4ZWN1dGluZy4uLlwiKTtcbiAgc3Bpbm5lci5zZXRBdHRyaWJ1dGUoXCJhcmlhLWhpZGRlblwiLCBcInRydWVcIik7XG5cbiAgcmV0dXJuIHBhbmVsO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQVFPO0FBQ1AsbUJBQTZDO0FBQzdDLElBQUFDLGVBQTJFO0FBQzNFLElBQUFDLGVBQXdCOzs7QUNYeEIsc0JBQTZDO0FBQzdDLGdCQUFnRDtBQUNoRCxJQUFBQyxtQkFBK0M7QUFDL0MsSUFBQUMsZUFBaUY7QUFDakYsSUFBQUMsd0JBQXNCOzs7QUNKdEIsc0JBQXVDO0FBQ3ZD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QUN4QyxVQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSxhQUFhO0FBQ25DO0FBQUEsTUFDRjtBQUVBLGVBQVMsSUFBSSxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQzVDLFlBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLDRCQUE0QjtBQUNsRCxpQkFBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUM1QjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF92aWV3IiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJwb3NpeFBhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImdldExlYWRpbmdXaGl0ZXNwYWNlIiwgIm5vcm1hbGl6ZUV4dGVuc2lvbiIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfZnMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImxvb21QbHVnaW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
