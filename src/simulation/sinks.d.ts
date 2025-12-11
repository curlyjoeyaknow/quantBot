import { OutputTargetConfig } from './config';
import { SimulationResultSink, SimulationRunContext, SimulationLogger } from './engine';
export interface ConfigDrivenSinkOptions {
    defaultOutputs?: OutputTargetConfig[];
    logger?: SimulationLogger;
}
export declare class ConfigDrivenSink implements SimulationResultSink {
    readonly name = "config-driven-sink";
    private readonly defaultOutputs;
    private readonly logger?;
    private readonly initializedCsv;
    constructor(options?: ConfigDrivenSinkOptions);
    handle(context: SimulationRunContext): Promise<void>;
    private writeStdout;
    private writeJson;
    private writeCsv;
    private resolvePath;
    private writeClickHouse;
}
//# sourceMappingURL=sinks.d.ts.map