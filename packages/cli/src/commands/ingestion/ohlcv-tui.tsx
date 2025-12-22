/**
 * OHLCV Ingestion TUI
 * ====================
 * 
 * Interactive terminal UI for monitoring OHLCV ingestion activity.
 * 
 * Features:
 * - Left panel: Categorized, scrollable log entries (success, failure, partial, skipped)
 * - Right panel: Verbose details of selected entry
 * - Navigation: Up/down arrows to select entries
 * - Detailed view: Shows ClickHouse and DuckDB entries for successful/partial ingestions
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import { OhlcvRepository } from '@quantbot/storage';
import { DuckDBStorageService } from '@quantbot/simulation';
import type { PythonEngine } from '@quantbot/utils';

/**
 * Event types for OHLCV ingestion
 */
export type IngestionEventType = 
  | 'worklist_generated'
  | 'fetch_started'
  | 'fetch_success'
  | 'fetch_failure'
  | 'fetch_skipped'
  | 'store_started'
  | 'store_success'
  | 'store_failure'
  | 'metadata_updated'
  | 'workflow_started'
  | 'workflow_completed';

/**
 * Base ingestion event
 */
export interface IngestionEvent {
  id: string;
  type: IngestionEventType;
  timestamp: string;
  mint?: string;
  chain?: string;
  interval?: string;
  alertTime?: string;
  startTime?: string;
  endTime?: string;
  candlesFetched?: number;
  candlesStored?: number;
  error?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Event emitter for OHLCV ingestion
 */
export class OhlcvIngestionEventEmitter extends EventEmitter {
  private events: IngestionEvent[] = [];
  private nextId = 1;

  /**
   * Emit an event and store it
   */
  emitEvent(event: Omit<IngestionEvent, 'id' | 'timestamp'>): void {
    const fullEvent: IngestionEvent = {
      ...event,
      id: `event_${this.nextId++}`,
      timestamp: DateTime.utc().toISO()!,
    };
    
    this.events.push(fullEvent);
    this.emit('event', fullEvent);
  }

  /**
   * Get all events
   */
  getEvents(): IngestionEvent[] {
    return [...this.events];
  }

