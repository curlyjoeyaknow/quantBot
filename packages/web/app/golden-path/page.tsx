/**
 * Golden Path Workflows Page
 * 
 * Enhanced UI with dropdowns, date pickers, and search/filter functionality
 */

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Strategy {
  id: number;
  name: string;
  version: string;
  category?: string;
  description?: string;
  displayName: string;
}

interface Caller {
  id: number;
  handle: string;
  displayName?: string;
  callCount: number;
}

interface Token {
  id: number;
  address: string;
  symbol?: string;
  name?: string;
  callCount: number;
  firstCallDate?: string;
  lastCallDate?: string;
  mcap?: number;
}

export default function GoldenPathPage() {
  const [telegramResult, setTelegramResult] = useState<any>(null);
  const [ohlcvResult, setOhlcvResult] = useState<any>(null);
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Strategy simulation state
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [callers, setCallers] = useState<Caller[]>([]);
  const [selectedCaller, setSelectedCaller] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // OHLCV state
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenSearch, setTokenSearch] = useState<string>('');
  const [tokenCallerFilter, setTokenCallerFilter] = useState<string>('');
  const [tokenFromDate, setTokenFromDate] = useState<string>('');
  const [tokenToDate, setTokenToDate] = useState<string>('');
  const [minMcap, setMinMcap] = useState<string>('');
  const [maxMcap, setMaxMcap] = useState<string>('');
  const [tokenLoading, setTokenLoading] = useState(false);
  const [ohlcvInterval, setOhlcvInterval] = useState<string>('5m');

  // Load strategies and callers on mount
  useEffect(() => {
    fetchStrategies();
    fetchCallers();
    fetchTokens();
  }, []);

  // Fetch tokens when filters change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchTokens();
    }, 500); // Debounce search
    return () => clearTimeout(timeoutId);
  }, [tokenSearch, tokenCallerFilter, tokenFromDate, tokenToDate, minMcap, maxMcap]);

  const fetchStrategies = async () => {
    try {
      const response = await fetch('/api/golden-path/strategies');
      const data = await response.json();
      if (data.success) {
        setStrategies(data.strategies);
      }
    } catch (error) {
      console.error('Failed to fetch strategies:', error);
    }
  };

  const fetchCallers = async () => {
    try {
      const response = await fetch('/api/golden-path/callers');
      const data = await response.json();
      if (data.success) {
        setCallers(data.callers);
      }
    } catch (error) {
      console.error('Failed to fetch callers:', error);
    }
  };

  const fetchTokens = async () => {
    setTokenLoading(true);
    try {
      const params = new URLSearchParams();
      if (tokenSearch) params.append('search', tokenSearch);
      if (tokenCallerFilter) params.append('caller', tokenCallerFilter);
      if (tokenFromDate) params.append('from', tokenFromDate);
      if (tokenToDate) params.append('to', tokenToDate);
      if (minMcap) params.append('minMcap', minMcap);
      if (maxMcap) params.append('maxMcap', maxMcap);
      params.append('limit', '100');

      const response = await fetch(`/api/golden-path/tokens?${params.toString()}`);
      const data = await response.json();
      if (data.success) {
        setTokens(data.tokens);
      }
    } catch (error) {
      console.error('Failed to fetch tokens:', error);
    } finally {
      setTokenLoading(false);
    }
  };

  const handleTelegramIngest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const response = await fetch('/api/golden-path/ingest/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: formData.get('filePath'),
          callerName: formData.get('callerName'),
          chain: formData.get('chain') || 'SOL',
          chatId: formData.get('chatId') || undefined,
        }),
      });
      const data = await response.json();
      setTelegramResult(data);
      // Refresh callers and tokens after ingestion
      fetchCallers();
      fetchTokens();
    } catch (error) {
      setTelegramResult({ error: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleOhlcvIngest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const response = await fetch('/api/golden-path/ingest/ohlcv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: formData.get('from') || tokenFromDate || undefined,
          to: formData.get('to') || tokenToDate || undefined,
          preWindowMinutes: parseInt(formData.get('preWindowMinutes') as string) || 260,
          postWindowMinutes: parseInt(formData.get('postWindowMinutes') as string) || 1440,
          interval: ohlcvInterval || '5m',
        }),
      });
      const data = await response.json();
      setOhlcvResult(data);
      // Refresh tokens after OHLCV fetch
      fetchTokens();
    } catch (error) {
      setOhlcvResult({ error: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleSimulate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedStrategy) {
      setSimulationResult({ error: 'Please select a strategy' });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/golden-path/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyName: selectedStrategy,
          callerName: selectedCaller || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
      });
      const data = await response.json();
      setSimulationResult(data);
    } catch (error) {
      setSimulationResult({ error: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const formatMcap = (mcap: number | null | undefined) => {
    if (!mcap) return 'N/A';
    if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
    if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(2)}K`;
    return `$${mcap.toFixed(2)}`;
  };

  const formatAddress = (address: string) => {
    if (address.length > 20) {
      return `${address.substring(0, 10)}...${address.substring(address.length - 10)}`;
    }
    return address;
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Golden Path Workflows</h1>
      
      <Tabs defaultValue="telegram" className="space-y-4">
        <TabsList>
          <TabsTrigger value="telegram">Telegram Ingestion</TabsTrigger>
          <TabsTrigger value="ohlcv">OHLCV Ingestion</TabsTrigger>
          <TabsTrigger value="simulate">Simulation</TabsTrigger>
        </TabsList>

        <TabsContent value="telegram">
          <Card>
            <CardHeader>
              <CardTitle>Telegram Export Ingestion</CardTitle>
              <CardDescription>
                Parse Telegram chat exports and extract calls
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleTelegramIngest} className="space-y-4">
                <div>
                  <Label htmlFor="filePath">File Path</Label>
                  <Input
                    id="filePath"
                    name="filePath"
                    placeholder="data/raw/messages/brook7/messages.html"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="callerName">Caller Name</Label>
                  <Input
                    id="callerName"
                    name="callerName"
                    placeholder="Brook"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="chain">Chain</Label>
                  <Input
                    id="chain"
                    name="chain"
                    defaultValue="SOL"
                    placeholder="SOL"
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Processing...' : 'Ingest Telegram Export'}
                </Button>
              </form>
              {telegramResult && (
                <div className="mt-4 p-4 bg-gray-100 rounded">
                  <pre>{JSON.stringify(telegramResult, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ohlcv">
          <Card>
            <CardHeader>
              <CardTitle>OHLCV Data Ingestion</CardTitle>
              <CardDescription>
                Fetch and store candle data for calls. View existing token data below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-lg">
                <div>
                  <Label htmlFor="tokenSearch">Search Token</Label>
                  <Input
                    id="tokenSearch"
                    placeholder="Address, symbol, or name..."
                    value={tokenSearch}
                    onChange={(e) => setTokenSearch(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="tokenCallerFilter">Filter by Caller</Label>
                  <Select value={tokenCallerFilter} onValueChange={setTokenCallerFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All callers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All callers</SelectItem>
                      {callers.map((caller) => (
                        <SelectItem key={caller.id} value={caller.handle}>
                          {caller.displayName || caller.handle} ({caller.callCount} calls)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tokenFromDate">From Date</Label>
                  <Input
                    id="tokenFromDate"
                    type="date"
                    value={tokenFromDate}
                    onChange={(e) => setTokenFromDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="tokenToDate">To Date</Label>
                  <Input
                    id="tokenToDate"
                    type="date"
                    value={tokenToDate}
                    onChange={(e) => setTokenToDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="minMcap">Min MCAP</Label>
                  <Input
                    id="minMcap"
                    type="number"
                    placeholder="0"
                    value={minMcap}
                    onChange={(e) => setMinMcap(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="maxMcap">Max MCAP</Label>
                  <Input
                    id="maxMcap"
                    type="number"
                    placeholder="1000000000"
                    value={maxMcap}
                    onChange={(e) => setMaxMcap(e.target.value)}
                  />
                </div>
              </div>

              {/* Token List */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Existing Token Data</h3>
                {tokenLoading ? (
                  <div className="text-center p-4">Loading tokens...</div>
                ) : tokens.length === 0 ? (
                  <div className="text-center p-4 text-gray-500">No tokens found</div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Token</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Calls</TableHead>
                          <TableHead>MCAP</TableHead>
                          <TableHead>First Call</TableHead>
                          <TableHead>Last Call</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tokens.map((token) => (
                          <TableRow key={token.id}>
                            <TableCell className="font-mono text-xs">
                              {formatAddress(token.address)}
                            </TableCell>
                            <TableCell>{token.symbol || 'N/A'}</TableCell>
                            <TableCell>{token.callCount}</TableCell>
                            <TableCell>{formatMcap(token.mcap)}</TableCell>
                            <TableCell>
                              {token.firstCallDate
                                ? new Date(token.firstCallDate).toLocaleDateString()
                                : 'N/A'}
                            </TableCell>
                            <TableCell>
                              {token.lastCallDate
                                ? new Date(token.lastCallDate).toLocaleDateString()
                                : 'N/A'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* OHLCV Fetch Form */}
              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold mb-4">Fetch OHLCV Data</h3>
                <form onSubmit={handleOhlcvIngest} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="from">From Date</Label>
                      <Input
                        id="from"
                        name="from"
                        type="date"
                        value={tokenFromDate}
                        onChange={(e) => setTokenFromDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="to">To Date</Label>
                      <Input
                        id="to"
                        name="to"
                        type="date"
                        value={tokenToDate}
                        onChange={(e) => setTokenToDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="preWindowMinutes">Pre-Window Minutes</Label>
                      <Input
                        id="preWindowMinutes"
                        name="preWindowMinutes"
                        type="number"
                        defaultValue="260"
                      />
                    </div>
                    <div>
                      <Label htmlFor="postWindowMinutes">Post-Window Minutes</Label>
                      <Input
                        id="postWindowMinutes"
                        name="postWindowMinutes"
                        type="number"
                        defaultValue="1440"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="interval">Interval</Label>
                    <Select value={ohlcvInterval} onValueChange={setOhlcvInterval}>
                      <SelectTrigger id="interval">
                        <SelectValue placeholder="Select interval" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1m">1 minute</SelectItem>
                        <SelectItem value="5m">5 minutes</SelectItem>
                        <SelectItem value="15m">15 minutes</SelectItem>
                        <SelectItem value="1h">1 hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Processing...' : 'Fetch OHLCV Data'}
                  </Button>
                </form>
                {ohlcvResult && (
                  <div className="mt-4 p-4 bg-gray-100 rounded">
                    <pre>{JSON.stringify(ohlcvResult, null, 2)}</pre>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulate">
          <Card>
            <CardHeader>
              <CardTitle>Strategy Simulation</CardTitle>
              <CardDescription>
                Run backtests on historical calls
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSimulate} className="space-y-4">
                <div>
                  <Label htmlFor="strategySelect">Strategy</Label>
                  <Select value={selectedStrategy} onValueChange={setSelectedStrategy} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a strategy" />
                    </SelectTrigger>
                    <SelectContent>
                      {strategies.length === 0 ? (
                        <SelectItem value="" disabled>Loading strategies...</SelectItem>
                      ) : (
                        strategies.map((strategy) => (
                          <SelectItem key={strategy.id} value={strategy.name}>
                            {strategy.displayName}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="callerSelect">Caller (Optional)</Label>
                  <Select value={selectedCaller} onValueChange={setSelectedCaller}>
                    <SelectTrigger>
                      <SelectValue placeholder="All callers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All callers</SelectItem>
                      {callers.map((caller) => (
                        <SelectItem key={caller.id} value={caller.handle}>
                          {caller.displayName || caller.handle} ({caller.callCount} calls)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="fromDate">From Date</Label>
                    <Input
                      id="fromDate"
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="toDate">To Date</Label>
                    <Input
                      id="toDate"
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={loading || !selectedStrategy}>
                  {loading ? 'Running Simulation...' : 'Run Simulation'}
                </Button>
              </form>
              {simulationResult && (
                <div className="mt-4 p-4 bg-gray-100 rounded">
                  <pre>{JSON.stringify(simulationResult, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
