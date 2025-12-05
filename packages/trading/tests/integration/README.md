# Integration Tests

Integration tests for the QuantBot live trading system on Solana devnet/testnet.

## Setup

### Environment Variables

Create a `.env.test` file in the project root:

```env
HELIUS_API_KEY=your_testnet_api_key
TEST_WALLET_PRIVATE_KEY=your_test_wallet_private_key_json_array
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=quantbot_test
```

### Test Wallet

You can either:
1. Let the tests generate a new wallet automatically
2. Provide your own test wallet via `TEST_WALLET_PRIVATE_KEY`

To generate a test wallet:

```bash
solana-keygen new --no-passphrase -o test-wallet.json
```

Then convert to the format needed:

```bash
cat test-wallet.json
# Copy the array of numbers and set TEST_WALLET_PRIVATE_KEY="[1,2,3,...]"
```

### Getting Devnet SOL

Request an airdrop:

```bash
solana airdrop 2 <YOUR_WALLET_ADDRESS> --url devnet
```

Or use the test suite's built-in airdrop functionality.

## Running Tests

### All Integration Tests

```bash
cd packages/trading
pnpm test:integration
```

### Specific Test Suite

```bash
pnpm vitest run tests/integration/rpc-client.integration.test.ts
```

### Watch Mode

```bash
pnpm vitest watch tests/integration/
```

## Test Structure

### testnet-setup.ts

Utilities for setting up testnet environment:
- RPC client initialization
- Test wallet management
- Airdrop requests
- Cleanup utilities

### rpc-client.integration.test.ts

Tests for Helius RPC client:
- Transaction sending
- Transaction simulation
- Signature status checking
- Connection failover

### trade-executor.integration.test.ts

Tests for trade execution:
- Buy order execution
- Sell order execution
- Stop-loss triggering
- Take-profit execution
- Fee calculation

## Important Notes

### Devnet vs Mainnet

- All integration tests run on **Solana devnet**
- Never run integration tests on mainnet
- Test tokens have no real value

### Rate Limiting

- Helius API has rate limits
- Tests include delays to avoid hitting limits
- Use dedicated test API keys

### Test Duration

Integration tests can take several minutes:
- Network latency
- Transaction confirmation times
- Airdrop delays

### Cleanup

Tests clean up after themselves:
- Close open positions
- Clean database records
- Minimal SOL usage

## CI/CD Integration

### GitHub Actions

```yaml
name: Integration Tests

on:
  pull_request:
    branches: [main]

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: testpass
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - run: npm install -g pnpm
      - run: pnpm install
      
      - name: Run integration tests
        env:
          HELIUS_API_KEY: ${{ secrets.HELIUS_TESTNET_API_KEY }}
        run: pnpm test:integration
```

## Troubleshooting

### Airdrop Failures

If airdrops fail:
1. Check devnet faucet status
2. Try manual airdrop via CLI
3. Wait and retry (rate limited)

### Transaction Failures

Common issues:
- Insufficient SOL balance
- Network congestion
- Invalid token addresses
- Blockhash expiry

### Database Connection

Ensure PostgreSQL is running:

```bash
docker-compose up -d postgres
```

Run migrations:

```bash
psql -U quantbot -d quantbot_test -f scripts/migration/postgres/003_live_trading.sql
```

## Best Practices

1. **Use Test Tokens**: Only use devnet tokens
2. **Small Amounts**: Test with minimal SOL amounts
3. **Clean Up**: Always run cleanup after tests
4. **Timeout Handling**: Set appropriate timeouts
5. **Error Handling**: Test both success and failure cases

## Security

- Never commit private keys
- Use environment variables
- Rotate test API keys
- Separate test and production databases

## Future Enhancements

- [ ] Automated devnet token deployment
- [ ] Mock trading strategies for tests
- [ ] Performance benchmarking
- [ ] Load testing
- [ ] Multi-wallet scenarios

