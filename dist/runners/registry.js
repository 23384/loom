"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoomRunnerRegistry = void 0;
class LoomRunnerRegistry {
    constructor(runners) {
        this.runners = runners;
    }
    getRunnerForBlock(block, settings) {
        return this.runners.find((runner) => runner.languages.includes(block.language) && runner.canRun(block, settings)) ?? null;
    }
    getSupportedLanguages() {
        return [...new Set(this.runners.flatMap((runner) => runner.languages))];
    }
}
exports.LoomRunnerRegistry = LoomRunnerRegistry;
