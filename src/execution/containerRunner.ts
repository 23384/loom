import { Notice, type App, type TFile } from "obsidian";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { basename, join, normalize as normalizeFsPath, posix as posixPath } from "path";
import { runProcess } from "./processRunner";
import { splitCommandLine } from "../utils/command";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult } from "../types";

type loomContainerRuntime = "docker" | "podman" | "qemu" | "custom";

interface loomContainerLanguageConfig {
  command: string;
  extension: string;
}

interface loomCommandExpectation {
  command: string;
  positiveResponse?: string;
  negativeResponse?: string;
}

interface loomQemuConfig {
  sshTarget: string;
  remoteWorkspace: string;
  sshExecutable?: string;
  sshArgs?: string;
  startCommand?: string;
  buildCommand?: string;
  teardownCommand?: string;
  healthCheck?: loomCommandExpectation;
}

interface loomCustomRuntimeConfig {
  executable: string;
  args?: string;
  build?: string;
  commandStructure?: string;
  teardown?: string;
  healthCheck?: loomCommandExpectation;
}

interface loomContainerConfig {
  runtime: loomContainerRuntime;
  executable?: string;
  image?: string;
  healthCheck?: loomCommandExpectation;
  qemu?: loomQemuConfig;
  custom?: loomCustomRuntimeConfig;
  languages: Record<string, loomContainerLanguageConfig>;
}

interface loomCustomRuntimeRequest {
  action: "build" | "run" | "teardown";
  groupName: string;
  groupPath: string;
  runtime: loomContainerRuntime;
  image?: string;
  build?: string;
  commandStructure?: string;
  teardown?: string;
  language?: string;
  languageAlias?: string;
  fileName?: string;
  filePath?: string;
  command?: string;
  timeoutMs: number;
  config: {
    executable?: string;
    custom?: loomCustomRuntimeConfig;
    qemu?: loomQemuConfig;
    healthCheck?: loomCommandExpectation;
  };
}

