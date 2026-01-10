/**
 * TelegramExportParser Tests
 *
 * Tests for parsing Telegram HTML export files, including:
 * - Message extraction
 * - Reply-to reference parsing
 * - Message ID extraction
 * - Timestamp parsing with timezone offsets
 */

import { describe, it, expect } from 'vitest';
import { parseExport, type ParsedMessage } from '../src/TelegramExportParser';

describe('TelegramExportParser', () => {
  describe('reply_to parsing', () => {
    it('should extract reply_to message ID from same file', () => {
      const html = `
        <div class="message default clearfix" id="message149470">
          <div class="from_name">Rick</div>
          <div class="reply_to details">
            In reply to <a href="#go_to_message149468">this message</a>
          </div>
          <div class="text">Bot response text</div>
          <div class="pull_right date details" title="10.12.2025 04:37:21 UTC+10:00">04:37</div>
        </div>
      `;

      // Write to temp file
      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, 'temp-test.html');
      fs.writeFileSync(tempFile, html);

      try {
        const messages = parseExport(tempFile);
        expect(messages.length).toBe(1);
        expect(messages[0].replyToMessageId).toBe('149468');
        expect(messages[0].messageId).toBe('149470');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should extract reply_to message ID from cross-file reference', () => {
      const html = `
        <div class="message default clearfix" id="message149470">
          <div class="from_name">Rick</div>
          <div class="reply_to details">
            In reply to <a href="messages47.html#go_to_message149468">this message</a>
          </div>
          <div class="text">Bot response text</div>
          <div class="pull_right date details" title="10.12.2025 04:37:21 UTC+10:00">04:37</div>
        </div>
      `;

      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, 'temp-test.html');
      fs.writeFileSync(tempFile, html);

      try {
        const messages = parseExport(tempFile);
        expect(messages.length).toBe(1);
        expect(messages[0].replyToMessageId).toBe('149468');
        expect(messages[0].replyToFile).toBe('messages47.html');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should extract message ID from element id attribute', () => {
      const html = `
        <div class="message default clearfix" id="message149471">
          <div class="from_name">AnnaGems</div>
          <div class="text">7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump</div>
          <div class="pull_right date details" title="10.12.2025 06:05:13 UTC+10:00">06:05</div>
        </div>
      `;

      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, 'temp-test.html');
      fs.writeFileSync(tempFile, html);

      try {
        const messages = parseExport(tempFile);
        expect(messages.length).toBe(1);
        expect(messages[0].messageId).toBe('149471');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });

  describe('timestamp parsing', () => {
    it('should parse timestamp with UTC+10:00 offset', () => {
      const html = `
        <div class="message default clearfix" id="message1">
          <div class="from_name">Test</div>
          <div class="text">Test message</div>
          <div class="pull_right date details" title="10.12.2025 04:37:21 UTC+10:00">04:37</div>
        </div>
      `;

      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, 'temp-test.html');
      fs.writeFileSync(tempFile, html);

      try {
        const messages = parseExport(tempFile);
        expect(messages.length).toBe(1);
        expect(messages[0].timestamp).toBeInstanceOf(Date);
        // Verify it's parsed correctly (UTC+10:00 means subtract 10 hours to get UTC)
        const expectedUTC = new Date('2025-12-09T18:37:21Z'); // 10 hours before
        expect(messages[0].timestamp.getTime()).toBe(expectedUTC.getTime());
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should parse timestamp with UTC-5:00 offset', () => {
      const html = `
        <div class="message default clearfix" id="message1">
          <div class="from_name">Test</div>
          <div class="text">Test message</div>
          <div class="pull_right date details" title="10.12.2025 04:37:21 UTC-5:00">04:37</div>
        </div>
      `;

      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, 'temp-test.html');
      fs.writeFileSync(tempFile, html);

      try {
        const messages = parseExport(tempFile);
        expect(messages.length).toBe(1);
        expect(messages[0].timestamp).toBeInstanceOf(Date);
        // UTC-5:00 means add 5 hours to get UTC
        const expectedUTC = new Date('2025-12-10T09:37:21Z');
        expect(messages[0].timestamp.getTime()).toBe(expectedUTC.getTime());
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });

  describe('message extraction', () => {
    it('should extract sender name correctly', () => {
      const html = `
        <div class="message default clearfix" id="message1">
          <div class="from_name">Rick</div>
          <div class="text">Bot message</div>
          <div class="pull_right date details" title="10.12.2025 04:37:21 UTC+10:00">04:37</div>
        </div>
      `;

      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, 'temp-test.html');
      fs.writeFileSync(tempFile, html);

      try {
        const messages = parseExport(tempFile);
        expect(messages.length).toBe(1);
        expect(messages[0].from).toBe('Rick');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should extract message text correctly', () => {
      const html = `
        <div class="message default clearfix" id="message1">
          <div class="from_name">Test</div>
          <div class="text">7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump</div>
          <div class="pull_right date details" title="10.12.2025 06:05:13 UTC+10:00">06:05</div>
        </div>
      `;

      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, 'temp-test.html');
      fs.writeFileSync(tempFile, html);

      try {
        const messages = parseExport(tempFile);
        expect(messages.length).toBe(1);
        expect(messages[0].text).toContain('7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });
});