  /**
   * Get events by category
   */
  getEventsByCategory(category: 'success' | 'failure' | 'skipped' | 'all'): IngestionEvent[] {
    if (category === 'all') {
      return this.events;
    }
    
    return this.events.filter((event) => {
      if (category === 'success') {
        return event.type === 'fetch_success' || event.type === 'store_success' || event.type === 'metadata_updated';
      }
      if (category === 'failure') {
        return event.type === 'fetch_failure' || event.type === 'store_failure';
      }
      if (category === 'skipped') {
        return event.type === 'fetch_skipped';
      }
      return false;
    });
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
  }
}

/**
 * UI Component: Log entry in the list
 */
function LogEntry({
  event,
  isSelected,
  width,
}: {
  event: IngestionEvent;
  isSelected: boolean;
  width: number;
}) {
  const getIcon = () => {
    switch (event.type) {
      case 'fetch_success':
      case 'store_success':
      case 'metadata_updated':
        return '✅';
      case 'fetch_failure':
      case 'store_failure':
        return '❌';
      case 'fetch_skipped':
        return '⏭️';
      case 'fetch_started':
      case 'store_started':
        return '🔄';
      case 'worklist_generated':
        return '📋';
      case 'workflow_started':
        return '🚀';
      case 'workflow_completed':
        return '✨';
      default:
        return '📝';
    }
  };

  const getColor = () => {
    if (isSelected) return 'green';
    switch (event.type) {
      case 'fetch_success':
      case 'store_success':
      case 'metadata_updated':
        return 'green';
      case 'fetch_failure':
      case 'store_failure':
        return 'red';
      case 'fetch_skipped':
        return 'yellow';
      default:
        return 'white';
    }
  };

  const time = DateTime.fromISO(event.timestamp).toFormat('HH:mm:ss');
  const mintDisplay = event.mint ? event.mint.substring(0, 12) + '...' : 'N/A';
  const typeDisplay = event.type.replace(/_/g, ' ');

  return (
    <Box width={width} paddingX={1}>
      <Text color={getColor()} inverse={isSelected}>
        {getIcon()} {time} {typeDisplay} {mintDisplay}
        {event.candlesFetched !== undefined && ` (${event.candlesFetched} candles)`}
        {event.error && ' ERROR'}
      </Text>
    </Box>
  );
}

/**
 * UI Component: Detailed view panel
 */
function DetailPanel({
  event,
  clickHouseData,
  duckDbData,
  loading,
  error,
  width,
  height,
}: {
  event: IngestionEvent | null;
  clickHouseData: unknown;
  duckDbData: unknown;
  loading: boolean;
  error: string | null;
  width: number;
  height: number;
}) {
  if (!event) {
    return (
      <Box width={width} height={height} borderStyle="single" padding={1} flexDirection="column">
        <Text color="gray" dimColor>Select an entry to view details</Text>
      </Box>
    );
  }

  return (
    <Box width={width} height={height} borderStyle="single" padding={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>Event Details</Text>
      </Box>
      
      <Box flexDirection="column" marginBottom={1}>
        <Text>Type: <Text color="green">{event.type}</Text></Text>
        <Text>Timestamp: <Text color="green">{event.timestamp}</Text></Text>
        {event.mint && <Text>Mint: <Text color="green">{event.mint}</Text></Text>}
        {event.chain && <Text>Chain: <Text color="green">{event.chain}</Text></Text>}
        {event.interval && <Text>Interval: <Text color="green">{event.interval}</Text></Text>}
        {event.alertTime && <Text>Alert Time: <Text color="green">{event.alertTime}</Text></Text>}
        {event.startTime && <Text>Start Time: <Text color="green">{event.startTime}</Text></Text>}
        {event.endTime && <Text>End Time: <Text color="green">{event.endTime}</Text></Text>}
        {event.candlesFetched !== undefined && <Text>Candles Fetched: <Text color="green">{event.candlesFetched}</Text></Text>}
        {event.candlesStored !== undefined && <Text>Candles Stored: <Text color="green">{event.candlesStored}</Text></Text>}
        {event.durationMs !== undefined && <Text>Duration: <Text color="green">{event.durationMs}ms</Text></Text>}
        {event.error && <Text color="red">Error: {event.error}</Text>}
      </Box>

      {(event.type === 'store_success' || event.type === 'fetch_success') && event.mint && (
        <>
          <Box marginTop={1} marginBottom={1}>
            <Text color="cyan" bold>ClickHouse Data</Text>
          </Box>
          {loading && <Text color="yellow">Loading...</Text>}
          {error && <Text color="red">Error: {error}</Text>}
          {clickHouseData && (
            <Box flexDirection="column">
              <Text>{JSON.stringify(clickHouseData, null, 2)}</Text>
            </Box>
          )}

          <Box marginTop={1} marginBottom={1}>
            <Text color="cyan" bold>DuckDB Metadata</Text>
          </Box>
          {loading && <Text color="yellow">Loading...</Text>}
          {error && <Text color="red">Error: {error}</Text>}
          {duckDbData && (
            <Box flexDirection="column">
              <Text>{JSON.stringify(duckDbData, null, 2)}</Text>
            </Box>
          )}
        </>
      )}

      {event.metadata && (
        <>
          <Box marginTop={1} marginBottom={1}>
            <Text color="cyan" bold>Additional Metadata</Text>
          </Box>
          <Box flexDirection="column">
            <Text>{JSON.stringify(event.metadata, null, 2)}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}

/**
 * Main TUI App Component
 */
export function OhlcvIngestionTuiApp({
  eventEmitter,
  duckdbPath,
  clickHouseRepo,
  duckdbStorage,
}: {
  eventEmitter: OhlcvIngestionEventEmitter;
  duckdbPath: string;
  clickHouseRepo: OhlcvRepository;
  duckdbStorage: DuckDBStorageService;
}) {
  const { exit } = useApp();
  const [dimensions, setDimensions] = useState({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });

  const [events, setEvents] = useState<IngestionEvent[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [category, setCategory] = useState<'all' | 'success' | 'failure' | 'skipped'>('all');
  const [clickHouseData, setClickHouseData] = useState<unknown>(null);
  const [duckDbData, setDuckDbData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24,
      });
    };

    process.stdout.on('resize', updateDimensions);
    return () => {
      process.stdout.off('resize', updateDimensions);
    };
  }, []);

  // Listen for events
  useEffect(() => {
    const handleEvent = (event: IngestionEvent) => {
      setEvents((prev) => [...prev, event]);
    };

    eventEmitter.on('event', handleEvent);
    setEvents(eventEmitter.getEvents());

    return () => {
      eventEmitter.off('event', handleEvent);
    };
  }, [eventEmitter]);

  // Filter events by category
  const filteredEvents = category === 'all' 
    ? events 
    : eventEmitter.getEventsByCategory(category);

  // Load detailed data when selection changes
  const selectedEvent = filteredEvents[selectedIndex] || null;
  useEffect(() => {
    if (!selectedEvent || !selectedEvent.mint) {
      setClickHouseData(null);
      setDuckDbData(null);
      return;
    }

    const loadDetails = async () => {
      if (selectedEvent.type !== 'store_success' && selectedEvent.type !== 'fetch_success') {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Load ClickHouse data
        if (selectedEvent.startTime && selectedEvent.endTime && selectedEvent.interval) {
          const start = DateTime.fromISO(selectedEvent.startTime);
          const end = DateTime.fromISO(selectedEvent.endTime);
          
          const candles = await clickHouseRepo.getCandles(
            selectedEvent.mint!,
            selectedEvent.chain || 'solana',
            selectedEvent.interval,
            { from: start, to: end }
          );

          setClickHouseData({
            count: candles.length,
            firstCandle: candles[0] || null,
            lastCandle: candles[candles.length - 1] || null,
            sample: candles.slice(0, 5), // First 5 candles
          });
        }

        // Load DuckDB metadata
        if (selectedEvent.alertTime && selectedEvent.interval) {
          const intervalSeconds = {
            '15s': 15,
            '1m': 60,
            '5m': 300,
            '1H': 3600,
          }[selectedEvent.interval] || 300;

          const metadata = await duckdbStorage.queryOhlcvMetadata(
            duckdbPath,
            selectedEvent.mint!,
            selectedEvent.alertTime,
            intervalSeconds,
            selectedEvent.startTime,
            selectedEvent.endTime
          );

          setDuckDbData(metadata);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
  }, [selectedEvent, clickHouseRepo, duckdbStorage, duckdbPath]);

  // Ensure selected index is valid
  useEffect(() => {
    if (selectedIndex >= filteredEvents.length && filteredEvents.length > 0) {
      setSelectedIndex(filteredEvents.length - 1);
    }
  }, [filteredEvents.length, selectedIndex]);

  // Keyboard navigation
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(filteredEvents.length - 1, prev + 1));
    }

    if (input === '1') setCategory('all');
    if (input === '2') setCategory('success');
    if (input === '3') setCategory('failure');
    if (input === '4') setCategory('skipped');
  });

  const listWidth = Math.floor(dimensions.width * 0.4);
  const detailWidth = dimensions.width - listWidth - 3; // Account for borders and padding

  // Ensure selectedIndex is valid for filtered events
  const validSelectedIndex = Math.min(selectedIndex, Math.max(0, filteredEvents.length - 1));

  return (
    <Box flexDirection="row" width={dimensions.width} height={dimensions.height}>
      {/* Left Panel: Log List */}
      <Box width={listWidth} borderStyle="single" flexDirection="column" minHeight={dimensions.height}>
        <Box paddingX={1} paddingY={1} borderBottom={true}>
          <Text color="cyan" bold>OHLCV Ingestion Logs</Text>
        </Box>
        <Box paddingX={1} paddingY={1} borderBottom={true}>
          <Text dimColor>
            [1] All [2] Success [3] Failure [4] Skipped | ↑↓ Navigate | Esc Exit
          </Text>
        </Box>
        <Box paddingX={1} paddingY={1} borderBottom={true}>
          <Text>
            Category: <Text color="green">{category}</Text> | 
            Total: <Text color="green">{filteredEvents.length}</Text>
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} minHeight={1}>
          {filteredEvents.length > 0 ? (
            filteredEvents.map((event, index) => (
              <LogEntry
                key={event.id}
                event={event}
                isSelected={index === validSelectedIndex}
                width={listWidth - 2}
              />
            ))
          ) : (
            <Box padding={1}>
              <Text color="gray" dimColor>No events yet. Waiting for ingestion to start...</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Right Panel: Details */}
      <Box marginLeft={1} minHeight={dimensions.height}>
        <DetailPanel
          event={filteredEvents[validSelectedIndex] || null}
          clickHouseData={clickHouseData}
          duckDbData={duckDbData}
          loading={loading}
          error={error}
          width={detailWidth}
          height={dimensions.height}
        />
      </Box>
    </Box>
  );
}

