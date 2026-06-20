import { runTempFileProcess } from "../execution/processRunner";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult, loomRunner } from "../types";

export class LlvmRunner implements loomRunner {
  id = "llvm-ir";
  displayName = "LLVM IR";
  languages = ["llvm-ir"] as const;

  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean {
    return block.language === "llvm-ir" && Boolean(settings.llvmInterpreterExecutable.trim());
  }

  run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings): Promise<loomRunResult> {
    return runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.llvmInterpreterExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".ll",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 30_000),
      signal: context.signal,
    });
  }
}
