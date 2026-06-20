"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeRunner = void 0;
const processRunner_1 = require("../execution/processRunner");
class NodeRunner {
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
            return (0, processRunner_1.runTempFileProcess)({
                runnerId: this.id,
                runnerName: this.displayName,
                executable: settings.nodeExecutable.trim(),
                args: ["{file}"],
                fileExtension: ".js",
                source: block.content,
                workingDirectory: context.workingDirectory,
                timeoutMs: context.timeoutMs,
                signal: context.signal,
            });
        }
        const executable = settings.typescriptTranspilerExecutable.trim();
        const runnerName = settings.typescriptMode === "tsx" ? "TypeScript (tsx)" : "TypeScript (ts-node)";
        return (0, processRunner_1.runTempFileProcess)({
            runnerId: `${this.id}:${settings.typescriptMode}`,
            runnerName,
            executable,
            args: ["{file}"],
            fileExtension: ".ts",
            source: block.content,
            workingDirectory: context.workingDirectory,
            timeoutMs: context.timeoutMs,
            signal: context.signal,
        });
    }
}
exports.NodeRunner = NodeRunner;