export class loomContainerRunner {
  private readonly builtImages = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
  ) {}

  getContainerGroupName(file: TFile): string | null {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["loom-container"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  async getGroupSummaries(): Promise<Array<{ name: string; status: string }>> {
    const containersPath = this.getContainersPath();
    if (!existsSync(containersPath)) {
      return [];
    }

    const { readdir } = await import("fs/promises");
    const entries = await readdir(containersPath, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const groupPath = join(containersPath, entry.name);
          const hasConfig = existsSync(join(groupPath, "config.json"));
          const hasDockerfile = existsSync(join(groupPath, "Dockerfile"));
          if (!hasConfig) {
            return {
              name: entry.name,
              status: "missing config.json",
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
              status: pieces.join(", "),
            };
          } catch (error) {
            return {
              name: entry.name,
              status: `invalid config.json: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }),
    );
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings, groupName: string): Promise<loomRunResult> {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const language = config.languages[block.language] ?? config.languages[block.languageAlias];
    if (!language) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }

    await mkdir(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = join(groupPath, tempFileName);

    try {
      await writeFile(tempFilePath, block.content, "utf8");
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
      await rm(tempFilePath, { force: true });
    }
  }

  async buildGroup(groupName: string, timeoutMs: number, signal: AbortSignal): Promise<loomRunResult> {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    await mkdir(groupPath, { recursive: true });
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

  private async runOciContainer(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    language: loomContainerLanguageConfig,
    tempFileName: string,
    context: loomRunContext,
    settings: loomPluginSettings,
  ): Promise<loomRunResult> {
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
        ...command,
      ],
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
    });
  }

  private async runQemu(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    language: loomContainerLanguageConfig,
    tempFileName: string,
    context: loomRunContext,
  ): Promise<loomRunResult> {
    const qemu = this.requireQemuConfig(config);
    await this.runOptionalCommand(qemu.startCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:start`, `QEMU ${groupName} start`);
    await this.runHealthCheck(qemu.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:health`, `QEMU ${groupName} health check`);

    try {
      const remoteFile = posixPath.join(qemu.remoteWorkspace, tempFileName);
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
          `cd ${shellQuote(qemu.remoteWorkspace)} && ${remoteCommand}`,
        ],
        workingDirectory: groupPath,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
      });
    } finally {
      await this.runOptionalCommand(qemu.teardownCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:teardown`, `QEMU ${groupName} teardown`);
    }
  }

  private async runCustom(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    block: loomCodeBlock,
    language: loomContainerLanguageConfig,
    tempFileName: string,
    tempFilePath: string,
    context: loomRunContext,
  ): Promise<loomRunResult> {
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
        command,
      }),
      context.timeoutMs,
      context.signal,
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
          command,
        }),
        context.timeoutMs,
        context.signal,
      );
      if (!teardown.success) {
        result.warning = `Custom runtime teardown failed: ${teardown.stderr || teardown.stdout || `exit ${teardown.exitCode}`}`;
      }
    }

    return result;
  }

  private async resolveImage(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    context: loomRunContext,
    settings: loomPluginSettings,
  ): Promise<string> {
    const dockerfile = join(groupPath, "Dockerfile");
    if (!existsSync(dockerfile)) {
      return config.image || "ubuntu:latest";
    }

    const image = this.imageNameForGroup(groupName);
    const cacheKey = `${this.runtimeExecutable(config)}:${image}`;
    if (this.builtImages.has(cacheKey)) {
      return image;
    }

    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 120_000), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `${runtimeLabel(config.runtime)} build failed for ${groupName}.`);
    }

    this.builtImages.add(cacheKey);
    return image;
  }

  private async buildImage(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<loomRunResult> {
    const image = this.imageNameForGroup(groupName);
    if (!existsSync(join(groupPath, "Dockerfile"))) {
      return this.createSyntheticResult(
        `container:${groupName}:build`,
        `${runtimeLabel(config.runtime)} ${groupName} build`,
        `No Dockerfile configured. Using image ${config.image || "ubuntu:latest"}.\n`,
      );
    }
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName} build`,
      executable: this.runtimeExecutable(config),
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal,
    });
  }

  private async buildQemu(groupName: string, groupPath: string, config: loomContainerConfig, timeoutMs: number, signal: AbortSignal): Promise<loomRunResult> {
    const qemu = this.requireQemuConfig(config);
    if (!qemu.buildCommand?.trim()) {
      return this.createSyntheticResult(`container:${groupName}:qemu:build`, `QEMU ${groupName} build`, "No QEMU build command configured.\n");
    }
    return this.runCommandLine(qemu.buildCommand, groupPath, timeoutMs, signal, `container:${groupName}:qemu:build`, `QEMU ${groupName} build`);
  }

  private async readConfig(groupPath: string): Promise<loomContainerConfig> {
    const configPath = join(groupPath, "config.json");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read container config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Container config must be an object.");
    }

    const data = raw as {
      runtime?: unknown;
      executable?: unknown;
      image?: unknown;
      healthCheck?: unknown;
      qemu?: unknown;
      custom?: unknown;
      languages?: unknown;
    };
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

    const languages: Record<string, loomContainerLanguageConfig> = {};
    for (const [language, value] of Object.entries(data.languages as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Container language ${language} must be an object.`);
      }
      const languageConfig = value as { command?: unknown; extension?: unknown };
      if (typeof languageConfig.command !== "string" || !languageConfig.command.trim()) {
        throw new Error(`Container language ${language} must define command.`);
      }
      languages[language] = {
        command: languageConfig.command,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : `.${language}`,
      };
    }

    return {
      runtime,
      executable: typeof data.executable === "string" && data.executable.trim() ? data.executable.trim() : undefined,
      image: typeof data.image === "string" ? data.image : undefined,
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config healthCheck"),
      qemu: this.readQemuConfig(data.qemu),
      custom: this.readCustomConfig(data.custom),
      languages,
    };
  }

  private readRuntime(value: unknown): loomContainerRuntime {
    if (value == null) {
      return "docker";
    }
    if (value === "docker" || value === "podman" || value === "qemu" || value === "custom") {
      return value;
    }
    throw new Error("Container config runtime must be docker, podman, qemu, or custom.");
  }

  private readQemuConfig(value: unknown): loomQemuConfig | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu must be an object.");
    }
    const data = value as Record<string, unknown>;
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
    };
  }

  private readCustomConfig(value: unknown): loomCustomRuntimeConfig | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config custom must be an object.");
    }
    const data = value as Record<string, unknown>;
    if (typeof data.executable !== "string" || !data.executable.trim()) {
      throw new Error("Container config custom.executable must be a string.");
    }
    return {
      executable: data.executable.trim(),
      args: optionalString(data.args),
      build: optionalString(data.build),
      commandStructure: optionalString(data.commandStructure),
      teardown: optionalString(data.teardown),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config custom.healthCheck"),
    };
  }

  private readHealthCheck(value: unknown, label: string): loomCommandExpectation | undefined {
    if (value == null) {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    const data = value as Record<string, unknown>;
    if (typeof data.command !== "string" || !data.command.trim()) {
      throw new Error(`${label}.command must be a string.`);
    }
    return {
      command: data.command.trim(),
      positiveResponse: optionalString(data.positiveResponse ?? data.positive_response ?? data["positive response"] ?? data.possitiveResponse),
      negativeResponse: optionalString(data.negativeResponse ?? data.negative_response ?? data["negative response"]),
    };
  }

  private requireQemuConfig(config: loomContainerConfig): loomQemuConfig {
    if (!config.qemu) {
      throw new Error("QEMU runtime requires a qemu config object.");
    }
    return config.qemu;
  }

  private requireCustomConfig(config: loomContainerConfig): loomCustomRuntimeConfig {
    if (!config.custom) {
      throw new Error("Custom runtime requires a custom config object.");
    }
    return config.custom;
  }

  private runtimeExecutable(config: loomContainerConfig): string {
    if (config.executable?.trim()) {
      return config.executable.trim();
    }
    return config.runtime === "podman" ? "podman" : "docker";
  }

  private async runHealthCheck(
    healthCheck: loomCommandExpectation | undefined,
    workingDirectory: string,
    timeoutMs: number,
    signal: AbortSignal,
    runnerId: string,
    runnerName: string,
  ): Promise<void> {
    if (!healthCheck) {
      return;
    }

    const result = await this.runCommandLine(healthCheck.command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
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

  private async runOptionalCommand(
    command: string | undefined,
    workingDirectory: string,
    timeoutMs: number,
    signal: AbortSignal,
    runnerId: string,
    runnerName: string,
  ): Promise<void> {
    if (!command?.trim()) {
      return;
    }
    const result = await this.runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }

  private async runCommandLine(
    command: string,
    workingDirectory: string,
    timeoutMs: number,
    signal: AbortSignal,
    runnerId: string,
    runnerName: string,
  ): Promise<loomRunResult> {
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
      signal,
    });
  }

  private async runCustomWrapper(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    request: loomCustomRuntimeRequest,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<loomRunResult> {
    const custom = this.requireCustomConfig(config);
    await this.runHealthCheck(custom.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:custom:health`, `Custom ${groupName} health check`);

    const requestFileName = `request_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    const requestPath = join(groupPath, requestFileName);
    try {
      await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
      const args = splitCommandLine(custom.args || "{request}").map((arg) =>
        arg
          .replaceAll("{request}", requestPath)
          .replaceAll("{group}", groupName)
          .replaceAll("{groupPath}", groupPath),
      );
      return await runProcess({
        runnerId: `container:${groupName}:custom:${request.action}`,
        runnerName: `Custom ${groupName} ${request.action}`,
        executable: custom.executable,
        args,
        workingDirectory: groupPath,
        timeoutMs,
        signal,
      });
    } finally {
      await rm(requestPath, { force: true });
    }
  }

  private createCustomRequest(
    action: loomCustomRuntimeRequest["action"],
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    timeoutMs: number,
    extra: Partial<loomCustomRuntimeRequest> = {},
  ): loomCustomRuntimeRequest {
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
        healthCheck: config.healthCheck,
      },
      ...extra,
    };
  }

  private createSyntheticResult(runnerId: string, runnerName: string, stdout: string, success = true): loomRunResult {
    const now = new Date().toISOString();
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
      cancelled: false,
    };
  }

  private getContainersPath(): string {
    const adapterBasePath = (this.app.vault.adapter as { basePath?: string }).basePath ?? "";
    return normalizeFsPath(join(adapterBasePath, this.pluginDir, "containers"));
  }

  private resolveGroupPath(groupName: string): string {
    const safeName = basename(groupName);
    if (!safeName || safeName !== groupName) {
      throw new Error(`Invalid container group name: ${groupName}`);
    }
    return normalizeFsPath(join(this.getContainersPath(), safeName));
  }

  private imageNameForGroup(groupName: string): string {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
}

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function showDockerNotice(message: string): void {
  new Notice(message, 8000);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function runtimeLabel(runtime: loomContainerRuntime): string {
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
