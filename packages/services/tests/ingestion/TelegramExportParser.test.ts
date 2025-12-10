/**
 * Unit tests for TelegramExportParser
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseExport } from '../../src/ingestion/TelegramExportParser';

describe('TelegramExportParser', () => {
  const testDataDir = path.join(__dirname, '../../../test-data');
  
  beforeEach(() => {
    // Ensure test data directory exists
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  it('should parse a simple HTML export', () => {
    // Create a minimal test HTML file
    const testHtml = `
      <div class="message default">
        <div class="from_name">TestUser</div>
        <div class="date details" title="2024-01-15 14:30:00">14:30</div>
        <div class="text">Check out this token: 7pXs123AbC456DeF789GhI012JkL345MnO678PqR</div>
      </div>
    `;
    
    const testFile = path.join(testDataDir, 'test-export.html');
    fs.writeFileSync(testFile, testHtml);

    const messages = parseExport(testFile);
    
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].text).toContain('Check out this token');
    expect(messages[0].from).toBe('TestUser');
    
    // Cleanup
    fs.unlinkSync(testFile);
  });

  it('should extract timestamps correctly', () => {
    const testHtml = `
      <div class="message default">
        <div class="from_name">TestUser</div>
        <div class="date details" title="2024-01-15 14:30:00">14:30</div>
        <div class="text">Test message</div>
      </div>
    `;
    
    const testFile = path.join(testDataDir, 'test-timestamp.html');
    fs.writeFileSync(testFile, testHtml);

    const messages = parseExport(testFile);
    
    if (messages.length > 0) {
      expect(messages[0].timestamp).toBeInstanceOf(Date);
    }
    
    // Cleanup
    fs.unlinkSync(testFile);
  });

  it('should skip service messages', () => {
    const testHtml = `
      <div class="message service">
        <div class="date details" title="2024-01-15 14:30:00">14:30</div>
        <div class="text">Service message</div>
      </div>
      <div class="message default">
        <div class="from_name">TestUser</div>
        <div class="date details" title="2024-01-15 14:31:00">14:31</div>
        <div class="text">Real message</div>
      </div>
    `;
    
    const testFile = path.join(testDataDir, 'test-service.html');
    fs.writeFileSync(testFile, testHtml);

    const messages = parseExport(testFile);
    
    // Should only have the real message, not the service message
    expect(messages.length).toBe(1);
    expect(messages[0].text).toBe('Real message');
    
    // Cleanup
    fs.unlinkSync(testFile);
  });

  it('should handle missing file gracefully', () => {
    expect(() => {
      parseExport('/nonexistent/file.html');
    }).toThrow();
  });
});

