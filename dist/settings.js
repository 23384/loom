"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoomSettingTab = exports.DEFAULT_SETTINGS = void 0;
exports.showExecutionDisabledNotice = showExecutionDisabledNotice;
const obsidian_1 = require("obsidian");
exports.DEFAULT_SETTINGS = {
    enableLocalExecution: false,
    hasAcknowledgedExecutionRisk: false,
    defaultTimeoutMs: 8000,
    workingDirectory: "",
    pythonExecutable: "python3",
    nodeExecutable: "node",
    typescriptMode: "ts-node",
    typescriptTranspilerExecutable: "ts-node",
    ocamlMode: "ocaml",
    ocamlExecutable: "ocaml",
    writeOutputToNote: false,
    autoRunOnFileOpen: false,
};
class LoomSettingTab extends obsidian_1.PluginSettingTab {
    constructor(loomPlugin) {
        super(loomPlugin.app, loomPlugin);
        this.loomPlugin = loomPlugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Loom" });
        containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });
        containerEl.createEl("h3", { text: "Execution" });
        new obsidian_1.Setting(containerEl)
            .setName("Enable local execution")
            .setDesc("Disabled by default. Loom runs code on your local machine and does not provide sandboxing.")
            .addToggle((toggle) => toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
            this.loomPlugin.settings.enableLocalExecution = value;
            if (value) {
                this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
            }
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Default timeout")
            .setDesc("Maximum execution time in milliseconds before Loom terminates the process.")
            .addText((text) => text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                this.loomPlugin.settings.defaultTimeoutMs = parsed;
                await this.loomPlugin.saveSettings();
            }
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Working directory")
            .setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.")
            .addText((text) => text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
            this.loomPlugin.settings.workingDirectory = value.trim() ? (0, obsidian_1.normalizePath)(value.trim()) : "";
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Write output back to note")
            .setDesc("Insert managed Loom output sections beneath code blocks instead of keeping results purely in the UI.")
            .addToggle((toggle) => toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
            this.loomPlugin.settings.writeOutputToNote = value;
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Auto-run on file open")
            .setDesc("Run all supported blocks in the active note when it opens. Disabled by default.")
            .addToggle((toggle) => toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
            this.loomPlugin.settings.autoRunOnFileOpen = value;
            await this.loomPlugin.saveSettings();
        }));
        containerEl.createEl("h3", { text: "Runtimes" });
        new obsidian_1.Setting(containerEl)
            .setName("Python executable")
            .setDesc("Path or command name for Python.")
            .addText((text) => text.setValue(this.loomPlugin.settings.pythonExecutable).onChange(async (value) => {
            this.loomPlugin.settings.pythonExecutable = value.trim();
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("Node executable")
            .setDesc("Path or command name for JavaScript execution.")
            .addText((text) => text.setValue(this.loomPlugin.settings.nodeExecutable).onChange(async (value) => {
            this.loomPlugin.settings.nodeExecutable = value.trim();
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("TypeScript runner mode")
            .setDesc("Use ts-node or tsx for TypeScript blocks.")
            .addDropdown((dropdown) => dropdown
            .addOption("ts-node", "ts-node")
            .addOption("tsx", "tsx")
            .setValue(this.loomPlugin.settings.typescriptMode)
            .onChange(async (value) => {
            this.loomPlugin.settings.typescriptMode = value;
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("TypeScript transpiler executable")
            .setDesc("Command or path for ts-node or tsx.")
            .addText((text) => text.setValue(this.loomPlugin.settings.typescriptTranspilerExecutable).onChange(async (value) => {
            this.loomPlugin.settings.typescriptTranspilerExecutable = value.trim();
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("OCaml mode")
            .setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.")
            .addDropdown((dropdown) => dropdown
            .addOption("ocaml", "ocaml")
            .addOption("ocamlc", "ocamlc")
            .addOption("dune", "dune")
            .setValue(this.loomPlugin.settings.ocamlMode)
            .onChange(async (value) => {
            this.loomPlugin.settings.ocamlMode = value;
            await this.loomPlugin.saveSettings();
        }));
        new obsidian_1.Setting(containerEl)
            .setName("OCaml executable")
            .setDesc("Command or path for ocaml, ocamlc, or dune depending on the selected mode.")
            .addText((text) => text.setValue(this.loomPlugin.settings.ocamlExecutable).onChange(async (value) => {
            this.loomPlugin.settings.ocamlExecutable = value.trim();
            await this.loomPlugin.saveSettings();
        }));
        containerEl.createEl("p", {
            text: "Missing runtime executables will surface as run errors. Loom never claims sandboxing and executes code with your configured commands.",
            cls: "setting-item-description",
        });
    }
}
exports.LoomSettingTab = LoomSettingTab;
function showExecutionDisabledNotice() {
    new obsidian_1.Notice("Loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
