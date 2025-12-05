'use client';

/**
 * Figma MCP Dashboard
 * Integration dashboard for Figma MCP server
 */

import { useState } from 'react';

export function FigmaDashboard() {
  const [figmaUrl, setFigmaUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const extractFigmaInfo = (url: string) => {
    // Extract fileKey and nodeId from Figma URL
    // Format: https://www.figma.com/design/{fileKey}/{fileName}?node-id={nodeId}
    const match = url.match(/figma\.com\/design\/([^/]+)\/[^?]*\?node-id=([^&]+)/);
    if (match) {
      return {
        fileKey: match[1],
        nodeId: match[2].replace(/-/g, ':')
      };
    }
    return null;
  };

  const handleImportDesign = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    const info = extractFigmaInfo(figmaUrl);
    if (!info) {
      setError('Invalid Figma URL. Please use a URL like: https://www.figma.com/design/FILE_KEY/NAME?node-id=X-Y');
      setIsLoading(false);
      return;
    }

    try {
      // Call your backend API that uses the Figma MCP tools
      const response = await fetch('/api/figma/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info)
      });

      if (!response.ok) throw new Error('Failed to import design');
      
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h2 className="text-2xl font-bold text-white mb-4">🎨 Figma MCP Integration</h2>
        <p className="text-slate-400 mb-6">
          Import designs directly from Figma using the Model Context Protocol
        </p>

        {/* Connection Status */}
        <div className="mb-6 p-4 bg-slate-900 rounded border border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">MCP Server Status</h3>
              <p className="text-sm text-slate-400 mt-1">Figma Remote Server</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-green-400 font-medium">Connected</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Endpoint: https://mcp.figma.com/mcp
          </div>
        </div>

        {/* Import Form */}
        <div className="space-y-4">
          <div>
            <label htmlFor="figma-url" className="block text-sm font-medium text-slate-300 mb-2">
              Figma Design URL
            </label>
            <input
              id="figma-url"
              type="text"
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              placeholder="https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-762"
              className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Right-click a frame in Figma → Copy link to selection
            </p>
          </div>

          <button
            onClick={handleImportDesign}
            disabled={isLoading || !figmaUrl}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded transition-colors"
          >
            {isLoading ? 'Importing...' : 'Import Design'}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Result Display */}
        {result && (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Imported Design</h3>
            
            {result.screenshot && (
              <div className="border border-slate-700 rounded overflow-hidden">
                <img src={result.screenshot} alt="Design screenshot" className="w-full" />
              </div>
            )}

            {result.code && (
              <div className="bg-slate-900 rounded border border-slate-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-white">Generated Code</h4>
                  <button
                    onClick={() => navigator.clipboard.writeText(result.code)}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre className="text-xs text-slate-300 overflow-x-auto">
                  <code>{result.code}</code>
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-2">📸 Get Screenshot</h3>
          <p className="text-sm text-slate-400 mb-3">Capture any Figma frame as an image</p>
          <button className="text-blue-400 hover:text-blue-300 text-sm font-medium">
            Try it →
          </button>
        </div>

        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-2">🎨 Get Variables</h3>
          <p className="text-sm text-slate-400 mb-3">Extract design tokens and variables</p>
          <button className="text-blue-400 hover:text-blue-300 text-sm font-medium">
            Try it →
          </button>
        </div>

        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-2">📋 Get Metadata</h3>
          <p className="text-sm text-slate-400 mb-3">View frame structure and properties</p>
          <button className="text-blue-400 hover:text-blue-300 text-sm font-medium">
            Try it →
          </button>
        </div>
      </div>

      {/* Recent Imports */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Imports</h3>
        <div className="text-slate-400 text-sm">
          No recent imports yet. Import your first design above!
        </div>
      </div>
    </div>
  );
}

