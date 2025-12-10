"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigDrivenSink = exports.DefaultTargetResolver = exports.SimulationConfigSchema = exports.parseSimulationConfig = exports.simulateStrategy = exports.SimulationEngine = void 0;
exports.runSimulationConfig = runSimulationConfig;
exports.loadSimulationConfig = loadSimulationConfig;
const engine_1 = require("./engine");
const config_1 = require("./config");
const target_resolver_1 = require("./target-resolver");
const sinks_1 = require("./sinks");
var engine_2 = require("./engine");
Object.defineProperty(exports, "SimulationEngine", { enumerable: true, get: function () { return engine_2.SimulationEngine; } });
Object.defineProperty(exports, "simulateStrategy", { enumerable: true, get: function () { return engine_2.simulateStrategy; } });
var config_2 = require("./config");
Object.defineProperty(exports, "parseSimulationConfig", { enumerable: true, get: function () { return config_2.parseSimulationConfig; } });
Object.defineProperty(exports, "SimulationConfigSchema", { enumerable: true, get: function () { return config_2.SimulationConfigSchema; } });
var target_resolver_2 = require("./target-resolver");
Object.defineProperty(exports, "DefaultTargetResolver", { enumerable: true, get: function () { return target_resolver_2.DefaultTargetResolver; } });
var sinks_2 = require("./sinks");
Object.defineProperty(exports, "ConfigDrivenSink", { enumerable: true, get: function () { return sinks_2.ConfigDrivenSink; } });
async function runSimulationConfig(config, options = {}) {
    const resolver = options.resolver ?? new target_resolver_1.DefaultTargetResolver();
    const engine = options.engine ??
        new engine_1.SimulationEngine({
            defaults: config.global.defaults,
            sinks: [
                new sinks_1.ConfigDrivenSink({
                    defaultOutputs: config.global.defaults.outputs,
                }),
            ],
        });
    const summaries = [];
    for (const scenario of config.scenarios) {
        const targets = await resolver.resolve(scenario);
        const summary = await engine.runScenario({
            scenario,
            targets,
            runOptions: config.global.run,
            overrides: config.global.defaults,
        });
        summaries.push(summary);
    }
    return summaries;
}
function loadSimulationConfig(raw) {
    return (0, config_1.parseSimulationConfig)(raw);
}
//# sourceMappingURL=index.js.map