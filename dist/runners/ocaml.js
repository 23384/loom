"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OcamlRunner = void 0;
const path_1 = require("path");
const processRunner_1 = require("../execution/processRunner");
class OcamlRunner {
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
            return (0, processRunner_1.runTempFileProcess)({
                runnerId: `${this.id}:ocaml`,
                runnerName: "OCaml",
                executable,
                args: ["{file}"],
                fileExtension: ".ml",
                source: block.content,
                workingDirectory: context.workingDirectory,
                timeoutMs: context.timeoutMs,
                signal: context.signal,
            });
        }
        if (mode === "dune") {
            return (0, processRunner_1.runTempFileProcess)({
                runnerId: `${this.id}:dune`,
                runnerName: "Dune / OCaml",
                executable,
                args: ["exec", "--", "ocaml", "{file}"],
                fileExtension: ".ml",
                source: block.content,
                workingDirectory: context.workingDirectory,
                timeoutMs: context.timeoutMs,
                signal: context.signal,
            });
        }
        return (0, processRunner_1.withTempSourceFile)(".ml", block.content, async ({ tempDir, tempFile }) => {
            const binaryPath = (0, path_1.join)(tempDir, "snippet.out");
            const compileResult = await (0, processRunner_1.runProcess)({
                runnerId: `${this.id}:ocamlc-compile`,
                runnerName: "OCamlc",
                executable,
                args: ["-o", binaryPath, tempFile],
                workingDirectory: context.workingDirectory,
                timeoutMs: context.timeoutMs,
                signal: context.signal,
            });
            if (!compileResult.success) {
                return compileResult;
            }
            return (0, processRunner_1.runProcess)({
                runnerId: `${this.id}:ocamlc-run`,
                runnerName: "OCamlc",
                executable: binaryPath,
                args: [],
                workingDirectory: context.workingDirectory,
                timeoutMs: context.timeoutMs,
                signal: context.signal,
            });
        });
    }
}
exports.OcamlRunner = OcamlRunner;
