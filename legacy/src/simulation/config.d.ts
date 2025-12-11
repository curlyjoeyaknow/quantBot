import { z } from 'zod';
/**
 * Shared strategy schemas reused across scenarios.
 *
 * These are intentionally richer than the legacy \"array of legs\" representation
 * used by some scripts. The engine consumes a normalized representation, while
 * full strategy configs (including ladders and indicator logic) are stored in
 * Postgres and can be rendered in the UI.
 */
export declare const StrategyLegSchema: z.ZodObject<{
    target: z.ZodNumber;
    percent: z.ZodNumber;
}, z.core.$strip>;
export type StrategyLeg = z.infer<typeof StrategyLegSchema>;
export declare const StopLossConfigSchema: z.ZodObject<{
    initial: z.ZodNumber;
    trailing: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
}, z.core.$strip>;
export type StopLossConfig = z.infer<typeof StopLossConfigSchema>;
export declare const EntryConfigSchema: z.ZodObject<{
    initialEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
    trailingEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
    maxWaitTime: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type EntryConfig = z.infer<typeof EntryConfigSchema>;
export declare const ReEntryConfigSchema: z.ZodObject<{
    trailingReEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
    maxReEntries: z.ZodDefault<z.ZodNumber>;
    sizePercent: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type ReEntryConfig = z.infer<typeof ReEntryConfigSchema>;
/**
 * Indicator & signal schemas
 *
 * These describe declarative conditions for entries, exits, and re-entries.
 */
export declare const IndicatorNameSchema: z.ZodEnum<{
    custom: "custom";
    rsi: "rsi";
    macd: "macd";
    sma: "sma";
    ema: "ema";
    vwma: "vwma";
    bbands: "bbands";
    atr: "atr";
    ichimoku_cloud: "ichimoku_cloud";
    price_change: "price_change";
    volume_change: "volume_change";
}>;
export type IndicatorName = z.infer<typeof IndicatorNameSchema>;
export declare const ComparisonOperatorSchema: z.ZodEnum<{
    ">": ">";
    ">=": ">=";
    "<": "<";
    "<=": "<=";
    "==": "==";
    "!=": "!=";
    crosses_above: "crosses_above";
    crosses_below: "crosses_below";
}>;
export type ComparisonOperator = z.infer<typeof ComparisonOperatorSchema>;
export declare const SignalConditionSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    indicator: z.ZodEnum<{
        custom: "custom";
        rsi: "rsi";
        macd: "macd";
        sma: "sma";
        ema: "ema";
        vwma: "vwma";
        bbands: "bbands";
        atr: "atr";
        ichimoku_cloud: "ichimoku_cloud";
        price_change: "price_change";
        volume_change: "volume_change";
    }>;
    secondaryIndicator: z.ZodOptional<z.ZodEnum<{
        custom: "custom";
        rsi: "rsi";
        macd: "macd";
        sma: "sma";
        ema: "ema";
        vwma: "vwma";
        bbands: "bbands";
        atr: "atr";
        ichimoku_cloud: "ichimoku_cloud";
        price_change: "price_change";
        volume_change: "volume_change";
    }>>;
    field: z.ZodDefault<z.ZodString>;
    operator: z.ZodEnum<{
        ">": ">";
        ">=": ">=";
        "<": "<";
        "<=": "<=";
        "==": "==";
        "!=": "!=";
        crosses_above: "crosses_above";
        crosses_below: "crosses_below";
    }>;
    value: z.ZodOptional<z.ZodNumber>;
    lookbackBars: z.ZodOptional<z.ZodNumber>;
    minBarsTrue: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type SignalCondition = z.infer<typeof SignalConditionSchema>;
export declare const SignalGroupSchema: z.ZodType<any>;
export type SignalGroup = z.infer<typeof SignalGroupSchema>;
export declare const LadderLegSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    sizePercent: z.ZodNumber;
    priceOffset: z.ZodOptional<z.ZodNumber>;
    multiple: z.ZodOptional<z.ZodNumber>;
    signal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
}, z.core.$strip>;
export type LadderLeg = z.infer<typeof LadderLegSchema>;
export declare const LadderConfigSchema: z.ZodObject<{
    legs: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        sizePercent: z.ZodNumber;
        priceOffset: z.ZodOptional<z.ZodNumber>;
        multiple: z.ZodOptional<z.ZodNumber>;
        signal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
    }, z.core.$strip>>;
    sequential: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type LadderConfig = z.infer<typeof LadderConfigSchema>;
export declare const CostConfigSchema: z.ZodObject<{
    entrySlippageBps: z.ZodDefault<z.ZodNumber>;
    exitSlippageBps: z.ZodDefault<z.ZodNumber>;
    takerFeeBps: z.ZodDefault<z.ZodNumber>;
    borrowAprBps: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type CostConfig = z.infer<typeof CostConfigSchema>;
export declare const DataSelectionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"mint">;
    mint: z.ZodString;
    chain: z.ZodDefault<z.ZodString>;
    start: z.ZodString;
    end: z.ZodOptional<z.ZodString>;
    durationHours: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"caller">;
    caller: z.ZodString;
    chain: z.ZodDefault<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    lookbackDays: z.ZodOptional<z.ZodNumber>;
    includeFailed: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"file">;
    path: z.ZodString;
    format: z.ZodDefault<z.ZodEnum<{
        csv: "csv";
        json: "json";
    }>>;
    mintField: z.ZodDefault<z.ZodString>;
    chainField: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    timestampField: z.ZodDefault<z.ZodString>;
    startOffsetMinutes: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    durationHours: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    filter: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"dataset">;
    id: z.ZodString;
}, z.core.$strip>], "kind">;
export type DataSelectionConfig = z.infer<typeof DataSelectionSchema>;
export declare const OutputTargetSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"stdout">;
    detail: z.ZodDefault<z.ZodEnum<{
        summary: "summary";
        detailed: "detailed";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"csv">;
    path: z.ZodString;
    includeEvents: z.ZodDefault<z.ZodBoolean>;
    append: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"json">;
    path: z.ZodString;
    pretty: z.ZodDefault<z.ZodBoolean>;
    includeEvents: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"clickhouse">;
    table: z.ZodDefault<z.ZodString>;
    schema: z.ZodDefault<z.ZodEnum<{
        aggregate: "aggregate";
        expanded: "expanded";
    }>>;
    upsert: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>], "type">;
