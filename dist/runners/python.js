"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonRunner = void 0;
const processRunner_1 = require("../execution/processRunner");
class PythonRunner {
    constructor() {
        this.id = "python";
        this.displayName = "Python";
        this.languages = ["python"];
    }
    canRun(block, settings) {
        return block.language === "python" && Boolean(settings.pythonExecutable.trim());
    }
    run(block, context, settings) {
        return (0, processRunner_1.runTempFileProcess)({
            runnerId: this.id,
            runnerName: this.displayName,
            executable: settings.pythonExecutable.trim(),
            args: ["{file}"],
            fileExtension: ".py",
            source: block.content,
            workingDirectory: context.workingDirectory,
            timeoutMs: context.timeoutMs,
            signal: context.signal,
        });
    }
}
exports.PythonRunner = PythonRunner;
