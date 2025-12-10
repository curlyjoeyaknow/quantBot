"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigDrivenSink = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const luxon_1 = require("luxon");
const clickhouse_client_1 = require("../storage/clickhouse-client");
class ConfigDrivenSink {
    constructor(options = {}) {
        this.name = 'config-driven-sink';
        this.initializedCsv = new Set();
        this.defaultOutputs = options.defaultOutputs ?? [];
        this.logger = options.logger;
    }
    async handle(context) {
        const outputs = context.scenario.outputs?.length
            ? context.scenario.outputs
            : this.defaultOutputs.length
                ? this.defaultOutputs
                : [{ type: 'stdout', detail: 'summary' }];
        for (const output of outputs) {
            try {
                switch (output.type) {
                    case 'stdout':
                        this.writeStdout(output, context);
                        break;
                    case 'json':
                        await this.writeJson(output, context);
                        break;
                    case 'csv':
                        await this.writeCsv(output, context);
                        break;
                    case 'clickhouse':
                        await this.writeClickHouse(output, context);
                        break;
                }
            }
            catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.logger?.error?.('Failed to emit simulation result', {
                    scenario: context.scenario.name,
                    target: output.type,
                    error: err.message,
                });
            }
        }
    }
    writeStdout(config, context) {
        const tokenSymbol = context.target.metadata?.tokenSymbol ||
            context.target.mint.substring(0, 8);
        const tokenName = context.target.metadata?.tokenName || undefined;
        const displayName = tokenName ? `${tokenName} (${tokenSymbol})` : tokenSymbol;
        const summary = {
            scenario: context.scenario.name,
            mint: context.target.mint,
            token: displayName,
            chain: context.target.chain,
            finalPnl: Number((context.result.finalPnl - 1).toFixed(4)),
            candles: context.result.totalCandles,
        };
        if (config.detail === 'detailed') {
            console.log('[simulation]', {
                ...summary,
                entryPrice: context.result.entryPrice,
                finalPrice: context.result.finalPrice,
                events: context.result.events.length,
            });
        }
        else {
            console.log(`[simulation] ${summary.scenario} ${displayName} ${summary.finalPnl >= 0 ? '+' : ''}${summary.finalPnl * 100}%`);
        }
    }
    async writeJson(config, context) {
        const filePath = this.resolvePath(config.path);
        await fs_1.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
        const tokenSymbol = context.target.metadata?.tokenSymbol || undefined;
        const tokenName = context.target.metadata?.tokenName || undefined;
        const payload = {
            scenario: context.scenario.name,
            mint: context.target.mint,
            tokenSymbol,
            tokenName,
            chain: context.target.chain,
            startTime: context.target.startTime.toISO(),
            endTime: context.target.endTime.toISO(),
            result: config.includeEvents
                ? context.result
                : {
                    finalPnl: context.result.finalPnl,
                    entryPrice: context.result.entryPrice,
                    finalPrice: context.result.finalPrice,
                    totalCandles: context.result.totalCandles,
                },
        };
        const data = JSON.stringify(payload, null, config.pretty ? 2 : undefined);
        await fs_1.promises.appendFile(filePath, data + '\n', 'utf-8');
    }
    async writeCsv(config, context) {
        const filePath = this.resolvePath(config.path);
        await fs_1.promises.mkdir(path_1.default.dirname(filePath), { recursive: true });
        if (!this.initializedCsv.has(filePath) || !config.append) {
            const header = 'scenario,mint,token_symbol,token_name,chain,start_time,end_time,entry_price,final_price,final_pnl,total_candles\n';
            await fs_1.promises.writeFile(filePath, header, 'utf-8');
            this.initializedCsv.add(filePath);
        }
        const tokenSymbol = context.target.metadata?.tokenSymbol || '';
        const tokenName = context.target.metadata?.tokenName || '';
        const row = [
            context.scenario.name,
            context.target.mint,
            tokenSymbol,
            tokenName,
            context.target.chain,
            context.target.startTime.toISO(),
            context.target.endTime.toISO(),
            context.result.entryPrice.toFixed(8),
            context.result.finalPrice.toFixed(8),
            context.result.finalPnl.toFixed(6),
            context.result.totalCandles.toString(),
        ].join(',');
        await fs_1.promises.appendFile(filePath, `${row}\n`, 'utf-8');
    }
    resolvePath(targetPath) {
        return path_1.default.isAbsolute(targetPath) ? targetPath : path_1.default.join(process.cwd(), targetPath);
    }
    async writeClickHouse(config, context) {
        const ch = (0, clickhouse_client_1.getClickHouseClient)();
        const table = config.schema === 'expanded'
            ? 'simulation_events'
            : 'simulation_aggregates';
        if (config.schema === 'expanded') {
            const rows = context.result.events.map((event, index) => ({
                simulation_run_id: 0, // placeholder until Postgres IDs are wired
                token_address: context.target.mint,
                chain: context.target.chain,
                event_time: luxon_1.DateTime.fromSeconds(event.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
                seq: index,
                event_type: event.type,
                price: event.price,
                size: 1,
                remaining_position: event.remainingPosition,
                pnl_so_far: event.pnlSoFar,
                indicators_json: '{}',
                position_state_json: '{}',
                metadata_json: JSON.stringify({
                    scenario: context.scenario.name,
                }),
            }));
            if (!rows.length) {
                return;
            }
            await ch.insert({
                table: `${process.env.CLICKHOUSE_DATABASE || 'quantbot'}.${table}`,
                values: rows,
                format: 'JSONEachRow',
            });
            return;
        }
        const finalEvent = context.result.events[context.result.events.length - 1];
        const aggregateRow = {
            simulation_run_id: 0,
            token_address: context.target.mint,
            chain: context.target.chain,
            final_pnl: context.result.finalPnl,
            max_drawdown: null,
            volatility: null,
            sharpe_ratio: null,
            sortino_ratio: null,
            win_rate: null,
            trade_count: context.result.events.filter((e) => e.type === 'entry' ||
                e.type === 'trailing_entry_triggered' ||
                e.type === 're_entry').length,
            reentry_count: context.result.events.filter((e) => e.type === 're_entry').length,
            ladder_entries_used: context.result.events.filter((e) => e.type === 'ladder_entry').length,
            ladder_exits_used: context.result.events.filter((e) => e.type === 'ladder_exit').length,
            created_at: finalEvent
                ? luxon_1.DateTime.fromSeconds(finalEvent.timestamp).toFormat('yyyy-MM-dd HH:mm:ss')
                : luxon_1.DateTime.utc().toFormat('yyyy-MM-dd HH:mm:ss'),
        };
        await ch.insert({
            table: `${process.env.CLICKHOUSE_DATABASE || 'quantbot'}.${table}`,
            values: [aggregateRow],
            format: 'JSONEachRow',
        });
    }
}
exports.ConfigDrivenSink = ConfigDrivenSink;
//# sourceMappingURL=sinks.js.map