export type OutputTargetConfig = z.infer<typeof OutputTargetSchema>;
/**
 * Scenario + run option schemas
 */
export declare const RunOptionsSchema: z.ZodObject<{
    maxConcurrency: z.ZodDefault<z.ZodNumber>;
    cachePolicy: z.ZodDefault<z.ZodEnum<{
        "prefer-cache": "prefer-cache";
        refresh: "refresh";
        "cache-only": "cache-only";
    }>>;
    dryRun: z.ZodDefault<z.ZodBoolean>;
    failFast: z.ZodDefault<z.ZodBoolean>;
    progressInterval: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type RunOptions = z.infer<typeof RunOptionsSchema>;
export declare const ScenarioSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    data: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"mint">;
        mint: z.ZodString;
        chain: z.ZodDefault<z.ZodString>;
        start: z.ZodString;
        end: z.ZodOptional<z.ZodString>;
        durationHours: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"caller">;
        caller: z.ZodString;
        chain: z.ZodDefault<z.ZodString>;
        limit: z.ZodDefault<z.ZodNumber>;
        lookbackDays: z.ZodOptional<z.ZodNumber>;
        includeFailed: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"file">;
        path: z.ZodString;
        format: z.ZodDefault<z.ZodEnum<{
            csv: "csv";
            json: "json";
        }>>;
        mintField: z.ZodDefault<z.ZodString>;
        chainField: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        timestampField: z.ZodDefault<z.ZodString>;
        startOffsetMinutes: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        durationHours: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        filter: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"dataset">;
        id: z.ZodString;
    }, z.core.$strip>], "kind">;
    strategy: z.ZodArray<z.ZodObject<{
        target: z.ZodNumber;
        percent: z.ZodNumber;
    }, z.core.$strip>>;
    stopLoss: z.ZodOptional<z.ZodObject<{
        initial: z.ZodNumber;
        trailing: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
    }, z.core.$strip>>;
    entry: z.ZodOptional<z.ZodObject<{
        initialEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
        trailingEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
        maxWaitTime: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    reEntry: z.ZodOptional<z.ZodObject<{
        trailingReEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
        maxReEntries: z.ZodDefault<z.ZodNumber>;
        sizePercent: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    costs: z.ZodOptional<z.ZodObject<{
        entrySlippageBps: z.ZodDefault<z.ZodNumber>;
        exitSlippageBps: z.ZodDefault<z.ZodNumber>;
        takerFeeBps: z.ZodDefault<z.ZodNumber>;
        borrowAprBps: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    entrySignal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
    exitSignal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
    entryLadder: z.ZodOptional<z.ZodObject<{
        legs: z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            sizePercent: z.ZodNumber;
            priceOffset: z.ZodOptional<z.ZodNumber>;
            multiple: z.ZodOptional<z.ZodNumber>;
            signal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
        }, z.core.$strip>>;
        sequential: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    exitLadder: z.ZodOptional<z.ZodObject<{
        legs: z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            sizePercent: z.ZodNumber;
            priceOffset: z.ZodOptional<z.ZodNumber>;
            multiple: z.ZodOptional<z.ZodNumber>;
            signal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
        }, z.core.$strip>>;
        sequential: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    outputs: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"stdout">;
        detail: z.ZodDefault<z.ZodEnum<{
            summary: "summary";
            detailed: "detailed";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"csv">;
        path: z.ZodString;
        includeEvents: z.ZodDefault<z.ZodBoolean>;
        append: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"json">;
        path: z.ZodString;
        pretty: z.ZodDefault<z.ZodBoolean>;
        includeEvents: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"clickhouse">;
        table: z.ZodDefault<z.ZodString>;
        schema: z.ZodDefault<z.ZodEnum<{
            aggregate: "aggregate";
            expanded: "expanded";
        }>>;
        upsert: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>], "type">>>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SimulationScenarioConfig = z.infer<typeof ScenarioSchema>;
export declare const SimulationConfigSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodString>;
    global: z.ZodDefault<z.ZodObject<{
        defaults: z.ZodDefault<z.ZodObject<{
            stopLoss: z.ZodOptional<z.ZodObject<{
                initial: z.ZodNumber;
                trailing: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
            }, z.core.$strip>>;
            entry: z.ZodOptional<z.ZodObject<{
                initialEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
                trailingEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
                maxWaitTime: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
            reEntry: z.ZodOptional<z.ZodObject<{
                trailingReEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
                maxReEntries: z.ZodDefault<z.ZodNumber>;
                sizePercent: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
            costs: z.ZodOptional<z.ZodObject<{
                entrySlippageBps: z.ZodDefault<z.ZodNumber>;
                exitSlippageBps: z.ZodDefault<z.ZodNumber>;
                takerFeeBps: z.ZodDefault<z.ZodNumber>;
                borrowAprBps: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
            outputs: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"stdout">;
                detail: z.ZodDefault<z.ZodEnum<{
                    summary: "summary";
                    detailed: "detailed";
                }>>;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"csv">;
                path: z.ZodString;
                includeEvents: z.ZodDefault<z.ZodBoolean>;
                append: z.ZodDefault<z.ZodBoolean>;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"json">;
                path: z.ZodString;
                pretty: z.ZodDefault<z.ZodBoolean>;
                includeEvents: z.ZodDefault<z.ZodBoolean>;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"clickhouse">;
                table: z.ZodDefault<z.ZodString>;
                schema: z.ZodDefault<z.ZodEnum<{
                    aggregate: "aggregate";
                    expanded: "expanded";
                }>>;
                upsert: z.ZodDefault<z.ZodBoolean>;
            }, z.core.$strip>], "type">>>;
        }, z.core.$strip>>;
        run: z.ZodOptional<z.ZodObject<{
            maxConcurrency: z.ZodDefault<z.ZodNumber>;
            cachePolicy: z.ZodDefault<z.ZodEnum<{
                "prefer-cache": "prefer-cache";
                refresh: "refresh";
                "cache-only": "cache-only";
            }>>;
            dryRun: z.ZodDefault<z.ZodBoolean>;
            failFast: z.ZodDefault<z.ZodBoolean>;
            progressInterval: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    scenarios: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        data: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"mint">;
            mint: z.ZodString;
            chain: z.ZodDefault<z.ZodString>;
            start: z.ZodString;
            end: z.ZodOptional<z.ZodString>;
            durationHours: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"caller">;
            caller: z.ZodString;
            chain: z.ZodDefault<z.ZodString>;
            limit: z.ZodDefault<z.ZodNumber>;
            lookbackDays: z.ZodOptional<z.ZodNumber>;
            includeFailed: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"file">;
            path: z.ZodString;
            format: z.ZodDefault<z.ZodEnum<{
                csv: "csv";
                json: "json";
            }>>;
            mintField: z.ZodDefault<z.ZodString>;
            chainField: z.ZodDefault<z.ZodOptional<z.ZodString>>;
            timestampField: z.ZodDefault<z.ZodString>;
            startOffsetMinutes: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
            durationHours: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
            filter: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"dataset">;
            id: z.ZodString;
        }, z.core.$strip>], "kind">;
        strategy: z.ZodArray<z.ZodObject<{
            target: z.ZodNumber;
            percent: z.ZodNumber;
        }, z.core.$strip>>;
        stopLoss: z.ZodOptional<z.ZodObject<{
            initial: z.ZodNumber;
            trailing: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
        }, z.core.$strip>>;
        entry: z.ZodOptional<z.ZodObject<{
            initialEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
            trailingEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
            maxWaitTime: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        reEntry: z.ZodOptional<z.ZodObject<{
            trailingReEntry: z.ZodDefault<z.ZodUnion<readonly [z.ZodNumber, z.ZodLiteral<"none">]>>;
            maxReEntries: z.ZodDefault<z.ZodNumber>;
            sizePercent: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        costs: z.ZodOptional<z.ZodObject<{
            entrySlippageBps: z.ZodDefault<z.ZodNumber>;
            exitSlippageBps: z.ZodDefault<z.ZodNumber>;
            takerFeeBps: z.ZodDefault<z.ZodNumber>;
            borrowAprBps: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        entrySignal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
        exitSignal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
        entryLadder: z.ZodOptional<z.ZodObject<{
            legs: z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                sizePercent: z.ZodNumber;
                priceOffset: z.ZodOptional<z.ZodNumber>;
                multiple: z.ZodOptional<z.ZodNumber>;
                signal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
            }, z.core.$strip>>;
            sequential: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        exitLadder: z.ZodOptional<z.ZodObject<{
            legs: z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                sizePercent: z.ZodNumber;
                priceOffset: z.ZodOptional<z.ZodNumber>;
                multiple: z.ZodOptional<z.ZodNumber>;
                signal: z.ZodOptional<z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>>;
            }, z.core.$strip>>;
            sequential: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        outputs: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"stdout">;
            detail: z.ZodDefault<z.ZodEnum<{
                summary: "summary";
                detailed: "detailed";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"csv">;
            path: z.ZodString;
            includeEvents: z.ZodDefault<z.ZodBoolean>;
            append: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"json">;
            path: z.ZodString;
            pretty: z.ZodDefault<z.ZodBoolean>;
            includeEvents: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"clickhouse">;
            table: z.ZodDefault<z.ZodString>;
            schema: z.ZodDefault<z.ZodEnum<{
                aggregate: "aggregate";
                expanded: "expanded";
            }>>;
            upsert: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>], "type">>>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SimulationEngineConfig = z.infer<typeof SimulationConfigSchema>;
export declare function parseSimulationConfig(input: unknown): SimulationEngineConfig;
//# sourceMappingURL=config.d.ts.map