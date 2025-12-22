# Figma MCP Server Troubleshooting Guide

## Known Issues

### Authentication Callback Not Working (Linux)

**Problem:** After clicking "Login" in Cursor's MCP settings, the browser doesn't open or the callback doesn't complete.

**Root Cause:** Cursor's embedded Chromium browser won't launch on Linux without `--no-sandbox` flags, and even then, the OAuth callback mechanism is unreliable.

**Workarounds:**

1. **Use Figma Desktop App with Local MCP Server (Recommended)**
   - Install Figma Desktop app
   - Enable Dev Mode: Figma menu → Preferences → "Enable Dev Mode MCP Server"
   - Verify server is running: `curl http://127.0.0.1:3845/sse`
   - Update `.cursor/mcp.json` to use `figma-local` instead of `figma`
   - Set `"enabled": true` for `figma-local` and `"enabled": false` for `figma`

2. **Manual Token Extraction (If OAuth Works in Browser)**
   - Open browser developer tools (F12)
   - Navigate to Network tab
   - Try to authenticate with Figma
   - Look for OAuth callback requests
   - Extract token from response (if possible)
   - Note: This is complex and may not work with remote MCP server

3. **Temporary Disable**
   - Set `"enabled": false` for the Figma MCP server in `mcp.json`
   - Use Figma manually until Cursor fixes the authentication flow

## Configuration Options

### Remote Server (Current - Has Auth Issues)
```json
{
  "figma": {
    "url": "https://mcp.figma.com/mcp",
    "type": "http",
    "enabled": true
  }
}
```

### Local Server (Requires Figma Desktop)
```json
{
  "figma-local": {
    "url": "http://127.0.0.1:3845/sse",
    "type": "sse",
    "enabled": true
  }
}
```

## Verification Steps

1. Check if MCP server is accessible:
   ```bash
   # For remote server
   curl https://mcp.figma.com/mcp
   
   # For local server
   curl http://127.0.0.1:3845/sse
   ```

2. In Cursor, check MCP status:
   - Open Command Palette (`Ctrl+Shift+P`)
   - Type "MCP" to see available commands
   - Check server connection status

3. Test MCP tools:
   - Try using `@Figma` in Cursor chat
   - Should see available Figma MCP tools if connected

## Alternative Solutions

If MCP integration continues to fail:

1. **Use Figma REST API directly** - Create API clients in the codebase
2. **Use Figma CLI tools** - Integrate via command-line tools
3. **Manual design sync** - Export designs manually and import to project

## Reporting Issues

If you find a working solution, please document it here or update this file.


