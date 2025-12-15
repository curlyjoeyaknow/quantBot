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

export class CallerResolver {
  constructor(private messageIndex: MessageIndex) {}

  /**
   * Resolve a bot message's reply_to reference to the caller message
   * @param botMessage - The bot message with reply_to information
   * @param currentFileName - The file name where the bot message is from
   * @returns Resolved caller information, or undefined if not found
   */
  resolveCaller(botMessage: ParsedMessage, currentFileName?: string): ResolvedCaller | undefined {
    if (!botMessage.replyToMessageId) {
      return undefined;
    }

    // Resolve the caller message using the index
    const callerMessage = this.messageIndex.resolveReplyTo(botMessage, currentFileName);

    if (!callerMessage) {
      return undefined;
    }

    // Extract caller name
    const callerName = callerMessage.from || 'Unknown';

    // Extract caller message text (original contract address drop)
    const callerMessageText = callerMessage.text || '';

    // Use caller message timestamp as alert timestamp (not bot message timestamp)
    const alertTimestamp = callerMessage.timestamp;

    return {
      callerName,
      callerMessageText,
      alertTimestamp,
      callerMessage,
    };
  }
}
