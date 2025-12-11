import { SimulationScenarioConfig } from './config';
import { SimulationTarget } from './engine';
export interface ScenarioTargetResolver {
    resolve(scenario: SimulationScenarioConfig): Promise<SimulationTarget[]>;
}
export declare class DefaultTargetResolver implements ScenarioTargetResolver {
    resolve(scenario: SimulationScenarioConfig): Promise<SimulationTarget[]>;
    private fromMint;
    private fromFile;
    private parseCsv;
    private parseJson;
    private matchesFilter;
    private parseTimestamp;
}
//# sourceMappingURL=target-resolver.d.ts.map