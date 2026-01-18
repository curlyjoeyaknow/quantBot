# Telegram Scripts

Helper scripts for Telegram authentication and session management.

## Prerequisites

The `generate-session.ts` script requires the `telegram` package (GramJS) for MTProto client access.

Install it if not already available:

```bash
pnpm add telegram
```

## generate-session.ts

Generates a Telegram session string for your personal account.

### Usage

```bash
# Set API credentials (get from https://my.telegram.org/apps)
export TELEGRAM_API_ID=12345678
export TELEGRAM_API_HASH=your_api_hash

# Run the generator
pnpm tsx scripts/telegram/generate-session.ts
```

### What It Does

1. Connects to Telegram using your API credentials
2. Prompts for your phone number (with country code, e.g., `+1234567890`)
3. Sends a verification code to your Telegram
4. Prompts for the verification code
5. Handles 2FA if enabled (simplified - may need full SRP implementation)
6. Prints the session string

### Output

The script prints a session string like:
```
1BVtsOHwBu7...
```

**Save this to `TELEGRAM_SESSION` environment variable** for use with the shadow runner.

### Important Notes

- **This uses YOUR PERSONAL Telegram account**, not a bot
- The session string is sensitive - keep it secure
- Don't commit session strings to git
- Each session is tied to your account - don't share between instances

### Troubleshooting

**Error: "Cannot find module 'telegram'"**
- Install the package: `pnpm add telegram`

**Error: "2FA requires full SRP implementation"**
- The script has simplified 2FA handling
- For full 2FA support, use the interactive authentication in the shadow runner
- Or implement proper SRP (Secure Remote Password) protocol

**Error: "SESSION_REVOKED"**
- Your session was revoked (logged out from another device)
- Generate a new session string

**Error: "PHONE_NUMBER_INVALID"**
- Use full international format: `+1234567890`
- Include country code

