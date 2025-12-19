/**
 * CallerResolver - Resolve reply_to references to caller messages
 *
 * Extracts:
 * - Caller name from resolved message
 * - Caller message text (original contract address drop)
 * - Alert timestamp from caller message (not bot message)
 */
import { MessageIndex } from './MessageIndex';
import type { ParsedMessage } from './TelegramExportParser';
export interface ResolvedCaller {
  callerName: string;
  callerMessageText: string;
  alertTimestamp: Date;
  callerMessage: ParsedMessage;
}
export declare class CallerResolver {
  private messageIndex;
  constructor(messageIndex: MessageIndex);
  /**
   * Resolve a bot message's reply_to reference to the caller message
   * @param botMessage - The bot message with reply_to information
   * @param currentFileName - The file name where the bot message is from
   * @returns Resolved caller information, or undefined if not found
   */
  resolveCaller(botMessage: ParsedMessage, currentFileName?: string): ResolvedCaller | undefined;
}
//# sourceMappingURL=CallerResolver.d.ts.map
