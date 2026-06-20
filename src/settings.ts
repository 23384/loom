import { Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type loomPlugin from "./main";
import type { loomPluginSettings } from "./types";

export const DEFAULT_SETTINGS: loomPluginSettings = {
  enableLocalExecution: false,
  hasAcknowledgedExecutionRisk: false,
  preserveSourceMode: true,
  defaultTimeoutMs: 8000,
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
  javaCompilerExecutable: "",
  javaExecutable: "java",
  llvmInterpreterExecutable: "lli",
  leanExecutable: "lean",
  coqExecutable: "coqc",
  smtExecutable: "z3",
  writeOutputToNote: false,
  autoRunOnFileOpen: false,
};

export class loomSettingTab extends PluginSettingTab {
  constructor(private readonly loomPlugin: loomPlugin) {
    super(loomPlugin.app, loomPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "loom" });
    containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });

    containerEl.createEl("h3", { text: "Execution" });
    new Setting(containerEl)
      .setName("Enable local execution")
      .setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
          this.loomPlugin.settings.enableLocalExecution = value;
          if (value) {
            this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
          }
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Keep loom notes in source mode")
      .setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
          this.loomPlugin.settings.preserveSourceMode = value;
          await this.loomPlugin.saveSettings();
          void this.loomPlugin.enforceSourceModeForActiveView();
        }),
      );

    new Setting(containerEl)
      .setName("Default timeout")
      .setDesc("Maximum execution time in milliseconds before loom terminates the process.")
      .addText((text) =>
        text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.loomPlugin.settings.defaultTimeoutMs = parsed;
            await this.loomPlugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.")
      .addText((text) =>
        text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
          this.loomPlugin.settings.workingDirectory = value.trim() ? normalizePath(value.trim()) : "";
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Write output back to note")
      .setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
          this.loomPlugin.settings.writeOutputToNote = value;
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Auto-run on file open")
      .setDesc("Run all supported blocks in the active note when it opens. Disabled by default.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
          this.loomPlugin.settings.autoRunOnFileOpen = value;
          await this.loomPlugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "Runtimes" });
    new Setting(containerEl)
      .setName("Python executable")
      .setDesc("Path or command name for Python.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.pythonExecutable).onChange(async (value) => {
          this.loomPlugin.settings.pythonExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Node executable")
      .setDesc("Path or command name for JavaScript execution.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.nodeExecutable).onChange(async (value) => {
          this.loomPlugin.settings.nodeExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("TypeScript runner mode")
      .setDesc("Use ts-node or tsx for TypeScript blocks.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ts-node", "ts-node")
          .addOption("tsx", "tsx")
          .setValue(this.loomPlugin.settings.typescriptMode)
          .onChange(async (value) => {
            this.loomPlugin.settings.typescriptMode = value as "ts-node" | "tsx";
            await this.loomPlugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("TypeScript transpiler executable")
      .setDesc("Command or path for ts-node or tsx.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.typescriptTranspilerExecutable).onChange(async (value) => {
          this.loomPlugin.settings.typescriptTranspilerExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("OCaml mode")
      .setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ocaml", "ocaml")
          .addOption("ocamlc", "ocamlc")
          .addOption("dune", "dune")
          .setValue(this.loomPlugin.settings.ocamlMode)
          .onChange(async (value) => {
            this.loomPlugin.settings.ocamlMode = value as "ocaml" | "ocamlc" | "dune";
            await this.loomPlugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("OCaml executable")
      .setDesc("Command or path for ocaml, ocamlc, or dune depending on the selected mode.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.ocamlExecutable).onChange(async (value) => {
          this.loomPlugin.settings.ocamlExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("C compiler")
      .setDesc("Command or path for compiling C blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.cExecutable).onChange(async (value) => {
          this.loomPlugin.settings.cExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("C++ compiler")
      .setDesc("Command or path for compiling C++ blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.cppExecutable).onChange(async (value) => {
          this.loomPlugin.settings.cppExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Shell executable")
      .setDesc("Command or path for Shell, Bash, and sh blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.shellExecutable).onChange(async (value) => {
          this.loomPlugin.settings.shellExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Ruby executable")
      .setDesc("Command or path for Ruby blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.rubyExecutable).onChange(async (value) => {
          this.loomPlugin.settings.rubyExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Perl executable")
      .setDesc("Command or path for Perl blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.perlExecutable).onChange(async (value) => {
          this.loomPlugin.settings.perlExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Lua executable")
      .setDesc("Command or path for Lua blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.luaExecutable).onChange(async (value) => {
          this.loomPlugin.settings.luaExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("PHP executable")
      .setDesc("Command or path for PHP blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.phpExecutable).onChange(async (value) => {
          this.loomPlugin.settings.phpExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Go executable")
      .setDesc("Command or path for Go blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.goExecutable).onChange(async (value) => {
          this.loomPlugin.settings.goExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Rust compiler")
      .setDesc("Command or path for compiling Rust blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.rustExecutable).onChange(async (value) => {
          this.loomPlugin.settings.rustExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Java compiler")
      .setDesc("Optional command or path for javac. Leave empty to use Java source-file mode.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.javaCompilerExecutable).onChange(async (value) => {
          this.loomPlugin.settings.javaCompilerExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("LLVM IR interpreter")
      .setDesc("Command or path for running LLVM IR blocks with lli.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.llvmInterpreterExecutable).onChange(async (value) => {
          this.loomPlugin.settings.llvmInterpreterExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Lean executable")
      .setDesc("Command or path for checking Lean blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.leanExecutable).onChange(async (value) => {
          this.loomPlugin.settings.leanExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Coq executable")
      .setDesc("Command or path for checking Coq blocks with coqc.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.coqExecutable).onChange(async (value) => {
          this.loomPlugin.settings.coqExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("SMT solver")
      .setDesc("Command or path for SMT-LIB blocks. Defaults to z3.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.smtExecutable).onChange(async (value) => {
          this.loomPlugin.settings.smtExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Java executable")
      .setDesc("Command or path for running compiled Java blocks.")
      .addText((text) =>
        text.setValue(this.loomPlugin.settings.javaExecutable).onChange(async (value) => {
          this.loomPlugin.settings.javaExecutable = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );

    containerEl.createEl("p", {
      text: "Missing runtime executables will surface as run errors. loom never claims sandboxing and executes code with your configured commands.",
      cls: "setting-item-description",
    });
  }
}

export function showExecutionDisabledNotice(): void {
  new Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
