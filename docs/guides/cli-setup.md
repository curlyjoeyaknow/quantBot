# QuantBot CLI Setup Guide

This guide explains how to set up the `quantbot` command in your terminal.

## Quick Setup

### Option 1: Using pnpm (Recommended - Easiest)

```bash
# Build the CLI package
pnpm --filter @quantbot/cli build

# Use via pnpm (no setup needed!)
pnpm cli --version
pnpm cli ingestion ohlcv --help
pnpm cli ohlcv backfill --mint So111... --from 2024-01-01 --to 2024-01-31
```

**This is the simplest approach - just use `pnpm cli` instead of `quantbot`!**

### Option 2: Create Bash Wrapper (Recommended for Global Command)

```bash
# Build the CLI
pnpm --filter @quantbot/cli build

# Create bash wrapper in ~/.local/bin
mkdir -p ~/.local/bin
cat > ~/.local/bin/quantbot << 'EOF'
#!/bin/bash
cd /home/memez/quantBot && node packages/cli/dist/bin/bin/quantbot.js "$@"
EOF
chmod +x ~/.local/bin/quantbot

# Add ~/.local/bin to PATH (if not already there)
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc  # or source ~/.bashrc

# Verify
quantbot --help
```

**Note:** Update `/home/memez/quantBot` to your actual project path!

### Option 3: Create Alias (Simple)

```bash
# Build the CLI
pnpm --filter @quantbot/cli build

# Add alias to your shell config
echo 'alias quantbot="cd /home/memez/quantBot && node packages/cli/dist/bin/bin/quantbot.js"' >> ~/.zshrc
source ~/.zshrc

# Verify
quantbot --help
```

**Note:** Update `/home/memez/quantBot` to your actual project path!

## Troubleshooting

### "quantbot: command not found"

1. **Check if binary exists:**
   ```bash
   ls -la packages/cli/dist/bin/quantbot.js
   ```

2. **Check if it's executable:**
   ```bash
   chmod +x packages/cli/dist/bin/quantbot.js
   ```

3. **Verify PATH:**
   ```bash
   echo $PATH | grep -q "quantBot" && echo "In PATH" || echo "Not in PATH"
   ```

4. **Test directly with node:**
   ```bash
   node packages/cli/dist/bin/quantbot.js --version
   ```

### "Cannot find module" errors

Make sure all packages are built:
```bash
pnpm build:ordered
```

### Binary is TypeScript instead of JavaScript

The build may not have compiled properly. Rebuild:
```bash
cd packages/cli
rm -rf dist
pnpm build
```

## Verification

After setup, verify the command works:

```bash
quantbot --version
quantbot --help
quantbot ingestion ohlcv --help
```

## Common Commands

Once set up, you can use:

```bash
# OHLCV ingestion
quantbot ingestion ohlcv --duckdb data/tele.duckdb

# OHLCV backfill
quantbot ohlcv backfill --mint So111... --from 2024-01-01 --to 2024-01-31

# Simulation
quantbot simulation run --strategy PT2_SL25 --caller Brook --from 2024-01-01 --to 2024-02-01

# Interactive simulation
quantbot sim
```

