/**
 * CA Detection Service
 * ====================
 * Handles contract address (CA) drop detection and processing including
 * address validation, chain identification, token metadata fetching,
 * and monitoring setup.
 */
import { Context } from 'telegraf';
export declare class CADetectionService {
    private readonly DEFAULT_STRATEGY;
    /**
     * Detects contract address (CA) drops in free-form user text.
     * Returns true if any CA was detected/processed, otherwise false.
     */
    detectCADrop(ctx: Context, text: string): Promise<boolean>;
    /**
     * Handles CA registration + monitoring.
     * Identifies chain, fetches meta, logs and monitors (if enabled).
     */
    processCADrop(ctx: Context, address: string): Promise<void>;
}
//# sourceMappingURL=CADetectionService.d.ts.map