import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import fs from 'node:fs';
import readline from 'node:readline';
import { streamNdjsonFile } from './ndjson.js';
import { rowFromNormalized, rowFromParseError, rowFromQuarantine } from './rows.js';
import { TelegramTuiOptions, TuiMode, Row } from './types.js';
import { clamp, fmtTime, prettyJson, safeString, truncateToBox } from './text.js';

type Props = TelegramTuiOptions;

function buildHistogram(rows: Row[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== 'err') continue;
    m.set(r.errorCode, (m.get(r.errorCode) ?? 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function includesCI(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

export function TelegramTuiApp(props: Props) {
  const { exit } = useApp();
  const [dimensions, setDimensions] = useState({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });

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

  const w = dimensions.width;
  const h = dimensions.height;

  const okRef = useRef<Row[]>([]);
  const errRef = useRef<Row[]>([]);
  const [version, bump] = useReducer((x) => x + 1, 0);

  const [mode, setMode] = useState<TuiMode>('all');
  const [filter, setFilter] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showRaw, setShowRaw] = useState(true);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null); // Format: "2025-07"
  const [selectedDay, setSelectedDay] = useState<string | null>(null); // Format: "2025-07-15"
  const [monthSelectMode, setMonthSelectMode] = useState(false);
  const [daySelectMode, setDaySelectMode] = useState(false);
  const [monthIndex, setMonthIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [shouldLoad, setShouldLoad] = useState(false); // Don't load until date is selected

  const statusRef = useRef({
    normalizedDone: false,
    quarantineDone: false,
    lastBump: 0,
  });

  // First, scan files to get available dates (lightweight - just read first few lines)
  const [availableDates, setAvailableDates] = useState<{ months: string[]; days: Map<string, string[]> }>({ months: [], days: new Map() });
  const [scanningDates, setScanningDates] = useState(true);

  // Scan for available dates without loading all data
  useEffect(() => {
    if (!scanningDates) return;

    const months = new Set<string>();
    const daysByMonth = new Map<string, Set<string>>();
    let lineCount = 0;
    const maxScanLines = 1000; // Only scan first 1000 lines to find dates

    const scanFile = (filePath: string) => {
      return new Promise<void>((resolve) => {
        const rs = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

        rl.on('line', (line: string) => {
          if (lineCount++ >= maxScanLines) {
            rl.close();
            rs.close();
            resolve();
            return;
          }
          const trimmed = line.trim();
          if (!trimmed) return;

          try {
            const obj = JSON.parse(trimmed);
            const tsMs = obj?.timestampMs ?? obj?.timestamp_ms;
            if (tsMs && Number.isFinite(tsMs)) {
              const d = new Date(tsMs);
              const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              const dayKey = `${monthKey}-${String(d.getDate()).padStart(2, '0')}`;
              months.add(monthKey);
              if (!daysByMonth.has(monthKey)) {
                daysByMonth.set(monthKey, new Set());
              }
              daysByMonth.get(monthKey)!.add(dayKey);
            }
          } catch {
            // Skip parse errors during scan
          }
        });

        rl.on('close', () => resolve());
        rs.on('error', () => resolve());
      });
    };

    Promise.all([
      scanFile(props.normalizedPath),
      scanFile(props.quarantinePath),
    ]).then(() => {
      const sortedMonths = Array.from(months).sort().reverse();
      const sortedDays = new Map<string, string[]>();
      for (const [month, days] of daysByMonth.entries()) {
        sortedDays.set(month, Array.from(days).sort().reverse());
      }
      setAvailableDates({ months: sortedMonths, days: sortedDays });
      setScanningDates(false);
    });
  }, [props.normalizedPath, props.quarantinePath, scanningDates]);

  // Load data only after date selection
  useEffect(() => {
    if (!shouldLoad || !selectedMonth) return;

    okRef.current = [];
    errRef.current = [];
    statusRef.current = { normalizedDone: false, quarantineDone: false, lastBump: 0 };
    bump();

    const ac = new AbortController();

    const maybeBump = () => {
      const now = Date.now();
      // Throttle updates to every 500ms to reduce flickering
      if (now - statusRef.current.lastBump > 500) {
        statusRef.current.lastBump = now;
        bump();
      }
    };

    const stopNorm = streamNdjsonFile(
      props.normalizedPath,
      {
        onObject: (obj: unknown, meta: { lineNo: number }) => {
          const row = rowFromNormalized(obj, props.chatId ?? 'unknown', meta.lineNo);
          if (props.chatId && row.chatId !== props.chatId) return;
          okRef.current.push(row);
          // Only set initial selection, don't change it as we load
          if (!selectedKey && okRef.current.length === 1) {
            setSelectedKey(row.key);
          }
          maybeBump();
        },
        onParseError: (_err: Error, meta: { lineNo: number; line: string }) => {
          errRef.current.push(rowFromParseError(meta.line, 'normalized', meta.lineNo));
          maybeBump();
        },
        onDone: () => {
          statusRef.current.normalizedDone = true;
          maybeBump();
        },
      },
      { maxLines: props.maxLines, signal: ac.signal }
    );

    const stopQ = streamNdjsonFile(
      props.quarantinePath,
      {
        onObject: (obj: unknown, meta: { lineNo: number }) => {
          const row = rowFromQuarantine(obj, props.chatId ?? 'unknown', meta.lineNo);
          if (props.chatId && row.chatId !== props.chatId) return;
          errRef.current.push(row);
          // Only set initial selection if we have no ok rows
          if (!selectedKey && okRef.current.length === 0 && errRef.current.length === 1) {
            setSelectedKey(row.key);
          }
          maybeBump();
        },
        onParseError: (_err: Error, meta: { lineNo: number; line: string }) => {
          errRef.current.push(rowFromParseError(meta.line, 'quarantine', meta.lineNo));
          maybeBump();
        },
        onDone: () => {
          statusRef.current.quarantineDone = true;
          maybeBump();
        },
      },
      { maxLines: props.maxLines, signal: ac.signal }
    );

    return () => {
      ac.abort();
      stopNorm();
      stopQ();
    };
  }, [props.normalizedPath, props.quarantinePath, props.chatId, props.maxLines, shouldLoad, selectedMonth, selectedDay]);

  // Use scanned dates instead of computing from loaded data
  const availableMonths = availableDates.months;
  const availableDays = selectedMonth ? (availableDates.days.get(selectedMonth) || []) : [];

  const allRows = useMemo(() => {
    // version intentionally used to recompute when refs update
    void version;
    const ok = okRef.current;
    const err = errRef.current;
    if (mode === 'ok') return ok;
    if (mode === 'err') return err;
    // all = interleave by ts if possible, else just concat
    const merged = ok.concat(err);
    merged.sort((a, b) => {
      const ta = a.tsMs ?? 0;
      const tb = b.tsMs ?? 0;
      return tb - ta;
    });
    return merged;
  }, [mode, version]);

  const visibleRows = useMemo(() => {
    let filtered = allRows;

    // Apply date filters
    if (selectedDay) {
      filtered = filtered.filter((r) => {
        if (!r.tsMs) return false;
        const d = new Date(r.tsMs);
        const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return dayKey === selectedDay;
      });
    } else if (selectedMonth) {
      filtered = filtered.filter((r) => {
        if (!r.tsMs) return false;
        const d = new Date(r.tsMs);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return monthKey === selectedMonth;
      });
    }

    // Apply text filter
    if (filter.trim()) {
      const f = filter.trim();
      filtered = filtered.filter((r) => {
        const blob = [
          r.kind,
          r.chatId,
          r.from ?? '',
          r.preview,
          r.kind === 'err' ? r.errorCode : '',
          r.kind === 'err' ? r.errorMessage : '',
        ].join(' | ');
        return includesCI(blob, f);
      });
    }

    return filtered;
  }, [allRows, filter, selectedMonth, selectedDay]);

  const selectedIndex = useMemo(() => {
    if (!selectedKey) return 0;
    const idx = visibleRows.findIndex((r) => r.key === selectedKey);
    return idx >= 0 ? idx : 0;
  }, [visibleRows, selectedKey]);

  const selected = visibleRows[selectedIndex] ?? null;

  const histogram = useMemo(() => buildHistogram(errRef.current), [version]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
    if (input === 'q' || key.escape) {
      if (filterActive) {
        setFilterActive(false);
        return;
      }
      exit();
      return;
    }

    if (filterActive) {
      if (key.return) {
        setFilterActive(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((s) => s.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilter((s) => s + input);
      }
      return;
    }

    if (input === '?') setShowHelp((x) => !x);
    if (input === 'r') setShowRaw((x) => !x);
    if (input === 'f') { setFilter(''); setFilterActive(true); }

    if (monthSelectMode) {
      // Navigating month selection
      if (key.downArrow || input === 'j') {
        setMonthIndex((i) => Math.min(availableMonths.length - 1, i + 1));
      } else if (key.upArrow || input === 'k') {
        setMonthIndex((i) => Math.max(0, i - 1));
      } else if (key.return) {
        setSelectedMonth(availableMonths[monthIndex]);
        setSelectedDay(null);
        setMonthSelectMode(false);
        // Don't auto-load - user must press 'l'
      } else if (key.escape) {
        setMonthSelectMode(false);
      }
      return;
    }

    if (daySelectMode) {
      // Navigating day selection
      if (key.downArrow || input === 'j') {
        setDayIndex((i) => Math.min(availableDays.length - 1, i + 1));
      } else if (key.upArrow || input === 'k') {
        setDayIndex((i) => Math.max(0, i - 1));
      } else if (key.return) {
        setSelectedDay(availableDays[dayIndex]);
        setDaySelectMode(false);
        // Don't auto-load - user must press 'l'
      } else if (key.escape) {
        setDaySelectMode(false);
      }
      return;
    }

    if (input === 'l' || input === 'L') {
      // Force load with current selection
      if (selectedMonth && !shouldLoad) {
        setShouldLoad(true);
      }
      return;
    }

    if (input === 'm') {
      // Enter month selection mode
      if (availableMonths.length > 0) {
        setMonthSelectMode(true);
        setMonthIndex(availableMonths.indexOf(selectedMonth || '') >= 0 ? availableMonths.indexOf(selectedMonth || '') : 0);
      }
      return;
    }
    if (input === 'd') {
      // Enter day selection mode (only if month is selected)
      if (selectedMonth && availableDays.length > 0) {
        setDaySelectMode(true);
        setDayIndex(availableDays.indexOf(selectedDay || '') >= 0 ? availableDays.indexOf(selectedDay || '') : 0);
      }
      return;
    }
    if (input === 'M') {
      // Clear month/day filters and stop loading
      setSelectedMonth(null);
      setSelectedDay(null);
      setMonthSelectMode(false);
      setDaySelectMode(false);
      setShouldLoad(false);
      okRef.current = [];
      errRef.current = [];
      setSelectedKey(null);
      bump();
      return;
    }

    if (input === 'a') setMode('all');
    if (input === 'o') setMode('ok');
    if (input === 'e') setMode('err');

    const step = key.pageDown ? 20 : key.pageUp ? -20 : 0;

    if (key.downArrow) {
      const ni = Math.min(visibleRows.length - 1, selectedIndex + 1);
      setSelectedKey(visibleRows[ni]?.key ?? null);
    } else if (key.upArrow) {
      const ni = Math.max(0, selectedIndex - 1);
      setSelectedKey(visibleRows[ni]?.key ?? null);
    } else if (step !== 0) {
      const ni = Math.max(0, Math.min(visibleRows.length - 1, selectedIndex + step));
      setSelectedKey(visibleRows[ni]?.key ?? null);
    }
  });

  const leftW = Math.max(30, Math.floor(w * 0.45));
  const rightW = Math.max(30, w - leftW - 3);

  const listH = Math.max(8, h - 6);

  const topBar = (() => {
    const okCount = okRef.current.length;
    const errCount = errRef.current.length;
    const done = statusRef.current.normalizedDone && statusRef.current.quarantineDone;
    const doneTxt = done ? 'DONE' : 'LOADING';
    const modeTxt = mode.toUpperCase();
    const filtTxt = filterActive ? `FILTER: ${filter}_` : filter ? `FILTER: ${filter}` : 'FILTER: (none)';
    const monthTxt = selectedMonth ? `MONTH: ${selectedMonth}` : 'MONTH: (all)';
    const dayTxt = selectedDay ? `DAY: ${selectedDay}` : selectedMonth ? 'DAY: (all)' : '';
    return `${doneTxt} | mode=${modeTxt} | ok=${okCount} err=${errCount} | shown=${visibleRows.length} | ${monthTxt} ${dayTxt} | ${filtTxt}`;
  })();

  const help = [
    'keys:',
    '  ↑/↓ navigate | PgUp/PgDn jump',
    '  a=all  o=ok  e=errors',
    '  m=select month  d=select day  l=load messages  M=clear filters',
    '  f=text filter (type, enter=done, esc=cancel)',
    '  r=toggle raw/summary',
    '  ?=help  q/esc=quit',
  ].join('\n');

  // Show date selection screen if not loaded yet
  if (scanningDates) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="cyan">📅 Scanning files for available dates...</Text>
      </Box>
    );
  }

  if (!shouldLoad || !selectedMonth) {
    return (
      <Box flexDirection="row" paddingX={1} paddingY={1}>
        {/* LEFT: Date Selection Panel */}
        <Box flexDirection="column" width={Math.floor(w * 0.4)} borderStyle="round" paddingX={1} paddingY={1}>
          <Text color="cyan" bold>📅 Select Date Filter</Text>
          <Box paddingTop={1}>
            <Text dimColor>Choose a month to load messages</Text>
          </Box>

          {monthSelectMode ? (
            <Box marginTop={1} flexDirection="column">
              <Text color="yellow" bold>Select Month (↑↓ navigate, Enter select, Esc cancel):</Text>
              <Box flexDirection="column" marginTop={1}>
                {availableMonths.map((m, idx) => (
                  <Text key={m} color={idx === monthIndex ? 'green' : undefined}>
                    {idx === monthIndex ? '❯ ' : '  '}{m}
                  </Text>
                ))}
              </Box>
            </Box>
          ) : (
            <Box marginTop={1} flexDirection="column">
              <Text>Available months: {availableMonths.length}</Text>
              <Box paddingTop={1}>
                <Text dimColor>Press 'm' to select month</Text>
              </Box>
            </Box>
          )}

          {daySelectMode && selectedMonth && (
            <Box marginTop={2} flexDirection="column">
              <Text color="yellow" bold>Select Day for {selectedMonth}:</Text>
              <Box flexDirection="column" marginTop={1}>
                {availableDays.map((d, idx) => (
                  <Text key={d} color={idx === dayIndex ? 'green' : undefined}>
                    {idx === dayIndex ? '❯ ' : '  '}{d} ({new Date(d).toLocaleDateString('en-US', { weekday: 'short' })})
                  </Text>
                ))}
              </Box>
            </Box>
          )}

          {selectedMonth && !monthSelectMode && !daySelectMode && (
            <Box marginTop={2} flexDirection="column">
              <Text color="green">Selected: {selectedDay || selectedMonth}</Text>
              <Box paddingTop={1}>
                <Text dimColor>Press 'd' to filter by day, 'l' to load, 'M' to clear</Text>
              </Box>
            </Box>
          )}
        </Box>

        {/* RIGHT: Instructions */}
        <Box flexDirection="column" width={w - Math.floor(w * 0.4) - 3} paddingX={1} paddingY={1}>
          <Text color="cyan" bold>Instructions</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>• Press 'm' to select a month</Text>
            <Text>• Press 'd' to select a day (after month)</Text>
            <Text>• Press 'l' to load messages for selected date</Text>
            <Text>• Press 'M' to clear selection</Text>
            <Text>• Press '?' for full help</Text>
            <Text>• Press 'q' to quit</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text>{clamp(topBar, w - 2)}</Text>
      </Box>

      {showHelp && (
        <Box paddingX={1} paddingY={1}>
          <Text>{help}</Text>
        </Box>
      )}

      <Box flexDirection="row" paddingX={1} paddingY={1}>
        {/* LEFT: DATE FILTER PANEL */}
        <Box flexDirection="column" width={Math.floor(w * 0.25)} borderStyle="round" paddingX={1} paddingY={1} marginRight={1}>
          <Text color="cyan" bold>📅 Date Filter</Text>
          {selectedMonth && (
            <Box marginTop={1} flexDirection="column">
              <Text color="green">Month: {selectedMonth}</Text>
              {selectedDay && <Text color="green">Day: {selectedDay}</Text>}
              <Box paddingTop={1}>
                <Text dimColor>Press 'm' to change month</Text>
                <Text dimColor>Press 'd' to change day</Text>
                <Text dimColor>Press 'M' to clear</Text>
              </Box>
            </Box>
          )}
          {!selectedMonth && (
            <Box paddingTop={1}>
              <Text dimColor>Press 'm' to select month</Text>
            </Box>
          )}
        </Box>

        {/* MIDDLE: LIST */}
        <Box flexDirection="column" width={leftW} borderStyle="round" paddingX={1} paddingY={0}>
          <Box marginTop={0}>
            <Text>{clamp('K  TIME                CHAT            ID     FROM            PREVIEW', leftW - 2)}</Text>
          </Box>

          <Box flexDirection="column" height={listH} marginTop={1}>
            {visibleRows.slice(Math.max(0, selectedIndex - Math.floor(listH / 2)), Math.max(0, selectedIndex - Math.floor(listH / 2)) + listH)
              .map((r) => {
                const isSel = selectedKey === r.key;
                const k = r.kind === 'ok' ? '✓' : '×';
                const time = fmtTime(r.tsMs).slice(0, 19);
                const chat = clamp(r.chatId, 14).padEnd(14, ' ');
                const mid = clamp(r.messageId == null ? '—' : String(r.messageId), 6).padEnd(6, ' ');
                const from = clamp(r.from ?? '—', 14).padEnd(14, ' ');
                const prev = clamp(r.preview, Math.max(1, leftW - 2 - (2 + 20 + 1 + 14 + 1 + 6 + 1 + 14 + 1)));
                const line = `${k}  ${time} ${chat} ${mid} ${from} ${prev}`;
                return <Text key={r.key}>{isSel ? `> ${clamp(line, leftW - 4)}` : `  ${clamp(line, leftW - 4)}`}</Text>;
              })}
          </Box>

          <Box marginTop={1}>
            <Text>{clamp(`errors top: ${histogram.map(([c, n]) => `${c}(${n})`).join('  ') || 'none'}`, leftW - 2)}</Text>
          </Box>
        </Box>

        <Box width={1} />

        {/* RIGHT: DETAILS */}
        <Box flexDirection="column" width={rightW} borderStyle="round" paddingX={1} paddingY={0}>
          {!selected ? (
            <Box marginTop={1}><Text>No rows loaded yet.</Text></Box>
          ) : (
            <>
              <Box marginTop={0}>
                <Text>
                  {clamp(
                    `selected: ${selected.kind.toUpperCase()} | chat=${selected.chatId} | id=${selected.messageId ?? '—'} | from=${selected.from ?? '—'} | ts=${fmtTime(selected.tsMs)}`,
                    rightW - 2
                  )}
                </Text>
              </Box>

              <Box marginTop={1} flexDirection="column">
                {selected.kind === 'err' ? (
                  <Text>{clamp(`ERROR ${selected.errorCode}: ${selected.errorMessage}`, rightW - 2)}</Text>
                ) : (
                  <Text>{clamp(`OK: ${selected.preview}`, rightW - 2)}</Text>
                )}
              </Box>

              <Box marginTop={1} flexDirection="column">
                <Text>{showRaw ? 'raw:' : 'summary:'}</Text>
                <Text>
                  {truncateToBox(
                    showRaw
                      ? prettyJson(selected.raw, 60_000)
                      : prettyJson(
                          {
                            kind: selected.kind,
                            chatId: selected.chatId,
                            messageId: selected.messageId,
                            tsMs: selected.tsMs,
                            from: selected.from,
                            preview: selected.preview,
                            ...(selected.kind === 'err' ? { errorCode: selected.errorCode, errorMessage: selected.errorMessage } : {}),
                          },
                          60_000
                        ),
                    Math.max(4, h - (showHelp ? 10 : 6) - 8),
                    rightW - 4
                  )}
                </Text>
              </Box>

              <Box marginTop={1}>
                <Text>{clamp(`paths: normalized=${safeString(props.normalizedPath)} | quarantine=${safeString(props.quarantinePath)}`, rightW - 2)}</Text>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

