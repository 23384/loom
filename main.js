"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => loomPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");
var import_state = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var import_path10 = require("path");

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
    const entries = await (0, import_promises2.readdir)(containersPath, { withFileTypes: true });
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
    const configLang = config.languages[block.language] ?? config.languages[block.languageAlias];
    let isFallback = false;
    let language = null;
    if (configLang) {
      if (configLang.useDefault) {
        language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      } else {
        language = configLang;
      }
    } else {
      language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      isFallback = true;
    }
    if (!language || !language.command || !language.extension) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = (0, import_path2.join)(groupPath, tempFileName);
    try {
      await (0, import_promises2.writeFile)(tempFilePath, block.content, "utf8");
      let result;
      switch (config.runtime) {
        case "docker":
        case "podman":
          result = await this.runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings);
          break;
        case "qemu":
          result = await this.runQemu(groupName, groupPath, config, language, tempFileName, context);
          break;
        case "custom":
          result = await this.runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context);
          break;
        case "wsl":
          result = await this.runWslContainer(groupName, groupPath, config, language, tempFileName, context);
          break;
        default:
          throw new Error(`Unsupported runtime: ${config.runtime}`);
      }
      if (isFallback) {
        const fallbackMsg = `[Loom] Language '${block.language}' was not declared in container group. Running using default command: ${language.command}`;
        result.warning = result.warning ? `${result.warning}
${fallbackMsg}` : fallbackMsg;
      }
      return result;
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
      case "wsl":
        return this.createSyntheticResult(
          `container:${groupName}:wsl:build`,
          `WSL ${groupName} build`,
          `WSL environment ${config.image || "(default)"} does not require a build step.
`
        );
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
  async runWslContainer(groupName, groupPath, config, language, tempFileName, context) {
    const wslGroupPath = this.translateToWslPath(groupPath);
    const command = language.command.replaceAll("{file}", tempFileName);
    if (!command.trim()) {
      throw new Error("WSL command is empty.");
    }
    const shellFlags = config.wsl?.interactive ? ["-i", "-l", "-c"] : ["-l", "-c"];
    const wslArgs = ["bash", ...shellFlags, `cd "${wslGroupPath.replaceAll('"', '\\"')}" && ${command}`];
    if (config.image?.trim()) {
      wslArgs.unshift("-d", config.image.trim());
    }
    return await runProcess({
      runnerId: `container:${groupName}:wsl`,
      runnerName: `WSL ${groupName}`,
      executable: "wsl",
      args: wslArgs,
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  translateToWslPath(windowsPath) {
    const match = windowsPath.match(/^([A-Za-z]):\\(.*)/);
    if (match) {
      const drive = match[1].toLowerCase();
      const rest = match[2].replace(/\\/g, "/");
      return `/mnt/${drive}/${rest}`;
    }
    if (windowsPath.includes("\\")) {
      return windowsPath.replace(/\\/g, "/");
    }
    return windowsPath;
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
      const useDefault = languageConfig.useDefault === true;
      if (!useDefault && (typeof languageConfig.command !== "string" || !languageConfig.command.trim())) {
        throw new Error(`Container language ${language} must define command or useDefault.`);
      }
      languages[language] = {
        command: typeof languageConfig.command === "string" ? languageConfig.command : void 0,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : useDefault ? void 0 : `.${language}`,
        useDefault: useDefault || void 0
      };
    }
    return {
      runtime,
      executable: typeof data.executable === "string" && data.executable.trim() ? data.executable.trim() : void 0,
      image: typeof data.image === "string" ? data.image : void 0,
      wsl: this.readWslConfig(data.wsl),
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
    if (value === "docker" || value === "podman" || value === "qemu" || value === "custom" || value === "wsl") {
      return value;
    }
    throw new Error("Container config runtime must be docker, podman, qemu, custom, or wsl.");
  }
  readWslConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config wsl must be an object.");
    }
    const data = value;
    return {
      interactive: data.interactive === true
    };
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
    const posixSafePath = safePath.replace(/\\/g, "/");
    const posixGroupPath = normalizedGroupPath.replace(/\\/g, "/");
    if (posixSafePath !== posixGroupPath && !posixSafePath.startsWith(`${posixGroupPath}/`)) {
      throw new Error(`Invalid QEMU manager path outside container group: ${filePath}`);
    }
    return safePath;
  }
  imageNameForGroup(groupName) {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
  getDefaultLanguageConfig(langId, settings) {
    if (!langId) return null;
    const normalized = langId.toLowerCase().trim();
    const custom = settings.customLanguages.find((c) => {
      const names = [c.name, ...c.aliases.split(",").map((s) => s.trim())].map((n) => n.toLowerCase());
      return names.includes(normalized);
    });
    if (custom) {
      return {
        command: `${custom.executable} ${custom.args}`.trim(),
        extension: custom.extension || ".txt"
      };
    }
    switch (normalized) {
      case "python":
      case "py":
        return {
          command: `${settings.pythonExecutable.trim() || "python3"} {file}`,
          extension: ".py"
        };
      case "javascript":
      case "js":
        return {
          command: `${settings.nodeExecutable.trim() || "node"} {file}`,
          extension: ".js"
        };
      case "typescript":
      case "ts":
        return {
          command: `${settings.typescriptTranspilerExecutable.trim() || "ts-node"} {file}`,
          extension: ".ts"
        };
      case "shell":
      case "sh":
      case "bash":
        return {
          command: `${settings.shellExecutable.trim() || "bash"} {file}`,
          extension: ".sh"
        };
      case "ruby":
      case "rb":
        return {
          command: `${settings.rubyExecutable.trim() || "ruby"} {file}`,
          extension: ".rb"
        };
      case "perl":
      case "pl":
        return {
          command: `${settings.perlExecutable.trim() || "perl"} {file}`,
          extension: ".pl"
        };
      case "lua":
        return {
          command: `${settings.luaExecutable.trim() || "lua"} {file}`,
          extension: ".lua"
        };
      case "php":
        return {
          command: `${settings.phpExecutable.trim() || "php"} {file}`,
          extension: ".php"
        };
      case "go":
        return {
          command: `${settings.goExecutable.trim() || "go"} run {file}`,
          extension: ".go"
        };
      case "haskell":
      case "hs":
        return {
          command: `${settings.haskellExecutable.trim() || "runghc"} {file}`,
          extension: ".hs"
        };
      case "ocaml":
      case "ml":
        if (settings.ocamlMode === "dune") {
          return {
            command: `${settings.ocamlExecutable.trim() || "dune"} exec -- ocaml {file}`,
            extension: ".ml"
          };
        }
        if (settings.ocamlMode === "ocamlc") {
          return {
            command: shellCommand(`${settings.ocamlExecutable.trim() || "ocamlc"} -o /tmp/loom-ocaml "$1" && /tmp/loom-ocaml`),
            extension: ".ml"
          };
        }
        return {
          command: `${settings.ocamlExecutable.trim() || "ocaml"} {file}`,
          extension: ".ml"
        };
      case "c":
        return {
          command: shellCommand(`${settings.cExecutable.trim() || "gcc"} "$1" -o /tmp/loom-c && /tmp/loom-c`),
          extension: ".c"
        };
      case "cpp":
      case "c++":
        return {
          command: shellCommand(`${settings.cppExecutable.trim() || "g++"} "$1" -o /tmp/loom-cpp && /tmp/loom-cpp`),
          extension: ".cpp"
        };
      case "ebpf":
      case "ebpf-c":
      case "bpf":
      case "bpf-c":
        return {
          command: shellCommand(`${settings.ebpfClangExecutable.trim() || "clang"} -target bpf -O2 -g -Wall "$1" -c -o /tmp/loom-ebpf.o && printf 'compiled /tmp/loom-ebpf.o\\n'`),
          extension: ".bpf.c"
        };
      case "bpftrace":
      case "bt":
        return {
          command: `${settings.bpftraceExecutable.trim() || "bpftrace"} -d {file}`,
          extension: ".bt"
        };
      case "rust":
      case "rs":
        return {
          command: shellCommand(`${settings.rustExecutable.trim() || "rustc"} "$1" -o /tmp/loom-rust && /tmp/loom-rust`),
          extension: ".rs"
        };
      case "java": {
        const compiler = settings.javaCompilerExecutable.trim() || "javac";
        return {
          command: shellCommand(`tmp=/tmp/loom-java-$$ && mkdir -p "$tmp" && cp "$1" "$tmp/Main.java" && ${compiler} "$tmp/Main.java" && ${settings.javaExecutable.trim() || "java"} -cp "$tmp" Main`),
          extension: ".java"
        };
      }
      case "llvm-ir":
      case "llvm":
      case "ll":
        return {
          command: `${settings.llvmInterpreterExecutable.trim() || "lli"} {file}`,
          extension: ".ll"
        };
      case "lean":
        return {
          command: `${settings.leanExecutable.trim() || "lean"} {file}`,
          extension: ".lean"
        };
      case "coq":
        return {
          command: `${settings.coqExecutable.trim() || "coqc"} -q {file}`,
          extension: ".v"
        };
      case "smtlib":
      case "smt":
      case "smt-lib":
        return {
          command: `${settings.smtExecutable.trim() || "z3"} {file}`,
          extension: ".smt2"
        };
    }
    return null;
  }
};
function shellCommand(command) {
  return `sh -lc ${quoteCommandArg(command)} sh {file}`;
}
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
    case "wsl":
      return "WSL";
  }
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function quoteCommandArg(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// src/executionContext.ts
var import_path3 = require("path");
var import_obsidian2 = require("obsidian");
function resolveExecutionContext(app, file, block, settings) {
  const note = readNoteExecutionContext(app, file);
  const defaultWorkingDirectory = resolveDefaultWorkingDirectory(file, settings);
  const noteWorkingDirectory = normalizeWorkingDirectory(note.workingDirectory);
  const blockWorkingDirectory = normalizeWorkingDirectory(block.executionContext.workingDirectory);
  const noteTimeout = note.timeoutMs;
  const blockTimeout = block.executionContext.timeoutMs;
  return {
    containerGroup: resolveContainerGroup(settings.defaultContainerGroup, note, block.executionContext),
    workingDirectory: blockWorkingDirectory ?? noteWorkingDirectory ?? defaultWorkingDirectory,
    timeoutMs: blockTimeout ?? noteTimeout ?? settings.defaultTimeoutMs,
    source: {
      container: resolveContainerSource(settings.defaultContainerGroup, note, block.executionContext),
      workingDirectory: blockWorkingDirectory ? "block" : noteWorkingDirectory ? "note" : settings.workingDirectory.trim() ? "global" : "default",
      timeout: blockTimeout ? "block" : noteTimeout ? "note" : "global"
    }
  };
}
function resolveContainerGroup(globalContainer, note, block) {
  if (block.disableContainer) {
    return void 0;
  }
  if (block.containerGroup?.trim()) {
    return block.containerGroup.trim();
  }
  if (note.disableContainer) {
    return void 0;
  }
  if (note.containerGroup?.trim()) {
    return note.containerGroup.trim();
  }
  return globalContainer.trim() || void 0;
}
function resolveContainerSource(globalContainer, note, block) {
  if (block.disableContainer || block.containerGroup?.trim()) {
    return "block";
  }
  if (note.disableContainer || note.containerGroup?.trim()) {
    return "note";
  }
  if (globalContainer.trim()) {
    return "global";
  }
  return "none";
}
function readNoteExecutionContext(app, file) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) {
    return {};
  }
  const container = frontmatter["loom-container"];
  const workingDirectory = frontmatter["loom-cwd"] ?? frontmatter["loom-working-directory"];
  const timeout = frontmatter["loom-timeout"];
  return {
    containerGroup: typeof container === "string" && !isDisabledValue(container) ? container.trim() : void 0,
    disableContainer: typeof container === "string" ? isDisabledValue(container) : void 0,
    workingDirectory: typeof workingDirectory === "string" ? workingDirectory : void 0,
    timeoutMs: typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0 ? Math.trunc(timeout) : typeof timeout === "string" ? parsePositiveInteger(timeout) : void 0
  };
}
function resolveDefaultWorkingDirectory(file, settings) {
  if (settings.workingDirectory.trim()) {
    return (0, import_obsidian2.normalizePath)(settings.workingDirectory.trim());
  }
  const adapterBasePath = file.vault.adapter.basePath ?? "";
  const fileFolder = (0, import_path3.dirname)(file.path);
  const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
  return resolved || process.cwd();
}
function normalizeWorkingDirectory(value) {
  return value?.trim() ? (0, import_obsidian2.normalizePath)(value.trim()) : void 0;
}
function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function isDisabledValue(value) {
  return ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase());
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

// src/languagePackages.ts
var BUILT_IN_LANGUAGE_PACKAGES = [
  {
    id: "interpreted",
    displayName: "Interpreted",
    description: "Script and REPL-oriented languages for operational notes and quick experiments.",
    languages: [
      { id: "python", displayName: "Python", aliases: ["python", "py"] },
      { id: "javascript", displayName: "JavaScript", aliases: ["javascript", "js"] },
      { id: "typescript", displayName: "TypeScript", aliases: ["typescript", "ts"] },
      { id: "shell", displayName: "Shell", aliases: ["shell", "sh", "bash", "zsh"] },
      { id: "ruby", displayName: "Ruby", aliases: ["ruby", "rb"] },
      { id: "perl", displayName: "Perl", aliases: ["perl", "pl"] },
      { id: "lua", displayName: "Lua", aliases: ["lua"] },
      { id: "php", displayName: "PHP", aliases: ["php"] },
      { id: "go", displayName: "Go", aliases: ["go", "golang"] },
      { id: "haskell", displayName: "Haskell", aliases: ["haskell", "hs"] },
      { id: "ocaml", displayName: "OCaml", aliases: ["ocaml", "ml"] }
    ]
  },
  {
    id: "native-compiled",
    displayName: "Native Compiled",
    description: "Languages compiled into native binaries by local toolchains.",
    languages: [
      { id: "c", displayName: "C", aliases: ["c", "h"] },
      { id: "cpp", displayName: "C++", aliases: ["cpp", "cxx", "cc", "c++"] }
    ]
  },
  {
    id: "managed-compiled",
    displayName: "Managed Compiled",
    description: "Compiled languages with managed runtimes or structured build/run phases.",
    languages: [
      { id: "rust", displayName: "Rust", aliases: ["rust", "rs"] },
      { id: "java", displayName: "Java", aliases: ["java"] }
    ]
  },
  {
    id: "proofs",
    displayName: "Proofs",
    description: "Proof assistants and solver-oriented languages.",
    languages: [
      { id: "lean", displayName: "Lean", aliases: ["lean", "lean4"] },
      { id: "coq", displayName: "Coq", aliases: ["coq", "v"] },
      { id: "smtlib", displayName: "SMT-LIB", aliases: ["smt", "smt2", "smtlib", "smt-lib", "z3"] }
    ]
  },
  {
    id: "llvm",
    displayName: "LLVM",
    description: "LLVM IR tooling for compiler and PL research vaults.",
    languages: [
      { id: "llvm-ir", displayName: "LLVM IR", aliases: ["llvm", "llvmir", "llvm-ir", "ll"] }
    ]
  },
  {
    id: "ebpf",
    displayName: "eBPF",
    description: "Kernel instrumentation languages for BPF object compilation, verifier checks, and bpftrace scripts.",
    languages: [
      { id: "ebpf-c", displayName: "eBPF C", aliases: ["ebpf", "ebpf-c", "bpf-c", "bpf"] },
      { id: "bpftrace", displayName: "bpftrace", aliases: ["bpftrace", "bt"] }
    ]
  }
];
var CUSTOM_LANGUAGE_PACKAGE_ID = "custom";
var LANGUAGE_CONFIGURATION_VERSION = 2;
function getDefaultLanguagePackIds() {
  return [...BUILT_IN_LANGUAGE_PACKAGES.map((pack) => pack.id), CUSTOM_LANGUAGE_PACKAGE_ID];
}
function getDefaultLanguageIds() {
  return BUILT_IN_LANGUAGE_PACKAGES.flatMap((pack) => pack.languages.map((language) => language.id));
}
function normalizeLanguageConfiguration(settings) {
  if (!Array.isArray(settings.enabledLanguagePacks) || !settings.enabledLanguagePacks.length) {
    settings.enabledLanguagePacks = getDefaultLanguagePackIds();
  }
  if (!Array.isArray(settings.enabledLanguages) || !settings.enabledLanguages.length) {
    settings.enabledLanguages = getDefaultLanguageIds();
  }
  if (!Number.isFinite(settings.languageConfigurationVersion)) {
    settings.languageConfigurationVersion = 1;
  }
  if (settings.languageConfigurationVersion < 2) {
    enableLanguagePackage(settings, "ebpf");
    settings.languageConfigurationVersion = LANGUAGE_CONFIGURATION_VERSION;
  }
}
function enableLanguagePackage(settings, packageId) {
  const pack = BUILT_IN_LANGUAGE_PACKAGES.find((candidate) => candidate.id === packageId);
  if (!pack) {
    return;
  }
  appendUnique(settings.enabledLanguagePacks, pack.id);
  for (const language of pack.languages) {
    appendUnique(settings.enabledLanguages, language.id);
  }
}
function appendUnique(values, value) {
  if (!values.includes(value)) {
    values.push(value);
  }
}
function getEnabledLanguageDefinitions(settings) {
  normalizeLanguageConfiguration(settings);
  const enabledPacks = new Set(settings.enabledLanguagePacks);
  const enabledLanguages = new Set(settings.enabledLanguages);
  return BUILT_IN_LANGUAGE_PACKAGES.filter((pack) => enabledPacks.has(pack.id)).flatMap((pack) => pack.languages).filter((language) => enabledLanguages.has(language.id));
}
function getEnabledLanguageAliasMap(settings) {
  return Object.fromEntries(
    getEnabledLanguageDefinitions(settings).flatMap(
      (language) => language.aliases.map((alias) => [alias.toLowerCase(), language.id])
    )
  );
}
function isLanguageEnabled(languageId, settings) {
  normalizeLanguageConfiguration(settings);
  return getEnabledLanguageDefinitions(settings).some((language) => language.id === languageId);
}
function areCustomLanguagesEnabled(settings) {
  normalizeLanguageConfiguration(settings);
  return settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID);
}

// src/parser.ts
var OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
var OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?(.*)$/;
function normalizeLanguage(rawLanguage, settings) {
  const normalized = rawLanguage.trim().toLowerCase();
  if (!settings) {
    return null;
  }
  if (areCustomLanguagesEnabled(settings)) {
    for (const language of settings.customLanguages ?? []) {
      const name = language.name.trim().toLowerCase();
      const aliases2 = parseAliasList(language.aliases);
      if (name && (name === normalized || aliases2.includes(normalized))) {
        return language.name.trim();
      }
    }
  }
  const aliases = getEnabledLanguageAliasMap(settings);
  return aliases[normalized] ?? null;
}
function getSupportedLanguageAliases(settings) {
  if (!settings) {
    return [];
  }
  const customAliases = areCustomLanguagesEnabled(settings) ? (settings.customLanguages ?? []).flatMap((language) => {
    const name = language.name.trim().toLowerCase();
    return [name, ...parseAliasList(language.aliases)];
  }) : [];
  return [
    ...Object.keys(getEnabledLanguageAliasMap(settings)),
    ...customAliases
  ].map((alias) => alias.toLowerCase()).filter(Boolean);
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
    const infoAttributes = parseInfoAttributes(fenceMatch[3] ?? "");
    const sourceReference = parseSourceReference(infoAttributes);
    const executionContext = parseExecutionContext(infoAttributes);
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
    const referenceHash = sourceReference ? `:${JSON.stringify(sourceReference)}` : "";
    const executionHash = executionContextHasValues(executionContext) ? `:${JSON.stringify(executionContext)}` : "";
    const attributeHash = Object.keys(infoAttributes).length ? `:${JSON.stringify(infoAttributes)}` : "";
    const contentHash = shortHash(`${content}${referenceHash}${executionHash}${attributeHash}`);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      attributes: infoAttributes,
      sourceReference,
      executionContext,
      startLine,
      endLine,
      fenceStart: 0,
      fenceEnd: 0
    });
  }
  return blocks;
}
function executionContextHasValues(context) {
  return Boolean(context.containerGroup || context.disableContainer || context.workingDirectory || context.timeoutMs);
}
function parseAliasList(value) {
  return value.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
}
function parseSourceReference(attrs) {
  const filePath = attrs["loom-file"] ?? attrs.file ?? attrs.src ?? attrs.source;
  if (!filePath) {
    return void 0;
  }
  const lines = attrs["loom-lines"] ?? attrs.lines ?? attrs.line;
  const lineRange = lines ? parseLineRange(lines) : null;
  const symbolName = attrs["loom-symbol"] ?? attrs.symbol ?? attrs.fn ?? attrs.function;
  const traceValue = attrs["loom-deps"] ?? attrs.deps ?? attrs.trace;
  const callExpression = attrs["loom-call"] ?? attrs.call;
  const callArgs = attrs["loom-args"] ?? attrs.args;
  const printValue = attrs["loom-print"] ?? attrs.print;
  const call = callExpression != null || callArgs != null ? {
    expression: normalizeBooleanAttribute(callExpression) === "true" ? void 0 : callExpression,
    args: callArgs,
    print: printValue == null ? true : !["0", "false", "no", "off"].includes(printValue.toLowerCase())
  } : void 0;
  return {
    filePath,
    lineStart: lineRange?.start,
    lineEnd: lineRange?.end,
    symbolName,
    traceDependencies: traceValue == null ? true : !["0", "false", "no", "off"].includes(traceValue.toLowerCase()),
    call
  };
}
function parseExecutionContext(attrs) {
  const container = attrs["loom-container"] ?? attrs.container;
  const timeout = attrs["loom-timeout"] ?? attrs.timeout;
  const workingDirectory = attrs["loom-cwd"] ?? attrs.cwd ?? attrs["working-directory"];
  const timeoutMs = timeout ? parsePositiveInteger2(timeout) : void 0;
  return {
    containerGroup: container && !isDisabledValue2(container) ? container : void 0,
    disableContainer: container ? isDisabledValue2(container) : void 0,
    workingDirectory,
    timeoutMs
  };
}
function parsePositiveInteger2(value) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function isDisabledValue2(value) {
  return ["0", "false", "no", "off", "none", "native"].includes(value.trim().toLowerCase());
}
function normalizeBooleanAttribute(value) {
  return value == null ? void 0 : value.trim().toLowerCase();
}
function parseInfoAttributes(input) {
  const attrs = {};
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(input)) != null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}
function parseLineRange(value) {
  const match = value.trim().match(/^L?(\d+)(?:\s*[-:]\s*L?(\d+))?$/i);
  if (!match) {
    return null;
  }
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2] ?? match[1], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null;
  }
  return { start, end };
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

// src/languageCapabilities.ts
var BUILT_IN_CAPABILITIES = {
  python: {
    language: "python",
    symbolExtraction: "ast",
    dependencyTracing: "ast",
    callHarness: "built-in",
    sourcePreview: true
  },
  javascript: {
    language: "javascript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  typescript: {
    language: "typescript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  c: {
    language: "c",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  cpp: {
    language: "cpp",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  "llvm-ir": {
    language: "llvm-ir",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  haskell: {
    language: "haskell",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  ocaml: {
    language: "ocaml",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  java: {
    language: "java",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  "ebpf-c": {
    language: "ebpf-c",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  bpftrace: {
    language: "bpftrace",
    symbolExtraction: "generic",
    dependencyTracing: "generic",
    callHarness: "raw",
    sourcePreview: true
  }
};
function getLanguageCapability(language, hasExternalExtractor = false) {
  if (hasExternalExtractor) {
    return {
      language,
      symbolExtraction: "external",
      dependencyTracing: "external",
      callHarness: "external",
      sourcePreview: true
    };
  }
  return BUILT_IN_CAPABILITIES[language] ?? {
    language,
    symbolExtraction: "generic",
    dependencyTracing: "generic",
    callHarness: "raw",
    sourcePreview: true
  };
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

// src/runners/ebpf.ts
var import_path4 = require("path");
var EbpfRunner = class {
  constructor() {
    this.id = "ebpf";
    this.displayName = "eBPF";
    this.languages = ["ebpf-c", "bpftrace"];
  }
  canRun(block, settings) {
    if (block.language === "ebpf-c") {
      return Boolean(settings.ebpfClangExecutable.trim());
    }
    if (block.language === "bpftrace") {
      return Boolean(settings.bpftraceExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    if (block.language === "ebpf-c") {
      return this.runEbpfC(block, context, settings);
    }
    if (block.language === "bpftrace") {
      return this.runBpftrace(block, context, settings);
    }
    throw new Error(`Unsupported eBPF language: ${block.language}`);
  }
  async runEbpfC(block, context, settings) {
    const mode = readEbpfCMode(block);
    const cflags = readListAttribute(block, "loom-ebpf-cflags", "ebpf-cflags").flatMap(splitCommandLine);
    const includePaths = [
      ...splitCsv(settings.ebpfIncludePaths),
      ...readListAttribute(block, "loom-ebpf-includes", "ebpf-includes")
    ];
    return withTempSourceFile(".bpf.c", block.content, async ({ tempDir, tempFile }) => {
      const objectPath = (0, import_path4.join)(tempDir, "snippet.bpf.o");
      const compileResult = await runProcess({
        runnerId: `${this.id}:clang`,
        runnerName: "eBPF clang",
        executable: settings.ebpfClangExecutable.trim(),
        args: [
          "-target",
          "bpf",
          "-O2",
          "-g",
          "-Wall",
          ...includePaths.flatMap((includePath) => ["-I", includePath]),
          ...cflags,
          "-c",
          tempFile,
          "-o",
          objectPath
        ],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      compileResult.stdout = appendSection(compileResult.stdout, "Compile", `eBPF object compiled successfully: ${objectPath}`);
      await this.appendObjectInspection(compileResult, objectPath, context, settings);
      if (mode === "compile") {
        return compileResult;
      }
      return this.loadEbpfObject(block, objectPath, context, settings, compileResult);
    });
  }
  async appendObjectInspection(result, objectPath, context, settings) {
    const objdump = settings.ebpfLlvmObjdumpExecutable.trim();
    if (!objdump) {
      result.warning = appendLine(result.warning, "eBPF object inspection skipped because no object inspector is configured.");
      return;
    }
    const inspect = await runProcess({
      runnerId: `${this.id}:objdump`,
      runnerName: "eBPF object inspection",
      executable: objdump,
      args: ["-h", objectPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    if (inspect.success) {
      result.stdout = appendSection(result.stdout, "Object sections", inspect.stdout.trim() || "(no sections reported)");
    } else {
      result.warning = appendLine(result.warning, `eBPF object inspection failed: ${inspect.stderr || inspect.stdout || `exit ${inspect.exitCode}`}`);
    }
  }
  async loadEbpfObject(block, objectPath, context, settings, compileResult) {
    if (!settings.ebpfAllowKernelLoad) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "eBPF kernel loading is disabled. Enable Allow eBPF kernel load in settings before using loom-ebpf-mode=load.")
      };
    }
    const pinPath = readStringAttribute(block, "loom-ebpf-pin", "ebpf-pin");
    if (!pinPath) {
      return {
        ...compileResult,
        success: false,
        exitCode: -1,
        stderr: appendLine(compileResult.stderr, "loom-ebpf-mode=load requires loom-ebpf-pin=/sys/fs/bpf/<path>.")
      };
    }
    const load = await runProcess({
      runnerId: `${this.id}:bpftool:load`,
      runnerName: "bpftool eBPF load",
      executable: settings.ebpfBpftoolExecutable.trim() || "bpftool",
      args: ["-d", "prog", "loadall", objectPath, pinPath],
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    load.stdout = appendSection(compileResult.stdout, "bpftool stdout", load.stdout.trim());
    load.stderr = appendSection(compileResult.stderr, "bpftool stderr", load.stderr.trim());
    load.warning = appendLine(compileResult.warning, `eBPF object load requested with pin path ${pinPath}.`);
    return load;
  }
  async runBpftrace(block, context, settings) {
    const mode = readBpftraceMode(block);
    const extraArgs = readListAttribute(block, "loom-bpftrace-args", "bpftrace-args").flatMap(splitCommandLine);
    const args = mode === "check" ? ["-d", ...extraArgs, "{file}"] : [...extraArgs, "{file}"];
    return withTempSourceFile(
      ".bt",
      block.content,
      async ({ tempFile }) => runProcess({
        runnerId: `${this.id}:bpftrace:${mode}`,
        runnerName: mode === "check" ? "bpftrace check" : "bpftrace",
        executable: settings.bpftraceExecutable.trim(),
        args: args.map((arg) => arg.replaceAll("{file}", tempFile)),
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      })
    );
  }
};
function readEbpfCMode(block) {
  const value = readStringAttribute(block, "loom-ebpf-mode", "ebpf-mode") || "compile";
  if (value === "compile" || value === "load") {
    return value;
  }
  throw new Error(`Unsupported eBPF mode: ${value}. Use compile or load.`);
}
function readBpftraceMode(block) {
  const value = readStringAttribute(block, "loom-bpftrace-mode", "bpftrace-mode") || "check";
  if (value === "check" || value === "run") {
    return value;
  }
  throw new Error(`Unsupported bpftrace mode: ${value}. Use check or run.`);
}
function readStringAttribute(block, primary, fallback) {
  return block.attributes[primary]?.trim() || block.attributes[fallback]?.trim() || void 0;
}
function readListAttribute(block, primary, fallback) {
  return splitCsv(readStringAttribute(block, primary, fallback) || "");
}
function splitCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
function appendLine(existing, line) {
  return [existing, line].filter((part) => part?.trim()).join("\n");
}
function appendSection(existing, title, body) {
  const content = body.trim();
  if (!content) {
    return existing;
  }
  return [existing.trim(), `${title}:
${content}`].filter(Boolean).join("\n\n");
}

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
var import_path5 = require("path");
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
      const binaryPath = (0, import_path5.join)(tempDir, "snippet.out");
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
var import_path6 = require("path");
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
      const binaryPath = (0, import_path6.join)(tempDir, "snippet.out");
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
var import_path7 = require("path");
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
      const binaryPath = (0, import_path7.join)(tempDir, "snippet.out");
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
var import_path8 = require("path");
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
  const opamCoqc = (0, import_path8.join)(process.env.HOME ?? "", ".opam", "default", "bin", "coqc");
  return (0, import_fs2.existsSync)(opamCoqc) ? opamCoqc : configured || "coqc";
}

// src/runners/registry.ts
var loomRunnerRegistry = class {
  constructor(runners) {
    this.runners = runners;
  }
  getRunnerForBlock(block, settings) {
    if (!this.isBlockLanguageEnabled(block, settings)) {
      return null;
    }
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }
  getSupportedLanguages() {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }
  isBlockLanguageEnabled(block, settings) {
    if (isLanguageEnabled(block.language, settings)) {
      return true;
    }
    return areCustomLanguagesEnabled(settings) && settings.customLanguages.some((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === block.language.trim().toLowerCase() || aliases.includes(block.languageAlias.trim().toLowerCase());
    });
  }
};

// src/defaultSettings.ts
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
  ebpfClangExecutable: "clang",
  ebpfBpftoolExecutable: "bpftool",
  ebpfLlvmObjdumpExecutable: "llvm-objdump",
  ebpfIncludePaths: "",
  ebpfAllowKernelLoad: false,
  bpftraceExecutable: "bpftrace",
  leanExecutable: "lean",
  coqExecutable: "coqc",
  smtExecutable: "z3",
  writeOutputToNote: false,
  outputVisibleLines: 0,
  autoRunOnFileOpen: false,
  extractedSourcePreviewMode: "collapsed",
  showLanguageCapabilityMetadata: true,
  languageConfigurationVersion: 2,
  enabledLanguagePacks: getDefaultLanguagePackIds(),
  enabledLanguages: getDefaultLanguageIds(),
  customLanguages: [],
  pdfExportMode: "both",
  defaultContainerGroup: ""
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
var loomSettingTab = class extends import_obsidian3.PluginSettingTab {
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
    this.renderLanguagePackages(this.createSection(containerEl, "Language Packages"));
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
    new import_obsidian3.Setting(containerEl).setName("Enable local execution").setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
        this.loomPlugin.settings.enableLocalExecution = value;
        if (value) {
          this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
        }
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Keep loom notes in source mode").setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
        this.loomPlugin.settings.preserveSourceMode = value;
        await this.loomPlugin.saveSettings();
        if (value) {
          void this.loomPlugin.enforceSourceModeForActiveView();
        } else {
          void this.loomPlugin.disableSourceModeForActiveView();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Default timeout").setDesc("Maximum execution time in milliseconds before loom terminates the process.").addText(
      (text) => text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.loomPlugin.settings.defaultTimeoutMs = parsed;
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Working directory").setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.").addText(
      (text) => text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
        this.loomPlugin.settings.workingDirectory = value.trim() ? (0, import_obsidian3.normalizePath)(value.trim()) : "";
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Write output back to note").setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
        this.loomPlugin.settings.writeOutputToNote = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Visible output lines").setDesc("Limit each stdout, stderr, and warning panel to this many visible lines. Use 0 for unlimited output.").addText(
      (text) => text.setPlaceholder("0").setValue(String(this.loomPlugin.settings.outputVisibleLines ?? 0)).onChange(async (value) => {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          this.loomPlugin.settings.outputVisibleLines = Math.min(parsed, 2e3);
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Auto-run on file open").setDesc("Run all supported blocks in the active note when it opens. Disabled by default.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
        this.loomPlugin.settings.autoRunOnFileOpen = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Extracted source preview").setDesc("Choose how loom shows the materialized source for blocks that use loom-file.").addDropdown(
      (dropdown) => dropdown.addOption("collapsed", "Collapsed").addOption("expanded", "Expanded").addOption("hidden", "Hidden").setValue(this.loomPlugin.settings.extractedSourcePreviewMode || "collapsed").onChange(async (value) => {
        this.loomPlugin.settings.extractedSourcePreviewMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Show capability metadata").setDesc("Show symbol, dependency, and harness capability metadata in extracted source preview headers.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.showLanguageCapabilityMetadata ?? true).onChange(async (value) => {
        this.loomPlugin.settings.showLanguageCapabilityMetadata = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("PDF export mode").setDesc("Choose what to include when exporting notes containing loom code blocks to PDF.").addDropdown(
      (dropdown) => dropdown.addOption("both", "Both Code and Output").addOption("code", "Code Block Only").addOption("output", "Output Only").setValue(this.loomPlugin.settings.pdfExportMode || "both").onChange(async (value) => {
        this.loomPlugin.settings.pdfExportMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
  }
  renderBuiltInRuntimes(containerEl) {
    if (this.isRuntimeLanguageEnabled("python")) {
      this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    }
    if (this.isRuntimeLanguageEnabled("javascript")) {
      this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");
    }
    if (this.isRuntimeLanguageEnabled("typescript")) {
      new import_obsidian3.Setting(containerEl).setName("TypeScript runner mode").setDesc("Use ts-node or tsx for TypeScript blocks.").addDropdown(
        (dropdown) => dropdown.addOption("ts-node", "ts-node").addOption("tsx", "tsx").setValue(this.loomPlugin.settings.typescriptMode).onChange(async (value) => {
          this.loomPlugin.settings.typescriptMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");
    }
    if (this.isRuntimeLanguageEnabled("ocaml")) {
      new import_obsidian3.Setting(containerEl).setName("OCaml mode").setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.").addDropdown(
        (dropdown) => dropdown.addOption("ocaml", "ocaml").addOption("ocamlc", "ocamlc").addOption("dune", "dune").setValue(this.loomPlugin.settings.ocamlMode).onChange(async (value) => {
          this.loomPlugin.settings.ocamlMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addTextSetting(containerEl, "OCaml executable", "Command or path for ocaml, ocamlc, or dune depending on the selected mode.", "ocamlExecutable");
    }
    this.addRuntimeTextSetting(containerEl, ["c"], "C compiler", "Command or path for compiling C blocks.", "cExecutable");
    this.addRuntimeTextSetting(containerEl, ["cpp"], "C++ compiler", "Command or path for compiling C++ blocks.", "cppExecutable");
    this.addRuntimeTextSetting(containerEl, ["shell"], "Shell executable", "Command or path for Shell, Bash, and sh blocks.", "shellExecutable");
    this.addRuntimeTextSetting(containerEl, ["ruby"], "Ruby executable", "Command or path for Ruby blocks.", "rubyExecutable");
    this.addRuntimeTextSetting(containerEl, ["perl"], "Perl executable", "Command or path for Perl blocks.", "perlExecutable");
    this.addRuntimeTextSetting(containerEl, ["lua"], "Lua executable", "Command or path for Lua blocks.", "luaExecutable");
    this.addRuntimeTextSetting(containerEl, ["php"], "PHP executable", "Command or path for PHP blocks.", "phpExecutable");
    this.addRuntimeTextSetting(containerEl, ["go"], "Go executable", "Command or path for Go blocks.", "goExecutable");
    this.addRuntimeTextSetting(containerEl, ["rust"], "Rust compiler", "Command or path for compiling Rust blocks.", "rustExecutable");
    this.addRuntimeTextSetting(containerEl, ["haskell"], "Haskell executable", "Command or path for Haskell blocks. Defaults to runghc.", "haskellExecutable");
    if (this.isRuntimeLanguageEnabled("java")) {
      this.addTextSetting(containerEl, "Java compiler", "Optional command or path for javac. Leave empty to use Java source-file mode.", "javaCompilerExecutable");
      this.addTextSetting(containerEl, "Java executable", "Command or path for running compiled Java blocks.", "javaExecutable");
    }
    this.addRuntimeTextSetting(containerEl, ["llvm-ir"], "LLVM IR interpreter", "Command or path for running LLVM IR blocks with lli.", "llvmInterpreterExecutable");
    if (this.isRuntimeLanguageEnabled("ebpf-c")) {
      this.addTextSetting(containerEl, "eBPF clang executable", "Command or path for clang with BPF target support.", "ebpfClangExecutable");
      this.addTextSetting(containerEl, "eBPF bpftool executable", "Command or path for bpftool verifier and load operations.", "ebpfBpftoolExecutable");
      this.addTextSetting(containerEl, "eBPF object inspector", "Command or path for llvm-objdump. Leave empty to skip object section inspection.", "ebpfLlvmObjdumpExecutable");
      this.addTextSetting(containerEl, "eBPF include paths", "Comma-separated include directories passed to clang with -I.", "ebpfIncludePaths");
      new import_obsidian3.Setting(containerEl).setName("Allow eBPF kernel load").setDesc("Required before any block can use loom-ebpf-mode=load. Compile-only mode stays available without this.").addToggle(
        (toggle) => toggle.setValue(this.loomPlugin.settings.ebpfAllowKernelLoad).onChange(async (value) => {
          this.loomPlugin.settings.ebpfAllowKernelLoad = value;
          await this.loomPlugin.saveSettings();
        })
      );
    }
    this.addRuntimeTextSetting(containerEl, ["bpftrace"], "bpftrace executable", "Command or path for bpftrace scripts.", "bpftraceExecutable");
    this.addRuntimeTextSetting(containerEl, ["lean"], "Lean executable", "Command or path for checking Lean blocks.", "leanExecutable");
    this.addRuntimeTextSetting(containerEl, ["coq"], "Coq executable", "Command or path for checking Coq blocks with coqc.", "coqExecutable");
    this.addRuntimeTextSetting(containerEl, ["smtlib"], "SMT solver", "Command or path for SMT-LIB blocks. Defaults to z3.", "smtExecutable");
  }
  addRuntimeTextSetting(containerEl, languageIds, name, description, key) {
    if (languageIds.some((languageId) => this.isRuntimeLanguageEnabled(languageId))) {
      this.addTextSetting(containerEl, name, description, key);
    }
  }
  isRuntimeLanguageEnabled(languageId) {
    return isLanguageEnabled(languageId, this.loomPlugin.settings);
  }
  renderLanguagePackages(containerEl) {
    normalizeLanguageConfiguration(this.loomPlugin.settings);
    for (const pack of BUILT_IN_LANGUAGE_PACKAGES) {
      const packEl = containerEl.createEl("details", { cls: "loom-language-package" });
      packEl.open = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      packEl.createEl("summary", { text: pack.displayName });
      packEl.createEl("p", { text: pack.description, cls: "setting-item-description" });
      new import_obsidian3.Setting(packEl).setName("Enable package").setDesc("Disable this to remove the package languages from parsing, command menus, and runners for this vault.").addToggle(
        (toggle) => toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id)).onChange(async (value) => {
          this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, pack.id, value);
          for (const language of pack.languages) {
            this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
          }
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
      const packageEnabled = this.loomPlugin.settings.enabledLanguagePacks.includes(pack.id);
      for (const language of pack.languages) {
        new import_obsidian3.Setting(packEl).setName(language.displayName).setDesc(`Aliases: ${language.aliases.join(", ")}`).addToggle(
          (toggle) => toggle.setDisabled(!packageEnabled).setValue(packageEnabled && this.loomPlugin.settings.enabledLanguages.includes(language.id)).onChange(async (value) => {
            this.setEnabledValue(this.loomPlugin.settings.enabledLanguages, language.id, value);
            await this.loomPlugin.saveSettings();
          })
        );
      }
    }
    new import_obsidian3.Setting(containerEl).setName("Custom languages").setDesc("Enable user-defined languages from the Custom Languages section.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enabledLanguagePacks.includes(CUSTOM_LANGUAGE_PACKAGE_ID)).onChange(async (value) => {
        this.setEnabledValue(this.loomPlugin.settings.enabledLanguagePacks, CUSTOM_LANGUAGE_PACKAGE_ID, value);
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Reset language packages").setDesc("Re-enable every built-in package and every built-in language.").addButton(
      (button) => button.setButtonText("Reset").onClick(async () => {
        this.loomPlugin.settings.enabledLanguagePacks = getDefaultLanguagePackIds();
        this.loomPlugin.settings.enabledLanguages = getDefaultLanguageIds();
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
  }
  setEnabledValue(values, id, enabled) {
    const index = values.indexOf(id);
    if (enabled && index < 0) {
      values.push(id);
    } else if (!enabled && index >= 0) {
      values.splice(index, 1);
    }
  }
  renderCustomLanguages(containerEl) {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);
    new import_obsidian3.Setting(containerEl).setName("Add custom language").setDesc("Create a new local command-backed language.").addButton(
      (button) => button.setButtonText("+").onClick(async () => {
        this.loomPlugin.settings.customLanguages.push({
          name: "custom-language",
          aliases: "",
          executable: "",
          args: "{file}",
          extension: ".txt",
          extractorMode: "command",
          extractorExecutable: "",
          extractorArgs: "{request}",
          transpileExecutable: "",
          transpileArgs: "{request}"
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
      new import_obsidian3.Setting(body).setName("Partial extraction strategy").setDesc("Choose how this custom language supports partial runnable source.").addDropdown(
        (dropdown) => dropdown.addOption("command", "Extractor command").addOption("transpile-c", "Transpile to C").setValue(language.extractorMode || "command").onChange(async (value) => {
          language.extractorMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addCustomLanguageTextSetting(body, language, "Extractor executable", "Optional command for partial source extraction. Leave empty to use generic line and symbol extraction.", "extractorExecutable");
      this.addCustomLanguageTextSetting(body, language, "Extractor arguments", "Arguments for the extractor. Use {request}, {source}, {harness}, {symbol}, {lineStart}, {lineEnd}, {deps}, and {language}.", "extractorArgs");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C executable", "Optional command that emits generated C and a symbol map as JSON.", "transpileExecutable");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C arguments", "Arguments for the transpiler. Use the same placeholders as extractor arguments.", "transpileArgs");
      new import_obsidian3.Setting(body).setName("Delete language").setDesc("Remove this custom language.").addButton(
        (button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          this.loomPlugin.settings.customLanguages.splice(index, 1);
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
    });
  }
  async renderContainerGroups(containerEl) {
    try {
      const groups = await this.loomPlugin.getContainerGroupSummaries();
      new import_obsidian3.Setting(containerEl).setName("Default containerization group").setDesc("The container group to run code blocks in by default if the note does not specify one.").addDropdown((dropdown) => {
        dropdown.addOption("", "None");
        for (const group of groups) {
          dropdown.addOption(group.name, group.name);
        }
        dropdown.setValue(this.loomPlugin.settings.defaultContainerGroup || "");
        dropdown.onChange(async (value) => {
          this.loomPlugin.settings.defaultContainerGroup = value;
          await this.loomPlugin.saveSettings();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Add new containerization group").setDesc("Create a new containerization group configuration folder.").addButton(
        (button) => button.setButtonText("+").onClick(() => {
          new ContainerGroupNameModal(this.app, async (groupName) => {
            const cleanName = groupName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
            if (!cleanName) {
              new import_obsidian3.Notice("Invalid group name.");
              return;
            }
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            const groupRelativePath = `${pluginDir}/containers/${cleanName}`;
            const configPath = `${groupRelativePath}/config.json`;
            const adapter = this.app.vault.adapter;
            if (await adapter.exists(groupRelativePath)) {
              new import_obsidian3.Notice("Container group folder already exists.");
              return;
            }
            await adapter.mkdir(groupRelativePath);
            const defaultConfig = {
              runtime: "docker",
              image: "ubuntu:latest",
              languages: {
                python: {
                  command: "python3 {file}",
                  extension: ".py"
                }
              }
            };
            await adapter.write(configPath, JSON.stringify(defaultConfig, null, 2));
            new import_obsidian3.Notice(`Container group "${cleanName}" created.`);
            this.display();
          }).open();
        })
      );
      const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
      if (!groups.length) {
        listEl.createEl("p", {
          text: "No container groups found in .obsidian/plugins/loom/containers.",
          cls: "setting-item-description"
        });
        return;
      }
      for (const group of groups) {
        new import_obsidian3.Setting(listEl).setName(group.name).setDesc(group.status).addButton(
          (button) => button.setButtonText("Build / rebuild").onClick(async () => {
            await this.loomPlugin.buildContainerGroup(group.name);
          })
        ).addButton(
          (button) => button.setButtonText("Edit").onClick(() => {
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            new EditContainerGroupModal(this.loomPlugin, group.name, pluginDir, () => {
              this.display();
            }).open();
          })
        );
      }
    } catch (error) {
      containerEl.empty();
      containerEl.createEl("p", {
        text: `Error loading container groups: ${error instanceof Error ? error.message : String(error)}`,
        cls: "loom-settings-error",
        attr: { style: "color: var(--text-error); font-weight: bold; margin: 1em 0;" }
      });
      console.error("loom: failed to render container groups:", error);
    }
  }
  addTextSetting(containerEl, name, description, key) {
    new import_obsidian3.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
        this.loomPlugin.settings[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
  addCustomLanguageTextSetting(containerEl, language, name, description, key) {
    new import_obsidian3.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(language[key] ?? "")).onChange(async (value) => {
        language[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
};
function showExecutionDisabledNotice() {
  new import_obsidian3.Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
var ContainerGroupNameModal = class extends import_obsidian3.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.name = "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New Container Group Name" });
    new import_obsidian3.Setting(contentEl).setName("Group Name").setDesc("Use lowercase letters, numbers, hyphens, and underscores.").addText(
      (text) => text.onChange((value) => {
        this.name = value;
      })
    );
    new import_obsidian3.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Create").setCta().onClick(async () => {
        await this.onSubmit(this.name);
        this.close();
      })
    );
  }
};
var EditContainerGroupModal = class extends import_obsidian3.Modal {
  constructor(loomPlugin2, groupName, pluginDir, onSave) {
    super(loomPlugin2.app);
    this.loomPlugin = loomPlugin2;
    this.groupName = groupName;
    this.pluginDir = pluginDir;
    this.onSave = onSave;
    this.activeTab = "general";
    this.configObj = {};
    this.rawJsonText = "";
    this.dockerfileText = null;
    this.newLanguageName = "";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Edit Config: ${this.groupName}` });
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    const adapter = this.app.vault.adapter;
    try {
      const rawConfig = await adapter.read(configPath);
      this.configObj = JSON.parse(rawConfig);
      this.rawJsonText = rawConfig;
    } catch (e) {
      new import_obsidian3.Notice("Could not read configuration file.");
      this.close();
      return;
    }
    try {
      if (await adapter.exists(dockerfilePath)) {
        this.dockerfileText = await adapter.read(dockerfilePath);
      } else {
        this.dockerfileText = null;
      }
    } catch (e) {
      this.dockerfileText = null;
    }
    const container = contentEl.createDiv({ cls: "loom-tab-container" });
    this.tabHeaderEl = container.createDiv({ cls: "loom-tab-header" });
    this.renderTabs();
    this.tabContentEl = container.createDiv({ cls: "loom-tab-content" });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      await this.saveAndClose();
    });
    this.renderActiveTab();
  }
  renderTabs() {
    this.tabHeaderEl.empty();
    const tabs = [
      { id: "general", label: "General" },
      { id: "languages", label: "Languages" },
      { id: "dockerfile", label: "Dockerfile" },
      { id: "raw", label: "Raw JSON" }
    ];
    for (const tab of tabs) {
      const btn = this.tabHeaderEl.createEl("button", {
        text: tab.label,
        cls: "loom-tab-btn" + (this.activeTab === tab.id ? " is-active" : "")
      });
      btn.addEventListener("click", () => {
        void this.switchTab(tab.id);
      });
    }
  }
  async switchTab(tab) {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian3.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before switching.");
        return;
      }
    }
    this.activeTab = tab;
    this.renderTabs();
    this.renderActiveTab();
  }
  renderActiveTab() {
    this.tabContentEl.empty();
    if (this.activeTab === "general") {
      this.renderGeneralTab(this.tabContentEl);
    } else if (this.activeTab === "languages") {
      this.renderLanguagesTab(this.tabContentEl);
    } else if (this.activeTab === "dockerfile") {
      this.renderDockerfileTab(this.tabContentEl);
    } else if (this.activeTab === "raw") {
      this.renderRawTab(this.tabContentEl);
    }
  }
  renderGeneralTab(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Runtime").setDesc("Choose the container/environment manager runtime.").addDropdown((dropdown) => {
      dropdown.addOption("docker", "Docker").addOption("podman", "Podman").addOption("wsl", "WSL").addOption("qemu", "QEMU").addOption("custom", "Custom").setValue(this.configObj.runtime || "docker").onChange((value) => {
        this.configObj.runtime = value;
        this.renderActiveTab();
      });
    });
    if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman" || this.configObj.runtime === "wsl") {
      new import_obsidian3.Setting(containerEl).setName(this.configObj.runtime === "wsl" ? "WSL Distro" : "Base Image").setDesc(
        this.configObj.runtime === "wsl" ? "Optional. The target WSL distro name (leave empty for default distro)." : "Fallback Docker/Podman image if no Dockerfile is present."
      ).addText((text) => {
        text.setValue(this.configObj.image || "").onChange((val) => {
          this.configObj.image = val.trim();
        });
      });
    }
    if (this.configObj.runtime === "wsl") {
      if (!this.configObj.wsl) {
        this.configObj.wsl = {};
      }
      new import_obsidian3.Setting(containerEl).setName("Use Interactive Shell").setDesc("Use interactive login shell flags (-i -l) to ensure ~/.bashrc initialization works (e.g., for NVM).").addToggle((toggle) => {
        toggle.setValue(this.configObj.wsl.interactive ?? false).onChange((val) => {
          this.configObj.wsl.interactive = val;
        });
      });
    }
    if (this.configObj.runtime === "qemu") {
      if (!this.configObj.qemu) {
        this.configObj.qemu = { sshTarget: "", remoteWorkspace: "" };
      }
      new import_obsidian3.Setting(containerEl).setName("SSH Target").setDesc("SSH target address (e.g. user@hostname or localhost -p 2222).").addText((text) => {
        text.setValue(this.configObj.qemu.sshTarget || "").onChange((val) => {
          this.configObj.qemu.sshTarget = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Remote Workspace").setDesc("Remote folder path to copy code snippets and run commands (e.g., /home/user/workspace).").addText((text) => {
        text.setValue(this.configObj.qemu.remoteWorkspace || "").onChange((val) => {
          this.configObj.qemu.remoteWorkspace = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("SSH Executable").setDesc("Optional. Path to SSH client executable (defaults to ssh).").addText((text) => {
        text.setValue(this.configObj.qemu.sshExecutable || "").onChange((val) => {
          this.configObj.qemu.sshExecutable = val.trim() || void 0;
        });
      });
      new import_obsidian3.Setting(containerEl).setName("SSH Arguments").setDesc("Optional. Additional SSH CLI flags.").addText((text) => {
        text.setValue(this.configObj.qemu.sshArgs || "").onChange((val) => {
          this.configObj.qemu.sshArgs = val.trim() || void 0;
        });
      });
    }
    if (this.configObj.runtime === "custom") {
      if (!this.configObj.custom) {
        this.configObj.custom = { executable: "" };
      }
      new import_obsidian3.Setting(containerEl).setName("Custom Executable").setDesc("Path to custom runtime wrapper executable or script.").addText((text) => {
        text.setValue(this.configObj.custom.executable || "").onChange((val) => {
          this.configObj.custom.executable = val.trim();
        });
      });
      new import_obsidian3.Setting(containerEl).setName("Custom Arguments").setDesc("Optional. Command arguments. Use {request} for JSON config path.").addText((text) => {
        text.setValue(this.configObj.custom.args || "").onChange((val) => {
          this.configObj.custom.args = val.trim() || void 0;
        });
      });
    }
  }
  renderLanguagesTab(containerEl) {
    containerEl.createEl("h3", { text: "Configured Languages" });
    if (!this.configObj.languages) {
      this.configObj.languages = {};
    }
    const langsListEl = containerEl.createDiv({ cls: "loom-languages-list" });
    const languages = Object.entries(this.configObj.languages);
    if (languages.length === 0) {
      langsListEl.createEl("p", { text: "No languages configured for this group.", cls: "setting-item-description" });
    } else {
      for (const [langName, langConfig] of languages) {
        const card = langsListEl.createDiv({ cls: "loom-language-card" });
        card.createEl("strong", { text: langName, attr: { style: "display: block; margin-bottom: 0.5rem; font-size: 1.1em;" } });
        const isDefault = langConfig.useDefault === true;
        new import_obsidian3.Setting(card).setName("Use default configuration").setDesc("If checked, Loom will run this language using its built-in commands/extensions.").addToggle((toggle) => {
          toggle.setValue(isDefault).onChange((val) => {
            if (val) {
              langConfig.useDefault = true;
              delete langConfig.command;
              delete langConfig.extension;
            } else {
              delete langConfig.useDefault;
              const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
              langConfig.command = defaults?.command || "";
              langConfig.extension = defaults?.extension || "";
            }
            this.renderActiveTab();
          });
        });
        new import_obsidian3.Setting(card).setName("Command").setDesc("Execution command. Use {file} for the code snippet filename.").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.command || "").setValue(langConfig.command || "").setDisabled(isDefault).onChange((val) => {
            langConfig.command = val.trim();
          });
        });
        new import_obsidian3.Setting(card).setName("Extension").setDesc("Source file extension (e.g. .py, .js).").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.extension || "").setValue(langConfig.extension || "").setDisabled(isDefault).onChange((val) => {
            langConfig.extension = val.trim();
          });
        });
        new import_obsidian3.Setting(card).addButton((btn) => {
          btn.setButtonText("Remove Language").setWarning().onClick(() => {
            delete this.configObj.languages[langName];
            this.renderActiveTab();
          });
        });
      }
    }
    containerEl.createEl("h3", { text: "Add Language Mapping", attr: { style: "margin-top: 1.5rem;" } });
    new import_obsidian3.Setting(containerEl).setName("Language ID").setDesc("e.g. python, javascript, node, sh").addText((text) => {
      text.setValue(this.newLanguageName).onChange((val) => {
        this.newLanguageName = val.trim().toLowerCase();
      });
    }).addButton((btn) => {
      btn.setButtonText("+ Add").setCta().onClick(() => {
        if (!this.newLanguageName) {
          new import_obsidian3.Notice("Please enter a language name.");
          return;
        }
        if (this.configObj.languages[this.newLanguageName]) {
          new import_obsidian3.Notice("Language already configured.");
          return;
        }
        this.configObj.languages[this.newLanguageName] = {
          command: `${this.newLanguageName} {file}`,
          extension: `.${this.newLanguageName}`
        };
        this.newLanguageName = "";
        this.renderActiveTab();
      });
    });
  }
  renderDockerfileTab(containerEl) {
    if (this.configObj.runtime !== "docker" && this.configObj.runtime !== "podman") {
      containerEl.createEl("p", {
        text: `Dockerfile editing is only available for Docker and Podman runtimes. Currently using: ${this.configObj.runtime}`,
        cls: "setting-item-description"
      });
      return;
    }
    if (this.dockerfileText === null) {
      containerEl.createEl("p", {
        text: "No Dockerfile exists in this container group directory.",
        cls: "setting-item-description"
      });
      new import_obsidian3.Setting(containerEl).addButton((btn) => {
        btn.setButtonText("Create Dockerfile").setCta().onClick(() => {
          this.dockerfileText = [
            "FROM ubuntu:latest",
            "",
            "# Install packages",
            "RUN apt-get update && apt-get install -y \\",
            "    python3 \\",
            "    nodejs \\",
            "    && rm -rf /var/lib/apt/lists/*",
            ""
          ].join("\n");
          this.renderActiveTab();
        });
      });
    } else {
      new import_obsidian3.Setting(containerEl).setName("Dockerfile Content").setDesc("Define the build steps for your environment container.").addTextArea((text) => {
        text.inputEl.rows = 15;
        text.inputEl.style.fontFamily = "monospace";
        text.inputEl.style.width = "100%";
        text.setValue(this.dockerfileText || "");
        text.onChange((val) => {
          this.dockerfileText = val;
        });
      });
    }
  }
  renderRawTab(containerEl) {
    this.rawJsonText = JSON.stringify(this.configObj, null, 2);
    new import_obsidian3.Setting(containerEl).setName("Configuration JSON").addTextArea((text) => {
      text.inputEl.rows = 15;
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.width = "100%";
      text.setValue(this.rawJsonText);
      text.onChange((val) => {
        this.rawJsonText = val;
      });
    });
  }
  async saveAndClose() {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian3.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before saving.");
        return;
      }
    }
    if (!this.configObj.runtime) {
      new import_obsidian3.Notice("Runtime is required.");
      return;
    }
    if (this.configObj.runtime === "qemu" && (!this.configObj.qemu?.sshTarget || !this.configObj.qemu?.remoteWorkspace)) {
      new import_obsidian3.Notice("QEMU runtime requires SSH Target and Remote Workspace.");
      return;
    }
    if (this.configObj.runtime === "custom" && !this.configObj.custom?.executable) {
      new import_obsidian3.Notice("Custom runtime requires Custom Executable.");
      return;
    }
    const adapter = this.app.vault.adapter;
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    try {
      const configStr = JSON.stringify(this.configObj, null, 2);
      await adapter.write(configPath, configStr);
      if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman") {
        if (this.dockerfileText !== null) {
          await adapter.write(dockerfilePath, this.dockerfileText);
        }
      }
      new import_obsidian3.Notice("Container group configurations saved.");
      this.onSave();
      this.close();
    } catch (error) {
      new import_obsidian3.Notice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

// src/sourceExtract.ts
var import_child_process3 = require("child_process");
var import_promises3 = require("fs/promises");
var import_os2 = require("os");
var import_path9 = require("path");
async function resolveReferencedSource(source, reference, language, harness, host) {
  if (host?.externalExtractor?.executable.trim()) {
    return host.externalExtractor.mode === "transpile-c" ? resolveTranspileToCReferencedSource(source, reference, language, harness, host.externalExtractor) : resolveExternalReferencedSource(source, reference, language, harness, host.externalExtractor);
  }
  if (language === "python" && host) {
    return resolvePythonReferencedSource(source, reference, harness, host);
  }
  return resolveReferencedSourceFallback(source, reference, language, harness);
}
function resolveReferencedSourceFallback(source, reference, language, harness) {
  const lines = source.split(/\r?\n/);
  const selectedRange = reference.symbolName ? findSymbolRange(lines, language, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const dependencies = reference.traceDependencies ? collectDependencySource(lines, language, selectedRange, selected) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
async function resolveExternalReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path9.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path9.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path9.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path9.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseExternalExtractorResult(output);
    const content = result.content ?? [
      ...result.imports ?? [],
      ...result.dependencies ?? [],
      result.selected ?? "",
      harness.trim() ? harness : ""
    ].filter((part) => part.trim()).join("\n\n");
    if (!content.trim()) {
      throw new Error("Custom source extractor returned no content.");
    }
    return {
      content,
      description: result.description?.trim() || formatSourceDescription(reference, null)
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function resolveTranspileToCReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path9.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path9.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path9.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path9.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile,
      targetLanguage: "c"
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseTranspileToCResult(output);
    const generatedLanguage = result.language === "cpp" ? "cpp" : "c";
    const mappedSymbol = reference.symbolName ? result.symbols?.[reference.symbolName] ?? reference.symbolName : void 0;
    const generatedReference = {
      ...reference,
      filePath: `${reference.filePath}:generated.${generatedLanguage === "cpp" ? "cpp" : "c"}`,
      symbolName: mappedSymbol
    };
    const resolved = resolveReferencedSourceFallback(result.generatedSource, generatedReference, generatedLanguage, result.harness ?? harness);
    return {
      content: resolved.content,
      description: result.description?.trim() || `${reference.filePath}#${reference.symbolName ?? "generated-c"}`
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function runExternalExtractor(extractor, values) {
  const args = extractor.args.map((arg) => arg.replaceAll("{request}", values.requestFile).replaceAll("{source}", values.sourceFile).replaceAll("{file}", values.sourceFile).replaceAll("{harness}", values.harnessFile).replaceAll("{symbol}", values.reference.symbolName ?? "").replaceAll("{lineStart}", values.reference.lineStart == null ? "" : String(values.reference.lineStart)).replaceAll("{lineEnd}", values.reference.lineEnd == null ? "" : String(values.reference.lineEnd)).replaceAll("{deps}", values.reference.traceDependencies ? "true" : "false").replaceAll("{language}", values.language));
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(extractor.executable, args, {
      cwd: extractor.workingDirectory,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Custom source extractor timed out after ${extractor.timeoutMs} ms.`));
    }, extractor.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Custom source extractor exited with code ${code}.`).trim()));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(JSON.stringify({
      requestFile: values.requestFile,
      sourceFile: values.sourceFile,
      harnessFile: values.harnessFile,
      language: values.language,
      filePath: values.reference.filePath,
      symbolName: values.reference.symbolName ?? null,
      lineStart: values.reference.lineStart ?? null,
      lineEnd: values.reference.lineEnd ?? null,
      traceDependencies: values.reference.traceDependencies
    }));
  });
}
function parseExternalExtractorResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null) {
      throw new Error("Custom source extractor must return a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Custom source extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function parseTranspileToCResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null || typeof parsed.generatedSource !== "string") {
      throw new Error("Transpile to C extractor must return generatedSource.");
    }
    if (parsed.language != null && parsed.language !== "c" && parsed.language !== "cpp") {
      throw new Error("Transpile to C language must be c or cpp.");
    }
    if (parsed.symbols != null && (typeof parsed.symbols !== "object" || Array.isArray(parsed.symbols))) {
      throw new Error("Transpile to C symbols must be an object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Transpile to C extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function resolvePythonReferencedSource(source, reference, harness, host) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  const selectedRange = reference.symbolName ? findPythonSymbolRange(moduleInfo, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const state = createPythonDependencyState();
  const dependencies = reference.traceDependencies ? await collectPythonDependencySource(source, reference.filePath, selectedRange, selected, harness, host, state) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
function createPythonDependencyState() {
  return {
    includedRanges: /* @__PURE__ */ new Set(),
    includedImports: /* @__PURE__ */ new Set(),
    aliases: /* @__PURE__ */ new Set(),
    namespaceBindings: /* @__PURE__ */ new Map(),
    visitingSymbols: /* @__PURE__ */ new Set(),
    needsNamespaceRuntime: false
  };
}
async function collectPythonDependencySource(source, filePath, selectedRange, selected, harness, host, state) {
  const parts = [];
  await collectPythonDependencies(source, filePath, selectedRange, `${selected}
${harness}`, host, state, parts);
  const namespace = renderPythonNamespaceBindings(state);
  return [...state.includedImports, ...parts, namespace].filter((part) => part.trim()).join("\n\n");
}
async function collectPythonDependencies(source, filePath, selectedRange, seed, host, state, parts) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  let haystack = seed;
  let collected = "";
  let changed = true;
  while (changed) {
    changed = false;
    const usage = await inspectPythonUsage(haystack, host);
    for (const definition of moduleInfo.definitions) {
      if (rangesOverlap(definition, selectedRange) || !pythonDefinitionIsUsed(definition, usage)) {
        continue;
      }
      const text = addPythonRange(lines, filePath, definition, state, parts);
      if (text) {
        const nested = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
        haystack += `
${text}
`;
        if (nested) {
          haystack += `
${nested}
`;
        }
        collected += `${nested}
${text}
`;
        changed = true;
      }
    }
    for (const importNode of moduleInfo.imports) {
      const text = await resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts);
      if (text) {
        haystack += `
${text}
`;
        collected += `${text}
`;
        changed = true;
      }
    }
  }
  return collected;
}
async function resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  if (importNode.kind === "from") {
    return resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts);
  }
  return resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts);
}
async function resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  const localModulePath = await host.resolvePythonImport(filePath, importNode.module, importNode.level);
  let added = "";
  for (const alias of importNode.names) {
    if (alias.name === "*") {
      if (!localModulePath) {
        if (usesUnknownImportedNames(usage) && addPythonImportLine(lines, importNode, state)) {
          added += `${renderRange(lines, importNode)}
`;
        }
        continue;
      }
      const source = await host.readFile(localModulePath);
      if (!source) {
        continue;
      }
      const moduleInfo = await inspectPythonModule(source, host);
      for (const definition of moduleInfo.definitions) {
        if (!pythonDefinitionIsUsed(definition, usage)) {
          continue;
        }
        added += await extractPythonSymbolFromFile(localModulePath, definition.name, host, state, parts);
      }
      continue;
    }
    const exposedName = alias.asname ?? alias.name;
    if (!usage.names.includes(exposedName)) {
      continue;
    }
    const submodulePath = await host.resolvePythonImport(filePath, joinPythonModule(importNode.module, alias.name), importNode.level);
    const importTargetPath = localModulePath ?? submodulePath;
    if (!importTargetPath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    const extracted = await extractPythonSymbolFromFile(importTargetPath, alias.name, host, state, parts);
    if (extracted) {
      added += extracted;
      if (alias.asname && alias.asname !== alias.name) {
        added += addPythonAlias(alias.name, alias.asname, state, parts);
      }
      continue;
    }
    const moduleBinding = alias.asname ?? alias.name;
    const moduleAttributes = usage.attributes[moduleBinding] ?? [];
    if (submodulePath && moduleAttributes.length) {
      for (const attribute of moduleAttributes) {
        added += await extractPythonSymbolFromFile(submodulePath, attribute, host, state, parts);
        addPythonNamespaceBinding(moduleBinding, attribute, state);
      }
    }
  }
  return added;
}
async function resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  let added = "";
  for (const alias of importNode.names) {
    const binding = alias.asname ?? alias.name.split(".")[0];
    const usedAttributes = usage.attributes[binding] ?? [];
    const bindingIsUsed = usage.names.includes(binding) || usedAttributes.length > 0;
    if (!bindingIsUsed) {
      continue;
    }
    const localModulePath = await host.resolvePythonImport(filePath, alias.name, 0);
    if (!localModulePath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    for (const attribute of usedAttributes) {
      added += await extractPythonSymbolFromFile(localModulePath, attribute, host, state, parts);
      addPythonNamespaceBinding(binding, attribute, state);
    }
  }
  return added;
}
async function extractPythonSymbolFromFile(filePath, symbolName, host, state, parts) {
  const visitKey = `${filePath}#${symbolName}`;
  if (state.visitingSymbols.has(visitKey)) {
    return "";
  }
  const source = await host.readFile(filePath);
  if (!source) {
    return "";
  }
  state.visitingSymbols.add(visitKey);
  try {
    const lines = source.split(/\r?\n/);
    const moduleInfo = await inspectPythonModule(source, host);
    const definition = moduleInfo.definitions.find((candidate) => (candidate.names ?? [candidate.name]).includes(symbolName));
    if (!definition) {
      return "";
    }
    const text = renderRange(lines, definition);
    const dependencyText = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
    const added = addPythonRange(lines, filePath, definition, state, parts);
    return [dependencyText, added].filter((part) => part.trim()).join("\n");
  } finally {
    state.visitingSymbols.delete(visitKey);
  }
}
function addPythonRange(lines, filePath, range, state, parts) {
  const key = `${filePath}:L${range.start + 1}-L${range.end + 1}`;
  if (state.includedRanges.has(key)) {
    return "";
  }
  state.includedRanges.add(key);
  const text = renderRange(lines, range);
  parts.push(text);
  return text;
}
function addPythonImportLine(lines, range, state) {
  const text = renderRange(lines, range);
  if (state.includedImports.has(text)) {
    return false;
  }
  state.includedImports.add(text);
  return true;
}
function addPythonAlias(name, asname, state, parts) {
  const key = `${asname}=${name}`;
  if (state.aliases.has(key)) {
    return "";
  }
  state.aliases.add(key);
  const text = `${asname} = ${name}`;
  parts.push(text);
  return `${text}
`;
}
function addPythonNamespaceBinding(binding, attribute, state) {
  state.needsNamespaceRuntime = true;
  const attributes = state.namespaceBindings.get(binding) ?? /* @__PURE__ */ new Set();
  attributes.add(attribute);
  state.namespaceBindings.set(binding, attributes);
}
function renderPythonNamespaceBindings(state) {
  if (!state.namespaceBindings.size) {
    return "";
  }
  const lines = state.needsNamespaceRuntime ? ["import types as _loom_types"] : [];
  for (const [binding, attributes] of state.namespaceBindings) {
    lines.push(`${binding} = _loom_types.SimpleNamespace()`);
    for (const attribute of attributes) {
      lines.push(`${binding}.${attribute} = ${attribute}`);
    }
  }
  return lines.join("\n");
}
function findPythonSymbolRange(moduleInfo, symbolName) {
  const exact = moduleInfo.definitions.find((definition) => (definition.names ?? [definition.name]).includes(symbolName));
  return exact ? { start: exact.start, end: exact.end } : null;
}
function pythonDefinitionIsUsed(definition, usage) {
  return (definition.names ?? [definition.name]).some((name) => usage.names.includes(name));
}
function usesUnknownImportedNames(usage) {
  return usage.names.length > 0;
}
function joinPythonModule(moduleName, name) {
  return moduleName ? `${moduleName}.${name}` : name;
}
async function inspectPythonModule(source, host) {
  return runPythonAst(source, "module", host);
}
async function inspectPythonUsage(source, host) {
  return runPythonAst(source, "usage", host);
}
async function runPythonAst(source, mode, host) {
  const command = splitCommandLine(host.pythonExecutable?.trim() || "python3");
  const executable = command[0] ?? "python3";
  const args = [...command.slice(1), "-c", PYTHON_AST_HELPER];
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Python AST helper exited with code ${code}.`).trim()));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ mode, source }));
  });
}
function findLineRange(lines, reference) {
  const start = Math.max((reference.lineStart ?? 1) - 1, 0);
  const end = Math.min((reference.lineEnd ?? reference.lineStart ?? lines.length) - 1, lines.length - 1);
  if (start > end || start >= lines.length) {
    return null;
  }
  return { start, end };
}
function findSymbolRange(lines, language, symbolName) {
  const definitions = collectDefinitions(lines, language);
  const exact = definitions.find((definition) => definitionNames(definition).includes(symbolName));
  if (exact) {
    return { start: exact.start, end: exact.end };
  }
  const symbolPattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
  const line = lines.findIndex((candidate) => symbolPattern.test(candidate));
  if (line < 0) {
    return null;
  }
  return lines[line].includes("{") ? { start: line, end: findBraceRangeEnd(lines, line) } : { start: line, end: line };
}
function collectDependencySource(lines, language, selectedRange, selected) {
  const prologue = collectPrologue(lines, language, selectedRange.start);
  const definitions = collectDefinitions(lines, language).filter((definition) => !rangesOverlap(definition, selectedRange));
  const selectedDefinitions = traceDefinitions(selected, definitions, lines);
  return [...prologue, ...selectedDefinitions.map((definition) => renderRange(lines, definition))].filter((part) => part.trim()).join("\n\n");
}
function traceDefinitions(seed, definitions, lines) {
  const selected = [];
  const selectedKeys = /* @__PURE__ */ new Set();
  let haystack = seed;
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      const key = `${definition.start}:${definition.end}:${definition.name}`;
      if (selectedKeys.has(key)) {
        continue;
      }
      if (!definitionNames(definition).some((name) => sourceUsesName(haystack, name))) {
        continue;
      }
      selectedKeys.add(key);
      selected.push(definition);
      haystack += `
${renderRange(lines, definition)}
`;
      changed = true;
    }
  }
  return selected.sort((left, right) => left.start - right.start);
}
function collectPrologue(lines, language, beforeLine) {
  const prologue = [];
  const max = Math.max(beforeLine, 0);
  for (let index = 0; index < max; index += 1) {
    const line = lines[index];
    if (isPrologueLine(line, language)) {
      prologue.push(line);
    }
  }
  return prologue.length ? [prologue.join("\n")] : [];
}
function isPrologueLine(line, language) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  switch (language) {
    case "python":
      return /^(from\s+\S+\s+import\s+|import\s+)/.test(trimmed);
    case "javascript":
    case "typescript":
      return /^(import\s+|export\s+.*\s+from\s+|(?:const|let|var)\s+\w+\s*=\s*require\s*\()/.test(trimmed);
    case "c":
    case "cpp":
    case "llvm-ir":
      return trimmed.startsWith("#") || trimmed.startsWith("target ") || trimmed.startsWith("source_filename");
    case "haskell":
      return /^(module\s+|import\s+)/.test(trimmed);
    case "ocaml":
      return /^(open\s+|include\s+|#use\s+)/.test(trimmed);
    case "java":
      return /^(package\s+|import\s+)/.test(trimmed);
    default:
      return false;
  }
}
function collectDefinitions(lines, language) {
  switch (language) {
    case "python":
      return collectPythonDefinitions(lines);
    case "javascript":
    case "typescript":
      return collectBraceDefinitions(lines, /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    case "c":
      return collectCDefinitions(lines, false);
    case "cpp":
      return collectCDefinitions(lines, true);
    case "haskell":
      return collectHaskellDefinitions(lines);
    case "ocaml":
      return collectOcamlDefinitions(lines);
    case "java":
      return collectBraceDefinitions(lines, /^\s*(?:public|private|protected|static|final|abstract|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b|^\s*(?:public|private|protected|static|final|synchronized|native|\s)+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
    case "llvm-ir":
      return collectLlvmDefinitions(lines);
    default:
      return [];
  }
}
function collectPythonDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const assignment = lines[index].match(/^([A-Za-z_]\w*)\s*[:=]/);
    if (assignment) {
      definitions.push({ name: assignment[1], start: index, end: index });
      continue;
    }
    const match = lines[index].match(/^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)\b/);
    if (!match) {
      continue;
    }
    const indent = match[1].length;
    let start = index;
    while (start > 0 && lines[start - 1].trim().startsWith("@") && getIndent(lines[start - 1]) === indent) {
      start -= 1;
    }
    let end = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() && getIndent(lines[cursor]) <= indent) {
        break;
      }
      end = cursor;
    }
    definitions.push({ name: match[2], start, end });
  }
  return definitions;
}
function collectCDefinitions(lines, isCpp) {
  const definitions = [];
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const topLevel = depth === 0;
    if (topLevel && trimmed) {
      const macro = trimmed.match(/^#\s*define\s+([A-Za-z_]\w*)\b/);
      if (macro) {
        definitions.push({ name: macro[1], start: index, end: index });
      } else if (!trimmed.startsWith("#") && !isCCommentLine(trimmed)) {
        const typeDefinition = matchCTypeDefinition(lines, index, isCpp);
        if (typeDefinition) {
          definitions.push(typeDefinition);
          index = Math.max(index, typeDefinition.end);
        } else {
          const functionDefinition = matchCFunctionDefinition(lines, index);
          if (functionDefinition) {
            definitions.push(functionDefinition);
            index = Math.max(index, functionDefinition.end);
          } else {
            const globalDefinition = matchCGlobalDefinition(line, index);
            if (globalDefinition) {
              definitions.push(globalDefinition);
            }
          }
        }
      }
    }
    depth += braceDelta(line);
    if (depth < 0) {
      depth = 0;
    }
  }
  return definitions;
}
function matchCTypeDefinition(lines, start, isCpp) {
  const header = lines.slice(start, Math.min(lines.length, start + 8)).join(" ");
  const keywordPattern = isCpp ? "(?:typedef\\s+)?(?:struct|class|enum|union)" : "(?:typedef\\s+)?(?:struct|enum|union)";
  const named = header.match(new RegExp(`^\\s*${keywordPattern}\\s+([A-Za-z_]\\w*)\\b`));
  const anonymousTypedef = header.match(/^\s*typedef\s+(?:struct|enum|union)\b[\s\S]*?\}\s*([A-Za-z_]\w*)\s*;/);
  const name = named?.[1] ?? anonymousTypedef?.[1];
  if (!name) {
    return null;
  }
  const end = findCDeclarationEnd(lines, start);
  return { name, names: [name], start, end };
}
function matchCFunctionDefinition(lines, start) {
  const headerLines = lines.slice(start, Math.min(lines.length, start + 12));
  const joined = headerLines.join(" ");
  const braceOffset = headerLines.findIndex((line) => line.includes("{"));
  if (braceOffset < 0 || joined.indexOf(";") >= 0 && joined.indexOf(";") < joined.indexOf("{")) {
    return null;
  }
  const matches = [...joined.matchAll(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?|operator\s*[^\s(]+)\s*\([^;{}]*\)\s*(?:const\b[^{}]*)?(?:noexcept\b[^{}]*)?(?:->\s*[^{}]+)?\{/g)];
  const name = matches[0]?.[1]?.replace(/\s+/g, "");
  if (!name || isCControlKeyword(name)) {
    return null;
  }
  const braceLine = start + braceOffset;
  const shortName = name.includes("::") ? name.split("::").pop() ?? name : name;
  return {
    name: shortName,
    names: [.../* @__PURE__ */ new Set([shortName, name])],
    start,
    end: findBraceRangeEnd(lines, braceLine)
  };
}
function matchCGlobalDefinition(line, index) {
  const trimmed = line.trim();
  if (!trimmed.endsWith(";") || trimmed.includes("(") || /^(return|using|namespace|template)\b/.test(trimmed)) {
    return null;
  }
  const withoutInitializer = trimmed.split("=")[0].replace(/\[[^\]]*]/g, "");
  const match = withoutInitializer.match(/([A-Za-z_]\w*)\s*(?:[,;]|$)/g)?.pop()?.match(/([A-Za-z_]\w*)/);
  const name = match?.[1];
  if (!name || /^(const|static|extern|volatile|unsigned|signed|long|short|int|char|float|double|void|auto)$/.test(name)) {
    return null;
  }
  return { name, start: index, end: index };
}
function collectLlvmDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const symbol = line.match(/^\s*(?:define|declare)\b.*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*\(/);
    if (symbol) {
      const end = line.trimStart().startsWith("define") ? findBraceRangeEnd(lines, index) : index;
      definitions.push({ name: symbol[1], names: [symbol[1], `@${symbol[1]}`], start: index, end });
      continue;
    }
    const global = line.match(/^\s*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*=/);
    if (global) {
      definitions.push({ name: global[1], names: [global[1], `@${global[1]}`], start: index, end: index });
    }
  }
  return definitions;
}
function collectHaskellDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(module|import)\b/.test(trimmed)) {
      continue;
    }
    const names = getHaskellDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findHaskellRangeEnd(lines, index, names[0]);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectOcamlDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(open|include|#use)\b/.test(trimmed)) {
      continue;
    }
    const names = getOcamlDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findLayoutRangeEnd(lines, index, isOcamlTopLevelStart);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectBraceDefinitions(lines, pattern) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    const name = match?.slice(1).find(Boolean);
    if (!name) {
      continue;
    }
    definitions.push({ name, start: index, end: findBraceRangeEnd(lines, index) });
  }
  return definitions;
}
function findBraceRangeEnd(lines, start) {
  if (!lines[start].includes("{")) {
    return start;
  }
  let depth = 0;
  let sawBrace = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawBrace && depth <= 0) {
      return index;
    }
  }
  return start;
}
function findCDeclarationEnd(lines, start) {
  let sawBrace = false;
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if ((!sawBrace || depth <= 0) && lines[index].includes(";")) {
      return index;
    }
  }
  return start;
}
function braceDelta(line) {
  let delta = 0;
  for (const char of line) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}
function isCCommentLine(trimmed) {
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}
function isCControlKeyword(name) {
  return ["if", "for", "while", "switch", "catch"].includes(name);
}
function getHaskellDefinitionNames(trimmed) {
  const signature = trimmed.match(/^([a-z_][\w']*)\s*::/);
  if (signature) {
    return [signature[1]];
  }
  const binding = trimmed.match(/^([a-z_][\w']*)\b.*=/);
  if (binding) {
    return [binding[1]];
  }
  const typeLike = trimmed.match(/^(?:data|newtype|type|class)\s+([A-Z][\w']*)\b/);
  if (typeLike) {
    return [typeLike[1]];
  }
  const instance = trimmed.match(/^instance\b.*?\b([A-Z][\w']*)\b/);
  return instance ? [instance[1]] : [];
}
function getOcamlDefinitionNames(trimmed) {
  const letBinding = trimmed.match(/^let\s+(?:rec\s+)?(?:\(([^)]+)\)|([a-z_][\w']*))/);
  if (letBinding) {
    return [letBinding[1] ?? letBinding[2]];
  }
  const typeBinding = trimmed.match(/^type\s+([a-z_][\w']*)/);
  if (typeBinding) {
    return [typeBinding[1]];
  }
  const moduleBinding = trimmed.match(/^module\s+([A-Z][\w']*)/);
  if (moduleBinding) {
    return [moduleBinding[1]];
  }
  return [];
}
function findLayoutRangeEnd(lines, start, isTopLevelStart) {
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && getIndent(line) === 0 && isTopLevelStart(line.trim())) {
      break;
    }
    end = index;
  }
  return end;
}
function findHaskellRangeEnd(lines, start, name) {
  let end = start;
  let allowMatchingEquation = lines[start].trim().startsWith(`${name} ::`);
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed && getIndent(line) === 0 && isHaskellTopLevelStart(trimmed)) {
      if (allowMatchingEquation && trimmed.startsWith(`${name} `) && trimmed.includes("=")) {
        allowMatchingEquation = false;
        end = index;
        continue;
      }
      break;
    }
    end = index;
  }
  return end;
}
function isHaskellTopLevelStart(trimmed) {
  return /^(module|import|data|newtype|type|class|instance)\b/.test(trimmed) || /^[a-z_][\w']*\s*(?:::|.*=)/.test(trimmed);
}
function isOcamlTopLevelStart(trimmed) {
  return /^(open|include|#use|let|type|module)\b/.test(trimmed);
}
function renderRange(lines, range) {
  return lines.slice(range.start, range.end + 1).join("\n");
}
function rangesOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}
function getIndent(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function definitionNames(definition) {
  return definition.names?.length ? definition.names : [definition.name];
}
function sourceUsesName(source, name) {
  if (name.startsWith("@")) {
    return new RegExp(`${escapeRegex(name)}\\b`).test(source);
  }
  return new RegExp(`\\b${escapeRegex(name)}\\b`).test(source);
}
function formatSourceDescription(reference, range) {
  if (reference.symbolName) {
    return `${reference.filePath}#${reference.symbolName}`;
  }
  if (range) {
    return `${reference.filePath}:L${range.start + 1}-L${range.end + 1}`;
  }
  return reference.filePath;
}
var PYTHON_AST_HELPER = String.raw`
import ast
import json
import sys

payload = json.loads(sys.stdin.read())
source = payload.get("source", "")
mode = payload.get("mode", "module")

def range_start(node):
    lineno = getattr(node, "lineno", 1)
    decorators = getattr(node, "decorator_list", None) or []
    if decorators:
        lineno = min(lineno, *(getattr(decorator, "lineno", lineno) for decorator in decorators))
    return lineno - 1

def range_end(node):
    return getattr(node, "end_lineno", getattr(node, "lineno", 1)) - 1

def target_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for item in target.elts:
            names.extend(target_names(item))
        return names
    return []

def definition_names(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.Assign):
        names = []
        for target in node.targets:
            names.extend(target_names(target))
        return names
    if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        return target_names(node.target)
    return []

def inspect_module(tree):
    definitions = []
    imports = []
    for node in tree.body:
        names = definition_names(node)
        if names:
            definitions.append({
                "name": names[0],
                "names": names,
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.Import):
            imports.append({
                "kind": "import",
                "module": "",
                "level": 0,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.ImportFrom):
            imports.append({
                "kind": "from",
                "module": node.module or "",
                "level": node.level,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
    return {"definitions": definitions, "imports": imports}

def attribute_chain(node):
    chain = []
    current = node
    while isinstance(current, ast.Attribute):
        chain.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        chain.append(current.id)
        chain.reverse()
        return chain
    return []

class UsageVisitor(ast.NodeVisitor):
    def __init__(self):
        self.names = set()
        self.attributes = {}

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.names.add(node.id)

    def visit_Attribute(self, node):
        chain = attribute_chain(node)
        if len(chain) >= 2:
            self.names.add(chain[0])
            self.attributes.setdefault(chain[0], set()).add(chain[1])
        self.generic_visit(node)

def inspect_usage(tree):
    visitor = UsageVisitor()
    visitor.visit(tree)
    return {
        "names": sorted(visitor.names),
        "attributes": {key: sorted(value) for key, value in visitor.attributes.items()},
    }

try:
    tree = ast.parse(source)
except SyntaxError:
    print(json.dumps({"definitions": [], "imports": []} if mode == "module" else {"names": [], "attributes": {}}))
    raise SystemExit(0)

if mode == "module":
    print(json.dumps(inspect_module(tree)))
else:
    print(json.dumps(inspect_usage(tree)))
`;

// src/sourceHarness.ts
function buildSourceReferenceHarness(block) {
  const call = block.sourceReference?.call;
  if (!call) {
    return block.content;
  }
  const symbolName = block.sourceReference?.symbolName?.trim();
  const input = block.content.trim();
  const expression = call.expression?.trim() ? renderSourceCallTemplate(call.expression, input, symbolName) : renderDefaultSourceCall(symbolName, call.args, input);
  return renderLanguageCallHarness(block.language, expression, call.print);
}
function renderDefaultSourceCall(symbolName, args, input) {
  if (!symbolName) {
    throw new Error("loom-call needs loom-symbol when no call expression is provided.");
  }
  const renderedArgs = renderSourceCallTemplate(args?.trim() || "{input}", input, symbolName);
  return `${symbolName}(${renderedArgs})`;
}
function renderSourceCallTemplate(template, input, symbolName) {
  return template.replaceAll("{input}", input).replaceAll("{symbol}", symbolName ?? "");
}
function renderLanguageCallHarness(language, expression, print) {
  if (!print) {
    return renderExpressionStatement(language, expression);
  }
  switch (language) {
    case "python":
      return `print(${expression})`;
    case "javascript":
    case "typescript":
      return `console.log(${expression});`;
    case "c":
      return `#include <stdio.h>
int main(void) { printf("%d\\n", ${expression}); return 0; }`;
    case "cpp":
      return `#include <iostream>
int main() { std::cout << (${expression}) << "\\n"; return 0; }`;
    case "ocaml":
      return `let () = print_endline (${expression})`;
    default:
      throw new Error(`loom-call cannot generate a printed harness for ${language}. Use loom-print=false or write the harness in the block body.`);
  }
}
function renderExpressionStatement(language, expression) {
  switch (language) {
    case "python":
    case "ocaml":
      return expression;
    default:
      return expression.endsWith(";") ? expression : `${expression};`;
  }
}

// src/ui/codeBlockToolbar.ts
var import_obsidian4 = require("obsidian");
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
  (0, import_obsidian4.setIcon)(button, iconName);
  return button;
}

// src/ui/outputPanel.ts
var import_obsidian5 = require("obsidian");
function getStatusKind(output) {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }
  return "failure";
}
function createOutputPanel(output, options) {
  const panel = document.createElement("div");
  panel.className = `loom-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.loomBlockId = output.blockId;
  renderOutputPanel(panel, output, options);
  return panel;
}
function renderOutputPanel(panel, output, options) {
  const kind = getStatusKind(output);
  panel.className = `loom-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();
  const visibleLines = resolveVisibleLines(output, options.defaultVisibleLines);
  const header = panel.createDiv({ cls: "loom-output-header" });
  const badge = header.createDiv({ cls: "loom-output-badge" });
  (0, import_obsidian5.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText(`${output.result.runnerName} \xB7 exit ${output.result.exitCode ?? "?"}`);
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText(`${output.result.durationMs} ms \xB7 ${new Date(output.result.finishedAt).toLocaleTimeString()}`);
  const body = panel.createDiv({ cls: "loom-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout, visibleLines);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning, visibleLines);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr, visibleLines);
  }
  if (output.sourcePreview?.content.trim()) {
    createSourcePreview(body, output.sourcePreview);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim() && !output.sourcePreview?.content.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content, visibleLines) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  const lineCount = countLines(content);
  section.createDiv({ cls: "loom-output-stream-label", text: formatStreamLabel(label, lineCount, visibleLines) });
  const pre = section.createEl("pre", { cls: "loom-output-pre", text: content });
  if (visibleLines > 0 && lineCount > visibleLines) {
    pre.addClass("is-scroll-limited");
    pre.style.setProperty("--loom-output-visible-lines", String(visibleLines));
  }
}
function createSourcePreview(container, preview) {
  const details = container.createEl("details", { cls: "loom-source-preview" });
  details.open = preview.expanded;
  const summary = details.createEl("summary", { cls: "loom-source-preview-summary" });
  summary.createSpan({ text: "Extracted source" });
  summary.createSpan({ cls: "loom-source-preview-meta", text: formatSourcePreviewMeta(preview) });
  details.createEl("pre", { cls: "loom-output-pre loom-source-preview-pre", text: preview.content });
}
function formatSourcePreviewMeta(preview) {
  const capability = preview.capability;
  if (!capability || !preview.showCapabilityMetadata) {
    return `${preview.language} \xB7 ${preview.description}`;
  }
  return [
    preview.language,
    preview.description,
    `symbols:${capability.symbolExtraction}`,
    `deps:${capability.dependencyTracing}`,
    `call:${capability.callHarness}`
  ].join(" \xB7 ");
}
function resolveVisibleLines(output, defaultVisibleLines) {
  const override = output.block.attributes["loom-output-lines"] ?? output.block.attributes["output-lines"];
  if (override != null) {
    return normalizeVisibleLines(Number.parseInt(override.trim(), 10));
  }
  return normalizeVisibleLines(defaultVisibleLines);
}
function normalizeVisibleLines(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), 2e3);
}
function countLines(content) {
  return content.replace(/\n$/, "").split("\n").length;
}
function formatStreamLabel(label, lineCount, visibleLines) {
  if (visibleLines > 0 && lineCount > visibleLines) {
    return `${label} \xB7 ${lineCount} lines \xB7 showing ${visibleLines}`;
  }
  return label;
}
function createRunningPanel() {
  const panel = document.createElement("div");
  panel.className = "loom-output-panel is-running";
  const header = panel.createDiv({ cls: "loom-output-header" });
  const spinner = header.createDiv({ cls: "loom-spinner" });
  (0, import_obsidian5.setIcon)(spinner, "loader-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");
  return panel;
}

// src/main.ts
var loomRefreshEffect = import_state.StateEffect.define();
var ExecutionConsentModal = class extends import_obsidian6.Modal {
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
var loomToolbarRenderChild = class extends import_obsidian6.MarkdownRenderChild {
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
    this.isRunning = plugin.isBlockRunning(block.id);
  }
  eq(other) {
    return other.block.id === this.block.id && other.isRunning === this.isRunning;
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
var loomPlugin = class extends import_obsidian6.Plugin {
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
      new EbpfRunner(),
      new LlvmRunner(),
      new ProofRunner(),
      new CustomLanguageRunner()
    ]);
    // Exposed as public and readonly so the settings panel and modals can access container configurations and default language mapping helpers.
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
          new import_obsidian6.Notice("No supported loom block at the current cursor.");
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
        new import_obsidian6.Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No loom container groups found.", 8e3);
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
        if (ctx instanceof import_obsidian6.MarkdownView) {
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
    normalizeLanguageConfiguration(this.settings);
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
          new import_obsidian6.Notice("Code copied");
        } catch {
          new import_obsidian6.Notice("Clipboard write failed.");
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
    container.appendChild(createOutputPanel(output, {
      defaultVisibleLines: this.settings.outputVisibleLines ?? 0
    }));
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
    if (!(file instanceof import_obsidian6.TFile)) {
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
    new import_obsidian6.Notice("loom snippet removed.");
  }
  async runAllBlocksInFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const supportedBlocks = blocks.filter((block) => {
      const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
      return executionContext.containerGroup || this.registry.getRunnerForBlock(block, this.settings);
    });
    if (!supportedBlocks.length) {
      new import_obsidian6.Notice("No supported loom blocks found in the current note.");
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
    new import_obsidian6.Notice("loom outputs cleared.");
  }
  async runBlock(file, block) {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new import_obsidian6.Notice("This loom block is already running.");
      return;
    }
    if (!await this.ensureExecutionEnabled()) {
      showExecutionDisabledNotice();
      return;
    }
    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    const containerGroup = executionContext.containerGroup;
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new import_obsidian6.Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }
    const controller = new AbortController();
    const runContext = {
      file,
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs,
      signal: controller.signal
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();
    try {
      const resolvedBlock = await this.resolveExecutableBlock(file, block);
      const result = containerGroup ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup) : await runner.run(resolvedBlock.block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      if (resolvedBlock.sourcePreview) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourcePreview.description}.`;
        result.warning = result.warning ? `${sourceNotice}
${result.warning}` : sourceNotice;
      }
      if (this.hasExplicitExecutionContext(executionContext)) {
        const contextNotice = this.formatExecutionContextNotice(executionContext);
        result.warning = result.warning ? `${contextNotice}
${result.warning}` : contextNotice;
      }
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        sourcePreview: resolvedBlock.sourcePreview,
        collapsed: false,
        visible: true
      });
      if (this.settings.writeOutputToNote) {
        await this.writeManagedOutputBlock(file, block, result);
      }
      const runnerName = containerGroup ? `container ${containerGroup}` : runner.displayName;
      new import_obsidian6.Notice(result.success ? `loom ran ${runnerName} block.` : `loom run failed for ${runnerName}.`);
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
      new import_obsidian6.Notice(`loom error: ${message}`);
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
  async resolveExecutableBlock(file, block) {
    if (!block.sourceReference) {
      return { block };
    }
    const referencePath = this.resolveReferencedVaultPath(file, block.sourceReference.filePath);
    const sourceFile = this.app.vault.getAbstractFileByPath(referencePath);
    if (!(sourceFile instanceof import_obsidian6.TFile)) {
      throw new Error(`Referenced source file not found: ${referencePath}`);
    }
    const harness = buildSourceReferenceHarness(block);
    const externalExtractor = this.getCustomLanguageExtractor(block, file);
    const resolved = await resolveReferencedSource(
      await this.app.vault.cachedRead(sourceFile),
      { ...block.sourceReference, filePath: referencePath },
      block.language,
      harness,
      {
        pythonExecutable: this.settings.pythonExecutable.trim() || "python3",
        externalExtractor,
        readFile: async (filePath) => {
          const importedFile = this.app.vault.getAbstractFileByPath((0, import_obsidian6.normalizePath)(filePath));
          return importedFile instanceof import_obsidian6.TFile ? this.app.vault.cachedRead(importedFile) : null;
        },
        resolvePythonImport: async (fromFilePath, moduleName, level) => this.resolvePythonImportVaultPath(fromFilePath, moduleName, level)
      }
    );
    const capability = getLanguageCapability(block.language, Boolean(externalExtractor));
    const shouldShowPreview = (this.settings.extractedSourcePreviewMode || "collapsed") !== "hidden";
    return {
      block: {
        ...block,
        content: resolved.content
      },
      sourcePreview: shouldShowPreview ? {
        description: resolved.description,
        language: block.language,
        content: resolved.content,
        capability,
        expanded: this.settings.extractedSourcePreviewMode === "expanded",
        showCapabilityMetadata: this.settings.showLanguageCapabilityMetadata ?? true
      } : void 0
    };
  }
  resolveReferencedVaultPath(file, referencePath) {
    const trimmed = referencePath.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return (0, import_obsidian6.normalizePath)(trimmed.slice(1));
    }
    const baseDir = (0, import_path10.dirname)(file.path);
    return (0, import_obsidian6.normalizePath)(baseDir === "." ? trimmed : `${baseDir}/${trimmed}`);
  }
  resolvePythonImportVaultPath(fromFilePath, moduleName, level) {
    const modulePath = moduleName.split(".").map((part) => part.trim()).filter(Boolean).join("/");
    const fromDir = (0, import_path10.dirname)(fromFilePath);
    const baseDirs = level > 0 ? [this.ascendVaultPath(fromDir === "." ? "" : fromDir, level - 1)] : [fromDir === "." ? "" : fromDir, ""];
    for (const baseDir of baseDirs) {
      const candidates = this.getPythonImportCandidates(baseDir, modulePath);
      for (const candidate of candidates) {
        const normalized = (0, import_obsidian6.normalizePath)(candidate);
        if (this.app.vault.getAbstractFileByPath(normalized) instanceof import_obsidian6.TFile) {
          return normalized;
        }
      }
    }
    return null;
  }
  getPythonImportCandidates(baseDir, modulePath) {
    const prefix = baseDir ? `${baseDir}/` : "";
    if (!modulePath) {
      return [`${prefix}__init__.py`];
    }
    return [
      `${prefix}${modulePath}.py`,
      `${prefix}${modulePath}/__init__.py`
    ];
  }
  ascendVaultPath(path, levels) {
    let current = path;
    for (let index = 0; index < levels; index += 1) {
      const next = (0, import_path10.dirname)(current);
      current = next === "." ? "" : next;
    }
    return current;
  }
  async getContainerGroupSummaries() {
    return this.containerRunner.getGroupSummaries();
  }
  async buildContainerGroup(name) {
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 12e4), controller.signal);
    new import_obsidian6.Notice(result.success ? `loom built container group ${name}.` : `loom container build failed for ${name}.`, 8e3);
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
        if (!(file instanceof import_obsidian6.TFile)) {
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
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    return view?.file ?? null;
  }
  getCurrentEditorFilePath() {
    return this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
  }
  async enforceSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view) {
      return;
    }
    await this.enforceSourceModeForLeaf(view.leaf);
  }
  async disableSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!view) {
      return;
    }
    const leaf = view.leaf;
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      state.source = false;
      await leaf.setViewState({
        ...viewState,
        state
      });
    }
  }
  async enforceSourceModeForLeaf(leaf) {
    if (!this.settings.preserveSourceMode) {
      return;
    }
    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }
    const view = leaf.view;
    if (!(view instanceof import_obsidian6.MarkdownView) || !view.file) {
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
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
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
  hasExplicitExecutionContext(context) {
    return context.source.container !== "none" || context.source.workingDirectory !== "default" || context.source.timeout !== "global";
  }
  formatExecutionContextNotice(context) {
    const pieces = [
      `container=${context.containerGroup ?? "native"} (${context.source.container})`,
      `cwd=${context.workingDirectory} (${context.source.workingDirectory})`,
      `timeout=${context.timeoutMs}ms (${context.source.timeout})`
    ];
    return `Execution context: ${pieces.join(", ")}.`;
  }
  getCustomLanguageExtractor(block, file) {
    const languageId = block.language;
    const normalized = languageId.trim().toLowerCase();
    const language = this.settings.customLanguages.find((candidate) => {
      const name = candidate.name.trim().toLowerCase();
      const aliases = candidate.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
    if (!language) {
      return void 0;
    }
    const mode = language.extractorMode || "command";
    const executable = mode === "transpile-c" ? language.transpileExecutable?.trim() : language.extractorExecutable?.trim();
    const args = mode === "transpile-c" ? language.transpileArgs || "{request}" : language.extractorArgs || "{request}";
    if (!executable) {
      return void 0;
    }
    const executionContext = resolveExecutionContext(this.app, file, block, this.settings);
    return {
      mode,
      language: language.name,
      executable,
      args: splitCommandLine(args),
      workingDirectory: executionContext.workingDirectory,
      timeoutMs: executionContext.timeoutMs
    };
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
    if (!(file instanceof import_obsidian6.TFile)) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9leGVjdXRpb25Db250ZXh0LnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9sYW5ndWFnZVBhY2thZ2VzLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL2xhbmd1YWdlQ2FwYWJpbGl0aWVzLnRzIiwgInNyYy9ydW5uZXJzL25vZGUudHMiLCAic3JjL3J1bm5lcnMvY3VzdG9tLnRzIiwgInNyYy9ydW5uZXJzL2ludGVycHJldGVkLnRzIiwgInNyYy9ydW5uZXJzL2VicGYudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9kZWZhdWx0U2V0dGluZ3MudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zb3VyY2VFeHRyYWN0LnRzIiwgInNyYy9zb3VyY2VIYXJuZXNzLnRzIiwgInNyYy91aS9jb2RlQmxvY2tUb29sYmFyLnRzIiwgInNyYy91aS9vdXRwdXRQYW5lbC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25SZW5kZXJDaGlsZCxcbiAgTWFya2Rvd25WaWV3LFxuICBNb2RhbCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxuICBub3JtYWxpemVQYXRoLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB7IERlY29yYXRpb24sIEVkaXRvclZpZXcsIFZpZXdQbHVnaW4sIFZpZXdVcGRhdGUsIFdpZGdldFR5cGUgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBsb29tQ29udGFpbmVyUnVubmVyIH0gZnJvbSBcIi4vZXhlY3V0aW9uL2NvbnRhaW5lclJ1bm5lclwiO1xuaW1wb3J0IHsgcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi9leGVjdXRpb25Db250ZXh0XCI7XG5pbXBvcnQgeyBhZGRMbHZtRGVjb3JhdGlvbnMsIGhpZ2hsaWdodExsdm1FbGVtZW50IH0gZnJvbSBcIi4vbGx2bUhpZ2hsaWdodFwiO1xuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBnZXRMYW5ndWFnZUNhcGFiaWxpdHkgfSBmcm9tIFwiLi9sYW5ndWFnZUNhcGFiaWxpdGllc1wiO1xuaW1wb3J0IHsgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuaW1wb3J0IHsgTm9kZVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbm9kZVwiO1xuaW1wb3J0IHsgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2N1c3RvbVwiO1xuaW1wb3J0IHsgSW50ZXJwcmV0ZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2ludGVycHJldGVkXCI7XG5pbXBvcnQgeyBFYnBmUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9lYnBmXCI7XG5pbXBvcnQgeyBMbHZtUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9sbHZtXCI7XG5pbXBvcnQgeyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL21hbmFnZWRDb21waWxlZFwiO1xuaW1wb3J0IHsgTmF0aXZlQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25hdGl2ZUNvbXBpbGVkXCI7XG5pbXBvcnQgeyBPY2FtbFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvb2NhbWxcIjtcbmltcG9ydCB7IFB5dGhvblJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHl0aG9uXCI7XG5pbXBvcnQgeyBQcm9vZlJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHJvb2ZcIjtcbmltcG9ydCB7IGxvb21SdW5uZXJSZWdpc3RyeSB9IGZyb20gXCIuL3J1bm5lcnMvcmVnaXN0cnlcIjtcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MgfSBmcm9tIFwiLi9kZWZhdWx0U2V0dGluZ3NcIjtcbmltcG9ydCB7IGxvb21TZXR0aW5nVGFiLCBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UgfSBmcm9tIFwiLi9zb3VyY2VFeHRyYWN0XCI7XG5pbXBvcnQgeyBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MgfSBmcm9tIFwiLi9zb3VyY2VIYXJuZXNzXCI7XG5pbXBvcnQgeyBjcmVhdGVDb2RlQmxvY2tUb29sYmFyIH0gZnJvbSBcIi4vdWkvY29kZUJsb2NrVG9vbGJhclwiO1xuaW1wb3J0IHsgY3JlYXRlT3V0cHV0UGFuZWwsIGNyZWF0ZVJ1bm5pbmdQYW5lbCB9IGZyb20gXCIuL3VpL291dHB1dFBhbmVsXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBsb29tUmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZTx2b2lkPigpO1xuXG5jbGFzcyBFeGVjdXRpb25Db25zZW50TW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogUGx1Z2luW1wiYXBwXCJdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25Db25maXJtOiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb25PcGVuKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJFbmFibGUgbG9vbSBsb2NhbCBleGVjdXRpb24/XCIgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcImxvb20gcnVucyBjb2RlIGZyb20geW91ciBub3RlcyBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgdXNpbmcgdGhlIGNvbmZpZ3VyZWQgZXhlY3V0YWJsZXMuIEl0IGRvZXMgbm90IHNhbmRib3ggb3IgaXNvbGF0ZSB0aGUgcHJvY2Vzcy5cIixcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbW9kYWwtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGNhbmNlbEJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pO1xuICAgIGNvbnN0IGVuYWJsZUJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkVuYWJsZSBhbmQgcnVuXCIsIGNsczogXCJtb2QtY3RhXCIgfSk7XG5cbiAgICBjYW5jZWxCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgZW5hYmxlQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLm9uQ29uZmlybSgpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyUmVuZGVyQ2hpbGQgZXh0ZW5kcyBNYXJrZG93blJlbmRlckNoaWxkIHtcbiAgcHJpdmF0ZSBwYW5lbENvbnRhaW5lcjogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB1bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29kZUVsZW1lbnQ6IEhUTUxFbGVtZW50LFxuICApIHtcbiAgICBzdXBlcihjb250YWluZXJFbCk7XG4gIH1cblxuICBvbmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5jb2RlRWxlbWVudC5wYXJlbnRFbGVtZW50Py5hZGRDbGFzcyhcImxvb20tY29kZWJsb2NrLXNoZWxsXCIpO1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYXBwZW5kQ2hpbGQodGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jaykpO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwib3V0cHV0XCIpIHtcbiAgICAgIHRoaXMuY29kZUVsZW1lbnQuY2xhc3NMaXN0LmFkZChcImxvb20tcHJpbnQtaGlkZS1jb2RlXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGhvc3RDbGFzc2VzID0gW1wibG9vbS1pbmxpbmUtb3V0cHV0LWhvc3RcIl07XG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwiY29kZVwiKSB7XG4gICAgICBob3N0Q2xhc3Nlcy5wdXNoKFwibG9vbS1wcmludC1oaWRlLW91dHB1dFwiKTtcbiAgICB9XG4gICAgdGhpcy5wYW5lbENvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBob3N0Q2xhc3Nlcy5qb2luKFwiIFwiKSB9KTtcblxuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIgPSB0aGlzLnBsdWdpbi5yZWdpc3Rlck91dHB1dExpc3RlbmVyKHRoaXMuYmxvY2suaWQsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLnBhbmVsQ29udGFpbmVyKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnVucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcj8uKCk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbVRvb2xiYXJXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpc1J1bm5pbmc6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLmlzUnVubmluZyA9IHBsdWdpbi5pc0Jsb2NrUnVubmluZyhibG9jay5pZCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbVRvb2xiYXJXaWRnZXQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIuaXNSdW5uaW5nID09PSB0aGlzLmlzUnVubmluZztcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jayk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbU91dHB1dFdpZGdldCBleHRlbmRzIFdpZGdldFR5cGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrSWQ6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9ja0lkLCB3cmFwcGVyKTtcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBsb29tUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXG4gICAgbmV3IFB5dGhvblJ1bm5lcigpLFxuICAgIG5ldyBOb2RlUnVubmVyKCksXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXG4gICAgbmV3IE5hdGl2ZUNvbXBpbGVkUnVubmVyKCksXG4gICAgbmV3IEludGVycHJldGVkUnVubmVyKCksXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBFYnBmUnVubmVyKCksXG4gICAgbmV3IExsdm1SdW5uZXIoKSxcbiAgICBuZXcgUHJvb2ZSdW5uZXIoKSxcbiAgICBuZXcgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIoKSxcbiAgXSk7XG4gIC8vIEV4cG9zZWQgYXMgcHVibGljIGFuZCByZWFkb25seSBzbyB0aGUgc2V0dGluZ3MgcGFuZWwgYW5kIG1vZGFscyBjYW4gYWNjZXNzIGNvbnRhaW5lciBjb25maWd1cmF0aW9ucyBhbmQgZGVmYXVsdCBsYW5ndWFnZSBtYXBwaW5nIGhlbHBlcnMuXG4gIHB1YmxpYyByZWFkb25seSBjb250YWluZXJSdW5uZXIgPSBuZXcgbG9vbUNvbnRhaW5lclJ1bm5lcih0aGlzLmFwcCwgdGhpcy5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCIpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0cyA9IG5ldyBNYXA8c3RyaW5nLCBsb29tU3RvcmVkT3V0cHV0PigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJ1bm5pbmcgPSBuZXcgTWFwPHN0cmluZywgQWJvcnRDb250cm9sbGVyPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dExpc3RlbmVycyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8KCkgPT4gdm9pZD4+KCk7XG4gIHByaXZhdGUgc3RhdHVzQmFySXRlbUVsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgZWRpdG9yVmlld3MgPSBuZXcgU2V0PEVkaXRvclZpZXc+KCk7XG4gIHByaXZhdGUgbGFzdE1hcmtkb3duRmlsZVBhdGg6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuXG4gIGFzeW5jIG9ubG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgbG9vbVNldHRpbmdUYWIodGhpcykpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsID0gdGhpcy5hZGRTdGF0dXNCYXJJdGVtKCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xuICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tcnVuLWN1cnJlbnQtY29kZS1ibG9ja1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBSdW4gQ3VycmVudCBDb2RlIEJsb2NrXCIsXG4gICAgICBlZGl0b3JDYWxsYmFjazogYXN5bmMgKGVkaXRvciwgdmlldykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdmlldy5maWxlO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3QgYmxvY2sgPSBmaW5kQmxvY2tBdExpbmUoYmxvY2tzLCBlZGl0b3IuZ2V0Q3Vyc29yKCkubGluZSk7XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2sgYXQgdGhlIGN1cnJlbnQgY3Vyc29yLlwiKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tcnVuLWFsbC1jb2RlLWJsb2Nrc1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBSdW4gQWxsIFN1cHBvcnRlZCBDb2RlIEJsb2NrcyBpbiBDdXJyZW50IE5vdGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMucnVuQWxsQmxvY2tzSW5GaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLWNsZWFyLW5vdGUtb3V0cHV0c1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBDbGVhciBsb29tIE91dHB1dHMgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmNsZWFyT3V0cHV0c0ZvckZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24odGhpcy5jcmVhdGVMaXZlUHJldmlld0V4dGVuc2lvbigpKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImZpbGUtb3BlblwiLCAoZmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gZmlsZT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xuICAgICAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICAgICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgIGlmIChmaWxlICYmIHRoaXMuc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4pIHtcbiAgICAgICAgICB2b2lkIHRoaXMucnVuQWxsQmxvY2tzSW5GaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tdmFsaWRhdGUtY29udGFpbmVyLWdyb3Vwc1wiLFxuICAgICAgbmFtZTogXCJsb29tOiBWYWxpZGF0ZSBDb250YWluZXIgR3JvdXBzXCIsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBncm91cHMgPSBhd2FpdCB0aGlzLmdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk7XG4gICAgICAgIG5ldyBOb3RpY2UoZ3JvdXBzLmxlbmd0aCA/IGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBgJHtncm91cC5uYW1lfTogJHtncm91cC5zdGF0dXN9YCkuam9pbihcIlxcblwiKSA6IFwiTm8gbG9vbSBjb250YWluZXIgZ3JvdXBzIGZvdW5kLlwiLCA4MDAwKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xuICAgICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLWNoYW5nZVwiLCAoX2VkaXRvciwgY3R4KSA9PiB7XG4gICAgICAgIGlmIChjdHggaW5zdGFuY2VvZiBNYXJrZG93blZpZXcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGN0eC5sZWFmKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIG9udW5sb2FkKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgY29udHJvbGxlciBvZiB0aGlzLnJ1bm5pbmcudmFsdWVzKCkpIHtcbiAgICAgIGNvbnRyb2xsZXIuYWJvcnQoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IHtcbiAgICAgIC4uLkRFRkFVTFRfU0VUVElOR1MsXG4gICAgICAuLi4oYXdhaXQgdGhpcy5sb2FkRGF0YSgpKSxcbiAgICB9O1xuICAgIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbih0aGlzLnNldHRpbmdzKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG4gICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgfVxuXG4gIGlzQmxvY2tSdW5uaW5nKGJsb2NrSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpO1xuICB9XG5cbiAgcmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcihibG9ja0lkOiBzdHJpbmcsIGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgaWYgKCF0aGlzLm91dHB1dExpc3RlbmVycy5oYXMoYmxvY2tJZCkpIHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLnNldChibG9ja0lkLCBuZXcgU2V0KCkpO1xuICAgIH1cbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmFkZChsaXN0ZW5lcik7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZGVsZXRlKGxpc3RlbmVyKTtcbiAgICB9O1xuICB9XG5cbiAgY3JlYXRlVG9vbGJhckVsZW1lbnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoYmxvY2suaWQsIHRoaXMuaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpLCB7XG4gICAgICBvblJ1bjogKCkgPT4gdm9pZCB0aGlzLnJ1bkFjdGl2ZUJsb2NrQnlJZChibG9jay5pZCksXG4gICAgICBvbkNvcHk6IGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChibG9jay5jb250ZW50KTtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ29kZSBjb3BpZWRcIik7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJDbGlwYm9hcmQgd3JpdGUgZmFpbGVkLlwiKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uUmVtb3ZlOiAoKSA9PiB2b2lkIHRoaXMucmVtb3ZlU25pcHBldEJ5SWQoYmxvY2suaWQpLFxuICAgICAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9jay5pZCk7XG4gICAgICAgIGlmICghb3V0cHV0KSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIG91dHB1dC52aXNpYmxlID0gIW91dHB1dC52aXNpYmxlO1xuICAgICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJlbmRlck91dHB1dEludG8oYmxvY2tJZDogc3RyaW5nLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG5cbiAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlUnVubmluZ1BhbmVsKCkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghb3V0cHV0IHx8ICFvdXRwdXQudmlzaWJsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQsIHtcbiAgICAgIGRlZmF1bHRWaXNpYmxlTGluZXM6IHRoaXMuc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzID8/IDAsXG4gICAgfSkpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgIGlmICghYmxvY2sgfHwgIWZpbGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5ydW5CbG9jayhmaWxlLCBibG9jayk7XG4gIH1cblxuICBhc3luYyByZW1vdmVTbmlwcGV0QnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcbiAgICBpZiAoIWJsb2NrKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChibG9jay5maWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMucnVubmluZy5nZXQoYmxvY2tJZCk/LmFib3J0KCk7XG4gICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9ja0lkKTtcbiAgICB0aGlzLm91dHB1dHMuZGVsZXRlKGJsb2NrSWQpO1xuXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGNvbnRlbnQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgY29uc3QgY3VycmVudEJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBibG9ja0lkKTtcbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtYW5hZ2VkUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrSWQpO1xuICAgICAgY29uc3QgcmVtb3ZhbFN0YXJ0ID0gY3VycmVudEJsb2NrLnN0YXJ0TGluZTtcbiAgICAgIGNvbnN0IHJlbW92YWxFbmQgPSBtYW5hZ2VkUmFuZ2UgPyBtYW5hZ2VkUmFuZ2UuZW5kIDogY3VycmVudEJsb2NrLmVuZExpbmU7XG4gICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCByZW1vdmFsRW5kIC0gcmVtb3ZhbFN0YXJ0ICsgMSk7XG5cbiAgICAgIHdoaWxlIChyZW1vdmFsU3RhcnQgPCBsaW5lcy5sZW5ndGggLSAxICYmIGxpbmVzW3JlbW92YWxTdGFydF0gPT09IFwiXCIgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0ICsgMV0gPT09IFwiXCIpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKHJlbW92YWxTdGFydCwgMSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrSWQpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgbmV3IE5vdGljZShcImxvb20gc25pcHBldCByZW1vdmVkLlwiKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlOiBURmlsZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBzb3VyY2UsIHRoaXMuc2V0dGluZ3MpO1xuICAgIGNvbnN0IHN1cHBvcnRlZEJsb2NrcyA9IGJsb2Nrcy5maWx0ZXIoKGJsb2NrKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcmVzb2x2ZUV4ZWN1dGlvbkNvbnRleHQodGhpcy5hcHAsIGZpbGUsIGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIHJldHVybiBleGVjdXRpb25Db250ZXh0LmNvbnRhaW5lckdyb3VwIHx8IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIH0pO1xuXG4gICAgaWYgKCFzdXBwb3J0ZWRCbG9ja3MubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2Ygc3VwcG9ydGVkQmxvY2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFwibG9vbSBvdXRwdXRzIGNsZWFyZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGxvb20gYmxvY2sgaXMgYWxyZWFkeSBydW5uaW5nLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcbiAgICAgIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGlvbkNvbnRleHQgPSByZXNvbHZlRXhlY3V0aW9uQ29udGV4dCh0aGlzLmFwcCwgZmlsZSwgYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gZXhlY3V0aW9uQ29udGV4dC5jb250YWluZXJHcm91cDtcbiAgICBjb25zdCBydW5uZXIgPSBjb250YWluZXJHcm91cCA/IG51bGwgOiB0aGlzLnJlZ2lzdHJ5LmdldFJ1bm5lckZvckJsb2NrKGJsb2NrLCB0aGlzLnNldHRpbmdzKTtcbiAgICBpZiAoIXJ1bm5lcikge1xuICAgICAgaWYgKCFjb250YWluZXJHcm91cCkge1xuICAgICAgICBuZXcgTm90aWNlKGBObyBjb25maWd1cmVkIHJ1bm5lciBmb3IgJHtibG9jay5sYW5ndWFnZX0uYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgIGNvbnN0IHJ1bkNvbnRleHQgPSB7XG4gICAgICBmaWxlLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZXhlY3V0aW9uQ29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBleGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgfTtcbiAgICB0aGlzLnJ1bm5pbmcuc2V0KGJsb2NrLmlkLCBjb250cm9sbGVyKTtcbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzb2x2ZWRCbG9jayA9IGF3YWl0IHRoaXMucmVzb2x2ZUV4ZWN1dGFibGVCbG9jayhmaWxlLCBibG9jayk7XG4gICAgICBjb25zdCByZXN1bHQgPSBjb250YWluZXJHcm91cFxuICAgICAgICA/IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzKTtcblxuICAgICAgaWYgKHJlc3VsdC50aW1lZE91dCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBgRXhlY3V0aW9uIHRpbWVkIG91dCBhZnRlciAke3RoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNc30gbXMuYDtcbiAgICAgIH0gZWxzZSBpZiAocmVzdWx0LmNhbmNlbGxlZCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBcIkV4ZWN1dGlvbiBjYW5jZWxsZWQuXCI7XG4gICAgICB9IGVsc2UgaWYgKCFyZXN1bHQuc3VjY2VzcyAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IFwiUHJvY2VzcyBleGl0ZWQgdW5zdWNjZXNzZnVsbHkuXCI7XG4gICAgICB9XG5cbiAgICAgIGlmIChyZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcpIHtcbiAgICAgICAgY29uc3Qgc291cmNlTm90aWNlID0gYFJhbiBleHRyYWN0ZWQgc291cmNlIGZyb20gJHtyZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcuZGVzY3JpcHRpb259LmA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtzb3VyY2VOb3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogc291cmNlTm90aWNlO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuaGFzRXhwbGljaXRFeGVjdXRpb25Db250ZXh0KGV4ZWN1dGlvbkNvbnRleHQpKSB7XG4gICAgICAgIGNvbnN0IGNvbnRleHROb3RpY2UgPSB0aGlzLmZvcm1hdEV4ZWN1dGlvbkNvbnRleHROb3RpY2UoZXhlY3V0aW9uQ29udGV4dCk7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtjb250ZXh0Tm90aWNlfVxcbiR7cmVzdWx0Lndhcm5pbmd9YCA6IGNvbnRleHROb3RpY2U7XG4gICAgICB9XG5cbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICByZXN1bHQsXG4gICAgICAgIHNvdXJjZVByZXZpZXc6IHJlc29sdmVkQmxvY2suc291cmNlUHJldmlldyxcbiAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkge1xuICAgICAgICBhd2FpdCB0aGlzLndyaXRlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUsIGJsb2NrLCByZXN1bHQpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBydW5uZXJOYW1lID0gY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lciEuZGlzcGxheU5hbWU7XG4gICAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gcmFuICR7cnVubmVyTmFtZX0gYmxvY2suYCA6IGBsb29tIHJ1biBmYWlsZWQgZm9yICR7cnVubmVyTmFtZX0uYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgY29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgdmlzaWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgcnVubmVySWQ6IGNvbnRhaW5lckdyb3VwID8gYGNvbnRhaW5lcjoke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXI/LmlkID8/IFwidW5rbm93blwiLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IGNvbnRhaW5lckdyb3VwID8gYENvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXI/LmRpc3BsYXlOYW1lID8/IFwiVW5rbm93blwiLFxuICAgICAgICAgIHN0YXJ0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGZpbmlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAwLFxuICAgICAgICAgIGV4aXRDb2RlOiAtMSxcbiAgICAgICAgICBzdGRvdXQ6IFwiXCIsXG4gICAgICAgICAgc3RkZXJyOiBtZXNzYWdlLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHRpbWVkT3V0OiBmYWxzZSxcbiAgICAgICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBuZXcgTm90aWNlKGBsb29tIGVycm9yOiAke21lc3NhZ2V9YCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVFeGVjdXRpb25FbmFibGVkKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzaykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlPGJvb2xlYW4+KChyZXNvbHZlKSA9PiB7XG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlO1xuICAgICAgY29uc3Qgc2V0dGxlID0gKHZhbHVlOiBib29sZWFuKSA9PiB7XG4gICAgICAgIGlmICghc2V0dGxlZCkge1xuICAgICAgICAgIHNldHRsZWQgPSB0cnVlO1xuICAgICAgICAgIHJlc29sdmUodmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtb2RhbCA9IG5ldyBFeGVjdXRpb25Db25zZW50TW9kYWwodGhpcy5hcHAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHRydWU7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHNldHRsZSh0cnVlKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBvcmlnaW5hbENsb3NlID0gbW9kYWwuY2xvc2UuYmluZChtb2RhbCk7XG4gICAgICBtb2RhbC5jbG9zZSA9ICgpID0+IHtcbiAgICAgICAgb3JpZ2luYWxDbG9zZSgpO1xuICAgICAgICBzZXR0bGUodGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiAmJiB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2spO1xuICAgICAgfTtcbiAgICAgIG1vZGFsLm9wZW4oKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUV4ZWN1dGFibGVCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHsgYmxvY2s6IGxvb21Db2RlQmxvY2s7IHNvdXJjZVByZXZpZXc/OiBsb29tU3RvcmVkT3V0cHV0W1wic291cmNlUHJldmlld1wiXSB9PiB7XG4gICAgaWYgKCFibG9jay5zb3VyY2VSZWZlcmVuY2UpIHtcbiAgICAgIHJldHVybiB7IGJsb2NrIH07XG4gICAgfVxuXG4gICAgY29uc3QgcmVmZXJlbmNlUGF0aCA9IHRoaXMucmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZSwgYmxvY2suc291cmNlUmVmZXJlbmNlLmZpbGVQYXRoKTtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHJlZmVyZW5jZVBhdGgpO1xuICAgIGlmICghKHNvdXJjZUZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVmZXJlbmNlZCBzb3VyY2UgZmlsZSBub3QgZm91bmQ6ICR7cmVmZXJlbmNlUGF0aH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYXJuZXNzID0gYnVpbGRTb3VyY2VSZWZlcmVuY2VIYXJuZXNzKGJsb2NrKTtcbiAgICBjb25zdCBleHRlcm5hbEV4dHJhY3RvciA9IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2ssIGZpbGUpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UoXG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKHNvdXJjZUZpbGUpLFxuICAgICAgeyAuLi5ibG9jay5zb3VyY2VSZWZlcmVuY2UsIGZpbGVQYXRoOiByZWZlcmVuY2VQYXRoIH0sXG4gICAgICBibG9jay5sYW5ndWFnZSxcbiAgICAgIGhhcm5lc3MsXG4gICAgICB7XG4gICAgICAgIHB5dGhvbkV4ZWN1dGFibGU6IHRoaXMuc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCIsXG4gICAgICAgIGV4dGVybmFsRXh0cmFjdG9yLFxuICAgICAgICByZWFkRmlsZTogYXN5bmMgKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgICAgY29uc3QgaW1wb3J0ZWRGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG5vcm1hbGl6ZVBhdGgoZmlsZVBhdGgpKTtcbiAgICAgICAgICByZXR1cm4gaW1wb3J0ZWRGaWxlIGluc3RhbmNlb2YgVEZpbGUgPyB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGltcG9ydGVkRmlsZSkgOiBudWxsO1xuICAgICAgICB9LFxuICAgICAgICByZXNvbHZlUHl0aG9uSW1wb3J0OiBhc3luYyAoZnJvbUZpbGVQYXRoLCBtb2R1bGVOYW1lLCBsZXZlbCkgPT4gdGhpcy5yZXNvbHZlUHl0aG9uSW1wb3J0VmF1bHRQYXRoKGZyb21GaWxlUGF0aCwgbW9kdWxlTmFtZSwgbGV2ZWwpLFxuICAgICAgfSxcbiAgICApO1xuICAgIGNvbnN0IGNhcGFiaWxpdHkgPSBnZXRMYW5ndWFnZUNhcGFiaWxpdHkoYmxvY2subGFuZ3VhZ2UsIEJvb2xlYW4oZXh0ZXJuYWxFeHRyYWN0b3IpKTtcbiAgICBjb25zdCBzaG91bGRTaG93UHJldmlldyA9ICh0aGlzLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlIHx8IFwiY29sbGFwc2VkXCIpICE9PSBcImhpZGRlblwiO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJsb2NrOiB7XG4gICAgICAgIC4uLmJsb2NrLFxuICAgICAgICBjb250ZW50OiByZXNvbHZlZC5jb250ZW50LFxuICAgICAgfSxcbiAgICAgIHNvdXJjZVByZXZpZXc6IHNob3VsZFNob3dQcmV2aWV3ID8ge1xuICAgICAgICBkZXNjcmlwdGlvbjogcmVzb2x2ZWQuZGVzY3JpcHRpb24sXG4gICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgICAgY2FwYWJpbGl0eSxcbiAgICAgICAgZXhwYW5kZWQ6IHRoaXMuc2V0dGluZ3MuZXh0cmFjdGVkU291cmNlUHJldmlld01vZGUgPT09IFwiZXhwYW5kZWRcIixcbiAgICAgICAgc2hvd0NhcGFiaWxpdHlNZXRhZGF0YTogdGhpcy5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPz8gdHJ1ZSxcbiAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZVJlZmVyZW5jZWRWYXVsdFBhdGgoZmlsZTogVEZpbGUsIHJlZmVyZW5jZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHJlZmVyZW5jZVBhdGgudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkge1xuICAgICAgcmV0dXJuIHRyaW1tZWQ7XG4gICAgfVxuICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplUGF0aCh0cmltbWVkLnNsaWNlKDEpKTtcbiAgICB9XG5cbiAgICBjb25zdCBiYXNlRGlyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIHJldHVybiBub3JtYWxpemVQYXRoKGJhc2VEaXIgPT09IFwiLlwiID8gdHJpbW1lZCA6IGAke2Jhc2VEaXJ9LyR7dHJpbW1lZH1gKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZVB5dGhvbkltcG9ydFZhdWx0UGF0aChmcm9tRmlsZVBhdGg6IHN0cmluZywgbW9kdWxlTmFtZTogc3RyaW5nLCBsZXZlbDogbnVtYmVyKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgbW9kdWxlUGF0aCA9IG1vZHVsZU5hbWVcbiAgICAgIC5zcGxpdChcIi5cIilcbiAgICAgIC5tYXAoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIvXCIpO1xuICAgIGNvbnN0IGZyb21EaXIgPSBkaXJuYW1lKGZyb21GaWxlUGF0aCk7XG4gICAgY29uc3QgYmFzZURpcnMgPSBsZXZlbCA+IDBcbiAgICAgID8gW3RoaXMuYXNjZW5kVmF1bHRQYXRoKGZyb21EaXIgPT09IFwiLlwiID8gXCJcIiA6IGZyb21EaXIsIGxldmVsIC0gMSldXG4gICAgICA6IFtmcm9tRGlyID09PSBcIi5cIiA/IFwiXCIgOiBmcm9tRGlyLCBcIlwiXTtcblxuICAgIGZvciAoY29uc3QgYmFzZURpciBvZiBiYXNlRGlycykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHRoaXMuZ2V0UHl0aG9uSW1wb3J0Q2FuZGlkYXRlcyhiYXNlRGlyLCBtb2R1bGVQYXRoKTtcbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVBhdGgoY2FuZGlkYXRlKTtcbiAgICAgICAgaWYgKHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVkKSBpbnN0YW5jZW9mIFRGaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0UHl0aG9uSW1wb3J0Q2FuZGlkYXRlcyhiYXNlRGlyOiBzdHJpbmcsIG1vZHVsZVBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwcmVmaXggPSBiYXNlRGlyID8gYCR7YmFzZURpcn0vYCA6IFwiXCI7XG4gICAgaWYgKCFtb2R1bGVQYXRoKSB7XG4gICAgICByZXR1cm4gW2Ake3ByZWZpeH1fX2luaXRfXy5weWBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAgYCR7cHJlZml4fSR7bW9kdWxlUGF0aH0ucHlgLFxuICAgICAgYCR7cHJlZml4fSR7bW9kdWxlUGF0aH0vX19pbml0X18ucHlgLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIGFzY2VuZFZhdWx0UGF0aChwYXRoOiBzdHJpbmcsIGxldmVsczogbnVtYmVyKTogc3RyaW5nIHtcbiAgICBsZXQgY3VycmVudCA9IHBhdGg7XG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxldmVsczsgaW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgbmV4dCA9IGRpcm5hbWUoY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gbmV4dCA9PT0gXCIuXCIgPyBcIlwiIDogbmV4dDtcbiAgICB9XG4gICAgcmV0dXJuIGN1cnJlbnQ7XG4gIH1cblxuICBhc3luYyBnZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIHJldHVybiB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRHcm91cFN1bW1hcmllcygpO1xuICB9XG5cbiAgYXN5bmMgYnVpbGRDb250YWluZXJHcm91cChuYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLmJ1aWxkR3JvdXAobmFtZSwgTWF0aC5tYXgodGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLCAxMjBfMDAwKSwgY29udHJvbGxlci5zaWduYWwpO1xuICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSBidWlsdCBjb250YWluZXIgZ3JvdXAgJHtuYW1lfS5gIDogYGxvb20gY29udGFpbmVyIGJ1aWxkIGZhaWxlZCBmb3IgJHtuYW1lfS5gLCA4MDAwKTtcbiAgfVxuXG4gIHJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGFsaWFzIG9mIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyh0aGlzLnNldHRpbmdzKSkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEFsaWFzID0gYWxpYXMudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICh0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmhhcyhub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoL1teYS16QS1aMC05Xy1dLy50ZXN0KG5vcm1hbGl6ZWRBbGlhcykpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMuYWRkKG5vcm1hbGl6ZWRBbGlhcyk7XG4gICAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3Iobm9ybWFsaXplZEFsaWFzLCBhc3luYyAoc291cmNlLCBlbCwgY3R4KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gY3R4LnNvdXJjZVBhdGg7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgICAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZnVsbFRleHQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgZnVsbFRleHQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gKGN0eCAmJiB0eXBlb2YgY3R4LmdldFNlY3Rpb25JbmZvID09PSBcImZ1bmN0aW9uXCIpID8gY3R4LmdldFNlY3Rpb25JbmZvKGVsKSA6IG51bGw7XG4gICAgICAgIGxldCBibG9jazogbG9vbUNvZGVCbG9jayB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKHNlY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBsaW5lU3RhcnQgPSBzZWN0aW9uLmxpbmVTdGFydDtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5zdGFydExpbmUgPT09IGxpbmVTdGFydCAmJiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBibG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcHJlID0gZWwucXVlcnlTZWxlY3RvcihcInByZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICghcHJlKSB7XG4gICAgICAgICAgcHJlID0gZWwuY3JlYXRlRWwoXCJwcmVcIik7XG4gICAgICAgICAgcHJlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb25zdCBjb2RlID0gcHJlLmNyZWF0ZUVsKFwiY29kZVwiKTtcbiAgICAgICAgICBjb2RlLmFkZENsYXNzKGBsYW5ndWFnZS0ke25vcm1hbGl6ZWRBbGlhc31gKTtcbiAgICAgICAgICBjb2RlLnNldFRleHQoc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIpIHtcbiAgICAgICAgICBjb25zdCBjb2RlID0gKHByZS5xdWVyeVNlbGVjdG9yKFwiY29kZVwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGwpID8/IHByZTtcbiAgICAgICAgICBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlLCBzb3VyY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgY3R4LmFkZENoaWxkKG5ldyBsb29tVG9vbGJhclJlbmRlckNoaWxkKGVsLCB0aGlzLCBibG9jaywgcHJlKSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVN0YXR1c0JhcigpOiB2b2lkIHtcbiAgICBjb25zdCBhY3RpdmVSdW5zID0gdGhpcy5ydW5uaW5nLnNpemU7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwuc2V0VGV4dChhY3RpdmVSdW5zID8gYGxvb206ICR7YWN0aXZlUnVuc30gQWN0aXZlIFJ1biR7YWN0aXZlUnVucyA9PT0gMSA/IFwiXCIgOiBcInNcIn1gIDogXCJsb29tOiBJZGxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrSWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZm9yRWFjaCgobGlzdGVuZXIpID0+IGxpc3RlbmVyKCkpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hBbGxWaWV3cygpOiB2b2lkIHtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IGxlYWYudmlldyBhcyBNYXJrZG93blZpZXc7XG4gICAgICBjb25zdCBwcmV2aWV3TW9kZSA9ICh2aWV3IGFzIHsgcHJldmlld01vZGU/OiB7IHJlcmVuZGVyPzogKGZvcmNlPzogYm9vbGVhbikgPT4gdm9pZCB9IH0pLnByZXZpZXdNb2RlO1xuICAgICAgcHJldmlld01vZGU/LnJlcmVuZGVyPy4odHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGVkaXRvclZpZXcgb2YgdGhpcy5lZGl0b3JWaWV3cykge1xuICAgICAgZWRpdG9yVmlldy5kaXNwYXRjaCh7IGVmZmVjdHM6IGxvb21SZWZyZXNoRWZmZWN0Lm9mKHVuZGVmaW5lZCkgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRBY3RpdmVNYXJrZG93bkZpbGUoKTogVEZpbGUgfCBudWxsIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICByZXR1cm4gdmlldz8uZmlsZSA/PyBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgfVxuXG4gIGFzeW5jIGVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZih2aWV3LmxlYWYpO1xuICB9XG5cbiAgYXN5bmMgZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGlmICghdmlldykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxlYWYgPSB2aWV3LmxlYWY7XG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHN0YXRlLnNvdXJjZSA9IGZhbHNlO1xuICAgICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAuLi52aWV3U3RhdGUsXG4gICAgICAgIHN0YXRlLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckxlYWYobGVhZjogV29ya3NwYWNlTGVhZik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobGVhZi5pc0RlZmVycmVkKSB7XG4gICAgICBhd2FpdCBsZWFmLmxvYWRJZkRlZmVycmVkKCk7XG4gICAgfVxuXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBpZiAoISh2aWV3IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB8fCAhdmlldy5maWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc291cmNlID0gdmlldy5lZGl0b3I/LmdldFZhbHVlPy4oKSA/PyAoYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZCh2aWV3LmZpbGUpKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2Nrcyh2aWV3LmZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBpZiAoIWJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB2aWV3U3RhdGUgPSBsZWFmLmdldFZpZXdTdGF0ZSgpO1xuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmIChzdGF0ZS5tb2RlID09PSBcInNvdXJjZVwiICYmIHN0YXRlLnNvdXJjZSA9PT0gdHJ1ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHN0YXRlLm1vZGUgPSBcInNvdXJjZVwiO1xuICAgIHN0YXRlLnNvdXJjZSA9IHRydWU7XG5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAuLi52aWV3U3RhdGUsXG4gICAgICBzdGF0ZSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBsb29tQ29kZUJsb2NrIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGU7XG4gICAgY29uc3QgZWRpdG9yID0gdmlldz8uZWRpdG9yO1xuICAgIGlmICghZmlsZSB8fCAhZWRpdG9yKSB7XG4gICAgICByZXR1cm4gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGVkaXRvci5nZXRWYWx1ZSgpLCB0aGlzLnNldHRpbmdzKTtcbiAgICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBibG9jay5pZCA9PT0gYmxvY2tJZCkgPz8gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKT8uYmxvY2sgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSB7XG4gICAgY29uc3QgcGx1Z2luID0gdGhpcztcblxuICAgIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICAgIGNsYXNzIHtcbiAgICAgICAgZGVjb3JhdGlvbnM7XG5cbiAgICAgICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB2aWV3OiBFZGl0b3JWaWV3KSB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmFkZCh2aWV3KTtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gdGhpcy5idWlsZERlY29yYXRpb25zKCk7XG4gICAgICAgIH1cblxuICAgICAgICB1cGRhdGUodXBkYXRlOiBWaWV3VXBkYXRlKTogdm9pZCB7XG4gICAgICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhsb29tUmVmcmVzaEVmZmVjdCkpKSkge1xuICAgICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgICAgICAgcGx1Z2luLmVkaXRvclZpZXdzLmRlbGV0ZSh0aGlzLnZpZXcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBidWlsZERlY29yYXRpb25zKCkge1xuICAgICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGx1Z2luLmdldEN1cnJlbnRFZGl0b3JGaWxlUGF0aCgpO1xuICAgICAgICAgIGlmICghZmlsZVBhdGgpIHtcbiAgICAgICAgICAgIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc291cmNlID0gdGhpcy52aWV3LnN0YXRlLmRvYy50b1N0cmluZygpO1xuICAgICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoLCBzb3VyY2UsIHBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXI8RGVjb3JhdGlvbj4oKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suc3RhcnRMaW5lICsgMSk7XG4gICAgICAgICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgICAgICAgc3RhcnRMaW5lLmZyb20sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgd2lkZ2V0OiBuZXcgbG9vbVRvb2xiYXJXaWRnZXQocGx1Z2luLCBibG9jayksXG4gICAgICAgICAgICAgICAgc2lkZTogLTEsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgaWYgKHBsdWdpbi5vdXRwdXRzLmhhcyhibG9jay5pZCkgfHwgcGx1Z2luLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgICAgICAgICBjb25zdCBlbmRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLmVuZExpbmUgKyAxKTtcbiAgICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBlbmRMaW5lLnRvLFxuICAgICAgICAgICAgICAgIERlY29yYXRpb24ud2lkZ2V0KHtcbiAgICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21PdXRwdXRXaWRnZXQocGx1Z2luLCBibG9jay5pZCksXG4gICAgICAgICAgICAgICAgICBzaWRlOiAxLFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgICAgIGFkZExsdm1EZWNvcmF0aW9ucyhidWlsZGVyLCB0aGlzLnZpZXcsIGJsb2NrKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgZGVjb3JhdGlvbnM6ICh2YWx1ZSkgPT4gdmFsdWUuZGVjb3JhdGlvbnMsXG4gICAgICB9LFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGhhc0V4cGxpY2l0RXhlY3V0aW9uQ29udGV4dChjb250ZXh0OiBsb29tUmVzb2x2ZWRFeGVjdXRpb25Db250ZXh0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGNvbnRleHQuc291cmNlLmNvbnRhaW5lciAhPT0gXCJub25lXCIgfHwgY29udGV4dC5zb3VyY2Uud29ya2luZ0RpcmVjdG9yeSAhPT0gXCJkZWZhdWx0XCIgfHwgY29udGV4dC5zb3VyY2UudGltZW91dCAhPT0gXCJnbG9iYWxcIjtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0RXhlY3V0aW9uQ29udGV4dE5vdGljZShjb250ZXh0OiBsb29tUmVzb2x2ZWRFeGVjdXRpb25Db250ZXh0KTogc3RyaW5nIHtcbiAgICBjb25zdCBwaWVjZXMgPSBbXG4gICAgICBgY29udGFpbmVyPSR7Y29udGV4dC5jb250YWluZXJHcm91cCA/PyBcIm5hdGl2ZVwifSAoJHtjb250ZXh0LnNvdXJjZS5jb250YWluZXJ9KWAsXG4gICAgICBgY3dkPSR7Y29udGV4dC53b3JraW5nRGlyZWN0b3J5fSAoJHtjb250ZXh0LnNvdXJjZS53b3JraW5nRGlyZWN0b3J5fSlgLFxuICAgICAgYHRpbWVvdXQ9JHtjb250ZXh0LnRpbWVvdXRNc31tcyAoJHtjb250ZXh0LnNvdXJjZS50aW1lb3V0fSlgLFxuICAgIF07XG4gICAgcmV0dXJuIGBFeGVjdXRpb24gY29udGV4dDogJHtwaWVjZXMuam9pbihcIiwgXCIpfS5gO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZUV4dHJhY3RvcihibG9jazogbG9vbUNvZGVCbG9jaywgZmlsZTogVEZpbGUpOiB7IG1vZGU6IFwiY29tbWFuZFwiIHwgXCJ0cmFuc3BpbGUtY1wiOyBsYW5ndWFnZTogc3RyaW5nOyBleGVjdXRhYmxlOiBzdHJpbmc7IGFyZ3M6IHN0cmluZ1tdOyB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7IHRpbWVvdXRNczogbnVtYmVyIH0gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGxhbmd1YWdlSWQgPSBibG9jay5sYW5ndWFnZTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbGFuZ3VhZ2VJZC50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IHRoaXMuc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGNhbmRpZGF0ZSkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IGNhbmRpZGF0ZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGNhbmRpZGF0ZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKTtcbiAgICB9KTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBsYW5ndWFnZS5leHRyYWN0b3JNb2RlIHx8IFwiY29tbWFuZFwiO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBtb2RlID09PSBcInRyYW5zcGlsZS1jXCIgPyBsYW5ndWFnZS50cmFuc3BpbGVFeGVjdXRhYmxlPy50cmltKCkgOiBsYW5ndWFnZS5leHRyYWN0b3JFeGVjdXRhYmxlPy50cmltKCk7XG4gICAgY29uc3QgYXJncyA9IG1vZGUgPT09IFwidHJhbnNwaWxlLWNcIiA/IGxhbmd1YWdlLnRyYW5zcGlsZUFyZ3MgfHwgXCJ7cmVxdWVzdH1cIiA6IGxhbmd1YWdlLmV4dHJhY3RvckFyZ3MgfHwgXCJ7cmVxdWVzdH1cIjtcbiAgICBpZiAoIWV4ZWN1dGFibGUpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IHJlc29sdmVFeGVjdXRpb25Db250ZXh0KHRoaXMuYXBwLCBmaWxlLCBibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1vZGUsXG4gICAgICBsYW5ndWFnZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBzcGxpdENvbW1hbmRMaW5lKGFyZ3MpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZXhlY3V0aW9uQ29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBleGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2suaWQpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0aGlzLnJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9jay5pZCwgcmVzdWx0KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcblxuICAgICAgaWYgKGV4aXN0aW5nUmFuZ2UpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBsaW5lcy5zcGxpY2UoY3VycmVudEJsb2NrLmVuZExpbmUgKyAxLCAwLCAuLi5yZW5kZXJlZCk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG9wZW5TeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJlYWRkaXIsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoLCBwb3NpeCBhcyBwb3NpeFBhdGggfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgbG9vbUNvbnRhaW5lclJ1bnRpbWUgPSBcImRvY2tlclwiIHwgXCJwb2RtYW5cIiB8IFwicWVtdVwiIHwgXCJ3c2xcIiB8IFwiY3VzdG9tXCI7XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcge1xuICBjb21tYW5kPzogc3RyaW5nO1xuICBleHRlbnNpb24/OiBzdHJpbmc7XG4gIHVzZURlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgcG9zaXRpdmVSZXNwb25zZT86IHN0cmluZztcbiAgbmVnYXRpdmVSZXNwb25zZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11Q29uZmlnIHtcbiAgc3NoVGFyZ2V0OiBzdHJpbmc7XG4gIHJlbW90ZVdvcmtzcGFjZTogc3RyaW5nO1xuICBzc2hFeGVjdXRhYmxlPzogc3RyaW5nO1xuICBzc2hBcmdzPzogc3RyaW5nO1xuICBzdGFydENvbW1hbmQ/OiBzdHJpbmc7XG4gIGJ1aWxkQ29tbWFuZD86IHN0cmluZztcbiAgdGVhcmRvd25Db21tYW5kPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIG1hbmFnZXI/OiBsb29tUWVtdU1hbmFnZXJDb25maWc7XG59XG5cbmludGVyZmFjZSBsb29tUWVtdU1hbmFnZXJDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgaW1hZ2VGb3JtYXQ/OiBzdHJpbmc7XG4gIHBpZEZpbGU/OiBzdHJpbmc7XG4gIGxvZ0ZpbGU/OiBzdHJpbmc7XG4gIHJlYWRpbmVzc1RpbWVvdXRNcz86IG51bWJlcjtcbiAgcmVhZGluZXNzSW50ZXJ2YWxNcz86IG51bWJlcjtcbiAgYm9vdERlbGF5TXM/OiBudW1iZXI7XG4gIHNodXRkb3duQ29tbWFuZD86IHN0cmluZztcbiAgc2h1dGRvd25UaW1lb3V0TXM/OiBudW1iZXI7XG4gIGtpbGxTaWduYWw/OiBOb2RlSlMuU2lnbmFscztcbiAgcGVyc2lzdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJncz86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG59XG5cbmludGVyZmFjZSBsb29tV3NsQ29uZmlnIHtcbiAgaW50ZXJhY3RpdmU/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckNvbmZpZyB7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgd3NsPzogbG9vbVdzbENvbmZpZztcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICBhY3Rpb246IFwiYnVpbGRcIiB8IFwicnVuXCIgfCBcInRlYXJkb3duXCI7XG4gIGdyb3VwTmFtZTogc3RyaW5nO1xuICBncm91cFBhdGg6IHN0cmluZztcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGltYWdlPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogc3RyaW5nO1xuICBsYW5ndWFnZUFsaWFzPzogc3RyaW5nO1xuICBmaWxlTmFtZT86IHN0cmluZztcbiAgZmlsZVBhdGg/OiBzdHJpbmc7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBjb25maWc6IHtcbiAgICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICAgIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICAgIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBsb29tQ29udGFpbmVyUnVubmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBidWlsdEltYWdlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5EaXI6IHN0cmluZyxcbiAgKSB7IH1cblxuICBnZXRDb250YWluZXJHcm91cE5hbWUoZmlsZTogVEZpbGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIGNvbnN0IGNvbnRhaW5lcnNQYXRoID0gdGhpcy5nZXRDb250YWluZXJzUGF0aCgpO1xuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyaWVzID0gYXdhaXQgcmVhZGRpcihjb250YWluZXJzUGF0aCwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgIGVudHJpZXNcbiAgICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmlzRGlyZWN0b3J5KCkpXG4gICAgICAgIC5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICAgICAgY29uc3QgZ3JvdXBQYXRoID0gam9pbihjb250YWluZXJzUGF0aCwgZW50cnkubmFtZSk7XG4gICAgICAgICAgY29uc3QgaGFzQ29uZmlnID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKSk7XG4gICAgICAgICAgY29uc3QgaGFzRG9ja2VyZmlsZSA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSk7XG4gICAgICAgICAgaWYgKCFoYXNDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJtaXNzaW5nIGNvbmZpZy5qc29uXCIsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBwaWVjZXMgPSBbYHJ1bnRpbWU6ICR7Y29uZmlnLnJ1bnRpbWV9YF07XG4gICAgICAgICAgICBpZiAoKGNvbmZpZy5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiKSAmJiBoYXNEb2NrZXJmaWxlKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKFwiRG9ja2VyZmlsZVwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/LnNzaFRhcmdldCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgc3NoOiAke2NvbmZpZy5xZW11LnNzaFRhcmdldH1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/Lm1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYG1hbmFnZXI6ICR7YXdhaXQgdGhpcy5nZXRNYW5hZ2VkUWVtdVN0YXR1cyhncm91cFBhdGgsIGNvbmZpZy5xZW11Lm1hbmFnZXIpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcImN1c3RvbVwiICYmIGNvbmZpZy5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHdyYXBwZXI6ICR7Y29uZmlnLmN1c3RvbS5leGVjdXRhYmxlfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgbGFuZ3VhZ2VDb3VudCA9IE9iamVjdC5rZXlzKGNvbmZpZy5sYW5ndWFnZXMpLmxlbmd0aDtcbiAgICAgICAgICAgIHBpZWNlcy5wdXNoKGAke2xhbmd1YWdlQ291bnR9IGxhbmd1YWdlJHtsYW5ndWFnZUNvdW50ID09PSAxID8gXCJcIiA6IFwic1wifWApO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBwaWVjZXMuam9pbihcIiwgXCIpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBgaW52YWxpZCBjb25maWcuanNvbjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgZ3JvdXBOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBjb25maWdMYW5nID0gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZV0gPz8gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZUFsaWFzXTtcblxuICAgIGxldCBpc0ZhbGxiYWNrID0gZmFsc2U7XG4gICAgbGV0IGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcgfCBudWxsID0gbnVsbDtcblxuICAgIGlmIChjb25maWdMYW5nKSB7XG4gICAgICBpZiAoY29uZmlnTGFuZy51c2VEZWZhdWx0KSB7XG4gICAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsYW5ndWFnZSA9IGNvbmZpZ0xhbmc7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICBpc0ZhbGxiYWNrID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlIHx8ICFsYW5ndWFnZS5jb21tYW5kIHx8ICFsYW5ndWFnZS5leHRlbnNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGdyb3VwICR7Z3JvdXBOYW1lfSBoYXMgbm8gY29tbWFuZCBmb3IgJHtibG9jay5sYW5ndWFnZX0uYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmhlYWx0aGAsIGBDb250YWluZXIgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuICAgIGNvbnN0IHRlbXBGaWxlTmFtZSA9IGB0ZW1wXyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0ke25vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24pfWA7XG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gam9pbihncm91cFBhdGgsIHRlbXBGaWxlTmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlUGF0aCwgYmxvY2suY29udGVudCwgXCJ1dGY4XCIpO1xuICAgICAgbGV0IHJlc3VsdDogbG9vbVJ1blJlc3VsdDtcbiAgICAgIHN3aXRjaCAoY29uZmlnLnJ1bnRpbWUpIHtcbiAgICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5PY2lDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGJsb2NrLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCB0ZW1wRmlsZVBhdGgsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Xc2xDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWApO1xuICAgICAgfVxuXG4gICAgICBpZiAoaXNGYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmYWxsYmFja01zZyA9IGBbTG9vbV0gTGFuZ3VhZ2UgJyR7YmxvY2subGFuZ3VhZ2V9JyB3YXMgbm90IGRlY2xhcmVkIGluIGNvbnRhaW5lciBncm91cC4gUnVubmluZyB1c2luZyBkZWZhdWx0IGNvbW1hbmQ6ICR7bGFuZ3VhZ2UuY29tbWFuZH1gO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7cmVzdWx0Lndhcm5pbmd9XFxuJHtmYWxsYmFja01zZ31gIDogZmFsbGJhY2tNc2c7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybSh0ZW1wRmlsZVBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYnVpbGRHcm91cChncm91cE5hbWU6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRRZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuQ3VzdG9tV3JhcHBlcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJidWlsZFwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMpLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2w6YnVpbGRgLFxuICAgICAgICAgIGBXU0wgJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgICAgICBgV1NMIGVudmlyb25tZW50ICR7Y29uZmlnLmltYWdlIHx8IFwiKGRlZmF1bHQpXCJ9IGRvZXMgbm90IHJlcXVpcmUgYSBidWlsZCBzdGVwLlxcbmAsXG4gICAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PY2lDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgaW1hZ2UgPSBhd2FpdCB0aGlzLnJlc29sdmVJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpKTtcbiAgICBpZiAoIWNvbW1hbmQubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXG4gICAgICAgIFwicnVuXCIsXG4gICAgICAgIFwiLS1ybVwiLFxuICAgICAgICBcIi12XCIsXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXG4gICAgICAgIFwiLXdcIixcbiAgICAgICAgXCIvd29ya3NwYWNlXCIsXG4gICAgICAgIGltYWdlLFxuICAgICAgICAuLi5jb21tYW5kLFxuICAgICAgXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5RZW11KFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBxZW11ID0gdGhpcy5yZXF1aXJlUWVtdUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUuc3RhcnRDb21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzdGFydGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBzdGFydGApO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhxZW11LmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpoZWFsdGhgLCBgUUVNVSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVtb3RlRmlsZSA9IHBvc2l4UGF0aC5qb2luKHFlbXUucmVtb3RlV29ya3NwYWNlLCB0ZW1wRmlsZU5hbWUpO1xuICAgICAgY29uc3QgcmVtb3RlQ29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgc2hlbGxRdW90ZShyZW1vdGVGaWxlKSk7XG4gICAgICBpZiAoIXJlbW90ZUNvbW1hbmQudHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXVgLFxuICAgICAgICBydW5uZXJOYW1lOiBgUUVNVSAke2dyb3VwTmFtZX1gLFxuICAgICAgICBleGVjdXRhYmxlOiBxZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJzc2hcIixcbiAgICAgICAgYXJnczogW1xuICAgICAgICAgIC4uLnNwbGl0Q29tbWFuZExpbmUocWVtdS5zc2hBcmdzIHx8IFwiXCIpLFxuICAgICAgICAgIHFlbXUuc3NoVGFyZ2V0LFxuICAgICAgICAgIGBjZCAke3NoZWxsUXVvdGUocWVtdS5yZW1vdGVXb3Jrc3BhY2UpfSAmJiAke3JlbW90ZUNvbW1hbmR9YCxcbiAgICAgICAgXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUudGVhcmRvd25Db21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTp0ZWFyZG93bmAsIGBRRU1VICR7Z3JvdXBOYW1lfSB0ZWFyZG93bmApO1xuICAgICAgYXdhaXQgdGhpcy5zdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICB0ZW1wRmlsZVBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBjb25maWcsXG4gICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJydW5cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICBjb21tYW5kLFxuICAgICAgfSksXG4gICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICk7XG5cbiAgICBpZiAoY29uZmlnLmN1c3RvbT8udGVhcmRvd24pIHtcbiAgICAgIGNvbnN0IHRlYXJkb3duID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgICBncm91cE5hbWUsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgY29uZmlnLFxuICAgICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJ0ZWFyZG93blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgICBjb21tYW5kLFxuICAgICAgICB9KSxcbiAgICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICAgKTtcbiAgICAgIGlmICghdGVhcmRvd24uc3VjY2Vzcykge1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBDdXN0b20gcnVudGltZSB0ZWFyZG93biBmYWlsZWQ6ICR7dGVhcmRvd24uc3RkZXJyIHx8IHRlYXJkb3duLnN0ZG91dCB8fCBgZXhpdCAke3RlYXJkb3duLmV4aXRDb2RlfWB9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Xc2xDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHdzbEdyb3VwUGF0aCA9IHRoaXMudHJhbnNsYXRlVG9Xc2xQYXRoKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBpZiAoIWNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXU0wgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc2hlbGxGbGFncyA9IGNvbmZpZy53c2w/LmludGVyYWN0aXZlID8gW1wiLWlcIiwgXCItbFwiLCBcIi1jXCJdIDogW1wiLWxcIiwgXCItY1wiXTtcbiAgICBjb25zdCB3c2xBcmdzID0gW1wiYmFzaFwiLCAuLi5zaGVsbEZsYWdzLCBgY2QgXCIke3dzbEdyb3VwUGF0aC5yZXBsYWNlQWxsKCdcIicsICdcXFxcXCInKX1cIiAmJiAke2NvbW1hbmR9YF07XG4gICAgaWYgKGNvbmZpZy5pbWFnZT8udHJpbSgpKSB7XG4gICAgICB3c2xBcmdzLnVuc2hpZnQoXCItZFwiLCBjb25maWcuaW1hZ2UudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsYCxcbiAgICAgIHJ1bm5lck5hbWU6IGBXU0wgJHtncm91cE5hbWV9YCxcbiAgICAgIGV4ZWN1dGFibGU6IFwid3NsXCIsXG4gICAgICBhcmdzOiB3c2xBcmdzLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRyYW5zbGF0ZVRvV3NsUGF0aCh3aW5kb3dzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBtYXRjaCA9IHdpbmRvd3NQYXRoLm1hdGNoKC9eKFtBLVphLXpdKTpcXFxcKC4qKS8pO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgY29uc3QgZHJpdmUgPSBtYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgcmVzdCA9IG1hdGNoWzJdLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgICAgcmV0dXJuIGAvbW50LyR7ZHJpdmV9LyR7cmVzdH1gO1xuICAgIH1cbiAgICBpZiAod2luZG93c1BhdGguaW5jbHVkZXMoXCJcXFxcXCIpKSB7XG4gICAgICByZXR1cm4gd2luZG93c1BhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgfVxuICAgIHJldHVybiB3aW5kb3dzUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGRvY2tlcmZpbGUgPSBqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpO1xuICAgIGlmICghZXhpc3RzU3luYyhkb2NrZXJmaWxlKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIjtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjYWNoZUtleSA9IGAke3RoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKX06JHtpbWFnZX1gO1xuICAgIGlmICh0aGlzLmJ1aWx0SW1hZ2VzLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgIHJldHVybiBpbWFnZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSBidWlsZCBmYWlsZWQgZm9yICR7Z3JvdXBOYW1lfS5gKTtcbiAgICB9XG5cbiAgICB0aGlzLmJ1aWx0SW1hZ2VzLmFkZChjYWNoZUtleSk7XG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZEltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgICBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICBgTm8gRG9ja2VyZmlsZSBjb25maWd1cmVkLiBVc2luZyBpbWFnZSAke2NvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIn0uXFxuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1wiYnVpbGRcIiwgXCItdFwiLCBpbWFnZSwgZ3JvdXBQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgaWYgKCFxZW11LmJ1aWxkQ29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGAsIFwiTm8gUUVNVSBidWlsZCBjb21tYW5kIGNvbmZpZ3VyZWQuXFxuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5Db21tYW5kTGluZShxZW11LmJ1aWxkQ29tbWFuZCwgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQ29uZmlnKGdyb3VwUGF0aDogc3RyaW5nKTogUHJvbWlzZTxsb29tQ29udGFpbmVyQ29uZmlnPiB7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpO1xuICAgIGxldCByYXc6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIHJhdyA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgXCJ1dGY4XCIpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcmVhZCBjb250YWluZXIgY29uZmlnICR7Y29uZmlnUGF0aH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cblxuICAgIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gcmF3IGFzIHtcbiAgICAgIHJ1bnRpbWU/OiB1bmtub3duO1xuICAgICAgZXhlY3V0YWJsZT86IHVua25vd247XG4gICAgICBpbWFnZT86IHVua25vd247XG4gICAgICB3c2w/OiB1bmtub3duO1xuICAgICAgaGVhbHRoQ2hlY2s/OiB1bmtub3duO1xuICAgICAgcWVtdT86IHVua25vd247XG4gICAgICBjdXN0b20/OiB1bmtub3duO1xuICAgICAgbGFuZ3VhZ2VzPzogdW5rbm93bjtcbiAgICB9O1xuICAgIGNvbnN0IHJ1bnRpbWUgPSB0aGlzLnJlYWRSdW50aW1lKGRhdGEucnVudGltZSk7XG4gICAgaWYgKGRhdGEuZXhlY3V0YWJsZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKGRhdGEuaW1hZ2UgIT0gbnVsbCAmJiB0eXBlb2YgZGF0YS5pbWFnZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBpbWFnZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKCFkYXRhLmxhbmd1YWdlcyB8fCB0eXBlb2YgZGF0YS5sYW5ndWFnZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkYXRhLmxhbmd1YWdlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbGFuZ3VhZ2VzIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtsYW5ndWFnZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBiZSBhbiBvYmplY3QuYCk7XG4gICAgICB9XG4gICAgICBjb25zdCBsYW5ndWFnZUNvbmZpZyA9IHZhbHVlIGFzIHsgY29tbWFuZD86IHVua25vd247IGV4dGVuc2lvbj86IHVua25vd247IHVzZURlZmF1bHQ/OiB1bmtub3duIH07XG4gICAgICBjb25zdCB1c2VEZWZhdWx0ID0gbGFuZ3VhZ2VDb25maWcudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgaWYgKCF1c2VEZWZhdWx0ICYmICh0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCAhPT0gXCJzdHJpbmdcIiB8fCAhbGFuZ3VhZ2VDb25maWcuY29tbWFuZC50cmltKCkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgZGVmaW5lIGNvbW1hbmQgb3IgdXNlRGVmYXVsdC5gKTtcbiAgICAgIH1cblxuICAgICAgbGFuZ3VhZ2VzW2xhbmd1YWdlXSA9IHtcbiAgICAgICAgY29tbWFuZDogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5jb21tYW5kIDogdW5kZWZpbmVkLFxuICAgICAgICBleHRlbnNpb246IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gOiB1c2VEZWZhdWx0ID8gdW5kZWZpbmVkIDogYC4ke2xhbmd1YWdlfWAsXG4gICAgICAgIHVzZURlZmF1bHQ6IHVzZURlZmF1bHQgfHwgdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcnVudGltZSxcbiAgICAgIGV4ZWN1dGFibGU6IHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgPT09IFwic3RyaW5nXCIgJiYgZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA/IGRhdGEuZXhlY3V0YWJsZS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBpbWFnZTogdHlwZW9mIGRhdGEuaW1hZ2UgPT09IFwic3RyaW5nXCIgPyBkYXRhLmltYWdlIDogdW5kZWZpbmVkLFxuICAgICAgd3NsOiB0aGlzLnJlYWRXc2xDb25maWcoZGF0YS53c2wpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBoZWFsdGhDaGVja1wiKSxcbiAgICAgIHFlbXU6IHRoaXMucmVhZFFlbXVDb25maWcoZGF0YS5xZW11KSxcbiAgICAgIGN1c3RvbTogdGhpcy5yZWFkQ3VzdG9tQ29uZmlnKGRhdGEuY3VzdG9tKSxcbiAgICAgIGxhbmd1YWdlcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUnVudGltZSh2YWx1ZTogdW5rbm93bik6IGxvb21Db250YWluZXJSdW50aW1lIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFwiZG9ja2VyXCI7XG4gICAgfVxuICAgIGlmICh2YWx1ZSA9PT0gXCJkb2NrZXJcIiB8fCB2YWx1ZSA9PT0gXCJwb2RtYW5cIiB8fCB2YWx1ZSA9PT0gXCJxZW11XCIgfHwgdmFsdWUgPT09IFwiY3VzdG9tXCIgfHwgdmFsdWUgPT09IFwid3NsXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBydW50aW1lIG11c3QgYmUgZG9ja2VyLCBwb2RtYW4sIHFlbXUsIGN1c3RvbSwgb3Igd3NsLlwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFdzbENvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21Xc2xDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyB3c2wgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgeyBpbnRlcmFjdGl2ZT86IHVua25vd24gfTtcbiAgICByZXR1cm4ge1xuICAgICAgaW50ZXJhY3RpdmU6IGRhdGEuaW50ZXJhY3RpdmUgPT09IHRydWUsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNzaFRhcmdldCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5zc2hUYXJnZXQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUuc3NoVGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGRhdGEucmVtb3RlV29ya3NwYWNlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5yZW1vdGVXb3Jrc3BhY2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxuICAgICAgcmVtb3RlV29ya3NwYWNlOiBkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCksXG4gICAgICBzc2hFeGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEV4ZWN1dGFibGUpLFxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcbiAgICAgIHN0YXJ0Q29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zdGFydENvbW1hbmQpLFxuICAgICAgYnVpbGRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkQ29tbWFuZCksXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5oZWFsdGhDaGVja1wiKSxcbiAgICAgIG1hbmFnZXI6IHRoaXMucmVhZFFlbXVNYW5hZ2VyQ29uZmlnKGRhdGEubWFuYWdlciksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVNYW5hZ2VyQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiBkYXRhLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgZXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5leGVjdXRhYmxlKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBpbWFnZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZSksXG4gICAgICBpbWFnZUZvcm1hdDogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZUZvcm1hdCksXG4gICAgICBwaWRGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBpZEZpbGUpLFxuICAgICAgbG9nRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5sb2dGaWxlKSxcbiAgICAgIHJlYWRpbmVzc1RpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NUaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zXCIpLFxuICAgICAgcmVhZGluZXNzSW50ZXJ2YWxNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NJbnRlcnZhbE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXNcIiksXG4gICAgICBib290RGVsYXlNczogb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIoZGF0YS5ib290RGVsYXlNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5ib290RGVsYXlNc1wiKSxcbiAgICAgIHNodXRkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zaHV0ZG93bkNvbW1hbmQpLFxuICAgICAgc2h1dGRvd25UaW1lb3V0TXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEuc2h1dGRvd25UaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXNcIiksXG4gICAgICBraWxsU2lnbmFsOiBvcHRpb25hbFNpZ25hbChkYXRhLmtpbGxTaWduYWwsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIua2lsbFNpZ25hbFwiKSxcbiAgICAgIHBlcnNpc3Q6IHR5cGVvZiBkYXRhLnBlcnNpc3QgPT09IFwiYm9vbGVhblwiID8gZGF0YS5wZXJzaXN0IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRDdXN0b21Db25maWcodmFsdWU6IHVua25vd24pOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGV4ZWN1dGFibGU6IGRhdGEuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxuICAgICAgYnVpbGQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGQpLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5jb21tYW5kU3RydWN0dXJlKSxcbiAgICAgIHRlYXJkb3duOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmhlYWx0aENoZWNrXCIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRIZWFsdGhDaGVjayh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9LmNvbW1hbmQgbXVzdCBiZSBhIHN0cmluZy5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbW1hbmQ6IGRhdGEuY29tbWFuZC50cmltKCksXG4gICAgICBwb3NpdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBvc2l0aXZlUmVzcG9uc2UgPz8gZGF0YS5wb3NpdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wicG9zaXRpdmUgcmVzcG9uc2VcIl0gPz8gZGF0YS5wb3NzaXRpdmVSZXNwb25zZSksXG4gICAgICBuZWdhdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLm5lZ2F0aXZlUmVzcG9uc2UgPz8gZGF0YS5uZWdhdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wibmVnYXRpdmUgcmVzcG9uc2VcIl0pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21RZW11Q29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5xZW11KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgYSBxZW11IGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnFlbXU7XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xuICAgIGlmICghY29uZmlnLmN1c3RvbSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgYSBjdXN0b20gY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcuY3VzdG9tO1xuICB9XG5cbiAgcHJpdmF0ZSBydW50aW1lRXhlY3V0YWJsZShjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBzdHJpbmcge1xuICAgIGlmIChjb25maWcuZXhlY3V0YWJsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmV4ZWN1dGFibGUudHJpbSgpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgPyBcInBvZG1hblwiIDogXCJkb2NrZXJcIjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSGVhbHRoQ2hlY2soXG4gICAgaGVhbHRoQ2hlY2s6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaGVhbHRoQ2hlY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGhlYWx0aENoZWNrLmNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgY29uc3QgY29tYmluZWRPdXRwdXQgPSBgJHtyZXN1bHQuc3Rkb3V0fVxcbiR7cmVzdWx0LnN0ZGVycn1gO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlICYmIGNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gcmV0dXJuZWQgbmVnYXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UgJiYgIWNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZGlkIG5vdCByZXR1cm4gcG9zaXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICBjb21tYW5kOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghY29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ29tbWFuZExpbmUoXG4gICAgY29tbWFuZDogc3RyaW5nLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJ0cyA9IHNwbGl0Q29tbWFuZExpbmUoY29tbWFuZCk7XG4gICAgaWYgKCFwYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBjb21tYW5kIGlzIGVtcHR5LmApO1xuICAgIH1cbiAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBwYXJ0c1swXSxcbiAgICAgIGFyZ3M6IHBhcnRzLnNsaWNlKDEpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgZXhpc3RpbmdQaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmIChleGlzdGluZ1BpZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcoZXhpc3RpbmdQaWQpKSB7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChleGlzdGluZ1BpZCkge1xuICAgICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gbWFuYWdlci5leGVjdXRhYmxlIHx8IFwicWVtdS1zeXN0ZW0teDg2XzY0XCI7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoLCBtYW5hZ2VyKTtcbiAgICBpZiAoIWFyZ3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IG5lZWRzIHFlbXUubWFuYWdlci5hcmdzIG9yIHFlbXUubWFuYWdlci5pbWFnZS5gKTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2dQYXRoID0gbWFuYWdlci5sb2dGaWxlID8gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIubG9nRmlsZSkgOiBudWxsO1xuICAgIGNvbnN0IGxvZ0ZkID0gbG9nUGF0aCA/IG9wZW5TeW5jKGxvZ1BhdGgsIFwiYVwiKSA6IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgICBjd2Q6IGdyb3VwUGF0aCxcbiAgICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIl0sXG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgY2hpbGQudW5yZWYoKTtcblxuICAgICAgaWYgKCFjaGlsZC5waWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VIG1hbmFnZXIgZm9yICR7Z3JvdXBOYW1lfSBkaWQgbm90IHJldHVybiBhIHByb2Nlc3MgaWQuYCk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHdyaXRlRmlsZShwaWRQYXRoLCBgJHtjaGlsZC5waWR9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKGxvZ0ZkICE9IG51bGwpIHtcbiAgICAgICAgY2xvc2VTeW5jKGxvZ0ZkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkTWFuYWdlZFFlbXVBcmdzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUobWFuYWdlci5hcmdzIHx8IFwiXCIpO1xuICAgIGlmIChtYW5hZ2VyLmltYWdlKSB7XG4gICAgICBjb25zdCBpbWFnZVBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5pbWFnZSk7XG4gICAgICBhcmdzLnB1c2goXCItZHJpdmVcIiwgYGZpbGU9JHtpbWFnZVBhdGh9LGlmPXZpcnRpbyxmb3JtYXQ9JHttYW5hZ2VyLmltYWdlRm9ybWF0IHx8IFwicWNvdzJcIn1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGFyZ3M7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBxZW11OiBsb29tUWVtdUNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghcWVtdS5oZWFsdGhDaGVjaykge1xuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKG1hbmFnZXIuYm9vdERlbGF5TXMgPz8gMCwgc2lnbmFsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0aW1lb3V0ID0gTWF0aC5taW4obWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXMgPz8gNjBfMDAwLCBNYXRoLm1heCh0aW1lb3V0TXMsIDEpKTtcbiAgICBjb25zdCBpbnRlcnZhbCA9IG1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNcyA/PyAxXzAwMDtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIGxldCBsYXN0RXJyb3IgPSBcIlwiO1xuXG4gICAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPD0gdGltZW91dCkge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIHdhaXQgY2FuY2VsbGVkLmApO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgTWF0aC5taW4oaW50ZXJ2YWwsIHRpbWVvdXQpLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6cmVhZHlgLCBgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIGNoZWNrYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxhc3RFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKGludGVydmFsLCBzaWduYWwpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gZGlkIG5vdCBiZWNvbWUgcmVhZHkgd2l0aGluICR7dGltZW91dH0gbXMke2xhc3RFcnJvciA/IGA6ICR7bGFzdEVycm9yfWAgOiBcIi5cIn1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCB8fCBtYW5hZ2VyLnBlcnNpc3QgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG1hbmFnZXIuc2h1dGRvd25Db21tYW5kKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICAgICAgbWFuYWdlci5zaHV0ZG93bkNvbW1hbmQsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgTWF0aC5taW4obWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyB0aW1lb3V0TXMsIHRpbWVvdXRNcyksXG4gICAgICAgIHNpZ25hbCxcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzaHV0ZG93bmAsXG4gICAgICAgIGBRRU1VICR7Z3JvdXBOYW1lfSBzaHV0ZG93bmAsXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAodGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIG1hbmFnZXIua2lsbFNpZ25hbCB8fCBcIlNJR1RFUk1cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcHBlZCA9IGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgbWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyAxMF8wMDAsIHNpZ25hbCk7XG4gICAgaWYgKCFzdG9wcGVkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCBcIlNJR0tJTExcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIDJfMDAwLCBzaWduYWwpO1xuICAgIH1cblxuICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgcGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoIXBpZCkge1xuICAgICAgcmV0dXJuIFwic3RvcHBlZFwiO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkgPyBgcnVubmluZyBwaWQgJHtwaWR9YCA6IGBzdGFsZSBwaWQgJHtwaWR9YDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZFBpZEZpbGUocGlkUGF0aDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gKGF3YWl0IHJlYWRGaWxlKHBpZFBhdGgsIFwidXRmOFwiKSkudHJpbSgpO1xuICAgICAgY29uc3QgcGlkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwaWQpICYmIHBpZCA+IDAgPyBwaWQgOiBudWxsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Byb2Nlc3NSdW5uaW5nKHBpZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgdHJ5IHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIDApO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yUHJvY2Vzc0V4aXQocGlkOiBudW1iZXIsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKDI1MCwgc2lnbmFsKTtcbiAgICB9XG4gICAgcmV0dXJuICF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tV3JhcHBlcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgcmVxdWVzdDogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0LFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGN1c3RvbSA9IHRoaXMucmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY3VzdG9tLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206aGVhbHRoYCwgYEN1c3RvbSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICBjb25zdCByZXF1ZXN0RmlsZU5hbWUgPSBgcmVxdWVzdF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9Lmpzb25gO1xuICAgIGNvbnN0IHJlcXVlc3RQYXRoID0gam9pbihncm91cFBhdGgsIHJlcXVlc3RGaWxlTmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0UGF0aCwgYCR7SlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMil9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUoY3VzdG9tLmFyZ3MgfHwgXCJ7cmVxdWVzdH1cIikubWFwKChhcmcpID0+XG4gICAgICAgIGFyZ1xuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie3JlcXVlc3R9XCIsIHJlcXVlc3RQYXRoKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwfVwiLCBncm91cE5hbWUpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXBQYXRofVwiLCBncm91cFBhdGgpLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbToke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBDdXN0b20gJHtncm91cE5hbWV9ICR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgZXhlY3V0YWJsZTogY3VzdG9tLmV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3MsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBzaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0ocmVxdWVzdFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVDdXN0b21SZXF1ZXN0KFxuICAgIGFjdGlvbjogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0W1wiYWN0aW9uXCJdLFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBleHRyYTogUGFydGlhbDxsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Q+ID0ge30sXG4gICk6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIHJ1bnRpbWU6IGNvbmZpZy5ydW50aW1lLFxuICAgICAgaW1hZ2U6IGNvbmZpZy5pbWFnZSxcbiAgICAgIGJ1aWxkOiBjb25maWcuY3VzdG9tPy5idWlsZCxcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IGNvbmZpZy5jdXN0b20/LmNvbW1hbmRTdHJ1Y3R1cmUsXG4gICAgICB0ZWFyZG93bjogY29uZmlnLmN1c3RvbT8udGVhcmRvd24sXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBjb25maWc6IHtcbiAgICAgICAgZXhlY3V0YWJsZTogY29uZmlnLmV4ZWN1dGFibGUsXG4gICAgICAgIGN1c3RvbTogY29uZmlnLmN1c3RvbSxcbiAgICAgICAgcWVtdTogY29uZmlnLnFlbXUsXG4gICAgICAgIGhlYWx0aENoZWNrOiBjb25maWcuaGVhbHRoQ2hlY2ssXG4gICAgICB9LFxuICAgICAgLi4uZXh0cmEsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3ludGhldGljUmVzdWx0KHJ1bm5lcklkOiBzdHJpbmcsIHJ1bm5lck5hbWU6IHN0cmluZywgc3Rkb3V0OiBzdHJpbmcsIHN1Y2Nlc3MgPSB0cnVlKTogbG9vbVJ1blJlc3VsdCB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiB7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBzdGFydGVkQXQ6IG5vdyxcbiAgICAgIGZpbmlzaGVkQXQ6IG5vdyxcbiAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICBleGl0Q29kZTogc3VjY2VzcyA/IDAgOiAtMSxcbiAgICAgIHN0ZG91dCxcbiAgICAgIHN0ZGVycjogXCJcIixcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldENvbnRhaW5lcnNQYXRoKCk6IHN0cmluZyB7XG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbihhZGFwdGVyQmFzZVBhdGgsIHRoaXMucGx1Z2luRGlyLCBcImNvbnRhaW5lcnNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlTmFtZSA9IGJhc2VuYW1lKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFzYWZlTmFtZSB8fCBzYWZlTmFtZSAhPT0gZ3JvdXBOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29udGFpbmVyIGdyb3VwIG5hbWU6ICR7Z3JvdXBOYW1lfWApO1xuICAgIH1cbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4odGhpcy5nZXRDb250YWluZXJzUGF0aCgpLCBzYWZlTmFtZSkpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGg6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZVBhdGggPSBub3JtYWxpemVGc1BhdGgoam9pbihncm91cFBhdGgsIGZpbGVQYXRoKSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZEdyb3VwUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IHBvc2l4U2FmZVBhdGggPSBzYWZlUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBjb25zdCBwb3NpeEdyb3VwUGF0aCA9IG5vcm1hbGl6ZWRHcm91cFBhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgaWYgKHBvc2l4U2FmZVBhdGggIT09IHBvc2l4R3JvdXBQYXRoICYmICFwb3NpeFNhZmVQYXRoLnN0YXJ0c1dpdGgoYCR7cG9zaXhHcm91cFBhdGh9L2ApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBzYWZlUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cblxuICBwdWJsaWMgZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdJZDogc3RyaW5nLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCB7XG4gICAgaWYgKCFsYW5nSWQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBsYW5nSWQudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgICAvLyBDaGVjayBjdXN0b20gbGFuZ3VhZ2VzIGZpcnN0XG4gICAgY29uc3QgY3VzdG9tID0gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGMpID0+IHtcbiAgICAgIGNvbnN0IG5hbWVzID0gW2MubmFtZSwgLi4uYy5hbGlhc2VzLnNwbGl0KFwiLFwiKS5tYXAoKHMpID0+IHMudHJpbSgpKV0ubWFwKChuKSA9PiBuLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgcmV0dXJuIG5hbWVzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICAgIGlmIChjdXN0b20pIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbW1hbmQ6IGAke2N1c3RvbS5leGVjdXRhYmxlfSAke2N1c3RvbS5hcmdzfWAudHJpbSgpLFxuICAgICAgICBleHRlbnNpb246IGN1c3RvbS5leHRlbnNpb24gfHwgXCIudHh0XCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFN0YW5kYXJkIGJ1aWx0LWluc1xuICAgIHN3aXRjaCAobm9ybWFsaXplZCkge1xuICAgICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgY2FzZSBcInB5XCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICAgIGNhc2UgXCJqc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgY2FzZSBcInRzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInRzLW5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnRzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic2hlbGxcIjpcbiAgICAgIGNhc2UgXCJzaFwiOlxuICAgICAgY2FzZSBcImJhc2hcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYmFzaFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc2hcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydWJ5XCI6XG4gICAgICBjYXNlIFwicmJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydWJ5XCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yYlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBlcmxcIjpcbiAgICAgIGNhc2UgXCJwbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBlcmxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInBlcmxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibHVhXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubHVhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsdWFcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmx1YVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBocFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBocEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGhwXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJnb1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmdvRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnb1wifSBydW4ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmdvXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgY2FzZSBcImhzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVuZ2hjXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICBjYXNlIFwibWxcIjpcbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImR1bmVcIn0gZXhlYyAtLSBvY2FtbCB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJvY2FtbGNcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm9jYW1sY1wifSAtbyAvdG1wL2xvb20tb2NhbWwgXCIkMVwiICYmIC90bXAvbG9vbS1vY2FtbGApLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnY2NcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jICYmIC90bXAvbG9vbS1jYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY3BwXCI6XG4gICAgICBjYXNlIFwiYysrXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZysrXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tY3BwICYmIC90bXAvbG9vbS1jcHBgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNwcFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImVicGZcIjpcbiAgICAgIGNhc2UgXCJlYnBmLWNcIjpcbiAgICAgIGNhc2UgXCJicGZcIjpcbiAgICAgIGNhc2UgXCJicGYtY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5lYnBmQ2xhbmdFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImNsYW5nXCJ9IC10YXJnZXQgYnBmIC1PMiAtZyAtV2FsbCBcIiQxXCIgLWMgLW8gL3RtcC9sb29tLWVicGYubyAmJiBwcmludGYgJ2NvbXBpbGVkIC90bXAvbG9vbS1lYnBmLm9cXFxcbidgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmJwZi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiYnBmdHJhY2VcIjpcbiAgICAgIGNhc2UgXCJidFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmJwZnRyYWNlRXhlY3V0YWJsZS50cmltKCkgfHwgXCJicGZ0cmFjZVwifSAtZCB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuYnRcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydXN0XCI6XG4gICAgICBjYXNlIFwicnNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVzdGNcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1ydXN0ICYmIC90bXAvbG9vbS1ydXN0YCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFcIjoge1xuICAgICAgICBjb25zdCBjb21waWxlciA9IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwiamF2YWNcIjtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYHRtcD0vdG1wL2xvb20tamF2YS0kJCAmJiBta2RpciAtcCBcIiR0bXBcIiAmJiBjcCBcIiQxXCIgXCIkdG1wL01haW4uamF2YVwiICYmICR7Y29tcGlsZXJ9IFwiJHRtcC9NYWluLmphdmFcIiAmJiAke3NldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImphdmFcIn0gLWNwIFwiJHRtcFwiIE1haW5gKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmphdmFcIixcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICBjYXNlIFwibGx2bVwiOlxuICAgICAgY2FzZSBcImxsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsbGlcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmxsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibGVhblwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImxlYW5cIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmxlYW5cIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjb3FcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImNvcWNcIn0gLXEge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnZcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJzbXRsaWJcIjpcbiAgICAgIGNhc2UgXCJzbXRcIjpcbiAgICAgIGNhc2UgXCJzbXQtbGliXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkgfHwgXCJ6M1wifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc210MlwiLFxuICAgICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBzaGVsbENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBzaCAtbGMgJHtxdW90ZUNvbW1hbmRBcmcoY29tbWFuZCl9IHNoIHtmaWxlfWA7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0RvY2tlck5vdGljZShtZXNzYWdlOiBzdHJpbmcpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShtZXNzYWdlLCA4MDAwKTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXIuYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbE5vbk5lZ2F0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsU2lnbmFsKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogTm9kZUpTLlNpZ25hbHMgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCAhL15TSUdbQS1aMC05XSskLy50ZXN0KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIHNpZ25hbCBuYW1lIGxpa2UgU0lHVEVSTS5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgTm9kZUpTLlNpZ25hbHM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNsZWVwV2l0aFNpZ25hbChkdXJhdGlvbk1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKGR1cmF0aW9uTXMgPD0gMCB8fCBzaWduYWwuYWJvcnRlZCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQocmVzb2x2ZSwgZHVyYXRpb25Ncyk7XG4gICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfTtcbiAgICBzaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBydW50aW1lTGFiZWwocnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKHJ1bnRpbWUpIHtcbiAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICByZXR1cm4gXCJEb2NrZXJcIjtcbiAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICByZXR1cm4gXCJQb2RtYW5cIjtcbiAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgcmV0dXJuIFwiUUVNVVwiO1xuICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgIHJldHVybiBcIkN1c3RvbVwiO1xuICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgIHJldHVybiBcIldTTFwiO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsUXVvdGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZUFsbChcIidcIiwgXCInXFxcXCcnXCIpfSdgO1xufVxuXG5mdW5jdGlvbiBxdW90ZUNvbW1hbmRBcmcodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZUFsbChcIidcIiwgXCInXFxcXCcnXCIpfSdgO1xufVxuIiwgImltcG9ydCB7IG1rZHRlbXAsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gXCJvc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21SdW5SZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tUHJvY2Vzc1NwZWMge1xuICBydW5uZXJJZDogc3RyaW5nO1xuICBydW5uZXJOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG4gIHNpZ25hbDogQWJvcnRTaWduYWw7XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlU3BlYyBleHRlbmRzIGxvb21Qcm9jZXNzU3BlYyB7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRlbXBTb3VyY2VIYW5kbGUge1xuICB0ZW1wRGlyOiBzdHJpbmc7XG4gIHRlbXBGaWxlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZTxUPihcbiAgZmlsZU5hbWU6IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tXCIpKTtcbiAgY29uc3QgdGVtcEZpbGUgPSBqb2luKHRlbXBEaXIsIGZpbGVOYW1lKTtcblxuICB0cnkge1xuICAgIGF3YWl0IHdyaXRlRmlsZSh0ZW1wRmlsZSwgbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2UpLCBcInV0ZjhcIik7XG4gICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKHsgdGVtcERpciwgdGVtcEZpbGUgfSk7XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3aXRoVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVFeHRlbnNpb246IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoaGFuZGxlOiBsb29tVGVtcFNvdXJjZUhhbmRsZSkgPT4gUHJvbWlzZTxUPixcbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoYHNuaXBwZXQke2ZpbGVFeHRlbnNpb259YCwgc291cmNlLCBjYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcbiAgY29uc3Qgbm9uRW1wdHlMaW5lcyA9IGxpbmVzLmZpbHRlcigobGluZSkgPT4gbGluZS50cmltKCkubGVuZ3RoID4gMCk7XG4gIGlmICghbm9uRW1wdHlMaW5lcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgbGV0IHNoYXJlZEluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKG5vbkVtcHR5TGluZXNbMF0pO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygbm9uRW1wdHlMaW5lcy5zbGljZSgxKSkge1xuICAgIHNoYXJlZEluZGVudCA9IHNoYXJlZFdoaXRlc3BhY2VQcmVmaXgoc2hhcmVkSW5kZW50LCBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKSk7XG4gICAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICAgIHJldHVybiBzb3VyY2U7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFzaGFyZWRJbmRlbnQpIHtcbiAgICByZXR1cm4gc291cmNlO1xuICB9XG5cbiAgcmV0dXJuIGxpbmVzXG4gICAgLm1hcCgobGluZSkgPT4gKGxpbmUudHJpbSgpLmxlbmd0aCA9PT0gMCA/IGxpbmUgOiBsaW5lLnN0YXJ0c1dpdGgoc2hhcmVkSW5kZW50KSA/IGxpbmUuc2xpY2Uoc2hhcmVkSW5kZW50Lmxlbmd0aCkgOiBsaW5lKSlcbiAgICAuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eW1xcdCBdKi8pO1xuICByZXR1cm4gbWF0Y2g/LlswXSA/PyBcIlwiO1xufVxuXG5mdW5jdGlvbiBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KGxlZnQ6IHN0cmluZywgcmlnaHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBpbmRleCA9IDA7XG4gIHdoaWxlIChpbmRleCA8IGxlZnQubGVuZ3RoICYmIGluZGV4IDwgcmlnaHQubGVuZ3RoICYmIGxlZnRbaW5kZXhdID09PSByaWdodFtpbmRleF0pIHtcbiAgICBpbmRleCArPSAxO1xuICB9XG4gIHJldHVybiBsZWZ0LnNsaWNlKDAsIGluZGV4KTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blByb2Nlc3Moc3BlYzogbG9vbVByb2Nlc3NTcGVjKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gIGNvbnN0IHN0YXJ0ZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGxldCBzdGRvdXQgPSBcIlwiO1xuICBsZXQgc3RkZXJyID0gXCJcIjtcbiAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVkT3V0ID0gZmFsc2U7XG4gIGxldCBjYW5jZWxsZWQgPSBmYWxzZTtcbiAgbGV0IGNoaWxkOiBSZXR1cm5UeXBlPHR5cGVvZiBzcGF3bj4gfCBudWxsID0gbnVsbDtcbiAgbGV0IHRpbWVvdXRIYW5kbGU6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIGxldCBhYm9ydEhhbmRsZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY2hpbGQgPSBzcGF3bihzcGVjLmV4ZWN1dGFibGUsIHNwZWMuYXJncywge1xuICAgICAgICBjd2Q6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgc2hlbGw6IGZhbHNlLFxuICAgICAgICBlbnY6IHtcbiAgICAgICAgICAuLi5wcm9jZXNzLmVudixcbiAgICAgICAgICAuLi5zcGVjLmVudixcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcbiAgICAgICAgY2FuY2VsbGVkID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfTtcbiAgICAgIGFib3J0SGFuZGxlciA9IGFib3J0O1xuXG4gICAgICBpZiAoc3BlYy5zaWduYWwuYWJvcnRlZCkge1xuICAgICAgICBhYm9ydCgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3BlYy5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0LCB7IG9uY2U6IHRydWUgfSk7XG4gICAgICB9XG5cbiAgICAgIHRpbWVvdXRIYW5kbGUgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGltZWRPdXQgPSB0cnVlO1xuICAgICAgICBjaGlsZD8ua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICB9LCBzcGVjLnRpbWVvdXRNcyk7XG5cbiAgICAgIGNoaWxkLnN0ZG91dD8ub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgICBzdGRvdXQgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5zdGRlcnI/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3RkZXJyICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XG4gICAgICAgIGV4aXRDb2RlID0gY29kZTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgc3RkZXJyID0gc3RkZXJyIHx8IGZvcm1hdFByb2Nlc3NFcnJvcihlcnJvciwgc3BlYy5leGVjdXRhYmxlKTtcbiAgICBleGl0Q29kZSA9IGV4aXRDb2RlID8/IC0xO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChhYm9ydEhhbmRsZXIpIHtcbiAgICAgIHNwZWMuc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydEhhbmRsZXIpO1xuICAgIH1cbiAgICBpZiAodGltZW91dEhhbmRsZSkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXRIYW5kbGUpO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGZpbmlzaGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBkdXJhdGlvbk1zID0gZmluaXNoZWRBdC5nZXRUaW1lKCkgLSBzdGFydGVkQXQuZ2V0VGltZSgpO1xuICBjb25zdCBzdWNjZXNzID0gIXRpbWVkT3V0ICYmICFjYW5jZWxsZWQgJiYgZXhpdENvZGUgPT09IDA7XG5cbiAgcmV0dXJuIHtcbiAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICBydW5uZXJOYW1lOiBzcGVjLnJ1bm5lck5hbWUsXG4gICAgc3RhcnRlZEF0OiBzdGFydGVkQXQudG9JU09TdHJpbmcoKSxcbiAgICBmaW5pc2hlZEF0OiBmaW5pc2hlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZHVyYXRpb25NcyxcbiAgICBleGl0Q29kZSxcbiAgICBzdGRvdXQsXG4gICAgc3RkZXJyLFxuICAgIHN1Y2Nlc3MsXG4gICAgdGltZWRPdXQsXG4gICAgY2FuY2VsbGVkLFxuICB9O1xufVxuXG5mdW5jdGlvbiBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3I6IHVua25vd24sIGV4ZWN1dGFibGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIFwiY29kZVwiIGluIGVycm9yICYmIChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICByZXR1cm4gYEV4ZWN1dGFibGUgbm90IGZvdW5kOiAke2V4ZWN1dGFibGV9YDtcbiAgfVxuXG4gIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5UZW1wRmlsZVByb2Nlc3Moc3BlYzogbG9vbVRlbXBTb3VyY2VTcGVjKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoc3BlYy5maWxlRXh0ZW5zaW9uLCBzcGVjLnNvdXJjZSwgYXN5bmMgKHsgdGVtcEZpbGUsIHRlbXBEaXIgfSkgPT5cbiAgICBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBzcGVjLnJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc3BlYy5leGVjdXRhYmxlLFxuICAgICAgYXJnczogc3BlYy5hcmdzLm1hcCgodmFsdWUpID0+IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogc3BlYy53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBzcGVjLnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogc3BlYy5zaWduYWwsXG4gICAgICBlbnY6IGV4cGFuZFRlbXBsYXRlZEVudihzcGVjLmVudiwgdGVtcEZpbGUsIHRlbXBEaXIpLFxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBleHBhbmRUZW1wbGF0ZWRFbnYoZW52OiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCwgdGVtcEZpbGU6IHN0cmluZywgdGVtcERpcjogc3RyaW5nKTogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQge1xuICBpZiAoIWVudikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGVudikubWFwKChba2V5LCB2YWx1ZV0pID0+IFtcbiAgICAgIGtleSxcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IHZhbHVlLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpLnJlcGxhY2VBbGwoXCJ7dGVtcERpcn1cIiwgdGVtcERpcikgOiB2YWx1ZSxcbiAgICBdKSxcbiAgKTtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gc3BsaXRDb21tYW5kTGluZShpbnB1dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSBcIlwiO1xuICBsZXQgcXVvdGU6IFwiJ1wiIHwgXCJcXFwiXCIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGVzY2FwaW5nID0gZmFsc2U7XG5cbiAgZm9yIChjb25zdCBjaGFyIG9mIGlucHV0LnRyaW0oKSkge1xuICAgIGlmIChlc2NhcGluZykge1xuICAgICAgY3VycmVudCArPSBjaGFyO1xuICAgICAgZXNjYXBpbmcgPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBcIlxcXFxcIikge1xuICAgICAgZXNjYXBpbmcgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKChjaGFyID09PSBcIidcIiB8fCBjaGFyID09PSBcIlxcXCJcIikgJiYgIXF1b3RlKSB7XG4gICAgICBxdW90ZSA9IGNoYXI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGNoYXIpICYmICFxdW90ZSkge1xuICAgICAgaWYgKGN1cnJlbnQpIHtcbiAgICAgICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9IFwiXCI7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjdXJyZW50ICs9IGNoYXI7XG4gIH1cblxuICBpZiAoY3VycmVudCkge1xuICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gIH1cblxuICByZXR1cm4gcGFydHM7XG59XG4iLCAiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBub3JtYWxpemVQYXRoLCB0eXBlIEFwcCwgdHlwZSBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgTm90ZUV4ZWN1dGlvbkNvbnRleHQge1xuICBjb250YWluZXJHcm91cD86IHN0cmluZztcbiAgZGlzYWJsZUNvbnRhaW5lcj86IGJvb2xlYW47XG4gIHdvcmtpbmdEaXJlY3Rvcnk/OiBzdHJpbmc7XG4gIHRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVFeGVjdXRpb25Db250ZXh0KFxuICBhcHA6IEFwcCxcbiAgZmlsZTogVEZpbGUsXG4gIGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuKTogbG9vbVJlc29sdmVkRXhlY3V0aW9uQ29udGV4dCB7XG4gIGNvbnN0IG5vdGUgPSByZWFkTm90ZUV4ZWN1dGlvbkNvbnRleHQoYXBwLCBmaWxlKTtcbiAgY29uc3QgZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkgPSByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZSwgc2V0dGluZ3MpO1xuICBjb25zdCBub3RlV29ya2luZ0RpcmVjdG9yeSA9IG5vcm1hbGl6ZVdvcmtpbmdEaXJlY3Rvcnkobm90ZS53b3JraW5nRGlyZWN0b3J5KTtcbiAgY29uc3QgYmxvY2tXb3JraW5nRGlyZWN0b3J5ID0gbm9ybWFsaXplV29ya2luZ0RpcmVjdG9yeShibG9jay5leGVjdXRpb25Db250ZXh0LndvcmtpbmdEaXJlY3RvcnkpO1xuICBjb25zdCBub3RlVGltZW91dCA9IG5vdGUudGltZW91dE1zO1xuICBjb25zdCBibG9ja1RpbWVvdXQgPSBibG9jay5leGVjdXRpb25Db250ZXh0LnRpbWVvdXRNcztcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiByZXNvbHZlQ29udGFpbmVyR3JvdXAoc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwLCBub3RlLCBibG9jay5leGVjdXRpb25Db250ZXh0KSxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBibG9ja1dvcmtpbmdEaXJlY3RvcnkgPz8gbm90ZVdvcmtpbmdEaXJlY3RvcnkgPz8gZGVmYXVsdFdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zOiBibG9ja1RpbWVvdXQgPz8gbm90ZVRpbWVvdXQgPz8gc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICBzb3VyY2U6IHtcbiAgICAgIGNvbnRhaW5lcjogcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShzZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAsIG5vdGUsIGJsb2NrLmV4ZWN1dGlvbkNvbnRleHQpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogYmxvY2tXb3JraW5nRGlyZWN0b3J5ID8gXCJibG9ja1wiIDogbm90ZVdvcmtpbmdEaXJlY3RvcnkgPyBcIm5vdGVcIiA6IHNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpID8gXCJnbG9iYWxcIiA6IFwiZGVmYXVsdFwiLFxuICAgICAgdGltZW91dDogYmxvY2tUaW1lb3V0ID8gXCJibG9ja1wiIDogbm90ZVRpbWVvdXQgPyBcIm5vdGVcIiA6IFwiZ2xvYmFsXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lckdyb3VwKFxuICBnbG9iYWxDb250YWluZXI6IHN0cmluZyxcbiAgbm90ZTogTm90ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGJsb2NrOiBsb29tRXhlY3V0aW9uQ29udGV4dE92ZXJyaWRlLFxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKGJsb2NrLmRpc2FibGVDb250YWluZXIpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIGJsb2NrLmNvbnRhaW5lckdyb3VwLnRyaW0oKTtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAobm90ZS5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIG5vdGUuY29udGFpbmVyR3JvdXAudHJpbSgpO1xuICB9XG4gIHJldHVybiBnbG9iYWxDb250YWluZXIudHJpbSgpIHx8IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvbnRhaW5lclNvdXJjZShcbiAgZ2xvYmFsQ29udGFpbmVyOiBzdHJpbmcsXG4gIG5vdGU6IE5vdGVFeGVjdXRpb25Db250ZXh0LFxuICBibG9jazogbG9vbUV4ZWN1dGlvbkNvbnRleHRPdmVycmlkZSxcbik6IGxvb21SZXNvbHZlZEV4ZWN1dGlvbkNvbnRleHRbXCJzb3VyY2VcIl1bXCJjb250YWluZXJcIl0ge1xuICBpZiAoYmxvY2suZGlzYWJsZUNvbnRhaW5lciB8fCBibG9jay5jb250YWluZXJHcm91cD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIFwiYmxvY2tcIjtcbiAgfVxuICBpZiAobm90ZS5kaXNhYmxlQ29udGFpbmVyIHx8IG5vdGUuY29udGFpbmVyR3JvdXA/LnRyaW0oKSkge1xuICAgIHJldHVybiBcIm5vdGVcIjtcbiAgfVxuICBpZiAoZ2xvYmFsQ29udGFpbmVyLnRyaW0oKSkge1xuICAgIHJldHVybiBcImdsb2JhbFwiO1xuICB9XG4gIHJldHVybiBcIm5vbmVcIjtcbn1cblxuZnVuY3Rpb24gcmVhZE5vdGVFeGVjdXRpb25Db250ZXh0KGFwcDogQXBwLCBmaWxlOiBURmlsZSk6IE5vdGVFeGVjdXRpb25Db250ZXh0IHtcbiAgY29uc3QgZnJvbnRtYXR0ZXIgPSBhcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICBpZiAoIWZyb250bWF0dGVyKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgY29uc3QgY29udGFpbmVyID0gZnJvbnRtYXR0ZXJbXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGZyb250bWF0dGVyW1wibG9vbS1jd2RcIl0gPz8gZnJvbnRtYXR0ZXJbXCJsb29tLXdvcmtpbmctZGlyZWN0b3J5XCJdO1xuICBjb25zdCB0aW1lb3V0ID0gZnJvbnRtYXR0ZXJbXCJsb29tLXRpbWVvdXRcIl07XG5cbiAgcmV0dXJuIHtcbiAgICBjb250YWluZXJHcm91cDogdHlwZW9mIGNvbnRhaW5lciA9PT0gXCJzdHJpbmdcIiAmJiAhaXNEaXNhYmxlZFZhbHVlKGNvbnRhaW5lcikgPyBjb250YWluZXIudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IHR5cGVvZiBjb250YWluZXIgPT09IFwic3RyaW5nXCIgPyBpc0Rpc2FibGVkVmFsdWUoY29udGFpbmVyKSA6IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiB0eXBlb2Ygd29ya2luZ0RpcmVjdG9yeSA9PT0gXCJzdHJpbmdcIiA/IHdvcmtpbmdEaXJlY3RvcnkgOiB1bmRlZmluZWQsXG4gICAgdGltZW91dE1zOiB0eXBlb2YgdGltZW91dCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodGltZW91dCkgJiYgdGltZW91dCA+IDBcbiAgICAgID8gTWF0aC50cnVuYyh0aW1lb3V0KVxuICAgICAgOiB0eXBlb2YgdGltZW91dCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHBhcnNlUG9zaXRpdmVJbnRlZ2VyKHRpbWVvdXQpXG4gICAgICAgIDogdW5kZWZpbmVkLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlRGVmYXVsdFdvcmtpbmdEaXJlY3RvcnkoZmlsZTogVEZpbGUsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBpZiAoc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChzZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSk7XG4gIH1cblxuICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAoZmlsZS52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgY29uc3QgZmlsZUZvbGRlciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgY29uc3QgcmVzb2x2ZWQgPSBmaWxlRm9sZGVyID09PSBcIi5cIiA/IGFkYXB0ZXJCYXNlUGF0aCA6IGAke2FkYXB0ZXJCYXNlUGF0aH0vJHtmaWxlRm9sZGVyfWA7XG4gIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JraW5nRGlyZWN0b3J5KHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWU/LnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VQb3NpdGl2ZUludGVnZXIodmFsdWU6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgcmV0dXJuIE51bWJlci5pc0ludGVnZXIocGFyc2VkKSAmJiBwYXJzZWQgPiAwID8gcGFyc2VkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBpc0Rpc2FibGVkVmFsdWUodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiMFwiLCBcImZhbHNlXCIsIFwibm9cIiwgXCJvZmZcIiwgXCJub25lXCIsIFwibmF0aXZlXCJdLmluY2x1ZGVzKHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbn1cbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHR5cGUgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBMbHZtVG9rZW4ge1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xufVxuXG5jb25zdCBMTFZNX0tFWVdPUkRTID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oW1xuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbnRyb2xcIiwgW1xuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1kZWNsYXJhdGlvblwiLCBbXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxuICAgIFwicGVyc29uYWxpdHlcIiwgXCJ1c2VsaXN0b3JkZXJcIiwgXCJ1c2VsaXN0b3JkZXJfYmJcIiwgXCJtb2R1bGVcIiwgXCJhc21cIiwgXCJzb3VyY2VfZmlsZW5hbWVcIiwgXCJ0YXJnZXRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcbiAgICBcImFsbG9jYVwiLCBcImxvYWRcIiwgXCJzdG9yZVwiLCBcImdldGVsZW1lbnRwdHJcIiwgXCJmZW5jZVwiLCBcImNtcHhjaGdcIiwgXCJhdG9taWNybXdcIiwgXCJleHRyYWN0dmFsdWVcIiwgXCJpbnNlcnR2YWx1ZVwiLCBcImV4dHJhY3RlbGVtZW50XCIsXG4gICAgXCJpbnNlcnRlbGVtZW50XCIsIFwic2h1ZmZsZXZlY3RvclwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1hcml0aG1ldGljXCIsIFtcbiAgICBcImFkZFwiLCBcInN1YlwiLCBcIm11bFwiLCBcInVkaXZcIiwgXCJzZGl2XCIsIFwidXJlbVwiLCBcInNyZW1cIiwgXCJzaGxcIiwgXCJsc2hyXCIsIFwiYXNoclwiLCBcImFuZFwiLCBcIm9yXCIsIFwieG9yXCIsIFwiZm5lZ1wiLCBcImZhZGRcIiwgXCJmc3ViXCIsIFwiZm11bFwiLFxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29tcGFyaXNvblwiLCBbXCJpY21wXCIsIFwiZmNtcFwiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXG4gICAgXCJ0cnVuY1wiLCBcInpleHRcIiwgXCJzZXh0XCIsIFwiZnB0cnVuY1wiLCBcImZwZXh0XCIsIFwiZnB0b3VpXCIsIFwiZnB0b3NpXCIsIFwidWl0b2ZwXCIsIFwic2l0b2ZwXCIsIFwicHRydG9pbnRcIiwgXCJpbnR0b3B0clwiLCBcImJpdGNhc3RcIiwgXCJhZGRyc3BhY2VjYXN0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tb2RpZmllclwiLCBbXG4gICAgXCJwcml2YXRlXCIsIFwiaW50ZXJuYWxcIiwgXCJhdmFpbGFibGVfZXh0ZXJuYWxseVwiLCBcImxpbmtvbmNlXCIsIFwid2Vha1wiLCBcImNvbW1vblwiLCBcImFwcGVuZGluZ1wiLCBcImV4dGVybl93ZWFrXCIsIFwibGlua29uY2Vfb2RyXCIsIFwid2Vha19vZHJcIixcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcbiAgICBcInRocmVhZF9sb2NhbFwiLCBcImxvY2FsZHluYW1pY1wiLCBcImluaXRpYWxleGVjXCIsIFwibG9jYWxleGVjXCIsIFwidW5uYW1lZF9hZGRyXCIsIFwibG9jYWxfdW5uYW1lZF9hZGRyXCIsIFwiYXRvbWljXCIsIFwidW5vcmRlcmVkXCIsIFwibW9ub3RvbmljXCIsXG4gICAgXCJhY3F1aXJlXCIsIFwicmVsZWFzZVwiLCBcImFjcV9yZWxcIiwgXCJzZXFfY3N0XCIsIFwic3luY3Njb3BlXCIsIFwidm9sYXRpbGVcIiwgXCJzaW5nbGV0aHJlYWRcIiwgXCJjY2NcIiwgXCJmYXN0Y2NcIiwgXCJjb2xkY2NcIiwgXCJ3ZWJraXRfanNjY1wiLFxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxuICAgIFwiZmFzdFwiLCBcIm5uYW5cIiwgXCJuaW5mXCIsIFwibnN6XCIsIFwiYXJjcFwiLCBcImNvbnRyYWN0XCIsIFwiYWZuXCIsIFwicmVhc3NvY1wiLCBcIm51d1wiLCBcIm5zd1wiLCBcImV4YWN0XCIsIFwiaW5ib3VuZHNcIiwgXCJ0b1wiLCBcInhcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXG4gICAgXCJlcVwiLCBcIm5lXCIsIFwidWd0XCIsIFwidWdlXCIsIFwidWx0XCIsIFwidWxlXCIsIFwic2d0XCIsIFwic2dlXCIsIFwic2x0XCIsIFwic2xlXCIsIFwib2VxXCIsIFwib2d0XCIsIFwib2dlXCIsIFwib2x0XCIsIFwib2xlXCIsIFwib25lXCIsIFwib3JkXCIsIFwidWVxXCIsIFwidW5lXCIsXG4gICAgXCJ1bm9cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWF0dHJpYnV0ZVwiLCBbXG4gICAgXCJhbHdheXNpbmxpbmVcIiwgXCJhcmdtZW1vbmx5XCIsIFwiYnVpbHRpblwiLCBcImJ5cmVmXCIsIFwiYnl2YWxcIiwgXCJjb2xkXCIsIFwiY29udmVyZ2VudFwiLCBcImRlcmVmZXJlbmNlYWJsZVwiLCBcImRlcmVmZXJlbmNlYWJsZV9vcl9udWxsXCIsIFwiZGlzdGluY3RcIixcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXG4gICAgXCJub25udWxsXCIsIFwibm9yZWN1cnNlXCIsIFwibm9yZWR6b25lXCIsIFwibm9yZXR1cm5cIiwgXCJub3N5bmNcIiwgXCJub3Vud2luZFwiLCBcIm51bGxfcG9pbnRlcl9pc192YWxpZFwiLCBcIm9wYXF1ZVwiLCBcIm9wdG5vbmVcIiwgXCJvcHRzaXplXCIsXG4gICAgXCJwcmVhbGxvY2F0ZWRcIiwgXCJyZWFkbm9uZVwiLCBcInJlYWRvbmx5XCIsIFwicmV0dXJuZWRcIiwgXCJyZXR1cm5zX3R3aWNlXCIsIFwic2FuaXRpemVfYWRkcmVzc1wiLCBcInNhbml0aXplX2h3YWRkcmVzc1wiLCBcInNhbml0aXplX21lbW9yeVwiLFxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcbiAgICBcIndpbGxyZXR1cm5cIiwgXCJ3cml0ZW9ubHlcIiwgXCJ6ZXJvZXh0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcbl0pO1xuXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xuICBcInZvaWRcIiwgXCJsYWJlbFwiLCBcInRva2VuXCIsIFwibWV0YWRhdGFcIiwgXCJ4ODZfbW14XCIsIFwieDg2X2FteFwiLCBcImhhbGZcIiwgXCJiZmxvYXRcIiwgXCJmbG9hdFwiLCBcImRvdWJsZVwiLCBcImZwMTI4XCIsIFwieDg2X2ZwODBcIiwgXCJwcGNfZnAxMjhcIiwgXCJwdHJcIixcbl0pO1xuXG5jb25zdCBQVU5DVFVBVElPTl9DTEFTUyA9IFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvZGVFbGVtZW50LmVtcHR5KCk7XG4gIGNvZGVFbGVtZW50LmFkZENsYXNzKFwibG9vbS1sbHZtLWNvZGVcIik7XG5cbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGxpbmVzLmZvckVhY2goKGxpbmUsIGluZGV4KSA9PiB7XG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcbiAgICBpZiAoaW5kZXggPCBsaW5lcy5sZW5ndGggLSAxKSB7XG4gICAgICBjb2RlRWxlbWVudC5hcHBlbmRUZXh0KFwiXFxuXCIpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMbHZtRGVjb3JhdGlvbnMoXG4gIGJ1aWxkZXI6IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPixcbiAgdmlldzogRWRpdG9yVmlldyxcbiAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xuICBpZiAoIWNvbnRlbnRMaW5lQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XSA/PyBcIlwiO1xuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplTGx2bUxpbmUobGluZSk7XG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2NMaW5lID0gdmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAyICsgaW5kZXgpO1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4uZnJvbSxcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4udG8sXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xuICAgIGlmICh0b2tlbi5mcm9tID4gY3Vyc29yKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvciwgdG9rZW4uZnJvbSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBjb250YWluZXIuY3JlYXRlU3Bhbih7IGNsczogdG9rZW4uY2xhc3NOYW1lIH0pO1xuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICBpZiAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvcikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xuICBjb25zdCB0b2tlbnM6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBpbmRleCA9IDA7XG5cbiAgYWRkTGFiZWxUb2tlbihsaW5lLCB0b2tlbnMpO1xuXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29uc3QgY3VycmVudCA9IGxpbmVbaW5kZXhdO1xuICAgIGlmIChjdXJyZW50ID09PSBcIjtcIikge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGN1cnJlbnQpKSB7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xuICAgIGlmIChzdHJpbmdUb2tlbikge1xuICAgICAgaWYgKHN0cmluZ1Rva2VuLnByZWZpeEVuZCA+IGluZGV4KSB7XG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xuICAgICAgfVxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBzdHJpbmdUb2tlbi52YWx1ZVN0YXJ0LCB0bzogc3RyaW5nVG9rZW4udmFsdWVFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nXCIgfSk7XG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AbGx2bVxcLltBLVphLXokLl8wLTldKy95LCBcImxvb20tbGx2bS1pbnRyaW5zaWNcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWxvY2FsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyFbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCFcXGQrXFxiL3ksIFwibG9vbS1sbHZtLW1ldGFkYXRhXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyNcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWF0dHJpYnV0ZS1ncm91cFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXGJhZGRyc3BhY2VcXHMqXFwoXFxzKlxcZCtcXHMqXFwpL3ksIFwibG9vbS1sbHZtLXR5cGVcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrfFxcZCspKD86W2VFXVstK10/XFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwuXFwuXFwuL3ksIFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCIsIHRva2Vucyk7XG5cbiAgICBpZiAobWF0Y2hlZCkge1xuICAgICAgaW5kZXggPSBtYXRjaGVkO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgd29yZCA9IHJlYWRXb3JkKGxpbmUsIGluZGV4KTtcbiAgICBpZiAod29yZCkge1xuICAgICAgdG9rZW5zLnB1c2goe1xuICAgICAgICBmcm9tOiBpbmRleCxcbiAgICAgICAgdG86IHdvcmQuZW5kLFxuICAgICAgICBjbGFzc05hbWU6IGNsYXNzaWZ5V29yZCh3b3JkLnZhbHVlKSxcbiAgICAgIH0pO1xuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChcIigpW117fTw+LDo9KlwiLmluY2x1ZGVzKGN1cnJlbnQpKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogaW5kZXggKyAxLCBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTIH0pO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplVG9rZW5zKHRva2Vucyk7XG59XG5cbmZ1bmN0aW9uIGFkZExhYmVsVG9rZW4obGluZTogc3RyaW5nLCB0b2tlbnM6IExsdm1Ub2tlbltdKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXHMqKSg/OihbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfFxcZCspfCglW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkKykpKDopLyk7XG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxhYmVsU3RhcnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IG1hdGNoWzJdID8/IG1hdGNoWzNdO1xuICBpZiAoIWxhYmVsVGV4dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0LFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWxhYmVsXCIsXG4gIH0pO1xuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoICsgMSxcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlXb3JkKHdvcmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXmlcXGQrJC8udGVzdCh3b3JkKSB8fCBMTFZNX1BSSU1JVElWRV9UWVBFUy5oYXMod29yZCkpIHtcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xuICB9XG5cbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9bQS1aYS16X11bQS1aYS16MC05Xy4tXSoveTtcbiAgbWF0Y2gubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiByZXN1bHRbMF0sXG4gICAgZW5kOiBtYXRjaC5sYXN0SW5kZXgsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdUb2tlbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHByZWZpeEVuZDogbnVtYmVyOyB2YWx1ZVN0YXJ0OiBudW1iZXI7IHZhbHVlRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgY3Vyc29yID0gaW5kZXg7XG4gIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiY1wiICYmIGxpbmVbY3Vyc29yICsgMV0gPT09IFwiXFxcIlwiKSB7XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICBpZiAobGluZVtjdXJzb3JdICE9PSBcIlxcXCJcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcbiAgY3Vyc29yICs9IDE7XG4gIHdoaWxlIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XG4gICAgICBjdXJzb3IgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXCJcIikge1xuICAgICAgY3Vyc29yICs9IDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcbiAgICB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlRW5kOiBjdXJzb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcbiAgbGluZTogc3RyaW5nLFxuICBpbmRleDogbnVtYmVyLFxuICByZWdleDogUmVnRXhwLFxuICBjbGFzc05hbWU6IHN0cmluZyxcbiAgdG9rZW5zOiBMbHZtVG9rZW5bXSxcbik6IG51bWJlciB8IG51bGwge1xuICByZWdleC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgbWF0Y2ggPSByZWdleC5leGVjKGxpbmUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogcmVnZXgubGFzdEluZGV4LCBjbGFzc05hbWUgfSk7XG4gIHJldHVybiByZWdleC5sYXN0SW5kZXg7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnM6IExsdm1Ub2tlbltdKTogTGx2bVRva2VuW10ge1xuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcbiAgY29uc3Qgbm9ybWFsaXplZDogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBpZiAodG9rZW4udG8gPD0gY3Vyc29yKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcbiAgICBub3JtYWxpemVkLnB1c2goeyAuLi50b2tlbiwgZnJvbSB9KTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbnVtYmVyIHtcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgaWYgKGJsb2NrLmNvbnRlbnQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGJsb2NrLmVuZExpbmUgPiBibG9jay5zdGFydExpbmUgKyAxID8gMSA6IDA7XG4gIH1cblxuICByZXR1cm4gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIG1hcFdvcmRzKGNsYXNzTmFtZTogc3RyaW5nLCB3b3Jkczogc3RyaW5nW10pOiBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB7XG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvcnRIYXNoKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoaW5wdXQpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZURlZmluaXRpb24ge1xuICBpZDogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgYWxpYXNlczogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbUxhbmd1YWdlUGFja2FnZSB7XG4gIGlkOiBzdHJpbmc7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIGxhbmd1YWdlczogbG9vbUxhbmd1YWdlRGVmaW5pdGlvbltdO1xufVxuXG5leHBvcnQgY29uc3QgQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVM6IGxvb21MYW5ndWFnZVBhY2thZ2VbXSA9IFtcbiAge1xuICAgIGlkOiBcImludGVycHJldGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiSW50ZXJwcmV0ZWRcIixcbiAgICBkZXNjcmlwdGlvbjogXCJTY3JpcHQgYW5kIFJFUEwtb3JpZW50ZWQgbGFuZ3VhZ2VzIGZvciBvcGVyYXRpb25hbCBub3RlcyBhbmQgcXVpY2sgZXhwZXJpbWVudHMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcInB5dGhvblwiLCBkaXNwbGF5TmFtZTogXCJQeXRob25cIiwgYWxpYXNlczogW1wicHl0aG9uXCIsIFwicHlcIl0gfSxcbiAgICAgIHsgaWQ6IFwiamF2YXNjcmlwdFwiLCBkaXNwbGF5TmFtZTogXCJKYXZhU2NyaXB0XCIsIGFsaWFzZXM6IFtcImphdmFzY3JpcHRcIiwgXCJqc1wiXSB9LFxuICAgICAgeyBpZDogXCJ0eXBlc2NyaXB0XCIsIGRpc3BsYXlOYW1lOiBcIlR5cGVTY3JpcHRcIiwgYWxpYXNlczogW1widHlwZXNjcmlwdFwiLCBcInRzXCJdIH0sXG4gICAgICB7IGlkOiBcInNoZWxsXCIsIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsIGFsaWFzZXM6IFtcInNoZWxsXCIsIFwic2hcIiwgXCJiYXNoXCIsIFwienNoXCJdIH0sXG4gICAgICB7IGlkOiBcInJ1YnlcIiwgZGlzcGxheU5hbWU6IFwiUnVieVwiLCBhbGlhc2VzOiBbXCJydWJ5XCIsIFwicmJcIl0gfSxcbiAgICAgIHsgaWQ6IFwicGVybFwiLCBkaXNwbGF5TmFtZTogXCJQZXJsXCIsIGFsaWFzZXM6IFtcInBlcmxcIiwgXCJwbFwiXSB9LFxuICAgICAgeyBpZDogXCJsdWFcIiwgZGlzcGxheU5hbWU6IFwiTHVhXCIsIGFsaWFzZXM6IFtcImx1YVwiXSB9LFxuICAgICAgeyBpZDogXCJwaHBcIiwgZGlzcGxheU5hbWU6IFwiUEhQXCIsIGFsaWFzZXM6IFtcInBocFwiXSB9LFxuICAgICAgeyBpZDogXCJnb1wiLCBkaXNwbGF5TmFtZTogXCJHb1wiLCBhbGlhc2VzOiBbXCJnb1wiLCBcImdvbGFuZ1wiXSB9LFxuICAgICAgeyBpZDogXCJoYXNrZWxsXCIsIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIiwgYWxpYXNlczogW1wiaGFza2VsbFwiLCBcImhzXCJdIH0sXG4gICAgICB7IGlkOiBcIm9jYW1sXCIsIGRpc3BsYXlOYW1lOiBcIk9DYW1sXCIsIGFsaWFzZXM6IFtcIm9jYW1sXCIsIFwibWxcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwibmF0aXZlLWNvbXBpbGVkXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTmF0aXZlIENvbXBpbGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiTGFuZ3VhZ2VzIGNvbXBpbGVkIGludG8gbmF0aXZlIGJpbmFyaWVzIGJ5IGxvY2FsIHRvb2xjaGFpbnMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcImNcIiwgZGlzcGxheU5hbWU6IFwiQ1wiLCBhbGlhc2VzOiBbXCJjXCIsIFwiaFwiXSB9LFxuICAgICAgeyBpZDogXCJjcHBcIiwgZGlzcGxheU5hbWU6IFwiQysrXCIsIGFsaWFzZXM6IFtcImNwcFwiLCBcImN4eFwiLCBcImNjXCIsIFwiYysrXCJdIH0sXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGlkOiBcIm1hbmFnZWQtY29tcGlsZWRcIixcbiAgICBkaXNwbGF5TmFtZTogXCJNYW5hZ2VkIENvbXBpbGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiQ29tcGlsZWQgbGFuZ3VhZ2VzIHdpdGggbWFuYWdlZCBydW50aW1lcyBvciBzdHJ1Y3R1cmVkIGJ1aWxkL3J1biBwaGFzZXMuXCIsXG4gICAgbGFuZ3VhZ2VzOiBbXG4gICAgICB7IGlkOiBcInJ1c3RcIiwgZGlzcGxheU5hbWU6IFwiUnVzdFwiLCBhbGlhc2VzOiBbXCJydXN0XCIsIFwicnNcIl0gfSxcbiAgICAgIHsgaWQ6IFwiamF2YVwiLCBkaXNwbGF5TmFtZTogXCJKYXZhXCIsIGFsaWFzZXM6IFtcImphdmFcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwicHJvb2ZzXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUHJvb2ZzXCIsXG4gICAgZGVzY3JpcHRpb246IFwiUHJvb2YgYXNzaXN0YW50cyBhbmQgc29sdmVyLW9yaWVudGVkIGxhbmd1YWdlcy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwibGVhblwiLCBkaXNwbGF5TmFtZTogXCJMZWFuXCIsIGFsaWFzZXM6IFtcImxlYW5cIiwgXCJsZWFuNFwiXSB9LFxuICAgICAgeyBpZDogXCJjb3FcIiwgZGlzcGxheU5hbWU6IFwiQ29xXCIsIGFsaWFzZXM6IFtcImNvcVwiLCBcInZcIl0gfSxcbiAgICAgIHsgaWQ6IFwic210bGliXCIsIGRpc3BsYXlOYW1lOiBcIlNNVC1MSUJcIiwgYWxpYXNlczogW1wic210XCIsIFwic210MlwiLCBcInNtdGxpYlwiLCBcInNtdC1saWJcIiwgXCJ6M1wiXSB9LFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBpZDogXCJsbHZtXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTExWTVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkxMVk0gSVIgdG9vbGluZyBmb3IgY29tcGlsZXIgYW5kIFBMIHJlc2VhcmNoIHZhdWx0cy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwibGx2bS1pclwiLCBkaXNwbGF5TmFtZTogXCJMTFZNIElSXCIsIGFsaWFzZXM6IFtcImxsdm1cIiwgXCJsbHZtaXJcIiwgXCJsbHZtLWlyXCIsIFwibGxcIl0gfSxcbiAgICBdLFxuICB9LFxuICB7XG4gICAgaWQ6IFwiZWJwZlwiLFxuICAgIGRpc3BsYXlOYW1lOiBcImVCUEZcIixcbiAgICBkZXNjcmlwdGlvbjogXCJLZXJuZWwgaW5zdHJ1bWVudGF0aW9uIGxhbmd1YWdlcyBmb3IgQlBGIG9iamVjdCBjb21waWxhdGlvbiwgdmVyaWZpZXIgY2hlY2tzLCBhbmQgYnBmdHJhY2Ugc2NyaXB0cy5cIixcbiAgICBsYW5ndWFnZXM6IFtcbiAgICAgIHsgaWQ6IFwiZWJwZi1jXCIsIGRpc3BsYXlOYW1lOiBcImVCUEYgQ1wiLCBhbGlhc2VzOiBbXCJlYnBmXCIsIFwiZWJwZi1jXCIsIFwiYnBmLWNcIiwgXCJicGZcIl0gfSxcbiAgICAgIHsgaWQ6IFwiYnBmdHJhY2VcIiwgZGlzcGxheU5hbWU6IFwiYnBmdHJhY2VcIiwgYWxpYXNlczogW1wiYnBmdHJhY2VcIiwgXCJidFwiXSB9LFxuICAgIF0sXG4gIH0sXG5dO1xuXG5leHBvcnQgY29uc3QgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQgPSBcImN1c3RvbVwiO1xuZXhwb3J0IGNvbnN0IExBTkdVQUdFX0NPTkZJR1VSQVRJT05fVkVSU0lPTiA9IDI7XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzKCk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIFsuLi5CVUlMVF9JTl9MQU5HVUFHRV9QQUNLQUdFUy5tYXAoKHBhY2spID0+IHBhY2suaWQpLCBDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRF07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMoKTogc3RyaW5nW10ge1xuICByZXR1cm4gQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMuZmxhdE1hcCgocGFjaykgPT4gcGFjay5sYW5ndWFnZXMubWFwKChsYW5ndWFnZSkgPT4gbGFuZ3VhZ2UuaWQpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogdm9pZCB7XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcykgfHwgIXNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmxlbmd0aCkge1xuICAgIHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzID0gZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpO1xuICB9XG4gIGlmICghQXJyYXkuaXNBcnJheShzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzKSB8fCAhc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzID0gZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCk7XG4gIH1cbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbikpIHtcbiAgICBzZXR0aW5ncy5sYW5ndWFnZUNvbmZpZ3VyYXRpb25WZXJzaW9uID0gMTtcbiAgfVxuICBpZiAoc2V0dGluZ3MubGFuZ3VhZ2VDb25maWd1cmF0aW9uVmVyc2lvbiA8IDIpIHtcbiAgICBlbmFibGVMYW5ndWFnZVBhY2thZ2Uoc2V0dGluZ3MsIFwiZWJwZlwiKTtcbiAgICBzZXR0aW5ncy5sYW5ndWFnZUNvbmZpZ3VyYXRpb25WZXJzaW9uID0gTEFOR1VBR0VfQ09ORklHVVJBVElPTl9WRVJTSU9OO1xuICB9XG59XG5cbmZ1bmN0aW9uIGVuYWJsZUxhbmd1YWdlUGFja2FnZShzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBwYWNrYWdlSWQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBwYWNrID0gQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IHBhY2thZ2VJZCk7XG4gIGlmICghcGFjaykge1xuICAgIHJldHVybjtcbiAgfVxuICBhcHBlbmRVbmlxdWUoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MsIHBhY2suaWQpO1xuICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHBhY2subGFuZ3VhZ2VzKSB7XG4gICAgYXBwZW5kVW5pcXVlKHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMsIGxhbmd1YWdlLmlkKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRVbmlxdWUodmFsdWVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIXZhbHVlcy5pbmNsdWRlcyh2YWx1ZSkpIHtcbiAgICB2YWx1ZXMucHVzaCh2YWx1ZSk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTGFuZ3VhZ2VEZWZpbml0aW9uW10ge1xuICBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24oc2V0dGluZ3MpO1xuICBjb25zdCBlbmFibGVkUGFja3MgPSBuZXcgU2V0KHNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzKTtcbiAgY29uc3QgZW5hYmxlZExhbmd1YWdlcyA9IG5ldyBTZXQoc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlcyk7XG5cbiAgcmV0dXJuIEJVSUxUX0lOX0xBTkdVQUdFX1BBQ0tBR0VTXG4gICAgLmZpbHRlcigocGFjaykgPT4gZW5hYmxlZFBhY2tzLmhhcyhwYWNrLmlkKSlcbiAgICAuZmxhdE1hcCgocGFjaykgPT4gcGFjay5sYW5ndWFnZXMpXG4gICAgLmZpbHRlcigobGFuZ3VhZ2UpID0+IGVuYWJsZWRMYW5ndWFnZXMuaGFzKGxhbmd1YWdlLmlkKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmFibGVkTGFuZ3VhZ2VBbGlhc01hcChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUmVjb3JkPHN0cmluZywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZT4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzKS5mbGF0TWFwKChsYW5ndWFnZSkgPT5cbiAgICAgIGxhbmd1YWdlLmFsaWFzZXMubWFwKChhbGlhcykgPT4gW2FsaWFzLnRvTG93ZXJDYXNlKCksIGxhbmd1YWdlLmlkXSBhcyBjb25zdCksXG4gICAgKSxcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQ6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHNldHRpbmdzKTtcbiAgcmV0dXJuIGdldEVuYWJsZWRMYW5ndWFnZURlZmluaXRpb25zKHNldHRpbmdzKS5zb21lKChsYW5ndWFnZSkgPT4gbGFuZ3VhZ2UuaWQgPT09IGxhbmd1YWdlSWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gIG5vcm1hbGl6ZUxhbmd1YWdlQ29uZmlndXJhdGlvbihzZXR0aW5ncyk7XG4gIHJldHVybiBzZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCk7XG59XG4iLCAiaW1wb3J0IHsgc2hvcnRIYXNoIH0gZnJvbSBcIi4vdXRpbHMvaGFzaFwiO1xuaW1wb3J0IHsgYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZCwgZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAgfSBmcm9tIFwiLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmNvbnN0IE9VVFBVVF9TVEFSVCA9IC9ePCEtLVxccypsb29tOm91dHB1dDpzdGFydFxccytpZD0oW2EtZjAtOV0rKVxccyotLT4kL2k7XG5jb25zdCBPVVRQVVRfRU5EID0gL148IS0tXFxzKmxvb206b3V0cHV0OmVuZFxccyotLT4kL2k7XG5jb25zdCBGRU5DRV9TVEFSVCA9IC9eKGBgYCt8fn5+KylcXHMqKFteXFxzYF0qKT8oLiopJC87XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZShyYXdMYW5ndWFnZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfCBudWxsIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHJhd0xhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuXG4gIGlmICghc2V0dGluZ3MpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGlmIChhcmVDdXN0b21MYW5ndWFnZXNFbmFibGVkKHNldHRpbmdzKSkge1xuICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2Ygc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKSB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBwYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKTtcbiAgICAgIGlmIChuYW1lICYmIChuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpKSB7XG4gICAgICAgIHJldHVybiBsYW5ndWFnZS5uYW1lLnRyaW0oKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBhbGlhc2VzID0gZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3MpO1xuICByZXR1cm4gYWxpYXNlc1tub3JtYWxpemVkXSA/PyBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nW10ge1xuICBpZiAoIXNldHRpbmdzKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3QgY3VzdG9tQWxpYXNlcyA9IGFyZUN1c3RvbUxhbmd1YWdlc0VuYWJsZWQoc2V0dGluZ3MpXG4gICAgPyAoc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKS5mbGF0TWFwKChsYW5ndWFnZSkgPT4ge1xuICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgcmV0dXJuIFtuYW1lLCAuLi5wYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKV07XG4gICAgfSlcbiAgICA6IFtdO1xuXG4gIHJldHVybiBbXG4gICAgLi4uT2JqZWN0LmtleXMoZ2V0RW5hYmxlZExhbmd1YWdlQWxpYXNNYXAoc2V0dGluZ3MpKSxcbiAgICAuLi5jdXN0b21BbGlhc2VzLFxuICBdLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRvTG93ZXJDYXNlKCkpLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Db2RlQmxvY2tbXSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IGJsb2NrczogbG9vbUNvZGVCbG9ja1tdID0gW107XG4gIGxldCBvcmRpbmFsID0gMDtcbiAgbGV0IGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xuXG4gICAgaWYgKGluc2lkZU1hbmFnZWRPdXRwdXQpIHtcbiAgICAgIGlmIChPVVRQVVRfRU5ELnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChPVVRQVVRfU1RBUlQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZmVuY2VNYXRjaCA9IGxpbmUubWF0Y2goRkVOQ0VfU1RBUlQpO1xuICAgIGlmICghZmVuY2VNYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnRMaW5lID0gaTtcbiAgICBjb25zdCBmZW5jZUluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpO1xuICAgIGNvbnN0IGZlbmNlVG9rZW4gPSBmZW5jZU1hdGNoWzFdO1xuICAgIGNvbnN0IHNvdXJjZUxhbmd1YWdlID0gKGZlbmNlTWF0Y2hbMl0gPz8gXCJcIikudHJpbSgpO1xuICAgIGNvbnN0IGluZm9BdHRyaWJ1dGVzID0gcGFyc2VJbmZvQXR0cmlidXRlcyhmZW5jZU1hdGNoWzNdID8/IFwiXCIpO1xuICAgIGNvbnN0IHNvdXJjZVJlZmVyZW5jZSA9IHBhcnNlU291cmNlUmVmZXJlbmNlKGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gcGFyc2VFeGVjdXRpb25Db250ZXh0KGluZm9BdHRyaWJ1dGVzKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IG5vcm1hbGl6ZUxhbmd1YWdlKHNvdXJjZUxhbmd1YWdlLCBzZXR0aW5ncyk7XG5cbiAgICBsZXQgZW5kTGluZSA9IGk7XG4gICAgY29uc3QgY29udGVudExpbmVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgIGNvbnN0IGlubmVyTGluZSA9IGxpbmVzW2pdO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyTGluZS50cmltKCk7XG5cbiAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoZmVuY2VUb2tlbikgJiYgL14oYGBgK3x+fn4rKVxccyokLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICAgIGVuZExpbmUgPSBqO1xuICAgICAgICBpID0gajtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnRlbnRMaW5lcy5wdXNoKHN0cmlwRmVuY2VJbmRlbnQoaW5uZXJMaW5lLCBmZW5jZUluZGVudCkpO1xuICAgICAgZW5kTGluZSA9IGo7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgb3JkaW5hbCArPSAxO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBjb250ZW50TGluZXMuam9pbihcIlxcblwiKTtcbiAgICBjb25zdCByZWZlcmVuY2VIYXNoID0gc291cmNlUmVmZXJlbmNlID8gYDoke0pTT04uc3RyaW5naWZ5KHNvdXJjZVJlZmVyZW5jZSl9YCA6IFwiXCI7XG4gICAgY29uc3QgZXhlY3V0aW9uSGFzaCA9IGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoZXhlY3V0aW9uQ29udGV4dCkgPyBgOiR7SlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uQ29udGV4dCl9YCA6IFwiXCI7XG4gICAgY29uc3QgYXR0cmlidXRlSGFzaCA9IE9iamVjdC5rZXlzKGluZm9BdHRyaWJ1dGVzKS5sZW5ndGggPyBgOiR7SlNPTi5zdHJpbmdpZnkoaW5mb0F0dHJpYnV0ZXMpfWAgOiBcIlwiO1xuICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gc2hvcnRIYXNoKGAke2NvbnRlbnR9JHtyZWZlcmVuY2VIYXNofSR7ZXhlY3V0aW9uSGFzaH0ke2F0dHJpYnV0ZUhhc2h9YCk7XG4gICAgY29uc3QgaWQgPSBzaG9ydEhhc2goYCR7ZmlsZVBhdGh9OiR7b3JkaW5hbH06JHtsYW5ndWFnZX06JHtjb250ZW50SGFzaH1gKTtcblxuICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgIGlkLFxuICAgICAgb3JkaW5hbCxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBsYW5ndWFnZUFsaWFzOiBzb3VyY2VMYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxuICAgICAgc291cmNlTGFuZ3VhZ2UsXG4gICAgICBjb250ZW50LFxuICAgICAgYXR0cmlidXRlczogaW5mb0F0dHJpYnV0ZXMsXG4gICAgICBzb3VyY2VSZWZlcmVuY2UsXG4gICAgICBleGVjdXRpb25Db250ZXh0LFxuICAgICAgc3RhcnRMaW5lLFxuICAgICAgZW5kTGluZSxcbiAgICAgIGZlbmNlU3RhcnQ6IDAsXG4gICAgICBmZW5jZUVuZDogMCxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBibG9ja3M7XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGlvbkNvbnRleHRIYXNWYWx1ZXMoY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgcGFyc2VFeGVjdXRpb25Db250ZXh0Pik6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihjb250ZXh0LmNvbnRhaW5lckdyb3VwIHx8IGNvbnRleHQuZGlzYWJsZUNvbnRhaW5lciB8fCBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnkgfHwgY29udGV4dC50aW1lb3V0TXMpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsaWFzTGlzdCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU291cmNlUmVmZXJlbmNlKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogbG9vbVNvdXJjZVJlZmVyZW5jZSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGZpbGVQYXRoID0gYXR0cnNbXCJsb29tLWZpbGVcIl0gPz8gYXR0cnMuZmlsZSA/PyBhdHRycy5zcmMgPz8gYXR0cnMuc291cmNlO1xuICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYXR0cnNbXCJsb29tLWxpbmVzXCJdID8/IGF0dHJzLmxpbmVzID8/IGF0dHJzLmxpbmU7XG4gIGNvbnN0IGxpbmVSYW5nZSA9IGxpbmVzID8gcGFyc2VMaW5lUmFuZ2UobGluZXMpIDogbnVsbDtcbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGF0dHJzW1wibG9vbS1zeW1ib2xcIl0gPz8gYXR0cnMuc3ltYm9sID8/IGF0dHJzLmZuID8/IGF0dHJzLmZ1bmN0aW9uO1xuICBjb25zdCB0cmFjZVZhbHVlID0gYXR0cnNbXCJsb29tLWRlcHNcIl0gPz8gYXR0cnMuZGVwcyA/PyBhdHRycy50cmFjZTtcbiAgY29uc3QgY2FsbEV4cHJlc3Npb24gPSBhdHRyc1tcImxvb20tY2FsbFwiXSA/PyBhdHRycy5jYWxsO1xuICBjb25zdCBjYWxsQXJncyA9IGF0dHJzW1wibG9vbS1hcmdzXCJdID8/IGF0dHJzLmFyZ3M7XG4gIGNvbnN0IHByaW50VmFsdWUgPSBhdHRyc1tcImxvb20tcHJpbnRcIl0gPz8gYXR0cnMucHJpbnQ7XG4gIGNvbnN0IGNhbGwgPSBjYWxsRXhwcmVzc2lvbiAhPSBudWxsIHx8IGNhbGxBcmdzICE9IG51bGxcbiAgICA/IHtcbiAgICAgIGV4cHJlc3Npb246IG5vcm1hbGl6ZUJvb2xlYW5BdHRyaWJ1dGUoY2FsbEV4cHJlc3Npb24pID09PSBcInRydWVcIiA/IHVuZGVmaW5lZCA6IGNhbGxFeHByZXNzaW9uLFxuICAgICAgYXJnczogY2FsbEFyZ3MsXG4gICAgICBwcmludDogcHJpbnRWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhwcmludFZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICAgIH1cbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGZpbGVQYXRoLFxuICAgIGxpbmVTdGFydDogbGluZVJhbmdlPy5zdGFydCxcbiAgICBsaW5lRW5kOiBsaW5lUmFuZ2U/LmVuZCxcbiAgICBzeW1ib2xOYW1lLFxuICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB0cmFjZVZhbHVlID09IG51bGwgPyB0cnVlIDogIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKHRyYWNlVmFsdWUudG9Mb3dlckNhc2UoKSksXG4gICAgY2FsbCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VFeGVjdXRpb25Db250ZXh0KGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGF0dHJzW1wibG9vbS1jb250YWluZXJcIl0gPz8gYXR0cnMuY29udGFpbmVyO1xuICBjb25zdCB0aW1lb3V0ID0gYXR0cnNbXCJsb29tLXRpbWVvdXRcIl0gPz8gYXR0cnMudGltZW91dDtcbiAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IGF0dHJzW1wibG9vbS1jd2RcIl0gPz8gYXR0cnMuY3dkID8/IGF0dHJzW1wid29ya2luZy1kaXJlY3RvcnlcIl07XG4gIGNvbnN0IHRpbWVvdXRNcyA9IHRpbWVvdXQgPyBwYXJzZVBvc2l0aXZlSW50ZWdlcih0aW1lb3V0KSA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGNvbnRhaW5lckdyb3VwOiBjb250YWluZXIgJiYgIWlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpID8gY29udGFpbmVyIDogdW5kZWZpbmVkLFxuICAgIGRpc2FibGVDb250YWluZXI6IGNvbnRhaW5lciA/IGlzRGlzYWJsZWRWYWx1ZShjb250YWluZXIpIDogdW5kZWZpbmVkLFxuICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgdGltZW91dE1zLFxuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVBvc2l0aXZlSW50ZWdlcih2YWx1ZTogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLnRyaW0oKSwgMTApO1xuICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwYXJzZWQpICYmIHBhcnNlZCA+IDAgPyBwYXJzZWQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzRGlzYWJsZWRWYWx1ZSh2YWx1ZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiLCBcIm5vbmVcIiwgXCJuYXRpdmVcIl0uaW5jbHVkZXModmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVCb29sZWFuQXR0cmlidXRlKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/IHVuZGVmaW5lZCA6IHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xufVxuXG5mdW5jdGlvbiBwYXJzZUluZm9BdHRyaWJ1dGVzKGlucHV0OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcGF0dGVybiA9IC8oW0EtWmEtejAtOV8tXSspXFxzKj1cXHMqKD86XCIoW15cIl0qKVwifCcoW14nXSopJ3woW15cXHNdKykpL2c7XG4gIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcbiAgd2hpbGUgKChtYXRjaCA9IHBhdHRlcm4uZXhlYyhpbnB1dCkpICE9IG51bGwpIHtcbiAgICBhdHRyc1ttYXRjaFsxXS50b0xvd2VyQ2FzZSgpXSA9IG1hdGNoWzJdID8/IG1hdGNoWzNdID8/IG1hdGNoWzRdID8/IFwiXCI7XG4gIH1cbiAgcmV0dXJuIGF0dHJzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUxpbmVSYW5nZSh2YWx1ZTogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdmFsdWUudHJpbSgpLm1hdGNoKC9eTD8oXFxkKykoPzpcXHMqWy06XVxccypMPyhcXGQrKSk/JC9pKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gIGNvbnN0IGVuZCA9IE51bWJlci5wYXJzZUludChtYXRjaFsyXSA/PyBtYXRjaFsxXSwgMTApO1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIoc3RhcnQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGVuZCkgfHwgc3RhcnQgPD0gMCB8fCBlbmQgPCBzdGFydCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRCbG9ja0F0TGluZShibG9ja3M6IGxvb21Db2RlQmxvY2tbXSwgbGluZTogbnVtYmVyKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBsaW5lID49IGJsb2NrLnN0YXJ0TGluZSAmJiBsaW5lIDw9IGJsb2NrLmVuZExpbmUpID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc3RyaXBGZW5jZUluZGVudChsaW5lOiBzdHJpbmcsIGZlbmNlSW5kZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWZlbmNlSW5kZW50KSB7XG4gICAgcmV0dXJuIGxpbmU7XG4gIH1cblxuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBmZW5jZUluZGVudC5sZW5ndGggJiYgaW5kZXggPCBsaW5lLmxlbmd0aCAmJiBsaW5lW2luZGV4XSA9PT0gZmVuY2VJbmRlbnRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBsaW5lLnNsaWNlKGluZGV4KTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21MYW5ndWFnZUNhcGFiaWxpdHkge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgc3ltYm9sRXh0cmFjdGlvbjogXCJhc3RcIiB8IFwidG9wLWxldmVsXCIgfCBcImdlbmVyaWNcIiB8IFwiZXh0ZXJuYWxcIjtcbiAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiYXN0XCIgfCBcInRvcC1sZXZlbFwiIHwgXCJnZW5lcmljXCIgfCBcImV4dGVybmFsXCI7XG4gIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIgfCBcInJhd1wiIHwgXCJleHRlcm5hbFwiO1xuICBzb3VyY2VQcmV2aWV3OiBib29sZWFuO1xufVxuXG5jb25zdCBCVUlMVF9JTl9DQVBBQklMSVRJRVM6IFJlY29yZDxzdHJpbmcsIGxvb21MYW5ndWFnZUNhcGFiaWxpdHk+ID0ge1xuICBweXRob246IHtcbiAgICBsYW5ndWFnZTogXCJweXRob25cIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImFzdFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcImFzdFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcImphdmFzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgdHlwZXNjcmlwdDoge1xuICAgIGxhbmd1YWdlOiBcInR5cGVzY3JpcHRcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgYzoge1xuICAgIGxhbmd1YWdlOiBcImNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgY3BwOiB7XG4gICAgbGFuZ3VhZ2U6IFwiY3BwXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwibGx2bS1pclwiOiB7XG4gICAgbGFuZ3VhZ2U6IFwibGx2bS1pclwiLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwidG9wLWxldmVsXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwidG9wLWxldmVsXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgaGFza2VsbDoge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIG9jYW1sOiB7XG4gICAgbGFuZ3VhZ2U6IFwib2NhbWxcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcImJ1aWx0LWluXCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbiAgamF2YToge1xuICAgIGxhbmd1YWdlOiBcImphdmFcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIFwiZWJwZi1jXCI6IHtcbiAgICBsYW5ndWFnZTogXCJlYnBmLWNcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGJwZnRyYWNlOiB7XG4gICAgbGFuZ3VhZ2U6IFwiYnBmdHJhY2VcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImdlbmVyaWNcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJnZW5lcmljXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfSxcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRMYW5ndWFnZUNhcGFiaWxpdHkobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGhhc0V4dGVybmFsRXh0cmFjdG9yID0gZmFsc2UpOiBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5IHtcbiAgaWYgKGhhc0V4dGVybmFsRXh0cmFjdG9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc3ltYm9sRXh0cmFjdGlvbjogXCJleHRlcm5hbFwiLFxuICAgICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZXh0ZXJuYWxcIixcbiAgICAgIGNhbGxIYXJuZXNzOiBcImV4dGVybmFsXCIsXG4gICAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gQlVJTFRfSU5fQ0FQQUJJTElUSUVTW2xhbmd1YWdlXSA/PyB7XG4gICAgbGFuZ3VhZ2UsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJnZW5lcmljXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwiZ2VuZXJpY1wiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRCdWlsdEluTGFuZ3VhZ2VDYXBhYmlsaXRpZXMoKTogbG9vbUxhbmd1YWdlQ2FwYWJpbGl0eVtdIHtcbiAgcmV0dXJuIE9iamVjdC52YWx1ZXMoQlVJTFRfSU5fQ0FQQUJJTElUSUVTKTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTm9kZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibm9kZVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTm9kZS5qc1wiO1xuICBsYW5ndWFnZXMgPSBbXCJqYXZhc2NyaXB0XCIsIFwidHlwZXNjcmlwdFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCk7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IHNldHRpbmdzLnR5cGVzY3JpcHRNb2RlID09PSBcInRzeFwiID8gXCJUeXBlU2NyaXB0ICh0c3gpXCIgOiBcIlR5cGVTY3JpcHQgKHRzLW5vZGUpXCI7XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke3NldHRpbmdzLnR5cGVzY3JpcHRNb2RlfWAsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnRzXCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImN1c3RvbVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiQ3VzdG9tIGxhbmd1YWdlXCI7XG4gIGxhbmd1YWdlcyA9IFtdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKT8uZXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpO1xuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgY3VzdG9tIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7bGFuZ3VhZ2UubmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IGxhbmd1YWdlLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5hcmdzIHx8IFwie2ZpbGV9XCIpLFxuICAgICAgZmlsZUV4dGVuc2lvbjogbm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbiwgbGFuZ3VhZ2UubmFtZSksXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ3VzdG9tTGFuZ3VhZ2UgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBibG9jay5sYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICByZXR1cm4gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGxhbmd1YWdlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBsYW5ndWFnZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeHRlbnNpb24oZXh0ZW5zaW9uOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHtcbiAgICByZXR1cm4gYC4ke25hbWV9YDtcbiAgfVxuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmludGVyZmFjZSBJbnRlcnByZXRlZFNwZWMge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpID0+IHN0cmluZztcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nW107XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xuICBtaW5pbXVtVGltZW91dE1zPzogbnVtYmVyO1xufVxuXG5jb25zdCBJTlRFUlBSRVRFRF9TUEVDUzogSW50ZXJwcmV0ZWRTcGVjW10gPSBbXG4gIHtcbiAgICBsYW5ndWFnZTogXCJzaGVsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuc2hcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInJ1YnlcIixcbiAgICBkaXNwbGF5TmFtZTogXCJSdWJ5XCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5yYlwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGVybFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBlcmxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBlcmxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBsXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJsdWFcIixcbiAgICBkaXNwbGF5TmFtZTogXCJMdWFcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmx1YUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIubHVhXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwaHBcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQSFBcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBocEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGhwXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJnb1wiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkdvXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5nb0V4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuZ29cIixcbiAgICBhcmdzOiBbXCJydW5cIiwgXCJ7ZmlsZX1cIl0sXG4gICAgZW52OiB7XG4gICAgICBHT0NBQ0hFOiBcInt0ZW1wRGlyfS9nb2NhY2hlXCIsXG4gICAgfSxcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJoYXNrZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiSGFza2VsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuaHNcIixcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgSW50ZXJwcmV0ZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImludGVycHJldGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJJbnRlcnByZXRlZFwiO1xuICBsYW5ndWFnZXMgPSBJTlRFUlBSRVRFRF9TUEVDUy5tYXAoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UpO1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIHJldHVybiBCb29sZWFuKHNwZWM/LmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgaWYgKCFzcGVjKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9YCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncyA/PyBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBzcGVjLmZpbGVFeHRlbnNpb24sXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCBzcGVjLm1pbmltdW1UaW1lb3V0TXMgPz8gMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgZW52OiBzcGVjLmVudixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U3BlYyhsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IEludGVycHJldGVkU3BlYyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIElOVEVSUFJFVEVEX1NQRUNTLmZpbmQoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UgPT09IGxhbmd1YWdlKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG50eXBlIEVicGZDTW9kZSA9IFwiY29tcGlsZVwiIHwgXCJsb2FkXCI7XG50eXBlIEJwZnRyYWNlTW9kZSA9IFwiY2hlY2tcIiB8IFwicnVuXCI7XG5cbmV4cG9ydCBjbGFzcyBFYnBmUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJlYnBmXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJlQlBGXCI7XG4gIGxhbmd1YWdlcyA9IFtcImVicGYtY1wiLCBcImJwZnRyYWNlXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJlYnBmLWNcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuZWJwZkNsYW5nRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiYnBmdHJhY2VcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuYnBmdHJhY2VFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiZWJwZi1jXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkVicGZDKGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJicGZ0cmFjZVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5CcGZ0cmFjZShibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGVCUEYgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkVicGZDKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IG1vZGUgPSByZWFkRWJwZkNNb2RlKGJsb2NrKTtcbiAgICBjb25zdCBjZmxhZ3MgPSByZWFkTGlzdEF0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtY2ZsYWdzXCIsIFwiZWJwZi1jZmxhZ3NcIikuZmxhdE1hcChzcGxpdENvbW1hbmRMaW5lKTtcbiAgICBjb25zdCBpbmNsdWRlUGF0aHMgPSBbXG4gICAgICAuLi5zcGxpdENzdihzZXR0aW5ncy5lYnBmSW5jbHVkZVBhdGhzKSxcbiAgICAgIC4uLnJlYWRMaXN0QXR0cmlidXRlKGJsb2NrLCBcImxvb20tZWJwZi1pbmNsdWRlc1wiLCBcImVicGYtaW5jbHVkZXNcIiksXG4gICAgXTtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIuYnBmLmNcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3Qgb2JqZWN0UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0LmJwZi5vXCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06Y2xhbmdgLFxuICAgICAgICBydW5uZXJOYW1lOiBcImVCUEYgY2xhbmdcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuZWJwZkNsYW5nRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcbiAgICAgICAgICBcIi10YXJnZXRcIixcbiAgICAgICAgICBcImJwZlwiLFxuICAgICAgICAgIFwiLU8yXCIsXG4gICAgICAgICAgXCItZ1wiLFxuICAgICAgICAgIFwiLVdhbGxcIixcbiAgICAgICAgICAuLi5pbmNsdWRlUGF0aHMuZmxhdE1hcCgoaW5jbHVkZVBhdGgpID0+IFtcIi1JXCIsIGluY2x1ZGVQYXRoXSksXG4gICAgICAgICAgLi4uY2ZsYWdzLFxuICAgICAgICAgIFwiLWNcIixcbiAgICAgICAgICB0ZW1wRmlsZSxcbiAgICAgICAgICBcIi1vXCIsXG4gICAgICAgICAgb2JqZWN0UGF0aCxcbiAgICAgICAgXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICBjb21waWxlUmVzdWx0LnN0ZG91dCA9IGFwcGVuZFNlY3Rpb24oY29tcGlsZVJlc3VsdC5zdGRvdXQsIFwiQ29tcGlsZVwiLCBgZUJQRiBvYmplY3QgY29tcGlsZWQgc3VjY2Vzc2Z1bGx5OiAke29iamVjdFBhdGh9YCk7XG4gICAgICBhd2FpdCB0aGlzLmFwcGVuZE9iamVjdEluc3BlY3Rpb24oY29tcGlsZVJlc3VsdCwgb2JqZWN0UGF0aCwgY29udGV4dCwgc2V0dGluZ3MpO1xuXG4gICAgICBpZiAobW9kZSA9PT0gXCJjb21waWxlXCIpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLmxvYWRFYnBmT2JqZWN0KGJsb2NrLCBvYmplY3RQYXRoLCBjb250ZXh0LCBzZXR0aW5ncywgY29tcGlsZVJlc3VsdCk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGVuZE9iamVjdEluc3BlY3Rpb24ocmVzdWx0OiBsb29tUnVuUmVzdWx0LCBvYmplY3RQYXRoOiBzdHJpbmcsIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgb2JqZHVtcCA9IHNldHRpbmdzLmVicGZMbHZtT2JqZHVtcEV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGlmICghb2JqZHVtcCkge1xuICAgICAgcmVzdWx0Lndhcm5pbmcgPSBhcHBlbmRMaW5lKHJlc3VsdC53YXJuaW5nLCBcImVCUEYgb2JqZWN0IGluc3BlY3Rpb24gc2tpcHBlZCBiZWNhdXNlIG5vIG9iamVjdCBpbnNwZWN0b3IgaXMgY29uZmlndXJlZC5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgaW5zcGVjdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9iamR1bXBgLFxuICAgICAgcnVubmVyTmFtZTogXCJlQlBGIG9iamVjdCBpbnNwZWN0aW9uXCIsXG4gICAgICBleGVjdXRhYmxlOiBvYmpkdW1wLFxuICAgICAgYXJnczogW1wiLWhcIiwgb2JqZWN0UGF0aF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmIChpbnNwZWN0LnN1Y2Nlc3MpIHtcbiAgICAgIHJlc3VsdC5zdGRvdXQgPSBhcHBlbmRTZWN0aW9uKHJlc3VsdC5zdGRvdXQsIFwiT2JqZWN0IHNlY3Rpb25zXCIsIGluc3BlY3Quc3Rkb3V0LnRyaW0oKSB8fCBcIihubyBzZWN0aW9ucyByZXBvcnRlZClcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC53YXJuaW5nID0gYXBwZW5kTGluZShyZXN1bHQud2FybmluZywgYGVCUEYgb2JqZWN0IGluc3BlY3Rpb24gZmFpbGVkOiAke2luc3BlY3Quc3RkZXJyIHx8IGluc3BlY3Quc3Rkb3V0IHx8IGBleGl0ICR7aW5zcGVjdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9hZEVicGZPYmplY3QoXG4gICAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICAgb2JqZWN0UGF0aDogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICAgY29tcGlsZVJlc3VsdDogbG9vbVJ1blJlc3VsdCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKCFzZXR0aW5ncy5lYnBmQWxsb3dLZXJuZWxMb2FkKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jb21waWxlUmVzdWx0LFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICBzdGRlcnI6IGFwcGVuZExpbmUoY29tcGlsZVJlc3VsdC5zdGRlcnIsIFwiZUJQRiBrZXJuZWwgbG9hZGluZyBpcyBkaXNhYmxlZC4gRW5hYmxlIEFsbG93IGVCUEYga2VybmVsIGxvYWQgaW4gc2V0dGluZ3MgYmVmb3JlIHVzaW5nIGxvb20tZWJwZi1tb2RlPWxvYWQuXCIpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBwaW5QYXRoID0gcmVhZFN0cmluZ0F0dHJpYnV0ZShibG9jaywgXCJsb29tLWVicGYtcGluXCIsIFwiZWJwZi1waW5cIik7XG4gICAgaWYgKCFwaW5QYXRoKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jb21waWxlUmVzdWx0LFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICBzdGRlcnI6IGFwcGVuZExpbmUoY29tcGlsZVJlc3VsdC5zdGRlcnIsIFwibG9vbS1lYnBmLW1vZGU9bG9hZCByZXF1aXJlcyBsb29tLWVicGYtcGluPS9zeXMvZnMvYnBmLzxwYXRoPi5cIiksXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGxvYWQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpicGZ0b29sOmxvYWRgLFxuICAgICAgcnVubmVyTmFtZTogXCJicGZ0b29sIGVCUEYgbG9hZFwiLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuZWJwZkJwZnRvb2xFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImJwZnRvb2xcIixcbiAgICAgIGFyZ3M6IFtcIi1kXCIsIFwicHJvZ1wiLCBcImxvYWRhbGxcIiwgb2JqZWN0UGF0aCwgcGluUGF0aF0sXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGxvYWQuc3Rkb3V0ID0gYXBwZW5kU2VjdGlvbihjb21waWxlUmVzdWx0LnN0ZG91dCwgXCJicGZ0b29sIHN0ZG91dFwiLCBsb2FkLnN0ZG91dC50cmltKCkpO1xuICAgIGxvYWQuc3RkZXJyID0gYXBwZW5kU2VjdGlvbihjb21waWxlUmVzdWx0LnN0ZGVyciwgXCJicGZ0b29sIHN0ZGVyclwiLCBsb2FkLnN0ZGVyci50cmltKCkpO1xuICAgIGxvYWQud2FybmluZyA9IGFwcGVuZExpbmUoY29tcGlsZVJlc3VsdC53YXJuaW5nLCBgZUJQRiBvYmplY3QgbG9hZCByZXF1ZXN0ZWQgd2l0aCBwaW4gcGF0aCAke3BpblBhdGh9LmApO1xuICAgIHJldHVybiBsb2FkO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5CcGZ0cmFjZShibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gcmVhZEJwZnRyYWNlTW9kZShibG9jayk7XG4gICAgY29uc3QgZXh0cmFBcmdzID0gcmVhZExpc3RBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1icGZ0cmFjZS1hcmdzXCIsIFwiYnBmdHJhY2UtYXJnc1wiKS5mbGF0TWFwKHNwbGl0Q29tbWFuZExpbmUpO1xuICAgIGNvbnN0IGFyZ3MgPSBtb2RlID09PSBcImNoZWNrXCJcbiAgICAgID8gW1wiLWRcIiwgLi4uZXh0cmFBcmdzLCBcIntmaWxlfVwiXVxuICAgICAgOiBbLi4uZXh0cmFBcmdzLCBcIntmaWxlfVwiXTtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIuYnRcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcEZpbGUgfSkgPT5cbiAgICAgIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06YnBmdHJhY2U6JHttb2RlfWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IG1vZGUgPT09IFwiY2hlY2tcIiA/IFwiYnBmdHJhY2UgY2hlY2tcIiA6IFwiYnBmdHJhY2VcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuYnBmdHJhY2VFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogYXJncy5tYXAoKGFyZykgPT4gYXJnLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGUpKSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSksXG4gICAgKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWFkRWJwZkNNb2RlKGJsb2NrOiBsb29tQ29kZUJsb2NrKTogRWJwZkNNb2RlIHtcbiAgY29uc3QgdmFsdWUgPSByZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBcImxvb20tZWJwZi1tb2RlXCIsIFwiZWJwZi1tb2RlXCIpIHx8IFwiY29tcGlsZVwiO1xuICBpZiAodmFsdWUgPT09IFwiY29tcGlsZVwiIHx8IHZhbHVlID09PSBcImxvYWRcIikge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGVCUEYgbW9kZTogJHt2YWx1ZX0uIFVzZSBjb21waWxlIG9yIGxvYWQuYCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRCcGZ0cmFjZU1vZGUoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBCcGZ0cmFjZU1vZGUge1xuICBjb25zdCB2YWx1ZSA9IHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2ssIFwibG9vbS1icGZ0cmFjZS1tb2RlXCIsIFwiYnBmdHJhY2UtbW9kZVwiKSB8fCBcImNoZWNrXCI7XG4gIGlmICh2YWx1ZSA9PT0gXCJjaGVja1wiIHx8IHZhbHVlID09PSBcInJ1blwiKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYnBmdHJhY2UgbW9kZTogJHt2YWx1ZX0uIFVzZSBjaGVjayBvciBydW4uYCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdBdHRyaWJ1dGUoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHByaW1hcnk6IHN0cmluZywgZmFsbGJhY2s6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBibG9jay5hdHRyaWJ1dGVzW3ByaW1hcnldPy50cmltKCkgfHwgYmxvY2suYXR0cmlidXRlc1tmYWxsYmFja10/LnRyaW0oKSB8fCB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIHJlYWRMaXN0QXR0cmlidXRlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBwcmltYXJ5OiBzdHJpbmcsIGZhbGxiYWNrOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzcGxpdENzdihyZWFkU3RyaW5nQXR0cmlidXRlKGJsb2NrLCBwcmltYXJ5LCBmYWxsYmFjaykgfHwgXCJcIik7XG59XG5cbmZ1bmN0aW9uIHNwbGl0Q3N2KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRMaW5lKGV4aXN0aW5nOiBzdHJpbmcgfCB1bmRlZmluZWQsIGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbZXhpc3RpbmcsIGxpbmVdLmZpbHRlcigocGFydCkgPT4gcGFydD8udHJpbSgpKS5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBhcHBlbmRTZWN0aW9uKGV4aXN0aW5nOiBzdHJpbmcsIHRpdGxlOiBzdHJpbmcsIGJvZHk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbnRlbnQgPSBib2R5LnRyaW0oKTtcbiAgaWYgKCFjb250ZW50KSB7XG4gICAgcmV0dXJuIGV4aXN0aW5nO1xuICB9XG4gIHJldHVybiBbZXhpc3RpbmcudHJpbSgpLCBgJHt0aXRsZX06XFxuJHtjb250ZW50fWBdLmZpbHRlcihCb29sZWFuKS5qb2luKFwiXFxuXFxuXCIpO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBMbHZtUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJsbHZtLWlyXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJMTFZNIElSXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxsdm0taXJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIiAmJiBCb29sZWFuKHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sbFwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3VsdC50aW1lZE91dCAmJiAhcmVzdWx0LmNhbmNlbGxlZCAmJiByZXN1bHQuZXhpdENvZGUgIT0gbnVsbCAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgIGlmIChyZXN1bHQuZXhpdENvZGUgIT09IDApIHtcbiAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSB0cnVlO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBQcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uIFVuZGVyIGxsaSwgdGhhdCBiZWNvbWVzIHRoZSBwcm9jZXNzIGV4aXQgc3RhdHVzLmA7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZG91dCA9IHJlc3VsdC5leGl0Q29kZSA9PT0gMFxuICAgICAgICAgID8gXCJMTFZNIHByb2dyYW0gZXhpdGVkIHdpdGggY29kZSAwLlwiXG4gICAgICAgICAgOiBgTExWTSBwcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uXFxuVXNlIHN0ZG91dCBpbiB0aGUgSVIgaXRzZWxmIGlmIHlvdSB3YW50IHByaW50YWJsZSBwcm9ncmFtIG91dHB1dC5gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTWFuYWdlZENvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJtYW5hZ2VkLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJNYW5hZ2VkIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcInJ1c3RcIiwgXCJqYXZhXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuUnVzdChibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkphdmEoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5SdXN0KGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIucnNcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkphdmEoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKFwiTWFpbi5qYXZhXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGlmICghc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnNvdXJjZWAsXG4gICAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogdGVtcERpcixcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCItY3BcIiwgdGVtcERpciwgXCJNYWluXCJdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5hdGl2ZUNvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJuYXRpdmUtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5hdGl2ZSBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJjXCIsIFwiY3BwXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNwcFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgOiBzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBmaWxlRXh0ZW5zaW9uID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCIuY1wiIDogXCIuY3BwXCI7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiQyAoR0NDKVwiIDogXCJDKysgKEcrKylcIjtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoZmlsZUV4dGVuc2lvbiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCBydW5UZW1wRmlsZVByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBPY2FtbFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwib2NhbWxcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk9DYW1sXCI7XG4gIGxhbmd1YWdlcyA9IFtcIm9jYW1sXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJvY2FtbFwiICYmIEJvb2xlYW4oc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm9jYW1sTW9kZTtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKTtcblxuICAgIGlmIChtb2RlID09PSBcIm9jYW1sXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAobW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06ZHVuZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiRHVuZSAvIE9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcImV4ZWNcIiwgXCItLVwiLCBcIm9jYW1sXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIubWxcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1jb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiLW9cIiwgYmluYXJ5UGF0aCwgdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1ydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHl0aG9uUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJweXRob25cIjtcbiAgZGlzcGxheU5hbWUgPSBcIlB5dGhvblwiO1xuICBsYW5ndWFnZXMgPSBbXCJweXRob25cIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcInB5dGhvblwiICYmIEJvb2xlYW4oc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9vZlJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHJvb2ZcIjtcbiAgZGlzcGxheU5hbWUgPSBcIlByb29mIGNoZWNrZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGVhblwiLCBcImNvcVwiLCBcInNtdGxpYlwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4ocmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06bGVhbmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiTGVhblwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpjb3FgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkNvcVwiLFxuICAgICAgICBleGVjdXRhYmxlOiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncyksXG4gICAgICAgIGFyZ3M6IFtcIi1xXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnNtdGxpYmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiU01ULUxJQiAoWjMpXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnNtdDJcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHByb29mIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBjb25zdCBjb25maWd1cmVkID0gc2V0dGluZ3MuY29xRXhlY3V0YWJsZS50cmltKCk7XG4gIGlmIChjb25maWd1cmVkICYmIGNvbmZpZ3VyZWQgIT09IFwiY29xY1wiKSB7XG4gICAgcmV0dXJuIGNvbmZpZ3VyZWQ7XG4gIH1cblxuICBjb25zdCBvcGFtQ29xYyA9IGpvaW4ocHJvY2Vzcy5lbnYuSE9NRSA/PyBcIlwiLCBcIi5vcGFtXCIsIFwiZGVmYXVsdFwiLCBcImJpblwiLCBcImNvcWNcIik7XG4gIHJldHVybiBleGlzdHNTeW5jKG9wYW1Db3FjKSA/IG9wYW1Db3FjIDogY29uZmlndXJlZCB8fCBcImNvcWNcIjtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuaW1wb3J0IHsgYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZCwgaXNMYW5ndWFnZUVuYWJsZWQgfSBmcm9tIFwiLi4vbGFuZ3VhZ2VQYWNrYWdlc1wiO1xuXG5leHBvcnQgY2xhc3MgbG9vbVJ1bm5lclJlZ2lzdHJ5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBydW5uZXJzOiBsb29tUnVubmVyW10pIHt9XG5cbiAgZ2V0UnVubmVyRm9yQmxvY2soYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tUnVubmVyIHwgbnVsbCB7XG4gICAgaWYgKCF0aGlzLmlzQmxvY2tMYW5ndWFnZUVuYWJsZWQoYmxvY2ssIHNldHRpbmdzKSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJ1bm5lcnMuZmluZCgocnVubmVyKSA9PiAoIXJ1bm5lci5sYW5ndWFnZXMubGVuZ3RoIHx8IHJ1bm5lci5sYW5ndWFnZXMuaW5jbHVkZXMoYmxvY2subGFuZ3VhZ2UpKSAmJiBydW5uZXIuY2FuUnVuKGJsb2NrLCBzZXR0aW5ncykpID8/IG51bGw7XG4gIH1cblxuICBnZXRTdXBwb3J0ZWRMYW5ndWFnZXMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldCh0aGlzLnJ1bm5lcnMuZmxhdE1hcCgocnVubmVyKSA9PiBydW5uZXIubGFuZ3VhZ2VzKSldO1xuICB9XG5cbiAgcHJpdmF0ZSBpc0Jsb2NrTGFuZ3VhZ2VFbmFibGVkKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGlzTGFuZ3VhZ2VFbmFibGVkKGJsb2NrLmxhbmd1YWdlLCBzZXR0aW5ncykpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gYXJlQ3VzdG9tTGFuZ3VhZ2VzRW5hYmxlZChzZXR0aW5ncykgJiYgc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnNvbWUoKGxhbmd1YWdlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBsYW5ndWFnZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpIHx8IGFsaWFzZXMuaW5jbHVkZXMoYmxvY2subGFuZ3VhZ2VBbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMsIGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMgfSBmcm9tIFwiLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBsb29tUGx1Z2luU2V0dGluZ3MgPSB7XG4gIGVuYWJsZUxvY2FsRXhlY3V0aW9uOiBmYWxzZSxcbiAgaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzazogZmFsc2UsXG4gIHByZXNlcnZlU291cmNlTW9kZTogdHJ1ZSxcbiAgZGVmYXVsdFRpbWVvdXRNczogODAwMCxcbiAgd29ya2luZ0RpcmVjdG9yeTogXCJcIixcbiAgcHl0aG9uRXhlY3V0YWJsZTogXCJweXRob24zXCIsXG4gIG5vZGVFeGVjdXRhYmxlOiBcIm5vZGVcIixcbiAgdHlwZXNjcmlwdE1vZGU6IFwidHMtbm9kZVwiLFxuICB0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGU6IFwidHMtbm9kZVwiLFxuICBvY2FtbE1vZGU6IFwib2NhbWxcIixcbiAgb2NhbWxFeGVjdXRhYmxlOiBcIm9jYW1sXCIsXG4gIGNFeGVjdXRhYmxlOiBcImdjY1wiLFxuICBjcHBFeGVjdXRhYmxlOiBcImcrK1wiLFxuICBzaGVsbEV4ZWN1dGFibGU6IFwiYmFzaFwiLFxuICBydWJ5RXhlY3V0YWJsZTogXCJydWJ5XCIsXG4gIHBlcmxFeGVjdXRhYmxlOiBcInBlcmxcIixcbiAgbHVhRXhlY3V0YWJsZTogXCJsdWFcIixcbiAgcGhwRXhlY3V0YWJsZTogXCJwaHBcIixcbiAgZ29FeGVjdXRhYmxlOiBcImdvXCIsXG4gIHJ1c3RFeGVjdXRhYmxlOiBcInJ1c3RjXCIsXG4gIGhhc2tlbGxFeGVjdXRhYmxlOiBcInJ1bmdoY1wiLFxuICBqYXZhQ29tcGlsZXJFeGVjdXRhYmxlOiBcIlwiLFxuICBqYXZhRXhlY3V0YWJsZTogXCJqYXZhXCIsXG4gIGxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGU6IFwibGxpXCIsXG4gIGVicGZDbGFuZ0V4ZWN1dGFibGU6IFwiY2xhbmdcIixcbiAgZWJwZkJwZnRvb2xFeGVjdXRhYmxlOiBcImJwZnRvb2xcIixcbiAgZWJwZkxsdm1PYmpkdW1wRXhlY3V0YWJsZTogXCJsbHZtLW9iamR1bXBcIixcbiAgZWJwZkluY2x1ZGVQYXRoczogXCJcIixcbiAgZWJwZkFsbG93S2VybmVsTG9hZDogZmFsc2UsXG4gIGJwZnRyYWNlRXhlY3V0YWJsZTogXCJicGZ0cmFjZVwiLFxuICBsZWFuRXhlY3V0YWJsZTogXCJsZWFuXCIsXG4gIGNvcUV4ZWN1dGFibGU6IFwiY29xY1wiLFxuICBzbXRFeGVjdXRhYmxlOiBcInozXCIsXG4gIHdyaXRlT3V0cHV0VG9Ob3RlOiBmYWxzZSxcbiAgb3V0cHV0VmlzaWJsZUxpbmVzOiAwLFxuICBhdXRvUnVuT25GaWxlT3BlbjogZmFsc2UsXG4gIGV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlOiBcImNvbGxhcHNlZFwiLFxuICBzaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGE6IHRydWUsXG4gIGxhbmd1YWdlQ29uZmlndXJhdGlvblZlcnNpb246IDIsXG4gIGVuYWJsZWRMYW5ndWFnZVBhY2tzOiBnZXREZWZhdWx0TGFuZ3VhZ2VQYWNrSWRzKCksXG4gIGVuYWJsZWRMYW5ndWFnZXM6IGdldERlZmF1bHRMYW5ndWFnZUlkcygpLFxuICBjdXN0b21MYW5ndWFnZXM6IFtdLFxuICBwZGZFeHBvcnRNb2RlOiBcImJvdGhcIixcbiAgZGVmYXVsdENvbnRhaW5lckdyb3VwOiBcIlwiLFxufTtcbiIsICJpbXBvcnQgeyBBcHAsIE1vZGFsLCBOb3RpY2UsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcsIG5vcm1hbGl6ZVBhdGggfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIGxvb21QbHVnaW4gZnJvbSBcIi4vbWFpblwiO1xuaW1wb3J0IHsgQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMsIENVU1RPTV9MQU5HVUFHRV9QQUNLQUdFX0lELCBnZXREZWZhdWx0TGFuZ3VhZ2VJZHMsIGdldERlZmF1bHRMYW5ndWFnZVBhY2tJZHMsIGlzTGFuZ3VhZ2VFbmFibGVkLCBub3JtYWxpemVMYW5ndWFnZUNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiLi9sYW5ndWFnZVBhY2thZ2VzXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IHsgREVGQVVMVF9TRVRUSU5HUyB9IGZyb20gXCIuL2RlZmF1bHRTZXR0aW5nc1wiO1xuXG5leHBvcnQgY2xhc3MgbG9vbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luKSB7XG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHAsIGxvb21QbHVnaW4pO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwibG9vbVwiIH0pO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiUnVuIHN1cHBvcnRlZCBjb2RlIGZlbmNlcyBkaXJlY3RseSBmcm9tIG5vdGVzIHdoaWxlIHByZXNlcnZpbmcgbmF0aXZlIHN5bnRheCBoaWdobGlnaHRpbmcuXCIgfSk7XG5cbiAgICB0aGlzLnJlbmRlckdlbmVyYWxTZXR0aW5ncyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiR2VuZXJhbCBTZXR0aW5nc1wiLCB0cnVlKSk7XG4gICAgdGhpcy5yZW5kZXJMYW5ndWFnZVBhY2thZ2VzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJMYW5ndWFnZSBQYWNrYWdlc1wiKSk7XG4gICAgdGhpcy5yZW5kZXJCdWlsdEluUnVudGltZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkJ1aWx0LWluIFJ1bnRpbWVzXCIpKTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ3VzdG9tIExhbmd1YWdlc1wiKSk7XG4gICAgdm9pZCB0aGlzLnJlbmRlckNvbnRhaW5lckdyb3Vwcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ29udGFpbmVyaXphdGlvbiBHcm91cHNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgdGl0bGU6IHN0cmluZywgb3BlbiA9IGZhbHNlKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uXCIgfSk7XG4gICAgZGV0YWlscy5vcGVuID0gb3BlbjtcbiAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IHRpdGxlLCBjbHM6IFwibG9vbS1zZXR0aW5ncy1zdW1tYXJ5XCIgfSk7XG4gICAgcmV0dXJuIGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvbi1ib2R5XCIgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckdlbmVyYWxTZXR0aW5ncyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRW5hYmxlIGxvY2FsIGV4ZWN1dGlvblwiKVxuICAgICAgLnNldERlc2MoXCJEaXNhYmxlZCBieSBkZWZhdWx0LiBsb29tIHJ1bnMgY29kZSBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgYW5kIGRvZXMgbm90IHByb3ZpZGUgc2FuZGJveGluZy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdmFsdWU7XG4gICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgbG9vbSBub3RlcyBpbiBzb3VyY2UgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJQcmVzZXJ2ZSByYXcgZmVuY2VkIGNvZGUgaW4gdGhlIGVkaXRvciBpbnN0ZWFkIG9mIGxldHRpbmcgbGl2ZSBwcmV2aWV3IGNvbGxhcHNlIHJlc2VhcmNoIHNuaXBwZXRzLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2b2lkIHRoaXMubG9vbVBsdWdpbi5kaXNhYmxlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IHRpbWVvdXRcIilcbiAgICAgIC5zZXREZXNjKFwiTWF4aW11bSBleGVjdXRpb24gdGltZSBpbiBtaWxsaXNlY29uZHMgYmVmb3JlIGxvb20gdGVybWluYXRlcyB0aGUgcHJvY2Vzcy5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiODAwMFwiKS5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgICAgICBpZiAoIU51bWJlci5pc05hTihwYXJzZWQpICYmIHBhcnNlZCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zID0gcGFyc2VkO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldvcmtpbmcgZGlyZWN0b3J5XCIpXG4gICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBFbXB0eSB1c2VzIHRoZSBjdXJyZW50IG5vdGUgZm9sZGVyIHdoZW4gcG9zc2libGUsIG90aGVyd2lzZSB0aGUgdmF1bHQgcm9vdC5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiVmF1bHQgcm9vdFwiKS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkgPSB2YWx1ZS50cmltKCkgPyBub3JtYWxpemVQYXRoKHZhbHVlLnRyaW0oKSkgOiBcIlwiO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldyaXRlIG91dHB1dCBiYWNrIHRvIG5vdGVcIilcbiAgICAgIC5zZXREZXNjKFwiSW5zZXJ0IG1hbmFnZWQgbG9vbSBvdXRwdXQgc2VjdGlvbnMgYmVuZWF0aCBjb2RlIGJsb2NrcyBpbnN0ZWFkIG9mIGtlZXBpbmcgcmVzdWx0cyBwdXJlbHkgaW4gdGhlIFVJLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJWaXNpYmxlIG91dHB1dCBsaW5lc1wiKVxuICAgICAgLnNldERlc2MoXCJMaW1pdCBlYWNoIHN0ZG91dCwgc3RkZXJyLCBhbmQgd2FybmluZyBwYW5lbCB0byB0aGlzIG1hbnkgdmlzaWJsZSBsaW5lcy4gVXNlIDAgZm9yIHVubGltaXRlZCBvdXRwdXQuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIjBcIikuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vdXRwdXRWaXNpYmxlTGluZXMgPz8gMCkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZS50cmltKCksIDEwKTtcbiAgICAgICAgICBpZiAoIU51bWJlci5pc05hTihwYXJzZWQpICYmIHBhcnNlZCA+PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub3V0cHV0VmlzaWJsZUxpbmVzID0gTWF0aC5taW4ocGFyc2VkLCAyMDAwKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBdXRvLXJ1biBvbiBmaWxlIG9wZW5cIilcbiAgICAgIC5zZXREZXNjKFwiUnVuIGFsbCBzdXBwb3J0ZWQgYmxvY2tzIGluIHRoZSBhY3RpdmUgbm90ZSB3aGVuIGl0IG9wZW5zLiBEaXNhYmxlZCBieSBkZWZhdWx0LlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4gPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFeHRyYWN0ZWQgc291cmNlIHByZXZpZXdcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGhvdyBsb29tIHNob3dzIHRoZSBtYXRlcmlhbGl6ZWQgc291cmNlIGZvciBibG9ja3MgdGhhdCB1c2UgbG9vbS1maWxlLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY29sbGFwc2VkXCIsIFwiQ29sbGFwc2VkXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImV4cGFuZGVkXCIsIFwiRXhwYW5kZWRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiaGlkZGVuXCIsIFwiSGlkZGVuXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSB8fCBcImNvbGxhcHNlZFwiKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSA9IHZhbHVlIGFzIFwiY29sbGFwc2VkXCIgfCBcImV4cGFuZGVkXCIgfCBcImhpZGRlblwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJTaG93IGNhcGFiaWxpdHkgbWV0YWRhdGFcIilcbiAgICAgIC5zZXREZXNjKFwiU2hvdyBzeW1ib2wsIGRlcGVuZGVuY3ksIGFuZCBoYXJuZXNzIGNhcGFiaWxpdHkgbWV0YWRhdGEgaW4gZXh0cmFjdGVkIHNvdXJjZSBwcmV2aWV3IGhlYWRlcnMuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Muc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhID8/IHRydWUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJQREYgZXhwb3J0IG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHdoYXQgdG8gaW5jbHVkZSB3aGVuIGV4cG9ydGluZyBub3RlcyBjb250YWluaW5nIGxvb20gY29kZSBibG9ja3MgdG8gUERGLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiYm90aFwiLCBcIkJvdGggQ29kZSBhbmQgT3V0cHV0XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImNvZGVcIiwgXCJDb2RlIEJsb2NrIE9ubHlcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib3V0cHV0XCIsIFwiT3V0cHV0IE9ubHlcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgfHwgXCJib3RoXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPSB2YWx1ZSBhcyBcImJvdGhcIiB8IFwiY29kZVwiIHwgXCJvdXRwdXRcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckJ1aWx0SW5SdW50aW1lcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJweXRob25cIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUHl0aG9uIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgUHl0aG9uLlwiLCBcInB5dGhvbkV4ZWN1dGFibGVcIik7XG4gICAgfVxuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcImphdmFzY3JpcHRcIikpIHtcbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTm9kZSBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIEphdmFTY3JpcHQgZXhlY3V0aW9uLlwiLCBcIm5vZGVFeGVjdXRhYmxlXCIpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcInR5cGVzY3JpcHRcIikpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlR5cGVTY3JpcHQgcnVubmVyIG1vZGVcIilcbiAgICAgICAgLnNldERlc2MoXCJVc2UgdHMtbm9kZSBvciB0c3ggZm9yIFR5cGVTY3JpcHQgYmxvY2tzLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwidHMtbm9kZVwiLCBcInRzLW5vZGVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJ0c3hcIiwgXCJ0c3hcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9IHZhbHVlIGFzIFwidHMtbm9kZVwiIHwgXCJ0c3hcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiVHlwZVNjcmlwdCB0cmFuc3BpbGVyIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHRzLW5vZGUgb3IgdHN4LlwiLCBcInR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZVwiKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJvY2FtbFwiKSkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiT0NhbWwgbW9kZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNob29zZSBiZXR3ZWVuIHRoZSBPQ2FtbCB0b3BsZXZlbCwgb2NhbWxjIGNvbXBpbGF0aW9uLCBvciBkdW5lIGV4ZWMuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbFwiLCBcIm9jYW1sXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxjXCIsIFwib2NhbWxjXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiZHVuZVwiLCBcImR1bmVcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlID0gdmFsdWUgYXMgXCJvY2FtbFwiIHwgXCJvY2FtbGNcIiB8IFwiZHVuZVwiO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJPQ2FtbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBvY2FtbCwgb2NhbWxjLCBvciBkdW5lIGRlcGVuZGluZyBvbiB0aGUgc2VsZWN0ZWQgbW9kZS5cIiwgXCJvY2FtbEV4ZWN1dGFibGVcIik7XG4gICAgfVxuXG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImNcIl0sIFwiQyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMgYmxvY2tzLlwiLCBcImNFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJjcHBcIl0sIFwiQysrIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQysrIGJsb2Nrcy5cIiwgXCJjcHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJzaGVsbFwiXSwgXCJTaGVsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTaGVsbCwgQmFzaCwgYW5kIHNoIGJsb2Nrcy5cIiwgXCJzaGVsbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInJ1YnlcIl0sIFwiUnVieSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBSdWJ5IGJsb2Nrcy5cIiwgXCJydWJ5RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicGVybFwiXSwgXCJQZXJsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBlcmwgYmxvY2tzLlwiLCBcInBlcmxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJsdWFcIl0sIFwiTHVhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEx1YSBibG9ja3MuXCIsIFwibHVhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wicGhwXCJdLCBcIlBIUCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQSFAgYmxvY2tzLlwiLCBcInBocEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImdvXCJdLCBcIkdvIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEdvIGJsb2Nrcy5cIiwgXCJnb0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcInJ1c3RcIl0sIFwiUnVzdCBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIFJ1c3QgYmxvY2tzLlwiLCBcInJ1c3RFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJoYXNrZWxsXCJdLCBcIkhhc2tlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgSGFza2VsbCBibG9ja3MuIERlZmF1bHRzIHRvIHJ1bmdoYy5cIiwgXCJoYXNrZWxsRXhlY3V0YWJsZVwiKTtcbiAgICBpZiAodGhpcy5pc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQoXCJqYXZhXCIpKSB7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgY29tcGlsZXJcIiwgXCJPcHRpb25hbCBjb21tYW5kIG9yIHBhdGggZm9yIGphdmFjLiBMZWF2ZSBlbXB0eSB0byB1c2UgSmF2YSBzb3VyY2UtZmlsZSBtb2RlLlwiLCBcImphdmFDb21waWxlckV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBjb21waWxlZCBKYXZhIGJsb2Nrcy5cIiwgXCJqYXZhRXhlY3V0YWJsZVwiKTtcbiAgICB9XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImxsdm0taXJcIl0sIFwiTExWTSBJUiBpbnRlcnByZXRlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBMTFZNIElSIGJsb2NrcyB3aXRoIGxsaS5cIiwgXCJsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlXCIpO1xuICAgIGlmICh0aGlzLmlzUnVudGltZUxhbmd1YWdlRW5hYmxlZChcImVicGYtY1wiKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIGNsYW5nIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNsYW5nIHdpdGggQlBGIHRhcmdldCBzdXBwb3J0LlwiLCBcImVicGZDbGFuZ0V4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgYnBmdG9vbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBicGZ0b29sIHZlcmlmaWVyIGFuZCBsb2FkIG9wZXJhdGlvbnMuXCIsIFwiZWJwZkJwZnRvb2xFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJlQlBGIG9iamVjdCBpbnNwZWN0b3JcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGxsdm0tb2JqZHVtcC4gTGVhdmUgZW1wdHkgdG8gc2tpcCBvYmplY3Qgc2VjdGlvbiBpbnNwZWN0aW9uLlwiLCBcImVicGZMbHZtT2JqZHVtcEV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcImVCUEYgaW5jbHVkZSBwYXRoc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBpbmNsdWRlIGRpcmVjdG9yaWVzIHBhc3NlZCB0byBjbGFuZyB3aXRoIC1JLlwiLCBcImVicGZJbmNsdWRlUGF0aHNcIik7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJBbGxvdyBlQlBGIGtlcm5lbCBsb2FkXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVxdWlyZWQgYmVmb3JlIGFueSBibG9jayBjYW4gdXNlIGxvb20tZWJwZi1tb2RlPWxvYWQuIENvbXBpbGUtb25seSBtb2RlIHN0YXlzIGF2YWlsYWJsZSB3aXRob3V0IHRoaXMuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVicGZBbGxvd0tlcm5lbExvYWQpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVicGZBbGxvd0tlcm5lbExvYWQgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImJwZnRyYWNlXCJdLCBcImJwZnRyYWNlIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGJwZnRyYWNlIHNjcmlwdHMuXCIsIFwiYnBmdHJhY2VFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkUnVudGltZVRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBbXCJsZWFuXCJdLCBcIkxlYW4gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgTGVhbiBibG9ja3MuXCIsIFwibGVhbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRSdW50aW1lVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFtcImNvcVwiXSwgXCJDb3EgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgQ29xIGJsb2NrcyB3aXRoIGNvcWMuXCIsIFwiY29xRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFJ1bnRpbWVUZXh0U2V0dGluZyhjb250YWluZXJFbCwgW1wic210bGliXCJdLCBcIlNNVCBzb2x2ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNNVC1MSUIgYmxvY2tzLiBEZWZhdWx0cyB0byB6My5cIiwgXCJzbXRFeGVjdXRhYmxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRSdW50aW1lVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21QbHVnaW5TZXR0aW5ncz4oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCBsYW5ndWFnZUlkczogc3RyaW5nW10sIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XG4gICAgaWYgKGxhbmd1YWdlSWRzLnNvbWUoKGxhbmd1YWdlSWQpID0+IHRoaXMuaXNSdW50aW1lTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQpKSkge1xuICAgICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgbmFtZSwgZGVzY3JpcHRpb24sIGtleSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1J1bnRpbWVMYW5ndWFnZUVuYWJsZWQobGFuZ3VhZ2VJZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGFuZ3VhZ2VFbmFibGVkKGxhbmd1YWdlSWQsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckxhbmd1YWdlUGFja2FnZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbm9ybWFsaXplTGFuZ3VhZ2VDb25maWd1cmF0aW9uKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG5cbiAgICBmb3IgKGNvbnN0IHBhY2sgb2YgQlVJTFRfSU5fTEFOR1VBR0VfUEFDS0FHRVMpIHtcbiAgICAgIGNvbnN0IHBhY2tFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWxhbmd1YWdlLXBhY2thZ2VcIiB9KTtcbiAgICAgIHBhY2tFbC5vcGVuID0gdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzLmluY2x1ZGVzKHBhY2suaWQpO1xuICAgICAgcGFja0VsLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IHBhY2suZGlzcGxheU5hbWUgfSk7XG4gICAgICBwYWNrRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogcGFjay5kZXNjcmlwdGlvbiwgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhwYWNrRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRW5hYmxlIHBhY2thZ2VcIilcbiAgICAgICAgLnNldERlc2MoXCJEaXNhYmxlIHRoaXMgdG8gcmVtb3ZlIHRoZSBwYWNrYWdlIGxhbmd1YWdlcyBmcm9tIHBhcnNpbmcsIGNvbW1hbmQgbWVudXMsIGFuZCBydW5uZXJzIGZvciB0aGlzIHZhdWx0LlwiKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhwYWNrLmlkKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNldEVuYWJsZWRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MsIHBhY2suaWQsIHZhbHVlKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2YgcGFjay5sYW5ndWFnZXMpIHtcbiAgICAgICAgICAgICAgdGhpcy5zZXRFbmFibGVkVmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMsIGxhbmd1YWdlLmlkLCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgcGFja2FnZUVuYWJsZWQgPSB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlZExhbmd1YWdlUGFja3MuaW5jbHVkZXMocGFjay5pZCk7XG4gICAgICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHBhY2subGFuZ3VhZ2VzKSB7XG4gICAgICAgIG5ldyBTZXR0aW5nKHBhY2tFbClcbiAgICAgICAgICAuc2V0TmFtZShsYW5ndWFnZS5kaXNwbGF5TmFtZSlcbiAgICAgICAgICAuc2V0RGVzYyhgQWxpYXNlczogJHtsYW5ndWFnZS5hbGlhc2VzLmpvaW4oXCIsIFwiKX1gKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoIXBhY2thZ2VFbmFibGVkKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUocGFja2FnZUVuYWJsZWQgJiYgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMuaW5jbHVkZXMobGFuZ3VhZ2UuaWQpKVxuICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRFbmFibGVkVmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZXMsIGxhbmd1YWdlLmlkLCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJDdXN0b20gbGFuZ3VhZ2VzXCIpXG4gICAgICAuc2V0RGVzYyhcIkVuYWJsZSB1c2VyLWRlZmluZWQgbGFuZ3VhZ2VzIGZyb20gdGhlIEN1c3RvbSBMYW5ndWFnZXMgc2VjdGlvbi5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcy5pbmNsdWRlcyhDVVNUT01fTEFOR1VBR0VfUEFDS0FHRV9JRCkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMuc2V0RW5hYmxlZFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VQYWNrcywgQ1VTVE9NX0xBTkdVQUdFX1BBQ0tBR0VfSUQsIHZhbHVlKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJSZXNldCBsYW5ndWFnZSBwYWNrYWdlc1wiKVxuICAgICAgLnNldERlc2MoXCJSZS1lbmFibGUgZXZlcnkgYnVpbHQtaW4gcGFja2FnZSBhbmQgZXZlcnkgYnVpbHQtaW4gbGFuZ3VhZ2UuXCIpXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiUmVzZXRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZWRMYW5ndWFnZVBhY2tzID0gZ2V0RGVmYXVsdExhbmd1YWdlUGFja0lkcygpO1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVkTGFuZ3VhZ2VzID0gZ2V0RGVmYXVsdExhbmd1YWdlSWRzKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHNldEVuYWJsZWRWYWx1ZSh2YWx1ZXM6IHN0cmluZ1tdLCBpZDogc3RyaW5nLCBlbmFibGVkOiBib29sZWFuKTogdm9pZCB7XG4gICAgY29uc3QgaW5kZXggPSB2YWx1ZXMuaW5kZXhPZihpZCk7XG4gICAgaWYgKGVuYWJsZWQgJiYgaW5kZXggPCAwKSB7XG4gICAgICB2YWx1ZXMucHVzaChpZCk7XG4gICAgfSBlbHNlIGlmICghZW5hYmxlZCAmJiBpbmRleCA+PSAwKSB7XG4gICAgICB2YWx1ZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtbGlzdFwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGxpc3RFbCk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQWRkIGN1c3RvbSBsYW5ndWFnZVwiKVxuICAgICAgLnNldERlc2MoXCJDcmVhdGUgYSBuZXcgbG9jYWwgY29tbWFuZC1iYWNrZWQgbGFuZ3VhZ2UuXCIpXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogXCJjdXN0b20tbGFuZ3VhZ2VcIixcbiAgICAgICAgICAgIGFsaWFzZXM6IFwiXCIsXG4gICAgICAgICAgICBleGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgYXJnczogXCJ7ZmlsZX1cIixcbiAgICAgICAgICAgIGV4dGVuc2lvbjogXCIudHh0XCIsXG4gICAgICAgICAgICBleHRyYWN0b3JNb2RlOiBcImNvbW1hbmRcIixcbiAgICAgICAgICAgIGV4dHJhY3RvckV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICBleHRyYWN0b3JBcmdzOiBcIntyZXF1ZXN0fVwiLFxuICAgICAgICAgICAgdHJhbnNwaWxlRXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIHRyYW5zcGlsZUFyZ3M6IFwie3JlcXVlc3R9XCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgaWYgKCF0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmxlbmd0aCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBjdXN0b20gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZm9yRWFjaCgobGFuZ3VhZ2UsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlXCIgfSk7XG4gICAgICBkZXRhaWxzLm9wZW4gPSB0cnVlO1xuICAgICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiBsYW5ndWFnZS5uYW1lIHx8IGBDdXN0b20gbGFuZ3VhZ2UgJHtpbmRleCArIDF9YCB9KTtcbiAgICAgIGNvbnN0IGJvZHkgPSBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1ib2R5XCIgfSk7XG5cbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJOYW1lXCIsIFwiTm9ybWFsaXplZCBsYW5ndWFnZSBpZCB1c2VkIGJ5IGxvb20uXCIsIFwibmFtZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBbGlhc2VzXCIsIFwiQ29tbWEtc2VwYXJhdGVkIGZlbmNlIGFsaWFzZXMuXCIsIFwiYWxpYXNlc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeGVjdXRhYmxlXCIsIFwiTG9jYWwgY29tbWFuZCBvciBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGguXCIsIFwiZXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBcmd1bWVudHNcIiwgXCJTcGFjZS1zZXBhcmF0ZWQgYXJndW1lbnRzLiBVc2Uge2ZpbGV9IGZvciB0aGUgdGVtcCBzb3VyY2UgZmlsZS5cIiwgXCJhcmdzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dGVuc2lvblwiLCBcIlRlbXAgc291cmNlIGZpbGUgZXh0ZW5zaW9uLCBmb3IgZXhhbXBsZSAucHkuXCIsIFwiZXh0ZW5zaW9uXCIpO1xuXG4gICAgICBuZXcgU2V0dGluZyhib2R5KVxuICAgICAgICAuc2V0TmFtZShcIlBhcnRpYWwgZXh0cmFjdGlvbiBzdHJhdGVneVwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNob29zZSBob3cgdGhpcyBjdXN0b20gbGFuZ3VhZ2Ugc3VwcG9ydHMgcGFydGlhbCBydW5uYWJsZSBzb3VyY2UuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJjb21tYW5kXCIsIFwiRXh0cmFjdG9yIGNvbW1hbmRcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJ0cmFuc3BpbGUtY1wiLCBcIlRyYW5zcGlsZSB0byBDXCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUobGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSB8fCBcImNvbW1hbmRcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgbGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSA9IHZhbHVlIGFzIFwiY29tbWFuZFwiIHwgXCJ0cmFuc3BpbGUtY1wiO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dHJhY3RvciBleGVjdXRhYmxlXCIsIFwiT3B0aW9uYWwgY29tbWFuZCBmb3IgcGFydGlhbCBzb3VyY2UgZXh0cmFjdGlvbi4gTGVhdmUgZW1wdHkgdG8gdXNlIGdlbmVyaWMgbGluZSBhbmQgc3ltYm9sIGV4dHJhY3Rpb24uXCIsIFwiZXh0cmFjdG9yRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRyYWN0b3IgYXJndW1lbnRzXCIsIFwiQXJndW1lbnRzIGZvciB0aGUgZXh0cmFjdG9yLiBVc2Uge3JlcXVlc3R9LCB7c291cmNlfSwge2hhcm5lc3N9LCB7c3ltYm9sfSwge2xpbmVTdGFydH0sIHtsaW5lRW5kfSwge2RlcHN9LCBhbmQge2xhbmd1YWdlfS5cIiwgXCJleHRyYWN0b3JBcmdzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIlRyYW5zcGlsZSB0byBDIGV4ZWN1dGFibGVcIiwgXCJPcHRpb25hbCBjb21tYW5kIHRoYXQgZW1pdHMgZ2VuZXJhdGVkIEMgYW5kIGEgc3ltYm9sIG1hcCBhcyBKU09OLlwiLCBcInRyYW5zcGlsZUV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiVHJhbnNwaWxlIHRvIEMgYXJndW1lbnRzXCIsIFwiQXJndW1lbnRzIGZvciB0aGUgdHJhbnNwaWxlci4gVXNlIHRoZSBzYW1lIHBsYWNlaG9sZGVycyBhcyBleHRyYWN0b3IgYXJndW1lbnRzLlwiLCBcInRyYW5zcGlsZUFyZ3NcIik7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGJvZHkpXG4gICAgICAgIC5zZXROYW1lKFwiRGVsZXRlIGxhbmd1YWdlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVtb3ZlIHRoaXMgY3VzdG9tIGxhbmd1YWdlLlwiKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJEZWxldGVcIikuc2V0V2FybmluZygpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbmRlckNvbnRhaW5lckdyb3Vwcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5sb29tUGx1Z2luLmdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkRlZmF1bHQgY29udGFpbmVyaXphdGlvbiBncm91cFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlRoZSBjb250YWluZXIgZ3JvdXAgdG8gcnVuIGNvZGUgYmxvY2tzIGluIGJ5IGRlZmF1bHQgaWYgdGhlIG5vdGUgZG9lcyBub3Qgc3BlY2lmeSBvbmUuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oXCJcIiwgXCJOb25lXCIpO1xuICAgICAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oZ3JvdXAubmFtZSwgZ3JvdXAubmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAgfHwgXCJcIik7XG4gICAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJBZGQgbmV3IGNvbnRhaW5lcml6YXRpb24gZ3JvdXBcIilcbiAgICAgICAgLnNldERlc2MoXCJDcmVhdGUgYSBuZXcgY29udGFpbmVyaXphdGlvbiBncm91cCBjb25maWd1cmF0aW9uIGZvbGRlci5cIilcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgIG5ldyBDb250YWluZXJHcm91cE5hbWVNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKGdyb3VwTmFtZSkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBjbGVhbk5hbWUgPSBncm91cE5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTlfLV0vZywgXCItXCIpO1xuICAgICAgICAgICAgICBpZiAoIWNsZWFuTmFtZSkge1xuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIGdyb3VwIG5hbWUuXCIpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHBsdWdpbkRpciA9IHRoaXMubG9vbVBsdWdpbi5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCI7XG4gICAgICAgICAgICAgIGNvbnN0IGdyb3VwUmVsYXRpdmVQYXRoID0gYCR7cGx1Z2luRGlyfS9jb250YWluZXJzLyR7Y2xlYW5OYW1lfWA7XG4gICAgICAgICAgICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHtncm91cFJlbGF0aXZlUGF0aH0vY29uZmlnLmpzb25gO1xuXG4gICAgICAgICAgICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgICAgICAgICAgICBpZiAoYXdhaXQgYWRhcHRlci5leGlzdHMoZ3JvdXBSZWxhdGl2ZVBhdGgpKSB7XG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkNvbnRhaW5lciBncm91cCBmb2xkZXIgYWxyZWFkeSBleGlzdHMuXCIpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGF3YWl0IGFkYXB0ZXIubWtkaXIoZ3JvdXBSZWxhdGl2ZVBhdGgpO1xuICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0Q29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJ1bnRpbWU6IFwiZG9ja2VyXCIsXG4gICAgICAgICAgICAgICAgaW1hZ2U6IFwidWJ1bnR1OmxhdGVzdFwiLFxuICAgICAgICAgICAgICAgIGxhbmd1YWdlczoge1xuICAgICAgICAgICAgICAgICAgcHl0aG9uOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbW1hbmQ6IFwicHl0aG9uMyB7ZmlsZX1cIixcbiAgICAgICAgICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5weVwiXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGNvbmZpZ1BhdGgsIEpTT04uc3RyaW5naWZ5KGRlZmF1bHRDb25maWcsIG51bGwsIDIpKTtcbiAgICAgICAgICAgICAgbmV3IE5vdGljZShgQ29udGFpbmVyIGdyb3VwIFwiJHtjbGVhbk5hbWV9XCIgY3JlYXRlZC5gKTtcbiAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICB9KS5vcGVuKCk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWNvbnRhaW5lci1ncm91cC1saXN0XCIgfSk7XG4gICAgICBpZiAoIWdyb3Vwcy5sZW5ndGgpIHtcbiAgICAgICAgbGlzdEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgICAgdGV4dDogXCJObyBjb250YWluZXIgZ3JvdXBzIGZvdW5kIGluIC5vYnNpZGlhbi9wbHVnaW5zL2xvb20vY29udGFpbmVycy5cIixcbiAgICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgIG5ldyBTZXR0aW5nKGxpc3RFbClcbiAgICAgICAgICAuc2V0TmFtZShncm91cC5uYW1lKVxuICAgICAgICAgIC5zZXREZXNjKGdyb3VwLnN0YXR1cylcbiAgICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkJ1aWxkIC8gcmVidWlsZFwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLmJ1aWxkQ29udGFpbmVyR3JvdXAoZ3JvdXAubmFtZSk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJFZGl0XCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwbHVnaW5EaXIgPSB0aGlzLmxvb21QbHVnaW4ubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiO1xuICAgICAgICAgICAgICBuZXcgRWRpdENvbnRhaW5lckdyb3VwTW9kYWwodGhpcy5sb29tUGx1Z2luLCBncm91cC5uYW1lLCBwbHVnaW5EaXIsICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IGBFcnJvciBsb2FkaW5nIGNvbnRhaW5lciBncm91cHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgIGNsczogXCJsb29tLXNldHRpbmdzLWVycm9yXCIsXG4gICAgICAgIGF0dHI6IHsgc3R5bGU6IFwiY29sb3I6IHZhcigtLXRleHQtZXJyb3IpOyBmb250LXdlaWdodDogYm9sZDsgbWFyZ2luOiAxZW0gMDtcIiB9XG4gICAgICB9KTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJsb29tOiBmYWlsZWQgdG8gcmVuZGVyIGNvbnRhaW5lciBncm91cHM6XCIsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFkZFRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tUGx1Z2luU2V0dGluZ3M+KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgbmFtZTogc3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCBrZXk6IEspOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSA/PyBcIlwiKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldIGFzIHN0cmluZykgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21DdXN0b21MYW5ndWFnZT4oXG4gICAgY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LFxuICAgIGxhbmd1YWdlOiBsb29tQ3VzdG9tTGFuZ3VhZ2UsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRlc2NyaXB0aW9uOiBzdHJpbmcsXG4gICAga2V5OiBLLFxuICApOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFZhbHVlKFN0cmluZyhsYW5ndWFnZVtrZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAobGFuZ3VhZ2Vba2V5XSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UoKTogdm9pZCB7XG4gIG5ldyBOb3RpY2UoXCJsb29tIGxvY2FsIGV4ZWN1dGlvbiBpcyBkaXNhYmxlZC4gRW5hYmxlIGl0IGluIHNldHRpbmdzIG9yIGNvbmZpcm0gdGhlIGV4ZWN1dGlvbiB3YXJuaW5nIGZpcnN0LlwiKTtcbn1cblxuY2xhc3MgQ29udGFpbmVyR3JvdXBOYW1lTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgbmFtZSA9IFwiXCI7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvblN1Ym1pdDogKG5hbWU6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiTmV3IENvbnRhaW5lciBHcm91cCBOYW1lXCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIkdyb3VwIE5hbWVcIilcbiAgICAgIC5zZXREZXNjKFwiVXNlIGxvd2VyY2FzZSBsZXR0ZXJzLCBudW1iZXJzLCBoeXBoZW5zLCBhbmQgdW5kZXJzY29yZXMuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMub25TdWJtaXQodGhpcy5uYW1lKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cblxuY2xhc3MgRWRpdENvbnRhaW5lckdyb3VwTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgYWN0aXZlVGFiOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCIgPSBcImdlbmVyYWxcIjtcbiAgcHJpdmF0ZSBjb25maWdPYmo6IGFueSA9IHt9O1xuICBwcml2YXRlIHJhd0pzb25UZXh0ID0gXCJcIjtcbiAgcHJpdmF0ZSBkb2NrZXJmaWxlVGV4dDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbmV3TGFuZ3VhZ2VOYW1lID0gXCJcIjtcbiAgcHJpdmF0ZSB0YWJIZWFkZXJFbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIHRhYkNvbnRlbnRFbCE6IEhUTUxFbGVtZW50O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9vbVBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvblNhdmU6ICgpID0+IHZvaWRcbiAgKSB7XG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHApO1xuICB9XG5cbiAgYXN5bmMgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogYEVkaXQgQ29uZmlnOiAke3RoaXMuZ3JvdXBOYW1lfWAgfSk7XG5cbiAgICBjb25zdCBjb25maWdQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vY29uZmlnLmpzb25gO1xuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmF3Q29uZmlnID0gYXdhaXQgYWRhcHRlci5yZWFkKGNvbmZpZ1BhdGgpO1xuICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHJhd0NvbmZpZyk7XG4gICAgICB0aGlzLnJhd0pzb25UZXh0ID0gcmF3Q29uZmlnO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJDb3VsZCBub3QgcmVhZCBjb25maWd1cmF0aW9uIGZpbGUuXCIpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgYWRhcHRlci5leGlzdHMoZG9ja2VyZmlsZVBhdGgpKSB7XG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBhd2FpdCBhZGFwdGVyLnJlYWQoZG9ja2VyZmlsZVBhdGgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IG51bGw7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgY29udGFpbmVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1jb250YWluZXJcIiB9KTtcblxuICAgIC8vIFJlbmRlciBUYWIgSGVhZGVyXG4gICAgdGhpcy50YWJIZWFkZXJFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItaGVhZGVyXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XG5cbiAgICAvLyBSZW5kZXIgVGFiIENvbnRlbnQgQXJlYVxuICAgIHRoaXMudGFiQ29udGVudEVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1jb250ZW50XCIgfSk7XG5cbiAgICAvLyBSZW5kZXIgQWN0aW9ucyBGb290ZXJcbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcbiAgICBjb25zdCBzYXZlQnRuID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiU2F2ZVwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuICAgIHNhdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZUFuZENsb3NlKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICB9XG5cbiAgcmVuZGVyVGFicygpIHtcbiAgICB0aGlzLnRhYkhlYWRlckVsLmVtcHR5KCk7XG4gICAgY29uc3QgdGFiczogQXJyYXk8eyBpZDogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiOyBsYWJlbDogc3RyaW5nIH0+ID0gW1xuICAgICAgeyBpZDogXCJnZW5lcmFsXCIsIGxhYmVsOiBcIkdlbmVyYWxcIiB9LFxuICAgICAgeyBpZDogXCJsYW5ndWFnZXNcIiwgbGFiZWw6IFwiTGFuZ3VhZ2VzXCIgfSxcbiAgICAgIHsgaWQ6IFwiZG9ja2VyZmlsZVwiLCBsYWJlbDogXCJEb2NrZXJmaWxlXCIgfSxcbiAgICAgIHsgaWQ6IFwicmF3XCIsIGxhYmVsOiBcIlJhdyBKU09OXCIgfSxcbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCB0YWIgb2YgdGFicykge1xuICAgICAgY29uc3QgYnRuID0gdGhpcy50YWJIZWFkZXJFbC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIHRleHQ6IHRhYi5sYWJlbCxcbiAgICAgICAgY2xzOiBcImxvb20tdGFiLWJ0blwiICsgKHRoaXMuYWN0aXZlVGFiID09PSB0YWIuaWQgPyBcIiBpcy1hY3RpdmVcIiA6IFwiXCIpLFxuICAgICAgfSk7XG4gICAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLnN3aXRjaFRhYih0YWIuaWQpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc3dpdGNoVGFiKHRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiKSB7XG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIEpTT04gc3ludGF4IGluIFJhdyBKU09OIHRhYi4gUGxlYXNlIGZpeCBpdCBiZWZvcmUgc3dpdGNoaW5nLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmFjdGl2ZVRhYiA9IHRhYjtcbiAgICB0aGlzLnJlbmRlclRhYnMoKTtcbiAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICB9XG5cbiAgcmVuZGVyQWN0aXZlVGFiKCkge1xuICAgIHRoaXMudGFiQ29udGVudEVsLmVtcHR5KCk7XG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImdlbmVyYWxcIikge1xuICAgICAgdGhpcy5yZW5kZXJHZW5lcmFsVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImxhbmd1YWdlc1wiKSB7XG4gICAgICB0aGlzLnJlbmRlckxhbmd1YWdlc1RhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJkb2NrZXJmaWxlXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyRG9ja2VyZmlsZVRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdGhpcy5yZW5kZXJSYXdUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlckdlbmVyYWxUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgLy8gUnVudGltZSBzZWxlY3QgZHJvcGRvd25cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUnVudGltZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgdGhlIGNvbnRhaW5lci9lbnZpcm9ubWVudCBtYW5hZ2VyIHJ1bnRpbWUuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImRvY2tlclwiLCBcIkRvY2tlclwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJwb2RtYW5cIiwgXCJQb2RtYW5cIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwid3NsXCIsIFwiV1NMXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInFlbXVcIiwgXCJRRU1VXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImN1c3RvbVwiLCBcIkN1c3RvbVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5ydW50aW1lIHx8IFwiZG9ja2VyXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgLy8gQ29uZGl0aW9uYWwgaW1hZ2UvZGlzdHJvIG5hbWVcbiAgICBpZiAoXG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImRvY2tlclwiIHx8XG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiIHx8XG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiXG4gICAgKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIiA/IFwiV1NMIERpc3Ryb1wiIDogXCJCYXNlIEltYWdlXCIpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCJcbiAgICAgICAgICAgID8gXCJPcHRpb25hbC4gVGhlIHRhcmdldCBXU0wgZGlzdHJvIG5hbWUgKGxlYXZlIGVtcHR5IGZvciBkZWZhdWx0IGRpc3RybykuXCJcbiAgICAgICAgICAgIDogXCJGYWxsYmFjayBEb2NrZXIvUG9kbWFuIGltYWdlIGlmIG5vIERvY2tlcmZpbGUgaXMgcHJlc2VudC5cIlxuICAgICAgICApXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmltYWdlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5pbWFnZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoud3NsKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLndzbCA9IHt9O1xuICAgICAgfVxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiVXNlIEludGVyYWN0aXZlIFNoZWxsXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVXNlIGludGVyYWN0aXZlIGxvZ2luIHNoZWxsIGZsYWdzICgtaSAtbCkgdG8gZW5zdXJlIH4vLmJhc2hyYyBpbml0aWFsaXphdGlvbiB3b3JrcyAoZS5nLiwgZm9yIE5WTSkuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA/PyBmYWxzZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA9IHZhbDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBRRU1VIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnFlbXUpIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdSA9IHsgc3NoVGFyZ2V0OiBcIlwiLCByZW1vdGVXb3Jrc3BhY2U6IFwiXCIgfTtcbiAgICAgIH1cblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIFRhcmdldFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlNTSCB0YXJnZXQgYWRkcmVzcyAoZS5nLiB1c2VyQGhvc3RuYW1lIG9yIGxvY2FsaG9zdCAtcCAyMjIyKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0ID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiUmVtb3RlIFdvcmtzcGFjZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW90ZSBmb2xkZXIgcGF0aCB0byBjb3B5IGNvZGUgc25pcHBldHMgYW5kIHJ1biBjb21tYW5kcyAoZS5nLiwgL2hvbWUvdXNlci93b3Jrc3BhY2UpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnJlbW90ZVdvcmtzcGFjZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBQYXRoIHRvIFNTSCBjbGllbnQgZXhlY3V0YWJsZSAoZGVmYXVsdHMgdG8gc3NoKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEV4ZWN1dGFibGUgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBBZGRpdGlvbmFsIFNTSCBDTEkgZmxhZ3MuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoQXJncyB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hBcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZGl0aW9uYWwgQ3VzdG9tIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmouY3VzdG9tKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbSA9IHsgZXhlY3V0YWJsZTogXCJcIiB9O1xuICAgICAgfVxuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJDdXN0b20gRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlBhdGggdG8gY3VzdG9tIHJ1bnRpbWUgd3JhcHBlciBleGVjdXRhYmxlIG9yIHNjcmlwdC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBDb21tYW5kIGFyZ3VtZW50cy4gVXNlIHtyZXF1ZXN0fSBmb3IgSlNPTiBjb25maWcgcGF0aC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmFyZ3MgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyTGFuZ3VhZ2VzVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIkNvbmZpZ3VyZWQgTGFuZ3VhZ2VzXCIgfSk7XG5cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcykge1xuICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzID0ge307XG4gICAgfVxuXG4gICAgY29uc3QgbGFuZ3NMaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1sYW5ndWFnZXMtbGlzdFwiIH0pO1xuICAgIGNvbnN0IGxhbmd1YWdlcyA9IE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcyBhcyBSZWNvcmQ8c3RyaW5nLCB7IGNvbW1hbmQ/OiBzdHJpbmc7IGV4dGVuc2lvbj86IHN0cmluZzsgdXNlRGVmYXVsdD86IGJvb2xlYW4gfT4pO1xuXG4gICAgaWYgKGxhbmd1YWdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGxhbmdzTGlzdEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiTm8gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQgZm9yIHRoaXMgZ3JvdXAuXCIsIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIiB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChjb25zdCBbbGFuZ05hbWUsIGxhbmdDb25maWddIG9mIGxhbmd1YWdlcykge1xuICAgICAgICBjb25zdCBjYXJkID0gbGFuZ3NMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbGFuZ3VhZ2UtY2FyZFwiIH0pO1xuICAgICAgICBjYXJkLmNyZWF0ZUVsKFwic3Ryb25nXCIsIHsgdGV4dDogbGFuZ05hbWUsIGF0dHI6IHsgc3R5bGU6IFwiZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDAuNXJlbTsgZm9udC1zaXplOiAxLjFlbTtcIiB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGlzRGVmYXVsdCA9IChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiVXNlIGRlZmF1bHQgY29uZmlndXJhdGlvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiSWYgY2hlY2tlZCwgTG9vbSB3aWxsIHJ1biB0aGlzIGxhbmd1YWdlIHVzaW5nIGl0cyBidWlsdC1pbiBjb21tYW5kcy9leHRlbnNpb25zLlwiKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHZhbCkge1xuICAgICAgICAgICAgICAgICAgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSBsYW5nQ29uZmlnLmNvbW1hbmQ7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgbGFuZ0NvbmZpZy5leHRlbnNpb247XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQ7XG4gICAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIjtcbiAgICAgICAgICAgICAgICAgIGxhbmdDb25maWcuZXh0ZW5zaW9uID0gZGVmYXVsdHM/LmV4dGVuc2lvbiB8fCBcIlwiO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiQ29tbWFuZFwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiRXhlY3V0aW9uIGNvbW1hbmQuIFVzZSB7ZmlsZX0gZm9yIHRoZSBjb2RlIHNuaXBwZXQgZmlsZW5hbWUuXCIpXG4gICAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0cz8uY29tbWFuZCB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5jb21tYW5kIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIkV4dGVuc2lvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiU291cmNlIGZpbGUgZXh0ZW5zaW9uIChlLmcuIC5weSwgLmpzKS5cIilcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgIHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuZXh0ZW5zaW9uIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICAgICAgYnRuXG4gICAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVtb3ZlIExhbmd1YWdlXCIpXG4gICAgICAgICAgICAgIC5zZXRXYXJuaW5nKClcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbbGFuZ05hbWVdO1xuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFkZCBMYW5ndWFnZSBTZWN0aW9uXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQWRkIExhbmd1YWdlIE1hcHBpbmdcIiwgYXR0cjogeyBzdHlsZTogXCJtYXJnaW4tdG9wOiAxLjVyZW07XCIgfSB9KTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiTGFuZ3VhZ2UgSURcIilcbiAgICAgIC5zZXREZXNjKFwiZS5nLiBweXRob24sIGphdmFzY3JpcHQsIG5vZGUsIHNoXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMubmV3TGFuZ3VhZ2VOYW1lKS5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSB2YWwudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIisgQWRkXCIpLnNldEN0YSgpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIGlmICghdGhpcy5uZXdMYW5ndWFnZU5hbWUpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJQbGVhc2UgZW50ZXIgYSBsYW5ndWFnZSBuYW1lLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1t0aGlzLm5ld0xhbmd1YWdlTmFtZV0pIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJMYW5ndWFnZSBhbHJlYWR5IGNvbmZpZ3VyZWQuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbdGhpcy5uZXdMYW5ndWFnZU5hbWVdID0ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9IHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IGAuJHt0aGlzLm5ld0xhbmd1YWdlTmFtZX1gLFxuICAgICAgICAgIH07XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xuICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICByZW5kZXJEb2NrZXJmaWxlVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lICE9PSBcImRvY2tlclwiICYmIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwicG9kbWFuXCIpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IGBEb2NrZXJmaWxlIGVkaXRpbmcgaXMgb25seSBhdmFpbGFibGUgZm9yIERvY2tlciBhbmQgUG9kbWFuIHJ1bnRpbWVzLiBDdXJyZW50bHkgdXNpbmc6ICR7dGhpcy5jb25maWdPYmoucnVudGltZX1gLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCA9PT0gbnVsbCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBEb2NrZXJmaWxlIGV4aXN0cyBpbiB0aGlzIGNvbnRhaW5lciBncm91cCBkaXJlY3RvcnkuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgICAgYnRuXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZSBEb2NrZXJmaWxlXCIpXG4gICAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IFtcbiAgICAgICAgICAgICAgICBcIkZST00gdWJ1bnR1OmxhdGVzdFwiLFxuICAgICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgICAgXCIjIEluc3RhbGwgcGFja2FnZXNcIixcbiAgICAgICAgICAgICAgICBcIlJVTiBhcHQtZ2V0IHVwZGF0ZSAmJiBhcHQtZ2V0IGluc3RhbGwgLXkgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIHB5dGhvbjMgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIG5vZGVqcyBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgJiYgcm0gLXJmIC92YXIvbGliL2FwdC9saXN0cy8qXCIsXG4gICAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgXS5qb2luKFwiXFxuXCIpO1xuICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEb2NrZXJmaWxlIENvbnRlbnRcIilcbiAgICAgICAgLnNldERlc2MoXCJEZWZpbmUgdGhlIGJ1aWxkIHN0ZXBzIGZvciB5b3VyIGVudmlyb25tZW50IGNvbnRhaW5lci5cIilcbiAgICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLmRvY2tlcmZpbGVUZXh0IHx8IFwiXCIpO1xuICAgICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IHZhbDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyUmF3VGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIHRoaXMucmF3SnNvblRleHQgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkNvbmZpZ3VyYXRpb24gSlNPTlwiKVxuICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuaW5wdXRFbC5yb3dzID0gMTU7XG4gICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgIHRoaXMucmF3SnNvblRleHQgPSB2YWw7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBhc3luYyBzYXZlQW5kQ2xvc2UoKSB7XG4gICAgLy8gSWYgdGhlIGFjdGl2ZSB0YWIgaXMgcmF3IEpTT04sIHBhcnNlIGl0IGZpcnN0IHRvIGVuc3VyZSB3ZSBjYXB0dXJlIGVkaXRzXG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIEpTT04gc3ludGF4IGluIFJhdyBKU09OIHRhYi4gUGxlYXNlIGZpeCBpdCBiZWZvcmUgc2F2aW5nLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEJhc2ljIFZhbGlkYXRpb25cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnJ1bnRpbWUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJSdW50aW1lIGlzIHJlcXVpcmVkLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmICghdGhpcy5jb25maWdPYmoucWVtdT8uc3NoVGFyZ2V0IHx8ICF0aGlzLmNvbmZpZ09iai5xZW11Py5yZW1vdGVXb3Jrc3BhY2UpKSB7XG4gICAgICBuZXcgTm90aWNlKFwiUUVNVSBydW50aW1lIHJlcXVpcmVzIFNTSCBUYXJnZXQgYW5kIFJlbW90ZSBXb3Jrc3BhY2UuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIiAmJiAhdGhpcy5jb25maWdPYmouY3VzdG9tPy5leGVjdXRhYmxlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgQ3VzdG9tIEV4ZWN1dGFibGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9jb25maWcuanNvbmA7XG4gICAgY29uc3QgZG9ja2VyZmlsZVBhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9Eb2NrZXJmaWxlYDtcblxuICAgIHRyeSB7XG4gICAgICAvLyBTYXZlIGNvbmZpZy5qc29uXG4gICAgICBjb25zdCBjb25maWdTdHIgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGNvbmZpZ1BhdGgsIGNvbmZpZ1N0cik7XG5cbiAgICAgIC8vIFNhdmUgRG9ja2VyZmlsZVxuICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIikge1xuICAgICAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCAhPT0gbnVsbCkge1xuICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoZG9ja2VyZmlsZVBhdGgsIHRoaXMuZG9ja2VyZmlsZVRleHQpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgY29uZmlndXJhdGlvbnMgc2F2ZWQuXCIpO1xuICAgICAgdGhpcy5vblNhdmUoKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbmV3IE5vdGljZShgU2F2ZSBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cbiAgfVxufVxuIiwgImltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB7IG1rZHRlbXAsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gXCJvc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21Tb3VyY2VSZWZlcmVuY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuL3V0aWxzL2NvbW1hbmRcIjtcblxuaW50ZXJmYWNlIFNvdXJjZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBTb3VyY2VEZWZpbml0aW9uIGV4dGVuZHMgU291cmNlUmFuZ2Uge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5hbWVzPzogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBQeXRob25BbGlhcyB7XG4gIG5hbWU6IHN0cmluZztcbiAgYXNuYW1lOiBzdHJpbmcgfCBudWxsO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uSW1wb3J0IGV4dGVuZHMgU291cmNlUmFuZ2Uge1xuICBraW5kOiBcImltcG9ydFwiIHwgXCJmcm9tXCI7XG4gIG1vZHVsZTogc3RyaW5nO1xuICBsZXZlbDogbnVtYmVyO1xuICBuYW1lczogUHl0aG9uQWxpYXNbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbk1vZHVsZUluZm8ge1xuICBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdO1xuICBpbXBvcnRzOiBQeXRob25JbXBvcnRbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvblVzYWdlIHtcbiAgbmFtZXM6IHN0cmluZ1tdO1xuICBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT47XG59XG5cbmludGVyZmFjZSBQeXRob25EZXBlbmRlbmN5U3RhdGUge1xuICByZWFkb25seSBpbmNsdWRlZFJhbmdlczogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IGluY2x1ZGVkSW1wb3J0czogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IGFsaWFzZXM6IFNldDxzdHJpbmc+O1xuICByZWFkb25seSBuYW1lc3BhY2VCaW5kaW5nczogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+O1xuICByZWFkb25seSB2aXNpdGluZ1N5bWJvbHM6IFNldDxzdHJpbmc+O1xuICBuZWVkc05hbWVzcGFjZVJ1bnRpbWU6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0IHtcbiAgcHl0aG9uRXhlY3V0YWJsZT86IHN0cmluZztcbiAgZXh0ZXJuYWxFeHRyYWN0b3I/OiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3I7XG4gIHJlYWRGaWxlKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuICByZXNvbHZlUHl0aG9uSW1wb3J0KGZyb21GaWxlUGF0aDogc3RyaW5nLCBtb2R1bGVOYW1lOiBzdHJpbmcsIGxldmVsOiBudW1iZXIpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvciB7XG4gIG1vZGU6IFwiY29tbWFuZFwiIHwgXCJ0cmFuc3BpbGUtY1wiO1xuICBsYW5ndWFnZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQge1xuICBjb250ZW50Pzogc3RyaW5nO1xuICBzZWxlY3RlZD86IHN0cmluZztcbiAgZGVwZW5kZW5jaWVzPzogc3RyaW5nW107XG4gIGltcG9ydHM/OiBzdHJpbmdbXTtcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBUcmFuc3BpbGVUb0NSZXN1bHQge1xuICBnZW5lcmF0ZWRTb3VyY2U6IHN0cmluZztcbiAgc3ltYm9scz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGhhcm5lc3M/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogXCJjXCIgfCBcImNwcFwiO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tUmVzb2x2ZWRTb3VyY2Uge1xuICBjb250ZW50OiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdD86IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGlmIChob3N0Py5leHRlcm5hbEV4dHJhY3Rvcj8uZXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICByZXR1cm4gaG9zdC5leHRlcm5hbEV4dHJhY3Rvci5tb2RlID09PSBcInRyYW5zcGlsZS1jXCJcbiAgICAgID8gcmVzb2x2ZVRyYW5zcGlsZVRvQ1JlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzLCBob3N0LmV4dGVybmFsRXh0cmFjdG9yKVxuICAgICAgOiByZXNvbHZlRXh0ZXJuYWxSZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcywgaG9zdC5leHRlcm5hbEV4dHJhY3Rvcik7XG4gIH1cblxuICBpZiAobGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgaG9zdCkge1xuICAgIHJldHVybiByZXNvbHZlUHl0aG9uUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgaGFybmVzcywgaG9zdCk7XG4gIH1cblxuICByZXR1cm4gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2VGYWxsYmFjayhzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MpO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuKTogbG9vbVJlc29sdmVkU291cmNlIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3Qgc2VsZWN0ZWRSYW5nZSA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lXG4gICAgPyBmaW5kU3ltYm9sUmFuZ2UobGluZXMsIGxhbmd1YWdlLCByZWZlcmVuY2Uuc3ltYm9sTmFtZSlcbiAgICA6IGZpbmRMaW5lUmFuZ2UobGluZXMsIHJlZmVyZW5jZSk7XG5cbiAgaWYgKCFzZWxlY3RlZFJhbmdlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyBgc3ltYm9sICR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YCA6IFwibGluZSByYW5nZVwiO1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGV4dHJhY3QgJHt0YXJnZXR9IGZyb20gJHtyZWZlcmVuY2UuZmlsZVBhdGh9LmApO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWQgPSByZW5kZXJSYW5nZShsaW5lcywgc2VsZWN0ZWRSYW5nZSk7XG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llc1xuICAgID8gY29sbGVjdERlcGVuZGVuY3lTb3VyY2UobGluZXMsIGxhbmd1YWdlLCBzZWxlY3RlZFJhbmdlLCBzZWxlY3RlZClcbiAgICA6IFwiXCI7XG4gIGNvbnN0IGNvbnRlbnQgPSBbZGVwZW5kZW5jaWVzLCBzZWxlY3RlZCwgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIl1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcblxuICByZXR1cm4ge1xuICAgIGNvbnRlbnQsXG4gICAgZGVzY3JpcHRpb246IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgc2VsZWN0ZWRSYW5nZSksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVFeHRlcm5hbFJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLWV4dHJhY3QtXCIpKTtcbiAgY29uc3Qgc291cmNlRmlsZSA9IGpvaW4odGVtcERpciwgXCJzb3VyY2UudHh0XCIpO1xuICBjb25zdCBoYXJuZXNzRmlsZSA9IGpvaW4odGVtcERpciwgXCJoYXJuZXNzLnR4dFwiKTtcbiAgY29uc3QgcmVxdWVzdEZpbGUgPSBqb2luKHRlbXBEaXIsIFwicmVxdWVzdC5qc29uXCIpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgZmlsZVBhdGg6IHJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbnVsbCxcbiAgICAgIGxpbmVFbmQ6IHJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgIH07XG4gICAgYXdhaXQgd3JpdGVGaWxlKHNvdXJjZUZpbGUsIHNvdXJjZSwgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShoYXJuZXNzRmlsZSwgaGFybmVzcywgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0RmlsZSwgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMiksIFwidXRmOFwiKTtcblxuICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1bkV4dGVybmFsRXh0cmFjdG9yKGV4dHJhY3Rvciwge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICByZXF1ZXN0RmlsZSxcbiAgICAgIHJlZmVyZW5jZSxcbiAgICB9KTtcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZUV4dGVybmFsRXh0cmFjdG9yUmVzdWx0KG91dHB1dCk7XG4gICAgY29uc3QgY29udGVudCA9IHJlc3VsdC5jb250ZW50ID8/IFtcbiAgICAgIC4uLihyZXN1bHQuaW1wb3J0cyA/PyBbXSksXG4gICAgICAuLi4ocmVzdWx0LmRlcGVuZGVuY2llcyA/PyBbXSksXG4gICAgICByZXN1bHQuc2VsZWN0ZWQgPz8gXCJcIixcbiAgICAgIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCIsXG4gICAgXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKS5qb2luKFwiXFxuXFxuXCIpO1xuXG4gICAgaWYgKCFjb250ZW50LnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgcmV0dXJuZWQgbm8gY29udGVudC5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnQsXG4gICAgICBkZXNjcmlwdGlvbjogcmVzdWx0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBudWxsKSxcbiAgICB9O1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlVHJhbnNwaWxlVG9DUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tZXh0cmFjdC1cIikpO1xuICBjb25zdCBzb3VyY2VGaWxlID0gam9pbih0ZW1wRGlyLCBcInNvdXJjZS50eHRcIik7XG4gIGNvbnN0IGhhcm5lc3NGaWxlID0gam9pbih0ZW1wRGlyLCBcImhhcm5lc3MudHh0XCIpO1xuICBjb25zdCByZXF1ZXN0RmlsZSA9IGpvaW4odGVtcERpciwgXCJyZXF1ZXN0Lmpzb25cIik7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogcmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogcmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogcmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICB0YXJnZXRMYW5ndWFnZTogXCJjXCIsXG4gICAgfTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoc291cmNlRmlsZSwgc291cmNlLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKGhhcm5lc3NGaWxlLCBoYXJuZXNzLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RGaWxlLCBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKSwgXCJ1dGY4XCIpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuRXh0ZXJuYWxFeHRyYWN0b3IoZXh0cmFjdG9yLCB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHJlcXVlc3RGaWxlLFxuICAgICAgcmVmZXJlbmNlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlVHJhbnNwaWxlVG9DUmVzdWx0KG91dHB1dCk7XG4gICAgY29uc3QgZ2VuZXJhdGVkTGFuZ3VhZ2UgPSByZXN1bHQubGFuZ3VhZ2UgPT09IFwiY3BwXCIgPyBcImNwcFwiIDogXCJjXCI7XG4gICAgY29uc3QgbWFwcGVkU3ltYm9sID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyByZXN1bHQuc3ltYm9scz8uW3JlZmVyZW5jZS5zeW1ib2xOYW1lXSA/PyByZWZlcmVuY2Uuc3ltYm9sTmFtZSA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBnZW5lcmF0ZWRSZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UgPSB7XG4gICAgICAuLi5yZWZlcmVuY2UsXG4gICAgICBmaWxlUGF0aDogYCR7cmVmZXJlbmNlLmZpbGVQYXRofTpnZW5lcmF0ZWQuJHtnZW5lcmF0ZWRMYW5ndWFnZSA9PT0gXCJjcHBcIiA/IFwiY3BwXCIgOiBcImNcIn1gLFxuICAgICAgc3ltYm9sTmFtZTogbWFwcGVkU3ltYm9sLFxuICAgIH07XG4gICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKHJlc3VsdC5nZW5lcmF0ZWRTb3VyY2UsIGdlbmVyYXRlZFJlZmVyZW5jZSwgZ2VuZXJhdGVkTGFuZ3VhZ2UsIHJlc3VsdC5oYXJuZXNzID8/IGhhcm5lc3MpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICBkZXNjcmlwdGlvbjogcmVzdWx0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgYCR7cmVmZXJlbmNlLmZpbGVQYXRofSMke3JlZmVyZW5jZS5zeW1ib2xOYW1lID8/IFwiZ2VuZXJhdGVkLWNcIn1gLFxuICAgIH07XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bkV4dGVybmFsRXh0cmFjdG9yKFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvcixcbiAgdmFsdWVzOiB7XG4gICAgbGFuZ3VhZ2U6IHN0cmluZztcbiAgICBzb3VyY2VGaWxlOiBzdHJpbmc7XG4gICAgaGFybmVzc0ZpbGU6IHN0cmluZztcbiAgICByZXF1ZXN0RmlsZTogc3RyaW5nO1xuICAgIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZTtcbiAgfSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGFyZ3MgPSBleHRyYWN0b3IuYXJncy5tYXAoKGFyZykgPT4gYXJnXG4gICAgLnJlcGxhY2VBbGwoXCJ7cmVxdWVzdH1cIiwgdmFsdWVzLnJlcXVlc3RGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie3NvdXJjZX1cIiwgdmFsdWVzLnNvdXJjZUZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdmFsdWVzLnNvdXJjZUZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7aGFybmVzc31cIiwgdmFsdWVzLmhhcm5lc3NGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie3N5bWJvbH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IFwiXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGluZVN0YXJ0fVwiLCB2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCA9PSBudWxsID8gXCJcIiA6IFN0cmluZyh2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCkpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGluZUVuZH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kID09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlcy5yZWZlcmVuY2UubGluZUVuZCkpXG4gICAgLnJlcGxhY2VBbGwoXCJ7ZGVwc31cIiwgdmFsdWVzLnJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyA/IFwidHJ1ZVwiIDogXCJmYWxzZVwiKVxuICAgIC5yZXBsYWNlQWxsKFwie2xhbmd1YWdlfVwiLCB2YWx1ZXMubGFuZ3VhZ2UpKTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXh0cmFjdG9yLmV4ZWN1dGFibGUsIGFyZ3MsIHtcbiAgICAgIGN3ZDogZXh0cmFjdG9yLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdLFxuICAgIH0pO1xuICAgIGxldCBzdGRvdXQgPSBcIlwiO1xuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgdGltZWQgb3V0IGFmdGVyICR7ZXh0cmFjdG9yLnRpbWVvdXRNc30gbXMuYCkpO1xuICAgIH0sIGV4dHJhY3Rvci50aW1lb3V0TXMpO1xuXG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZG91dC5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZG91dCArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5zdGRlcnIub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRlcnIgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlamVjdChlcnJvcik7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgaWYgKGNvZGUgIT09IDApIHtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcigoc3RkZXJyIHx8IHN0ZG91dCB8fCBgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9LmApLnRyaW0oKSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICByZXNvbHZlKHN0ZG91dCk7XG4gICAgfSk7XG5cbiAgICBjaGlsZC5zdGRpbi5lbmQoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgcmVxdWVzdEZpbGU6IHZhbHVlcy5yZXF1ZXN0RmlsZSxcbiAgICAgIHNvdXJjZUZpbGU6IHZhbHVlcy5zb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGU6IHZhbHVlcy5oYXJuZXNzRmlsZSxcbiAgICAgIGxhbmd1YWdlOiB2YWx1ZXMubGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogdmFsdWVzLnJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHZhbHVlcy5yZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiB2YWx1ZXMucmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogdmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogdmFsdWVzLnJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICB9KSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBwYXJzZUV4dGVybmFsRXh0cmFjdG9yUmVzdWx0KG91dHB1dDogc3RyaW5nKTogRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2Uob3V0cHV0KSBhcyBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdDtcbiAgICBpZiAodHlwZW9mIHBhcnNlZCAhPT0gXCJvYmplY3RcIiB8fCBwYXJzZWQgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgbXVzdCByZXR1cm4gYSBKU09OIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDdXN0b20gc291cmNlIGV4dHJhY3RvciByZXR1cm5lZCBpbnZhbGlkIEpTT046ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHJhbnNwaWxlVG9DUmVzdWx0KG91dHB1dDogc3RyaW5nKTogVHJhbnNwaWxlVG9DUmVzdWx0IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG91dHB1dCkgYXMgVHJhbnNwaWxlVG9DUmVzdWx0O1xuICAgIGlmICh0eXBlb2YgcGFyc2VkICE9PSBcIm9iamVjdFwiIHx8IHBhcnNlZCA9PSBudWxsIHx8IHR5cGVvZiBwYXJzZWQuZ2VuZXJhdGVkU291cmNlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBleHRyYWN0b3IgbXVzdCByZXR1cm4gZ2VuZXJhdGVkU291cmNlLlwiKTtcbiAgICB9XG4gICAgaWYgKHBhcnNlZC5sYW5ndWFnZSAhPSBudWxsICYmIHBhcnNlZC5sYW5ndWFnZSAhPT0gXCJjXCIgJiYgcGFyc2VkLmxhbmd1YWdlICE9PSBcImNwcFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBsYW5ndWFnZSBtdXN0IGJlIGMgb3IgY3BwLlwiKTtcbiAgICB9XG4gICAgaWYgKHBhcnNlZC5zeW1ib2xzICE9IG51bGwgJiYgKHR5cGVvZiBwYXJzZWQuc3ltYm9scyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBhcnNlZC5zeW1ib2xzKSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIHN5bWJvbHMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNwaWxlIHRvIEMgZXh0cmFjdG9yIHJldHVybmVkIGludmFsaWQgSlNPTjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvblJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgY29uc3Qgc2VsZWN0ZWRSYW5nZSA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lXG4gICAgPyBmaW5kUHl0aG9uU3ltYm9sUmFuZ2UobW9kdWxlSW5mbywgcmVmZXJlbmNlLnN5bWJvbE5hbWUpXG4gICAgOiBmaW5kTGluZVJhbmdlKGxpbmVzLCByZWZlcmVuY2UpO1xuXG4gIGlmICghc2VsZWN0ZWRSYW5nZSkge1xuICAgIGNvbnN0IHRhcmdldCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gYHN5bWJvbCAke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWAgOiBcImxpbmUgcmFuZ2VcIjtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBleHRyYWN0ICR7dGFyZ2V0fSBmcm9tICR7cmVmZXJlbmNlLmZpbGVQYXRofS5gKTtcbiAgfVxuXG4gIGNvbnN0IHNlbGVjdGVkID0gcmVuZGVyUmFuZ2UobGluZXMsIHNlbGVjdGVkUmFuZ2UpO1xuICBjb25zdCBzdGF0ZSA9IGNyZWF0ZVB5dGhvbkRlcGVuZGVuY3lTdGF0ZSgpO1xuICBjb25zdCBkZXBlbmRlbmNpZXMgPSByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXNcbiAgICA/IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmN5U291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLmZpbGVQYXRoLCBzZWxlY3RlZFJhbmdlLCBzZWxlY3RlZCwgaGFybmVzcywgaG9zdCwgc3RhdGUpXG4gICAgOiBcIlwiO1xuICBjb25zdCBjb250ZW50ID0gW2RlcGVuZGVuY2llcywgc2VsZWN0ZWQsIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCJdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250ZW50LFxuICAgIGRlc2NyaXB0aW9uOiBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIHNlbGVjdGVkUmFuZ2UpLFxuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQeXRob25EZXBlbmRlbmN5U3RhdGUoKTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBpbmNsdWRlZFJhbmdlczogbmV3IFNldCgpLFxuICAgIGluY2x1ZGVkSW1wb3J0czogbmV3IFNldCgpLFxuICAgIGFsaWFzZXM6IG5ldyBTZXQoKSxcbiAgICBuYW1lc3BhY2VCaW5kaW5nczogbmV3IE1hcCgpLFxuICAgIHZpc2l0aW5nU3ltYm9sczogbmV3IFNldCgpLFxuICAgIG5lZWRzTmFtZXNwYWNlUnVudGltZTogZmFsc2UsXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZXBlbmRlbmN5U291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsXG4gIHNlbGVjdGVkOiBzdHJpbmcsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgc2VsZWN0ZWRSYW5nZSwgYCR7c2VsZWN0ZWR9XFxuJHtoYXJuZXNzfWAsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gIGNvbnN0IG5hbWVzcGFjZSA9IHJlbmRlclB5dGhvbk5hbWVzcGFjZUJpbmRpbmdzKHN0YXRlKTtcbiAgcmV0dXJuIFsuLi5zdGF0ZS5pbmNsdWRlZEltcG9ydHMsIC4uLnBhcnRzLCBuYW1lc3BhY2VdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoXG4gIHNvdXJjZTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc2VlZDogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gIGxldCBoYXlzdGFjayA9IHNlZWQ7XG4gIGxldCBjb2xsZWN0ZWQgPSBcIlwiO1xuICBsZXQgY2hhbmdlZCA9IHRydWU7XG5cbiAgd2hpbGUgKGNoYW5nZWQpIHtcbiAgICBjaGFuZ2VkID0gZmFsc2U7XG4gICAgY29uc3QgdXNhZ2UgPSBhd2FpdCBpbnNwZWN0UHl0aG9uVXNhZ2UoaGF5c3RhY2ssIGhvc3QpO1xuXG4gICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIG1vZHVsZUluZm8uZGVmaW5pdGlvbnMpIHtcbiAgICAgIGlmIChyYW5nZXNPdmVybGFwKGRlZmluaXRpb24sIHNlbGVjdGVkUmFuZ2UpIHx8ICFweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb24sIHVzYWdlKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRleHQgPSBhZGRQeXRob25SYW5nZShsaW5lcywgZmlsZVBhdGgsIGRlZmluaXRpb24sIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICBjb25zdCBuZXN0ZWQgPSBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIGRlZmluaXRpb24sIHRleHQsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICAgIGhheXN0YWNrICs9IGBcXG4ke3RleHR9XFxuYDtcbiAgICAgICAgaWYgKG5lc3RlZCkge1xuICAgICAgICAgIGhheXN0YWNrICs9IGBcXG4ke25lc3RlZH1cXG5gO1xuICAgICAgICB9XG4gICAgICAgIGNvbGxlY3RlZCArPSBgJHtuZXN0ZWR9XFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgaW1wb3J0Tm9kZSBvZiBtb2R1bGVJbmZvLmltcG9ydHMpIHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNvbHZlUHl0aG9uSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBjb2xsZWN0ZWQgKz0gYCR7dGV4dH1cXG5gO1xuICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gY29sbGVjdGVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBpZiAoaW1wb3J0Tm9kZS5raW5kID09PSBcImZyb21cIikge1xuICAgIHJldHVybiByZXNvbHZlUHl0aG9uRnJvbUltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgfVxuXG4gIHJldHVybiByZXNvbHZlUHl0aG9uUGxhaW5JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25Gcm9tSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBsb2NhbE1vZHVsZVBhdGggPSBhd2FpdCBob3N0LnJlc29sdmVQeXRob25JbXBvcnQoZmlsZVBhdGgsIGltcG9ydE5vZGUubW9kdWxlLCBpbXBvcnROb2RlLmxldmVsKTtcbiAgbGV0IGFkZGVkID0gXCJcIjtcblxuICBmb3IgKGNvbnN0IGFsaWFzIG9mIGltcG9ydE5vZGUubmFtZXMpIHtcbiAgICBpZiAoYWxpYXMubmFtZSA9PT0gXCIqXCIpIHtcbiAgICAgIGlmICghbG9jYWxNb2R1bGVQYXRoKSB7XG4gICAgICAgIGlmICh1c2VzVW5rbm93bkltcG9ydGVkTmFtZXModXNhZ2UpICYmIGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICAgIGFkZGVkICs9IGAke3JlbmRlclJhbmdlKGxpbmVzLCBpbXBvcnROb2RlKX1cXG5gO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCBob3N0LnJlYWRGaWxlKGxvY2FsTW9kdWxlUGF0aCk7XG4gICAgICBpZiAoIXNvdXJjZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gICAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgbW9kdWxlSW5mby5kZWZpbml0aW9ucykge1xuICAgICAgICBpZiAoIXB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbiwgdXNhZ2UpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGxvY2FsTW9kdWxlUGF0aCwgZGVmaW5pdGlvbi5uYW1lLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZXhwb3NlZE5hbWUgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZTtcbiAgICBpZiAoIXVzYWdlLm5hbWVzLmluY2x1ZGVzKGV4cG9zZWROYW1lKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3VibW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgam9pblB5dGhvbk1vZHVsZShpbXBvcnROb2RlLm1vZHVsZSwgYWxpYXMubmFtZSksIGltcG9ydE5vZGUubGV2ZWwpO1xuICAgIGNvbnN0IGltcG9ydFRhcmdldFBhdGggPSBsb2NhbE1vZHVsZVBhdGggPz8gc3VibW9kdWxlUGF0aDtcbiAgICBpZiAoIWltcG9ydFRhcmdldFBhdGgpIHtcbiAgICAgIGlmIChhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBleHRyYWN0ZWQgPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoaW1wb3J0VGFyZ2V0UGF0aCwgYWxpYXMubmFtZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICBpZiAoZXh0cmFjdGVkKSB7XG4gICAgICBhZGRlZCArPSBleHRyYWN0ZWQ7XG4gICAgICBpZiAoYWxpYXMuYXNuYW1lICYmIGFsaWFzLmFzbmFtZSAhPT0gYWxpYXMubmFtZSkge1xuICAgICAgICBhZGRlZCArPSBhZGRQeXRob25BbGlhcyhhbGlhcy5uYW1lLCBhbGlhcy5hc25hbWUsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2R1bGVCaW5kaW5nID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWU7XG4gICAgY29uc3QgbW9kdWxlQXR0cmlidXRlcyA9IHVzYWdlLmF0dHJpYnV0ZXNbbW9kdWxlQmluZGluZ10gPz8gW107XG4gICAgaWYgKHN1Ym1vZHVsZVBhdGggJiYgbW9kdWxlQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIG1vZHVsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKHN1Ym1vZHVsZVBhdGgsIGF0dHJpYnV0ZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgICAgYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhtb2R1bGVCaW5kaW5nLCBhdHRyaWJ1dGUsIHN0YXRlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYWRkZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25QbGFpbkltcG9ydERlcGVuZGVuY3koXG4gIGltcG9ydE5vZGU6IFB5dGhvbkltcG9ydCxcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICB1c2FnZTogUHl0aG9uVXNhZ2UsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgbGV0IGFkZGVkID0gXCJcIjtcblxuICBmb3IgKGNvbnN0IGFsaWFzIG9mIGltcG9ydE5vZGUubmFtZXMpIHtcbiAgICBjb25zdCBiaW5kaW5nID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWUuc3BsaXQoXCIuXCIpWzBdO1xuICAgIGNvbnN0IHVzZWRBdHRyaWJ1dGVzID0gdXNhZ2UuYXR0cmlidXRlc1tiaW5kaW5nXSA/PyBbXTtcbiAgICBjb25zdCBiaW5kaW5nSXNVc2VkID0gdXNhZ2UubmFtZXMuaW5jbHVkZXMoYmluZGluZykgfHwgdXNlZEF0dHJpYnV0ZXMubGVuZ3RoID4gMDtcbiAgICBpZiAoIWJpbmRpbmdJc1VzZWQpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGxvY2FsTW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgYWxpYXMubmFtZSwgMCk7XG4gICAgaWYgKCFsb2NhbE1vZHVsZVBhdGgpIHtcbiAgICAgIGlmIChhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiB1c2VkQXR0cmlidXRlcykge1xuICAgICAgYWRkZWQgKz0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGxvY2FsTW9kdWxlUGF0aCwgYXR0cmlidXRlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhiaW5kaW5nLCBhdHRyaWJ1dGUsIHN0YXRlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYWRkZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc3ltYm9sTmFtZTogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHZpc2l0S2V5ID0gYCR7ZmlsZVBhdGh9IyR7c3ltYm9sTmFtZX1gO1xuICBpZiAoc3RhdGUudmlzaXRpbmdTeW1ib2xzLmhhcyh2aXNpdEtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIGNvbnN0IHNvdXJjZSA9IGF3YWl0IGhvc3QucmVhZEZpbGUoZmlsZVBhdGgpO1xuICBpZiAoIXNvdXJjZSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgc3RhdGUudmlzaXRpbmdTeW1ib2xzLmFkZCh2aXNpdEtleSk7XG4gIHRyeSB7XG4gICAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSBtb2R1bGVJbmZvLmRlZmluaXRpb25zLmZpbmQoKGNhbmRpZGF0ZSkgPT4gKGNhbmRpZGF0ZS5uYW1lcyA/PyBbY2FuZGlkYXRlLm5hbWVdKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gICAgaWYgKCFkZWZpbml0aW9uKSB7XG4gICAgICByZXR1cm4gXCJcIjtcbiAgICB9XG5cbiAgICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pO1xuICAgIGNvbnN0IGRlcGVuZGVuY3lUZXh0ID0gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCB0ZXh0LCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgIGNvbnN0IGFkZGVkID0gYWRkUHl0aG9uUmFuZ2UobGluZXMsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCBzdGF0ZSwgcGFydHMpO1xuICAgIHJldHVybiBbZGVwZW5kZW5jeVRleHQsIGFkZGVkXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKS5qb2luKFwiXFxuXCIpO1xuICB9IGZpbmFsbHkge1xuICAgIHN0YXRlLnZpc2l0aW5nU3ltYm9scy5kZWxldGUodmlzaXRLZXkpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvblJhbmdlKFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogc3RyaW5nIHtcbiAgY29uc3Qga2V5ID0gYCR7ZmlsZVBhdGh9Okwke3JhbmdlLnN0YXJ0ICsgMX0tTCR7cmFuZ2UuZW5kICsgMX1gO1xuICBpZiAoc3RhdGUuaW5jbHVkZWRSYW5nZXMuaGFzKGtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuICBzdGF0ZS5pbmNsdWRlZFJhbmdlcy5hZGQoa2V5KTtcbiAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCByYW5nZSk7XG4gIHBhcnRzLnB1c2godGV4dCk7XG4gIHJldHVybiB0ZXh0O1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzOiBzdHJpbmdbXSwgcmFuZ2U6IFNvdXJjZVJhbmdlLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgcmFuZ2UpO1xuICBpZiAoc3RhdGUuaW5jbHVkZWRJbXBvcnRzLmhhcyh0ZXh0KSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBzdGF0ZS5pbmNsdWRlZEltcG9ydHMuYWRkKHRleHQpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uQWxpYXMobmFtZTogc3RyaW5nLCBhc25hbWU6IHN0cmluZywgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSwgcGFydHM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3Qga2V5ID0gYCR7YXNuYW1lfT0ke25hbWV9YDtcbiAgaWYgKHN0YXRlLmFsaWFzZXMuaGFzKGtleSkpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuICBzdGF0ZS5hbGlhc2VzLmFkZChrZXkpO1xuICBjb25zdCB0ZXh0ID0gYCR7YXNuYW1lfSA9ICR7bmFtZX1gO1xuICBwYXJ0cy5wdXNoKHRleHQpO1xuICByZXR1cm4gYCR7dGV4dH1cXG5gO1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKGJpbmRpbmc6IHN0cmluZywgYXR0cmlidXRlOiBzdHJpbmcsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiB2b2lkIHtcbiAgc3RhdGUubmVlZHNOYW1lc3BhY2VSdW50aW1lID0gdHJ1ZTtcbiAgY29uc3QgYXR0cmlidXRlcyA9IHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLmdldChiaW5kaW5nKSA/PyBuZXcgU2V0PHN0cmluZz4oKTtcbiAgYXR0cmlidXRlcy5hZGQoYXR0cmlidXRlKTtcbiAgc3RhdGUubmFtZXNwYWNlQmluZGluZ3Muc2V0KGJpbmRpbmcsIGF0dHJpYnV0ZXMpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJQeXRob25OYW1lc3BhY2VCaW5kaW5ncyhzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogc3RyaW5nIHtcbiAgaWYgKCFzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5zaXplKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IHN0YXRlLm5lZWRzTmFtZXNwYWNlUnVudGltZSA/IFtcImltcG9ydCB0eXBlcyBhcyBfbG9vbV90eXBlc1wiXSA6IFtdO1xuICBmb3IgKGNvbnN0IFtiaW5kaW5nLCBhdHRyaWJ1dGVzXSBvZiBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncykge1xuICAgIGxpbmVzLnB1c2goYCR7YmluZGluZ30gPSBfbG9vbV90eXBlcy5TaW1wbGVOYW1lc3BhY2UoKWApO1xuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7YmluZGluZ30uJHthdHRyaWJ1dGV9ID0gJHthdHRyaWJ1dGV9YCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBmaW5kUHl0aG9uU3ltYm9sUmFuZ2UobW9kdWxlSW5mbzogUHl0aG9uTW9kdWxlSW5mbywgc3ltYm9sTmFtZTogc3RyaW5nKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgZXhhY3QgPSBtb2R1bGVJbmZvLmRlZmluaXRpb25zLmZpbmQoKGRlZmluaXRpb24pID0+IChkZWZpbml0aW9uLm5hbWVzID8/IFtkZWZpbml0aW9uLm5hbWVdKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gIHJldHVybiBleGFjdCA/IHsgc3RhcnQ6IGV4YWN0LnN0YXJ0LCBlbmQ6IGV4YWN0LmVuZCB9IDogbnVsbDtcbn1cblxuZnVuY3Rpb24gcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uOiBTb3VyY2VEZWZpbml0aW9uLCB1c2FnZTogUHl0aG9uVXNhZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIChkZWZpbml0aW9uLm5hbWVzID8/IFtkZWZpbml0aW9uLm5hbWVdKS5zb21lKChuYW1lKSA9PiB1c2FnZS5uYW1lcy5pbmNsdWRlcyhuYW1lKSk7XG59XG5cbmZ1bmN0aW9uIHVzZXNVbmtub3duSW1wb3J0ZWROYW1lcyh1c2FnZTogUHl0aG9uVXNhZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIHVzYWdlLm5hbWVzLmxlbmd0aCA+IDA7XG59XG5cbmZ1bmN0aW9uIGpvaW5QeXRob25Nb2R1bGUobW9kdWxlTmFtZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbW9kdWxlTmFtZSA/IGAke21vZHVsZU5hbWV9LiR7bmFtZX1gIDogbmFtZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2U6IHN0cmluZywgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0KTogUHJvbWlzZTxQeXRob25Nb2R1bGVJbmZvPiB7XG4gIHJldHVybiBydW5QeXRob25Bc3Q8UHl0aG9uTW9kdWxlSW5mbz4oc291cmNlLCBcIm1vZHVsZVwiLCBob3N0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zcGVjdFB5dGhvblVzYWdlKHNvdXJjZTogc3RyaW5nLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFB5dGhvblVzYWdlPiB7XG4gIHJldHVybiBydW5QeXRob25Bc3Q8UHl0aG9uVXNhZ2U+KHNvdXJjZSwgXCJ1c2FnZVwiLCBob3N0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcnVuUHl0aG9uQXN0PFQ+KHNvdXJjZTogc3RyaW5nLCBtb2RlOiBcIm1vZHVsZVwiIHwgXCJ1c2FnZVwiLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUoaG9zdC5weXRob25FeGVjdXRhYmxlPy50cmltKCkgfHwgXCJweXRob24zXCIpO1xuICBjb25zdCBleGVjdXRhYmxlID0gY29tbWFuZFswXSA/PyBcInB5dGhvbjNcIjtcbiAgY29uc3QgYXJncyA9IFsuLi5jb21tYW5kLnNsaWNlKDEpLCBcIi1jXCIsIFBZVEhPTl9BU1RfSEVMUEVSXTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywgeyBzdGRpbzogW1wicGlwZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdIH0pO1xuICAgIGxldCBzdGRvdXQgPSBcIlwiO1xuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xuXG4gICAgY2hpbGQuc3Rkb3V0LnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRlcnIuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZG91dC5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZG91dCArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5zdGRlcnIub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRlcnIgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgIGlmIChjb2RlICE9PSAwKSB7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoKHN0ZGVyciB8fCBzdGRvdXQgfHwgYFB5dGhvbiBBU1QgaGVscGVyIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfS5gKS50cmltKCkpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzb2x2ZShKU09OLnBhcnNlKHN0ZG91dCkgYXMgVCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY2hpbGQuc3RkaW4uZW5kKEpTT04uc3RyaW5naWZ5KHsgbW9kZSwgc291cmNlIH0pKTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRMaW5lUmFuZ2UobGluZXM6IHN0cmluZ1tdLCByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBzdGFydCA9IE1hdGgubWF4KChyZWZlcmVuY2UubGluZVN0YXJ0ID8/IDEpIC0gMSwgMCk7XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKChyZWZlcmVuY2UubGluZUVuZCA/PyByZWZlcmVuY2UubGluZVN0YXJ0ID8/IGxpbmVzLmxlbmd0aCkgLSAxLCBsaW5lcy5sZW5ndGggLSAxKTtcbiAgaWYgKHN0YXJ0ID4gZW5kIHx8IHN0YXJ0ID49IGxpbmVzLmxlbmd0aCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZnVuY3Rpb24gZmluZFN5bWJvbFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHN5bWJvbE5hbWU6IHN0cmluZyk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGRlZmluaXRpb25zID0gY29sbGVjdERlZmluaXRpb25zKGxpbmVzLCBsYW5ndWFnZSk7XG4gIGNvbnN0IGV4YWN0ID0gZGVmaW5pdGlvbnMuZmluZCgoZGVmaW5pdGlvbikgPT4gZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb24pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgaWYgKGV4YWN0KSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IGV4YWN0LnN0YXJ0LCBlbmQ6IGV4YWN0LmVuZCB9O1xuICB9XG5cbiAgY29uc3Qgc3ltYm9sUGF0dGVybiA9IG5ldyBSZWdFeHAoYFxcXFxiJHtlc2NhcGVSZWdleChzeW1ib2xOYW1lKX1cXFxcYmApO1xuICBjb25zdCBsaW5lID0gbGluZXMuZmluZEluZGV4KChjYW5kaWRhdGUpID0+IHN5bWJvbFBhdHRlcm4udGVzdChjYW5kaWRhdGUpKTtcbiAgaWYgKGxpbmUgPCAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIGxpbmVzW2xpbmVdLmluY2x1ZGVzKFwie1wiKSA/IHsgc3RhcnQ6IGxpbmUsIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGxpbmUpIH0gOiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdERlcGVuZGVuY3lTb3VyY2UobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsIHNlbGVjdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwcm9sb2d1ZSA9IGNvbGxlY3RQcm9sb2d1ZShsaW5lcywgbGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2Uuc3RhcnQpO1xuICBjb25zdCBkZWZpbml0aW9ucyA9IGNvbGxlY3REZWZpbml0aW9ucyhsaW5lcywgbGFuZ3VhZ2UpXG4gICAgLmZpbHRlcigoZGVmaW5pdGlvbikgPT4gIXJhbmdlc092ZXJsYXAoZGVmaW5pdGlvbiwgc2VsZWN0ZWRSYW5nZSkpO1xuICBjb25zdCBzZWxlY3RlZERlZmluaXRpb25zID0gdHJhY2VEZWZpbml0aW9ucyhzZWxlY3RlZCwgZGVmaW5pdGlvbnMsIGxpbmVzKTtcbiAgcmV0dXJuIFsuLi5wcm9sb2d1ZSwgLi4uc2VsZWN0ZWREZWZpbml0aW9ucy5tYXAoKGRlZmluaXRpb24pID0+IHJlbmRlclJhbmdlKGxpbmVzLCBkZWZpbml0aW9uKSldXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG59XG5cbmZ1bmN0aW9uIHRyYWNlRGVmaW5pdGlvbnMoc2VlZDogc3RyaW5nLCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdLCBsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBzZWxlY3RlZDogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGNvbnN0IHNlbGVjdGVkS2V5cyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBsZXQgaGF5c3RhY2sgPSBzZWVkO1xuICBsZXQgY2hhbmdlZCA9IHRydWU7XG5cbiAgd2hpbGUgKGNoYW5nZWQpIHtcbiAgICBjaGFuZ2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIGRlZmluaXRpb25zKSB7XG4gICAgICBjb25zdCBrZXkgPSBgJHtkZWZpbml0aW9uLnN0YXJ0fToke2RlZmluaXRpb24uZW5kfToke2RlZmluaXRpb24ubmFtZX1gO1xuICAgICAgaWYgKHNlbGVjdGVkS2V5cy5oYXMoa2V5KSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb24pLnNvbWUoKG5hbWUpID0+IHNvdXJjZVVzZXNOYW1lKGhheXN0YWNrLCBuYW1lKSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBzZWxlY3RlZEtleXMuYWRkKGtleSk7XG4gICAgICBzZWxlY3RlZC5wdXNoKGRlZmluaXRpb24pO1xuICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7cmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pfVxcbmA7XG4gICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc2VsZWN0ZWQuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuc3RhcnQgLSByaWdodC5zdGFydCk7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RQcm9sb2d1ZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBiZWZvcmVMaW5lOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHByb2xvZ3VlOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBtYXggPSBNYXRoLm1heChiZWZvcmVMaW5lLCAwKTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1heDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgaWYgKGlzUHJvbG9ndWVMaW5lKGxpbmUsIGxhbmd1YWdlKSkge1xuICAgICAgcHJvbG9ndWUucHVzaChsaW5lKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHByb2xvZ3VlLmxlbmd0aCA/IFtwcm9sb2d1ZS5qb2luKFwiXFxuXCIpXSA6IFtdO1xufVxuXG5mdW5jdGlvbiBpc1Byb2xvZ3VlTGluZShsaW5lOiBzdHJpbmcsIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gL14oZnJvbVxccytcXFMrXFxzK2ltcG9ydFxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIC9eKGltcG9ydFxccyt8ZXhwb3J0XFxzKy4qXFxzK2Zyb21cXHMrfCg/OmNvbnN0fGxldHx2YXIpXFxzK1xcdytcXHMqPVxccypyZXF1aXJlXFxzKlxcKCkvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImNcIjpcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcInRhcmdldCBcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwic291cmNlX2ZpbGVuYW1lXCIpO1xuICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICByZXR1cm4gL14obW9kdWxlXFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiAvXihvcGVuXFxzK3xpbmNsdWRlXFxzK3wjdXNlXFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcImphdmFcIjpcbiAgICAgIHJldHVybiAvXihwYWNrYWdlXFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3REZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiBjb2xsZWN0UHl0aG9uRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lcywgL14oPzpleHBvcnRcXHMrKT8oPzphc3luY1xccyspP2Z1bmN0aW9uXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXGJ8Xig/OmV4cG9ydFxccyspP2NsYXNzXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXGJ8Xig/OmV4cG9ydFxccyspPyg/OmNvbnN0fGxldHx2YXIpXFxzKyhbQS1aYS16XyRdW1xcdyRdKilcXHMqPS8pO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgICByZXR1cm4gY29sbGVjdENEZWZpbml0aW9ucyhsaW5lcywgZmFsc2UpO1xuICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzLCB0cnVlKTtcbiAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RIYXNrZWxsRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RPY2FtbERlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwiamF2YVwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzLCAvXlxccyooPzpwdWJsaWN8cHJpdmF0ZXxwcm90ZWN0ZWR8c3RhdGljfGZpbmFsfGFic3RyYWN0fFxccykqXFxzKig/OmNsYXNzfGludGVyZmFjZXxlbnVtfHJlY29yZClcXHMrKFtBLVphLXpfXVxcdyopXFxifF5cXHMqKD86cHVibGljfHByaXZhdGV8cHJvdGVjdGVkfHN0YXRpY3xmaW5hbHxzeW5jaHJvbml6ZWR8bmF0aXZlfFxccykrW1xcdzw+XFxbXFxdLC4/XStcXHMrKFtBLVphLXpfXVxcdyopXFxzKlxcKFteO10qXFwpXFxzKlxcey8pO1xuICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICByZXR1cm4gY29sbGVjdExsdm1EZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgYXNzaWdubWVudCA9IGxpbmVzW2luZGV4XS5tYXRjaCgvXihbQS1aYS16X11cXHcqKVxccypbOj1dLyk7XG4gICAgaWYgKGFzc2lnbm1lbnQpIHtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBhc3NpZ25tZW50WzFdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaCgvXihcXHMqKSg/OmFzeW5jXFxzKyk/KD86ZGVmfGNsYXNzKVxccysoW0EtWmEtel9dXFx3KilcXGIvKTtcbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaW5kZW50ID0gbWF0Y2hbMV0ubGVuZ3RoO1xuICAgIGxldCBzdGFydCA9IGluZGV4O1xuICAgIHdoaWxlIChzdGFydCA+IDAgJiYgbGluZXNbc3RhcnQgLSAxXS50cmltKCkuc3RhcnRzV2l0aChcIkBcIikgJiYgZ2V0SW5kZW50KGxpbmVzW3N0YXJ0IC0gMV0pID09PSBpbmRlbnQpIHtcbiAgICAgIHN0YXJ0IC09IDE7XG4gICAgfVxuICAgIGxldCBlbmQgPSBpbmRleDtcbiAgICBmb3IgKGxldCBjdXJzb3IgPSBpbmRleCArIDE7IGN1cnNvciA8IGxpbmVzLmxlbmd0aDsgY3Vyc29yICs9IDEpIHtcbiAgICAgIGlmIChsaW5lc1tjdXJzb3JdLnRyaW0oKSAmJiBnZXRJbmRlbnQobGluZXNbY3Vyc29yXSkgPD0gaW5kZW50KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZW5kID0gY3Vyc29yO1xuICAgIH1cbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbWF0Y2hbMl0sIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgaXNDcHA6IGJvb2xlYW4pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGxldCBkZXB0aCA9IDA7XG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGNvbnN0IHRvcExldmVsID0gZGVwdGggPT09IDA7XG5cbiAgICBpZiAodG9wTGV2ZWwgJiYgdHJpbW1lZCkge1xuICAgICAgY29uc3QgbWFjcm8gPSB0cmltbWVkLm1hdGNoKC9eI1xccypkZWZpbmVcXHMrKFtBLVphLXpfXVxcdyopXFxiLyk7XG4gICAgICBpZiAobWFjcm8pIHtcbiAgICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG1hY3JvWzFdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgICB9IGVsc2UgaWYgKCF0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpICYmICFpc0NDb21tZW50TGluZSh0cmltbWVkKSkge1xuICAgICAgICBjb25zdCB0eXBlRGVmaW5pdGlvbiA9IG1hdGNoQ1R5cGVEZWZpbml0aW9uKGxpbmVzLCBpbmRleCwgaXNDcHApO1xuICAgICAgICBpZiAodHlwZURlZmluaXRpb24pIHtcbiAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKHR5cGVEZWZpbml0aW9uKTtcbiAgICAgICAgICBpbmRleCA9IE1hdGgubWF4KGluZGV4LCB0eXBlRGVmaW5pdGlvbi5lbmQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uRGVmaW5pdGlvbiA9IG1hdGNoQ0Z1bmN0aW9uRGVmaW5pdGlvbihsaW5lcywgaW5kZXgpO1xuICAgICAgICAgIGlmIChmdW5jdGlvbkRlZmluaXRpb24pIHtcbiAgICAgICAgICAgIGRlZmluaXRpb25zLnB1c2goZnVuY3Rpb25EZWZpbml0aW9uKTtcbiAgICAgICAgICAgIGluZGV4ID0gTWF0aC5tYXgoaW5kZXgsIGZ1bmN0aW9uRGVmaW5pdGlvbi5lbmQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBnbG9iYWxEZWZpbml0aW9uID0gbWF0Y2hDR2xvYmFsRGVmaW5pdGlvbihsaW5lLCBpbmRleCk7XG4gICAgICAgICAgICBpZiAoZ2xvYmFsRGVmaW5pdGlvbikge1xuICAgICAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKGdsb2JhbERlZmluaXRpb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGRlcHRoICs9IGJyYWNlRGVsdGEobGluZSk7XG4gICAgaWYgKGRlcHRoIDwgMCkge1xuICAgICAgZGVwdGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gbWF0Y2hDVHlwZURlZmluaXRpb24obGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBpc0NwcDogYm9vbGVhbik6IFNvdXJjZURlZmluaXRpb24gfCBudWxsIHtcbiAgY29uc3QgaGVhZGVyID0gbGluZXMuc2xpY2Uoc3RhcnQsIE1hdGgubWluKGxpbmVzLmxlbmd0aCwgc3RhcnQgKyA4KSkuam9pbihcIiBcIik7XG4gIGNvbnN0IGtleXdvcmRQYXR0ZXJuID0gaXNDcHAgPyBcIig/OnR5cGVkZWZcXFxccyspPyg/OnN0cnVjdHxjbGFzc3xlbnVtfHVuaW9uKVwiIDogXCIoPzp0eXBlZGVmXFxcXHMrKT8oPzpzdHJ1Y3R8ZW51bXx1bmlvbilcIjtcbiAgY29uc3QgbmFtZWQgPSBoZWFkZXIubWF0Y2gobmV3IFJlZ0V4cChgXlxcXFxzKiR7a2V5d29yZFBhdHRlcm59XFxcXHMrKFtBLVphLXpfXVxcXFx3KilcXFxcYmApKTtcbiAgY29uc3QgYW5vbnltb3VzVHlwZWRlZiA9IGhlYWRlci5tYXRjaCgvXlxccyp0eXBlZGVmXFxzKyg/OnN0cnVjdHxlbnVtfHVuaW9uKVxcYltcXHNcXFNdKj9cXH1cXHMqKFtBLVphLXpfXVxcdyopXFxzKjsvKTtcbiAgY29uc3QgbmFtZSA9IG5hbWVkPy5bMV0gPz8gYW5vbnltb3VzVHlwZWRlZj8uWzFdO1xuICBpZiAoIW5hbWUpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGVuZCA9IGZpbmRDRGVjbGFyYXRpb25FbmQobGluZXMsIHN0YXJ0KTtcbiAgcmV0dXJuIHsgbmFtZSwgbmFtZXM6IFtuYW1lXSwgc3RhcnQsIGVuZCB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaENGdW5jdGlvbkRlZmluaXRpb24obGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCBoZWFkZXJMaW5lcyA9IGxpbmVzLnNsaWNlKHN0YXJ0LCBNYXRoLm1pbihsaW5lcy5sZW5ndGgsIHN0YXJ0ICsgMTIpKTtcbiAgY29uc3Qgam9pbmVkID0gaGVhZGVyTGluZXMuam9pbihcIiBcIik7XG4gIGNvbnN0IGJyYWNlT2Zmc2V0ID0gaGVhZGVyTGluZXMuZmluZEluZGV4KChsaW5lKSA9PiBsaW5lLmluY2x1ZGVzKFwie1wiKSk7XG4gIGlmIChicmFjZU9mZnNldCA8IDAgfHwgam9pbmVkLmluZGV4T2YoXCI7XCIpID49IDAgJiYgam9pbmVkLmluZGV4T2YoXCI7XCIpIDwgam9pbmVkLmluZGV4T2YoXCJ7XCIpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBtYXRjaGVzID0gWy4uLmpvaW5lZC5tYXRjaEFsbCgvKFtBLVphLXpfXVxcdyooPzo6OltBLVphLXpfXVxcdyopP3xvcGVyYXRvclxccypbXlxccyhdKylcXHMqXFwoW147e31dKlxcKVxccyooPzpjb25zdFxcYltee31dKik/KD86bm9leGNlcHRcXGJbXnt9XSopPyg/Oi0+XFxzKltee31dKyk/XFx7L2cpXTtcbiAgY29uc3QgbmFtZSA9IG1hdGNoZXNbMF0/LlsxXT8ucmVwbGFjZSgvXFxzKy9nLCBcIlwiKTtcbiAgaWYgKCFuYW1lIHx8IGlzQ0NvbnRyb2xLZXl3b3JkKG5hbWUpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBicmFjZUxpbmUgPSBzdGFydCArIGJyYWNlT2Zmc2V0O1xuICBjb25zdCBzaG9ydE5hbWUgPSBuYW1lLmluY2x1ZGVzKFwiOjpcIikgPyBuYW1lLnNwbGl0KFwiOjpcIikucG9wKCkgPz8gbmFtZSA6IG5hbWU7XG4gIHJldHVybiB7XG4gICAgbmFtZTogc2hvcnROYW1lLFxuICAgIG5hbWVzOiBbLi4ubmV3IFNldChbc2hvcnROYW1lLCBuYW1lXSldLFxuICAgIHN0YXJ0LFxuICAgIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGJyYWNlTGluZSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ0dsb2JhbERlZmluaXRpb24obGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gIGlmICghdHJpbW1lZC5lbmRzV2l0aChcIjtcIikgfHwgdHJpbW1lZC5pbmNsdWRlcyhcIihcIikgfHwgL14ocmV0dXJufHVzaW5nfG5hbWVzcGFjZXx0ZW1wbGF0ZSlcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHdpdGhvdXRJbml0aWFsaXplciA9IHRyaW1tZWQuc3BsaXQoXCI9XCIpWzBdLnJlcGxhY2UoL1xcW1teXFxdXSpdL2csIFwiXCIpO1xuICBjb25zdCBtYXRjaCA9IHdpdGhvdXRJbml0aWFsaXplci5tYXRjaCgvKFtBLVphLXpfXVxcdyopXFxzKig/OlssO118JCkvZyk/LnBvcCgpPy5tYXRjaCgvKFtBLVphLXpfXVxcdyopLyk7XG4gIGNvbnN0IG5hbWUgPSBtYXRjaD8uWzFdO1xuICBpZiAoIW5hbWUgfHwgL14oY29uc3R8c3RhdGljfGV4dGVybnx2b2xhdGlsZXx1bnNpZ25lZHxzaWduZWR8bG9uZ3xzaG9ydHxpbnR8Y2hhcnxmbG9hdHxkb3VibGV8dm9pZHxhdXRvKSQvLnRlc3QobmFtZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7IG5hbWUsIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9O1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0TGx2bURlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3Qgc3ltYm9sID0gbGluZS5tYXRjaCgvXlxccyooPzpkZWZpbmV8ZGVjbGFyZSlcXGIuKkAoW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKilcXHMqXFwoLyk7XG4gICAgaWYgKHN5bWJvbCkge1xuICAgICAgY29uc3QgZW5kID0gbGluZS50cmltU3RhcnQoKS5zdGFydHNXaXRoKFwiZGVmaW5lXCIpID8gZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGluZGV4KSA6IGluZGV4O1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IHN5bWJvbFsxXSwgbmFtZXM6IFtzeW1ib2xbMV0sIGBAJHtzeW1ib2xbMV19YF0sIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZ2xvYmFsID0gbGluZS5tYXRjaCgvXlxccypAKFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSopXFxzKj0vKTtcbiAgICBpZiAoZ2xvYmFsKSB7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogZ2xvYmFsWzFdLCBuYW1lczogW2dsb2JhbFsxXSwgYEAke2dsb2JhbFsxXX1gXSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RIYXNrZWxsRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2luZGV4XS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IGdldEluZGVudChsaW5lc1tpbmRleF0pID4gMCB8fCAvXihtb2R1bGV8aW1wb3J0KVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZXMgPSBnZXRIYXNrZWxsRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQpO1xuICAgIGlmICghbmFtZXMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBlbmQgPSBmaW5kSGFza2VsbFJhbmdlRW5kKGxpbmVzLCBpbmRleCwgbmFtZXNbMF0pO1xuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBuYW1lc1swXSwgbmFtZXMsIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgIGluZGV4ID0gZW5kO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdE9jYW1sRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2luZGV4XS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IGdldEluZGVudChsaW5lc1tpbmRleF0pID4gMCB8fCAvXihvcGVufGluY2x1ZGV8I3VzZSlcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG5hbWVzID0gZ2V0T2NhbWxEZWZpbml0aW9uTmFtZXModHJpbW1lZCk7XG4gICAgaWYgKCFuYW1lcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGVuZCA9IGZpbmRMYXlvdXRSYW5nZUVuZChsaW5lcywgaW5kZXgsIGlzT2NhbWxUb3BMZXZlbFN0YXJ0KTtcbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbmFtZXNbMF0sIG5hbWVzLCBzdGFydDogaW5kZXgsIGVuZCB9KTtcbiAgICBpbmRleCA9IGVuZDtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgcGF0dGVybjogUmVnRXhwKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lc1tpbmRleF0ubWF0Y2gocGF0dGVybik7XG4gICAgY29uc3QgbmFtZSA9IG1hdGNoPy5zbGljZSgxKS5maW5kKEJvb2xlYW4pO1xuICAgIGlmICghbmFtZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lLCBzdGFydDogaW5kZXgsIGVuZDogZmluZEJyYWNlUmFuZ2VFbmQobGluZXMsIGluZGV4KSB9KTtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghbGluZXNbc3RhcnRdLmluY2x1ZGVzKFwie1wiKSkge1xuICAgIHJldHVybiBzdGFydDtcbiAgfVxuXG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBzYXdCcmFjZSA9IGZhbHNlO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0OyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGZvciAoY29uc3QgY2hhciBvZiBsaW5lc1tpbmRleF0pIHtcbiAgICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBzYXdCcmFjZSA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzYXdCcmFjZSAmJiBkZXB0aCA8PSAwKSB7XG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdGFydDtcbn1cblxuZnVuY3Rpb24gZmluZENEZWNsYXJhdGlvbkVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgc2F3QnJhY2UgPSBmYWxzZTtcbiAgbGV0IGRlcHRoID0gMDtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBmb3IgKGNvbnN0IGNoYXIgb2YgbGluZXNbaW5kZXhdKSB7XG4gICAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgICAgZGVwdGggKz0gMTtcbiAgICAgICAgc2F3QnJhY2UgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgICBkZXB0aCAtPSAxO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICgoIXNhd0JyYWNlIHx8IGRlcHRoIDw9IDApICYmIGxpbmVzW2luZGV4XS5pbmNsdWRlcyhcIjtcIikpIHtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0YXJ0O1xufVxuXG5mdW5jdGlvbiBicmFjZURlbHRhKGxpbmU6IHN0cmluZyk6IG51bWJlciB7XG4gIGxldCBkZWx0YSA9IDA7XG4gIGZvciAoY29uc3QgY2hhciBvZiBsaW5lKSB7XG4gICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICBkZWx0YSArPSAxO1xuICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgIGRlbHRhIC09IDE7XG4gICAgfVxuICB9XG4gIHJldHVybiBkZWx0YTtcbn1cblxuZnVuY3Rpb24gaXNDQ29tbWVudExpbmUodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIvL1wiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCIvKlwiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCIqXCIpO1xufVxuXG5mdW5jdGlvbiBpc0NDb250cm9sS2V5d29yZChuYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIFtcImlmXCIsIFwiZm9yXCIsIFwid2hpbGVcIiwgXCJzd2l0Y2hcIiwgXCJjYXRjaFwiXS5pbmNsdWRlcyhuYW1lKTtcbn1cblxuZnVuY3Rpb24gZ2V0SGFza2VsbERlZmluaXRpb25OYW1lcyh0cmltbWVkOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNpZ25hdHVyZSA9IHRyaW1tZWQubWF0Y2goL14oW2Etel9dW1xcdyddKilcXHMqOjovKTtcbiAgaWYgKHNpZ25hdHVyZSkge1xuICAgIHJldHVybiBbc2lnbmF0dXJlWzFdXTtcbiAgfVxuXG4gIGNvbnN0IGJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9eKFthLXpfXVtcXHcnXSopXFxiLio9Lyk7XG4gIGlmIChiaW5kaW5nKSB7XG4gICAgcmV0dXJuIFtiaW5kaW5nWzFdXTtcbiAgfVxuXG4gIGNvbnN0IHR5cGVMaWtlID0gdHJpbW1lZC5tYXRjaCgvXig/OmRhdGF8bmV3dHlwZXx0eXBlfGNsYXNzKVxccysoW0EtWl1bXFx3J10qKVxcYi8pO1xuICBpZiAodHlwZUxpa2UpIHtcbiAgICByZXR1cm4gW3R5cGVMaWtlWzFdXTtcbiAgfVxuXG4gIGNvbnN0IGluc3RhbmNlID0gdHJpbW1lZC5tYXRjaCgvXmluc3RhbmNlXFxiLio/XFxiKFtBLVpdW1xcdyddKilcXGIvKTtcbiAgcmV0dXJuIGluc3RhbmNlID8gW2luc3RhbmNlWzFdXSA6IFtdO1xufVxuXG5mdW5jdGlvbiBnZXRPY2FtbERlZmluaXRpb25OYW1lcyh0cmltbWVkOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxldEJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9ebGV0XFxzKyg/OnJlY1xccyspPyg/OlxcKChbXildKylcXCl8KFthLXpfXVtcXHcnXSopKS8pO1xuICBpZiAobGV0QmluZGluZykge1xuICAgIHJldHVybiBbbGV0QmluZGluZ1sxXSA/PyBsZXRCaW5kaW5nWzJdXTtcbiAgfVxuXG4gIGNvbnN0IHR5cGVCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXnR5cGVcXHMrKFthLXpfXVtcXHcnXSopLyk7XG4gIGlmICh0eXBlQmluZGluZykge1xuICAgIHJldHVybiBbdHlwZUJpbmRpbmdbMV1dO1xuICB9XG5cbiAgY29uc3QgbW9kdWxlQmluZGluZyA9IHRyaW1tZWQubWF0Y2goL15tb2R1bGVcXHMrKFtBLVpdW1xcdyddKikvKTtcbiAgaWYgKG1vZHVsZUJpbmRpbmcpIHtcbiAgICByZXR1cm4gW21vZHVsZUJpbmRpbmdbMV1dO1xuICB9XG5cbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBmaW5kTGF5b3V0UmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBpc1RvcExldmVsU3RhcnQ6IChsaW5lOiBzdHJpbmcpID0+IGJvb2xlYW4pOiBudW1iZXIge1xuICBsZXQgZW5kID0gc3RhcnQ7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQgKyAxOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgaWYgKGxpbmUudHJpbSgpICYmIGdldEluZGVudChsaW5lKSA9PT0gMCAmJiBpc1RvcExldmVsU3RhcnQobGluZS50cmltKCkpKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgZW5kID0gaW5kZXg7XG4gIH1cbiAgcmV0dXJuIGVuZDtcbn1cblxuZnVuY3Rpb24gZmluZEhhc2tlbGxSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIG5hbWU6IHN0cmluZyk6IG51bWJlciB7XG4gIGxldCBlbmQgPSBzdGFydDtcbiAgbGV0IGFsbG93TWF0Y2hpbmdFcXVhdGlvbiA9IGxpbmVzW3N0YXJ0XS50cmltKCkuc3RhcnRzV2l0aChgJHtuYW1lfSA6OmApO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0ICsgMTsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZCAmJiBnZXRJbmRlbnQobGluZSkgPT09IDAgJiYgaXNIYXNrZWxsVG9wTGV2ZWxTdGFydCh0cmltbWVkKSkge1xuICAgICAgaWYgKGFsbG93TWF0Y2hpbmdFcXVhdGlvbiAmJiB0cmltbWVkLnN0YXJ0c1dpdGgoYCR7bmFtZX0gYCkgJiYgdHJpbW1lZC5pbmNsdWRlcyhcIj1cIikpIHtcbiAgICAgICAgYWxsb3dNYXRjaGluZ0VxdWF0aW9uID0gZmFsc2U7XG4gICAgICAgIGVuZCA9IGluZGV4O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBlbmQgPSBpbmRleDtcbiAgfVxuICByZXR1cm4gZW5kO1xufVxuXG5mdW5jdGlvbiBpc0hhc2tlbGxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL14obW9kdWxlfGltcG9ydHxkYXRhfG5ld3R5cGV8dHlwZXxjbGFzc3xpbnN0YW5jZSlcXGIvLnRlc3QodHJpbW1lZClcbiAgICB8fCAvXlthLXpfXVtcXHcnXSpcXHMqKD86Ojp8Lio9KS8udGVzdCh0cmltbWVkKTtcbn1cblxuZnVuY3Rpb24gaXNPY2FtbFRvcExldmVsU3RhcnQodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXihvcGVufGluY2x1ZGV8I3VzZXxsZXR8dHlwZXxtb2R1bGUpXFxiLy50ZXN0KHRyaW1tZWQpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJSYW5nZShsaW5lczogc3RyaW5nW10sIHJhbmdlOiBTb3VyY2VSYW5nZSk6IHN0cmluZyB7XG4gIHJldHVybiBsaW5lcy5zbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kICsgMSkuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gcmFuZ2VzT3ZlcmxhcChsZWZ0OiBTb3VyY2VSYW5nZSwgcmlnaHQ6IFNvdXJjZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBsZWZ0LnN0YXJ0IDw9IHJpZ2h0LmVuZCAmJiByaWdodC5zdGFydCA8PSBsZWZ0LmVuZDtcbn1cblxuZnVuY3Rpb24gZ2V0SW5kZW50KGxpbmU6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBsaW5lLm1hdGNoKC9eXFxzKi8pPy5bMF0ubGVuZ3RoID8/IDA7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZVJlZ2V4KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsdWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpO1xufVxuXG5mdW5jdGlvbiBkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbjogU291cmNlRGVmaW5pdGlvbik6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGRlZmluaXRpb24ubmFtZXM/Lmxlbmd0aCA/IGRlZmluaXRpb24ubmFtZXMgOiBbZGVmaW5pdGlvbi5uYW1lXTtcbn1cblxuZnVuY3Rpb24gc291cmNlVXNlc05hbWUoc291cmNlOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAobmFtZS5zdGFydHNXaXRoKFwiQFwiKSkge1xuICAgIHJldHVybiBuZXcgUmVnRXhwKGAke2VzY2FwZVJlZ2V4KG5hbWUpfVxcXFxiYCkudGVzdChzb3VyY2UpO1xuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBcXFxcYiR7ZXNjYXBlUmVnZXgobmFtZSl9XFxcXGJgKS50ZXN0KHNvdXJjZSk7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSwgcmFuZ2U6IFNvdXJjZVJhbmdlIHwgbnVsbCk6IHN0cmluZyB7XG4gIGlmIChyZWZlcmVuY2Uuc3ltYm9sTmFtZSkge1xuICAgIHJldHVybiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9IyR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YDtcbiAgfVxuICBpZiAocmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cmVmZXJlbmNlLmZpbGVQYXRofTpMJHtyYW5nZS5zdGFydCArIDF9LUwke3JhbmdlLmVuZCArIDF9YDtcbiAgfVxuICByZXR1cm4gcmVmZXJlbmNlLmZpbGVQYXRoO1xufVxuXG5jb25zdCBQWVRIT05fQVNUX0hFTFBFUiA9IFN0cmluZy5yYXdgXG5pbXBvcnQgYXN0XG5pbXBvcnQganNvblxuaW1wb3J0IHN5c1xuXG5wYXlsb2FkID0ganNvbi5sb2FkcyhzeXMuc3RkaW4ucmVhZCgpKVxuc291cmNlID0gcGF5bG9hZC5nZXQoXCJzb3VyY2VcIiwgXCJcIilcbm1vZGUgPSBwYXlsb2FkLmdldChcIm1vZGVcIiwgXCJtb2R1bGVcIilcblxuZGVmIHJhbmdlX3N0YXJ0KG5vZGUpOlxuICAgIGxpbmVubyA9IGdldGF0dHIobm9kZSwgXCJsaW5lbm9cIiwgMSlcbiAgICBkZWNvcmF0b3JzID0gZ2V0YXR0cihub2RlLCBcImRlY29yYXRvcl9saXN0XCIsIE5vbmUpIG9yIFtdXG4gICAgaWYgZGVjb3JhdG9yczpcbiAgICAgICAgbGluZW5vID0gbWluKGxpbmVubywgKihnZXRhdHRyKGRlY29yYXRvciwgXCJsaW5lbm9cIiwgbGluZW5vKSBmb3IgZGVjb3JhdG9yIGluIGRlY29yYXRvcnMpKVxuICAgIHJldHVybiBsaW5lbm8gLSAxXG5cbmRlZiByYW5nZV9lbmQobm9kZSk6XG4gICAgcmV0dXJuIGdldGF0dHIobm9kZSwgXCJlbmRfbGluZW5vXCIsIGdldGF0dHIobm9kZSwgXCJsaW5lbm9cIiwgMSkpIC0gMVxuXG5kZWYgdGFyZ2V0X25hbWVzKHRhcmdldCk6XG4gICAgaWYgaXNpbnN0YW5jZSh0YXJnZXQsIGFzdC5OYW1lKTpcbiAgICAgICAgcmV0dXJuIFt0YXJnZXQuaWRdXG4gICAgaWYgaXNpbnN0YW5jZSh0YXJnZXQsIChhc3QuVHVwbGUsIGFzdC5MaXN0KSk6XG4gICAgICAgIG5hbWVzID0gW11cbiAgICAgICAgZm9yIGl0ZW0gaW4gdGFyZ2V0LmVsdHM6XG4gICAgICAgICAgICBuYW1lcy5leHRlbmQodGFyZ2V0X25hbWVzKGl0ZW0pKVxuICAgICAgICByZXR1cm4gbmFtZXNcbiAgICByZXR1cm4gW11cblxuZGVmIGRlZmluaXRpb25fbmFtZXMobm9kZSk6XG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCAoYXN0LkZ1bmN0aW9uRGVmLCBhc3QuQXN5bmNGdW5jdGlvbkRlZiwgYXN0LkNsYXNzRGVmKSk6XG4gICAgICAgIHJldHVybiBbbm9kZS5uYW1lXVxuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkFzc2lnbik6XG4gICAgICAgIG5hbWVzID0gW11cbiAgICAgICAgZm9yIHRhcmdldCBpbiBub2RlLnRhcmdldHM6XG4gICAgICAgICAgICBuYW1lcy5leHRlbmQodGFyZ2V0X25hbWVzKHRhcmdldCkpXG4gICAgICAgIHJldHVybiBuYW1lc1xuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgKGFzdC5Bbm5Bc3NpZ24sIGFzdC5BdWdBc3NpZ24pKTpcbiAgICAgICAgcmV0dXJuIHRhcmdldF9uYW1lcyhub2RlLnRhcmdldClcbiAgICByZXR1cm4gW11cblxuZGVmIGluc3BlY3RfbW9kdWxlKHRyZWUpOlxuICAgIGRlZmluaXRpb25zID0gW11cbiAgICBpbXBvcnRzID0gW11cbiAgICBmb3Igbm9kZSBpbiB0cmVlLmJvZHk6XG4gICAgICAgIG5hbWVzID0gZGVmaW5pdGlvbl9uYW1lcyhub2RlKVxuICAgICAgICBpZiBuYW1lczpcbiAgICAgICAgICAgIGRlZmluaXRpb25zLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJuYW1lXCI6IG5hbWVzWzBdLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogbmFtZXMsXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuSW1wb3J0KTpcbiAgICAgICAgICAgIGltcG9ydHMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcImtpbmRcIjogXCJpbXBvcnRcIixcbiAgICAgICAgICAgICAgICBcIm1vZHVsZVwiOiBcIlwiLFxuICAgICAgICAgICAgICAgIFwibGV2ZWxcIjogMCxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IFt7XCJuYW1lXCI6IGl0ZW0ubmFtZSwgXCJhc25hbWVcIjogaXRlbS5hc25hbWV9IGZvciBpdGVtIGluIG5vZGUubmFtZXNdLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkltcG9ydEZyb20pOlxuICAgICAgICAgICAgaW1wb3J0cy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwia2luZFwiOiBcImZyb21cIixcbiAgICAgICAgICAgICAgICBcIm1vZHVsZVwiOiBub2RlLm1vZHVsZSBvciBcIlwiLFxuICAgICAgICAgICAgICAgIFwibGV2ZWxcIjogbm9kZS5sZXZlbCxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IFt7XCJuYW1lXCI6IGl0ZW0ubmFtZSwgXCJhc25hbWVcIjogaXRlbS5hc25hbWV9IGZvciBpdGVtIGluIG5vZGUubmFtZXNdLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICByZXR1cm4ge1wiZGVmaW5pdGlvbnNcIjogZGVmaW5pdGlvbnMsIFwiaW1wb3J0c1wiOiBpbXBvcnRzfVxuXG5kZWYgYXR0cmlidXRlX2NoYWluKG5vZGUpOlxuICAgIGNoYWluID0gW11cbiAgICBjdXJyZW50ID0gbm9kZVxuICAgIHdoaWxlIGlzaW5zdGFuY2UoY3VycmVudCwgYXN0LkF0dHJpYnV0ZSk6XG4gICAgICAgIGNoYWluLmFwcGVuZChjdXJyZW50LmF0dHIpXG4gICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnZhbHVlXG4gICAgaWYgaXNpbnN0YW5jZShjdXJyZW50LCBhc3QuTmFtZSk6XG4gICAgICAgIGNoYWluLmFwcGVuZChjdXJyZW50LmlkKVxuICAgICAgICBjaGFpbi5yZXZlcnNlKClcbiAgICAgICAgcmV0dXJuIGNoYWluXG4gICAgcmV0dXJuIFtdXG5cbmNsYXNzIFVzYWdlVmlzaXRvcihhc3QuTm9kZVZpc2l0b3IpOlxuICAgIGRlZiBfX2luaXRfXyhzZWxmKTpcbiAgICAgICAgc2VsZi5uYW1lcyA9IHNldCgpXG4gICAgICAgIHNlbGYuYXR0cmlidXRlcyA9IHt9XG5cbiAgICBkZWYgdmlzaXRfTmFtZShzZWxmLCBub2RlKTpcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLmN0eCwgYXN0LkxvYWQpOlxuICAgICAgICAgICAgc2VsZi5uYW1lcy5hZGQobm9kZS5pZClcblxuICAgIGRlZiB2aXNpdF9BdHRyaWJ1dGUoc2VsZiwgbm9kZSk6XG4gICAgICAgIGNoYWluID0gYXR0cmlidXRlX2NoYWluKG5vZGUpXG4gICAgICAgIGlmIGxlbihjaGFpbikgPj0gMjpcbiAgICAgICAgICAgIHNlbGYubmFtZXMuYWRkKGNoYWluWzBdKVxuICAgICAgICAgICAgc2VsZi5hdHRyaWJ1dGVzLnNldGRlZmF1bHQoY2hhaW5bMF0sIHNldCgpKS5hZGQoY2hhaW5bMV0pXG4gICAgICAgIHNlbGYuZ2VuZXJpY192aXNpdChub2RlKVxuXG5kZWYgaW5zcGVjdF91c2FnZSh0cmVlKTpcbiAgICB2aXNpdG9yID0gVXNhZ2VWaXNpdG9yKClcbiAgICB2aXNpdG9yLnZpc2l0KHRyZWUpXG4gICAgcmV0dXJuIHtcbiAgICAgICAgXCJuYW1lc1wiOiBzb3J0ZWQodmlzaXRvci5uYW1lcyksXG4gICAgICAgIFwiYXR0cmlidXRlc1wiOiB7a2V5OiBzb3J0ZWQodmFsdWUpIGZvciBrZXksIHZhbHVlIGluIHZpc2l0b3IuYXR0cmlidXRlcy5pdGVtcygpfSxcbiAgICB9XG5cbnRyeTpcbiAgICB0cmVlID0gYXN0LnBhcnNlKHNvdXJjZSlcbmV4Y2VwdCBTeW50YXhFcnJvcjpcbiAgICBwcmludChqc29uLmR1bXBzKHtcImRlZmluaXRpb25zXCI6IFtdLCBcImltcG9ydHNcIjogW119IGlmIG1vZGUgPT0gXCJtb2R1bGVcIiBlbHNlIHtcIm5hbWVzXCI6IFtdLCBcImF0dHJpYnV0ZXNcIjoge319KSlcbiAgICByYWlzZSBTeXN0ZW1FeGl0KDApXG5cbmlmIG1vZGUgPT0gXCJtb2R1bGVcIjpcbiAgICBwcmludChqc29uLmR1bXBzKGluc3BlY3RfbW9kdWxlKHRyZWUpKSlcbmVsc2U6XG4gICAgcHJpbnQoanNvbi5kdW1wcyhpbnNwZWN0X3VzYWdlKHRyZWUpKSlcbmA7XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU291cmNlUmVmZXJlbmNlSGFybmVzcyhibG9jazogbG9vbUNvZGVCbG9jayk6IHN0cmluZyB7XG4gIGNvbnN0IGNhbGwgPSBibG9jay5zb3VyY2VSZWZlcmVuY2U/LmNhbGw7XG4gIGlmICghY2FsbCkge1xuICAgIHJldHVybiBibG9jay5jb250ZW50O1xuICB9XG5cbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGJsb2NrLnNvdXJjZVJlZmVyZW5jZT8uc3ltYm9sTmFtZT8udHJpbSgpO1xuICBjb25zdCBpbnB1dCA9IGJsb2NrLmNvbnRlbnQudHJpbSgpO1xuICBjb25zdCBleHByZXNzaW9uID0gY2FsbC5leHByZXNzaW9uPy50cmltKClcbiAgICA/IHJlbmRlclNvdXJjZUNhbGxUZW1wbGF0ZShjYWxsLmV4cHJlc3Npb24sIGlucHV0LCBzeW1ib2xOYW1lKVxuICAgIDogcmVuZGVyRGVmYXVsdFNvdXJjZUNhbGwoc3ltYm9sTmFtZSwgY2FsbC5hcmdzLCBpbnB1dCk7XG5cbiAgcmV0dXJuIHJlbmRlckxhbmd1YWdlQ2FsbEhhcm5lc3MoYmxvY2subGFuZ3VhZ2UsIGV4cHJlc3Npb24sIGNhbGwucHJpbnQpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJEZWZhdWx0U291cmNlQ2FsbChzeW1ib2xOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIGFyZ3M6IHN0cmluZyB8IHVuZGVmaW5lZCwgaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghc3ltYm9sTmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImxvb20tY2FsbCBuZWVkcyBsb29tLXN5bWJvbCB3aGVuIG5vIGNhbGwgZXhwcmVzc2lvbiBpcyBwcm92aWRlZC5cIik7XG4gIH1cblxuICBjb25zdCByZW5kZXJlZEFyZ3MgPSByZW5kZXJTb3VyY2VDYWxsVGVtcGxhdGUoYXJncz8udHJpbSgpIHx8IFwie2lucHV0fVwiLCBpbnB1dCwgc3ltYm9sTmFtZSk7XG4gIHJldHVybiBgJHtzeW1ib2xOYW1lfSgke3JlbmRlcmVkQXJnc30pYDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyU291cmNlQ2FsbFRlbXBsYXRlKHRlbXBsYXRlOiBzdHJpbmcsIGlucHV0OiBzdHJpbmcsIHN5bWJvbE5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG4gIHJldHVybiB0ZW1wbGF0ZVxuICAgIC5yZXBsYWNlQWxsKFwie2lucHV0fVwiLCBpbnB1dClcbiAgICAucmVwbGFjZUFsbChcIntzeW1ib2x9XCIsIHN5bWJvbE5hbWUgPz8gXCJcIik7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckxhbmd1YWdlQ2FsbEhhcm5lc3MobGFuZ3VhZ2U6IHN0cmluZywgZXhwcmVzc2lvbjogc3RyaW5nLCBwcmludDogYm9vbGVhbik6IHN0cmluZyB7XG4gIGlmICghcHJpbnQpIHtcbiAgICByZXR1cm4gcmVuZGVyRXhwcmVzc2lvblN0YXRlbWVudChsYW5ndWFnZSwgZXhwcmVzc2lvbik7XG4gIH1cblxuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIGBwcmludCgke2V4cHJlc3Npb259KWA7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIGBjb25zb2xlLmxvZygke2V4cHJlc3Npb259KTtgO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgICByZXR1cm4gYCNpbmNsdWRlIDxzdGRpby5oPlxcbmludCBtYWluKHZvaWQpIHsgcHJpbnRmKFwiJWRcXFxcblwiLCAke2V4cHJlc3Npb259KTsgcmV0dXJuIDA7IH1gO1xuICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIHJldHVybiBgI2luY2x1ZGUgPGlvc3RyZWFtPlxcbmludCBtYWluKCkgeyBzdGQ6OmNvdXQgPDwgKCR7ZXhwcmVzc2lvbn0pIDw8IFwiXFxcXG5cIjsgcmV0dXJuIDA7IH1gO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIGBsZXQgKCkgPSBwcmludF9lbmRsaW5lICgke2V4cHJlc3Npb259KWA7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbG9vbS1jYWxsIGNhbm5vdCBnZW5lcmF0ZSBhIHByaW50ZWQgaGFybmVzcyBmb3IgJHtsYW5ndWFnZX0uIFVzZSBsb29tLXByaW50PWZhbHNlIG9yIHdyaXRlIHRoZSBoYXJuZXNzIGluIHRoZSBibG9jayBib2R5LmApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlckV4cHJlc3Npb25TdGF0ZW1lbnQobGFuZ3VhZ2U6IHN0cmluZywgZXhwcmVzc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiBleHByZXNzaW9uO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZXhwcmVzc2lvbi5lbmRzV2l0aChcIjtcIikgPyBleHByZXNzaW9uIDogYCR7ZXhwcmVzc2lvbn07YDtcbiAgfVxufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tVG9vbGJhckhhbmRsZXJzIHtcbiAgb25SdW46ICgpID0+IHZvaWQ7XG4gIG9uQ29weTogKCkgPT4gdm9pZDtcbiAgb25SZW1vdmU6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihcbiAgYmxvY2tJZDogc3RyaW5nLFxuICBpc1J1bm5pbmc6IGJvb2xlYW4sXG4gIGhhbmRsZXJzOiBsb29tVG9vbGJhckhhbmRsZXJzLFxuKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCB0b29sYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgdG9vbGJhci5jbGFzc05hbWUgPSBcImxvb20tY29kZS10b29sYmFyXCI7XG4gIHRvb2xiYXIuZGF0YXNldC5sb29tQmxvY2tJZCA9IGJsb2NrSWQ7XG5cbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSdW4gYmxvY2tcIiwgaXNSdW5uaW5nID8gXCJsb2FkZXItY2lyY2xlXCIgOiBcInBsYXlcIiwgaGFuZGxlcnMub25SdW4sIGlzUnVubmluZykpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIkNvcHkgY29kZVwiLCBcImNvcHlcIiwgaGFuZGxlcnMub25Db3B5LCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJlbW92ZSBzbmlwcGV0XCIsIFwidHJhc2gtMlwiLCBoYW5kbGVycy5vblJlbW92ZSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJUb2dnbGUgb3V0cHV0XCIsIFwicGFuZWwtYm90dG9tLW9wZW5cIiwgaGFuZGxlcnMub25Ub2dnbGVPdXRwdXQsIGZhbHNlKSk7XG5cbiAgcmV0dXJuIHRvb2xiYXI7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1dHRvbihsYWJlbDogc3RyaW5nLCBpY29uTmFtZTogc3RyaW5nLCBvbkNsaWNrOiAoKSA9PiB2b2lkLCBzcGlubmluZzogYm9vbGVhbik6IEhUTUxCdXR0b25FbGVtZW50IHtcbiAgY29uc3QgYnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgYnV0dG9uLmNsYXNzTmFtZSA9IGBsb29tLXRvb2xiYXItYnV0dG9uJHtzcGlubmluZyA/IFwiIGlzLXJ1bm5pbmdcIiA6IFwiXCJ9YDtcbiAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xuICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBsYWJlbCk7XG4gIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBvbkNsaWNrKCk7XG4gIH0pO1xuICBzZXRJY29uKGJ1dHRvbiwgaWNvbk5hbWUpO1xuICByZXR1cm4gYnV0dG9uO1xufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbVN0b3JlZE91dHB1dCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgbG9vbU91dHB1dFBhbmVsT3B0aW9ucyB7XG4gIGRlZmF1bHRWaXNpYmxlTGluZXM6IG51bWJlcjtcbn1cblxuZnVuY3Rpb24gZ2V0U3RhdHVzS2luZChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBcInN1Y2Nlc3NcIiB8IFwid2FybmluZ1wiIHwgXCJmYWlsdXJlXCIge1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdWNjZXNzKSB7XG4gICAgcmV0dXJuIG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSB8fCBvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSA/IFwid2FybmluZ1wiIDogXCJzdWNjZXNzXCI7XG4gIH1cblxuICByZXR1cm4gXCJmYWlsdXJlXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQsIG9wdGlvbnM6IGxvb21PdXRwdXRQYW5lbE9wdGlvbnMpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7Z2V0U3RhdHVzS2luZChvdXRwdXQpfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9YDtcbiAgcGFuZWwuZGF0YXNldC5sb29tQmxvY2tJZCA9IG91dHB1dC5ibG9ja0lkO1xuICByZW5kZXJPdXRwdXRQYW5lbChwYW5lbCwgb3V0cHV0LCBvcHRpb25zKTtcbiAgcmV0dXJuIHBhbmVsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyT3V0cHV0UGFuZWwocGFuZWw6IEhUTUxFbGVtZW50LCBvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQsIG9wdGlvbnM6IGxvb21PdXRwdXRQYW5lbE9wdGlvbnMpOiB2b2lkIHtcbiAgY29uc3Qga2luZCA9IGdldFN0YXR1c0tpbmQob3V0cHV0KTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7a2luZH0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifSR7b3V0cHV0LmNvbGxhcHNlZCA/IFwiIGlzLWNvbGxhcHNlZFwiIDogXCJcIn1gO1xuICBwYW5lbC5lbXB0eSgpO1xuICBjb25zdCB2aXNpYmxlTGluZXMgPSByZXNvbHZlVmlzaWJsZUxpbmVzKG91dHB1dCwgb3B0aW9ucy5kZWZhdWx0VmlzaWJsZUxpbmVzKTtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IGJhZGdlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1iYWRnZVwiIH0pO1xuICBzZXRJY29uKGJhZGdlLCBraW5kID09PSBcInN1Y2Nlc3NcIiA/IFwiY2hlY2stY2lyY2xlLTJcIiA6IGtpbmQgPT09IFwid2FybmluZ1wiID8gXCJhbGVydC10cmlhbmdsZVwiIDogXCJ4LWNpcmNsZVwiKTtcblxuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LnJ1bm5lck5hbWV9IFx1MDBCNyBleGl0ICR7b3V0cHV0LnJlc3VsdC5leGl0Q29kZSA/PyBcIj9cIn1gKTtcblxuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChgJHtvdXRwdXQucmVzdWx0LmR1cmF0aW9uTXN9IG1zIFx1MDBCNyAke25ldyBEYXRlKG91dHB1dC5yZXN1bHQuZmluaXNoZWRBdCkudG9Mb2NhbGVUaW1lU3RyaW5nKCl9YCk7XG5cbiAgY29uc3QgYm9keSA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1ib2R5XCIgfSk7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRvdXRcIiwgb3V0cHV0LnJlc3VsdC5zdGRvdXQsIHZpc2libGVMaW5lcyk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiV2FybmluZ1wiLCBvdXRwdXQucmVzdWx0Lndhcm5pbmcsIHZpc2libGVMaW5lcyk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZGVyclwiLCBvdXRwdXQucmVzdWx0LnN0ZGVyciwgdmlzaWJsZUxpbmVzKTtcbiAgfVxuICBpZiAob3V0cHV0LnNvdXJjZVByZXZpZXc/LmNvbnRlbnQudHJpbSgpKSB7XG4gICAgY3JlYXRlU291cmNlUHJldmlldyhib2R5LCBvdXRwdXQuc291cmNlUHJldmlldyk7XG4gIH1cbiAgaWYgKCFvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpICYmICFvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkgJiYgIW91dHB1dC5zb3VyY2VQcmV2aWV3Py5jb250ZW50LnRyaW0oKSkge1xuICAgIGNvbnN0IGVtcHR5ID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtZW1wdHlcIiB9KTtcbiAgICBlbXB0eS5zZXRUZXh0KFwiTm8gb3V0cHV0XCIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVN0cmVhbShjb250YWluZXI6IEhUTUxFbGVtZW50LCBsYWJlbDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcsIHZpc2libGVMaW5lczogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbVwiIH0pO1xuICBjb25zdCBsaW5lQ291bnQgPSBjb3VudExpbmVzKGNvbnRlbnQpO1xuICBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW0tbGFiZWxcIiwgdGV4dDogZm9ybWF0U3RyZWFtTGFiZWwobGFiZWwsIGxpbmVDb3VudCwgdmlzaWJsZUxpbmVzKSB9KTtcbiAgY29uc3QgcHJlID0gc2VjdGlvbi5jcmVhdGVFbChcInByZVwiLCB7IGNsczogXCJsb29tLW91dHB1dC1wcmVcIiwgdGV4dDogY29udGVudCB9KTtcbiAgaWYgKHZpc2libGVMaW5lcyA+IDAgJiYgbGluZUNvdW50ID4gdmlzaWJsZUxpbmVzKSB7XG4gICAgcHJlLmFkZENsYXNzKFwiaXMtc2Nyb2xsLWxpbWl0ZWRcIik7XG4gICAgcHJlLnN0eWxlLnNldFByb3BlcnR5KFwiLS1sb29tLW91dHB1dC12aXNpYmxlLWxpbmVzXCIsIFN0cmluZyh2aXNpYmxlTGluZXMpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVTb3VyY2VQcmV2aWV3KGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIHByZXZpZXc6IE5vbk51bGxhYmxlPGxvb21TdG9yZWRPdXRwdXRbXCJzb3VyY2VQcmV2aWV3XCJdPik6IHZvaWQge1xuICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3XCIgfSk7XG4gIGRldGFpbHMub3BlbiA9IHByZXZpZXcuZXhwYW5kZWQ7XG4gIGNvbnN0IHN1bW1hcnkgPSBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3LXN1bW1hcnlcIiB9KTtcbiAgc3VtbWFyeS5jcmVhdGVTcGFuKHsgdGV4dDogXCJFeHRyYWN0ZWQgc291cmNlXCIgfSk7XG4gIHN1bW1hcnkuY3JlYXRlU3Bhbih7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3LW1ldGFcIiwgdGV4dDogZm9ybWF0U291cmNlUHJldmlld01ldGEocHJldmlldykgfSk7XG4gIGRldGFpbHMuY3JlYXRlRWwoXCJwcmVcIiwgeyBjbHM6IFwibG9vbS1vdXRwdXQtcHJlIGxvb20tc291cmNlLXByZXZpZXctcHJlXCIsIHRleHQ6IHByZXZpZXcuY29udGVudCB9KTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U291cmNlUHJldmlld01ldGEocHJldmlldzogTm9uTnVsbGFibGU8bG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0+KTogc3RyaW5nIHtcbiAgY29uc3QgY2FwYWJpbGl0eSA9IHByZXZpZXcuY2FwYWJpbGl0eTtcbiAgaWYgKCFjYXBhYmlsaXR5IHx8ICFwcmV2aWV3LnNob3dDYXBhYmlsaXR5TWV0YWRhdGEpIHtcbiAgICByZXR1cm4gYCR7cHJldmlldy5sYW5ndWFnZX0gXHUwMEI3ICR7cHJldmlldy5kZXNjcmlwdGlvbn1gO1xuICB9XG4gIHJldHVybiBbXG4gICAgcHJldmlldy5sYW5ndWFnZSxcbiAgICBwcmV2aWV3LmRlc2NyaXB0aW9uLFxuICAgIGBzeW1ib2xzOiR7Y2FwYWJpbGl0eS5zeW1ib2xFeHRyYWN0aW9ufWAsXG4gICAgYGRlcHM6JHtjYXBhYmlsaXR5LmRlcGVuZGVuY3lUcmFjaW5nfWAsXG4gICAgYGNhbGw6JHtjYXBhYmlsaXR5LmNhbGxIYXJuZXNzfWAsXG4gIF0uam9pbihcIiBcdTAwQjcgXCIpO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlVmlzaWJsZUxpbmVzKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCwgZGVmYXVsdFZpc2libGVMaW5lczogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3Qgb3ZlcnJpZGUgPSBvdXRwdXQuYmxvY2suYXR0cmlidXRlc1tcImxvb20tb3V0cHV0LWxpbmVzXCJdID8/IG91dHB1dC5ibG9jay5hdHRyaWJ1dGVzW1wib3V0cHV0LWxpbmVzXCJdO1xuICBpZiAob3ZlcnJpZGUgIT0gbnVsbCkge1xuICAgIHJldHVybiBub3JtYWxpemVWaXNpYmxlTGluZXMoTnVtYmVyLnBhcnNlSW50KG92ZXJyaWRlLnRyaW0oKSwgMTApKTtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplVmlzaWJsZUxpbmVzKGRlZmF1bHRWaXNpYmxlTGluZXMpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVWaXNpYmxlTGluZXModmFsdWU6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cbiAgcmV0dXJuIE1hdGgubWluKE1hdGguZmxvb3IodmFsdWUpLCAyMDAwKTtcbn1cblxuZnVuY3Rpb24gY291bnRMaW5lcyhjb250ZW50OiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gY29udGVudC5yZXBsYWNlKC9cXG4kLywgXCJcIikuc3BsaXQoXCJcXG5cIikubGVuZ3RoO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRTdHJlYW1MYWJlbChsYWJlbDogc3RyaW5nLCBsaW5lQ291bnQ6IG51bWJlciwgdmlzaWJsZUxpbmVzOiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAodmlzaWJsZUxpbmVzID4gMCAmJiBsaW5lQ291bnQgPiB2aXNpYmxlTGluZXMpIHtcbiAgICByZXR1cm4gYCR7bGFiZWx9IFx1MDBCNyAke2xpbmVDb3VudH0gbGluZXMgXHUwMEI3IHNob3dpbmcgJHt2aXNpYmxlTGluZXN9YDtcbiAgfVxuICByZXR1cm4gbGFiZWw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSdW5uaW5nUGFuZWwoKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IFwibG9vbS1vdXRwdXQtcGFuZWwgaXMtcnVubmluZ1wiO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3Qgc3Bpbm5lciA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zcGlubmVyXCIgfSk7XG4gIHNldEljb24oc3Bpbm5lciwgXCJsb2FkZXItY2lyY2xlXCIpO1xuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChcIlJ1bm5pbmdcIik7XG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KFwiRXhlY3V0aW5nLi4uXCIpO1xuICBzcGlubmVyLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcblxuICByZXR1cm4gcGFuZWw7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFTTztBQUNQLG1CQUE2QztBQUM3QyxJQUFBQyxlQUEyRTtBQUMzRSxJQUFBQyxnQkFBd0I7OztBQ1p4QixzQkFBNkM7QUFDN0MsZ0JBQWdEO0FBQ2hELElBQUFDLG1CQUF3RDtBQUN4RCxJQUFBQyxlQUFpRjtBQUNqRixJQUFBQyx3QkFBc0I7OztBQ0p0QixzQkFBdUM7QUFDdkMsZ0JBQXVCO0FBQ3ZCLGtCQUFxQjtBQUNyQiwyQkFBc0I7QUF3QnRCLGVBQXNCLHdCQUNwQixVQUNBLFFBQ0EsVUFDWTtBQUNaLFFBQU0sVUFBVSxVQUFNLDZCQUFRLHNCQUFLLGtCQUFPLEdBQUcsT0FBTyxDQUFDO0FBQ3JELFFBQU0sZUFBVyxrQkFBSyxTQUFTLFFBQVE7QUFFdkMsTUFBSTtBQUNGLGNBQU0sMkJBQVUsVUFBVSwwQkFBMEIsTUFBTSxHQUFHLE1BQU07QUFDbkUsV0FBTyxNQUFNLFNBQVMsRUFBRSxTQUFTLFNBQVMsQ0FBQztBQUFBLEVBQzdDLFVBQUU7QUFDQSxjQUFNLG9CQUFHLFNBQVMsRUFBRSxXQUFXLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFBQSxFQUNwRDtBQUNGO0FBRUEsZUFBc0IsbUJBQ3BCLGVBQ0EsUUFDQSxVQUNZO0FBQ1osU0FBTyx3QkFBd0IsVUFBVSxhQUFhLElBQUksUUFBUSxRQUFRO0FBQzVFO0FBRUEsU0FB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QTZCLE9BQU87QUFBQSxNQUNwQztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFUSx1QkFBdUIsT0FBaUIsU0FBd0Q7QUFDdEcsVUFBTSxjQUFjLDZCQUE2QixPQUFPO0FBQ3hELGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUN4QyxVQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSxhQUFhO0FBQ25DO0FBQUEsTUFDRjtBQUVBLGVBQVMsSUFBSSxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQzVDLFlBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLDRCQUE0QjtBQUNsRCxpQkFBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUM1QjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF92aWV3IiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJwb3NpeFBhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJhbGlhc2VzIiwgImdldExlYWRpbmdXaGl0ZXNwYWNlIiwgInBhcnNlUG9zaXRpdmVJbnRlZ2VyIiwgImlzRGlzYWJsZWRWYWx1ZSIsICJub3JtYWxpemVFeHRlbnNpb24iLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X2ZzIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJsb29tUGx1Z2luIiwgImltcG9ydF9jaGlsZF9wcm9jZXNzIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfb3MiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
