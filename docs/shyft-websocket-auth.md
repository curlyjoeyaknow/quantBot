# Shyft WebSocket Authentication Fix

## Problem

WebSocket authentication was not working because:
1. Auth response was not being handled
2. Subscriptions were sent before authentication completed
3. No timeout or error handling for auth failures
4. Messages were processed before authentication succeeded

## Solution

### Changes Made

1. **Added Authentication State Tracking**
   - `isAuthenticated: boolean` - Tracks if auth succeeded
   - `authPromise: { resolve, reject }` - Promise for auth completion

2. **Proper Auth Response Handling**
   - Wait for auth response with ID 1
   - Handle both success (`result: true`) and error responses
   - Set `isAuthenticated = true` only after successful auth

3. **Wait for Auth Before Subscribing**
   - Changed `connectWebSocket()` to `async`
   - Call `await authenticate()` before subscribing
   - Only subscribe after auth promise resolves

4. **Message Filtering**
   - Only process price updates if `isAuthenticated === true`
   - Ignore messages received before authentication

5. **Error Handling**
   - 5-second timeout for auth response
   - Proper error logging with error codes
   - Reconnect on auth failure

### Code Changes

**Before:**
```typescript
this.ws.on('open', () => {
  // Send auth
  this.ws.send(JSON.stringify(authMessage));
  // Subscribe immediately (wrong!)
  setTimeout(() => {
    this.subscribeToSolanaTokens();
  }, 1000);
});
```

**After:**
```typescript
this.ws.on('open', async () => {
  try {
    await this.authenticate(authToken);
    // Subscribe only after auth succeeds
    this.subscribeToSolanaTokens();
  } catch (error) {
    logger.error('Auth failed', error);
    this.ws.close();
  }
});
```

### Authentication Method

```typescript
private authenticate(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Set timeout
    const authTimeout = setTimeout(() => {
      reject(new Error('Authentication timeout'));
    }, 5000);

    // Store promise resolvers
    this.authPromise = {
      resolve: () => {
        clearTimeout(authTimeout);
        resolve();
      },
      reject: (error: Error) => {
        clearTimeout(authTimeout);
        reject(error);
      }
    };

    // Send auth message
    const authMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'auth',
      params: [token],
    };
    this.ws.send(JSON.stringify(authMessage));
  });
}
```

### Message Handler

```typescript
this.ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  // Handle auth response
  if (message.id === 1 && message.method === 'auth') {
    if (message.error) {
      this.authPromise?.reject(new Error(message.error.message));
      return;
    }
    if (message.result === true || !message.error) {
      this.isAuthenticated = true;
      this.authPromise?.resolve();
      return;
    }
  }
  
  // Only process if authenticated
  if (this.isAuthenticated) {
    this.handleWebSocketMessage(message);
  }
});
```

## Environment Variables

Ensure these are set:
```bash
SHYFT_X_TOKEN=your_shyft_x_token_here  # Preferred for WebSocket
SHYFT_API_KEY=your_shyft_api_key_here  # Fallback
SHYFT_WS_URL=wss://api.shyft.to/v1/stream
```

## Testing

1. Check logs for "Shyft WebSocket authenticated successfully"
2. Verify subscriptions are sent after auth
3. Confirm price updates are received
4. Check for auth timeout errors (should not occur)

## Files Updated

- `packages/monitoring/src/live-trade-alert-service.ts`
- `packages/monitoring/src/tenkan-kijun-alert-service.ts`

