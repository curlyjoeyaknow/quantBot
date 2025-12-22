#!/usr/bin/env node
import { runTelegramTuiFromCli } from '../commands/telegram/tui/cliEntrypoint.js';

runTelegramTuiFromCli(process.argv).catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  // keep it readable; Ink will handle the rest when running successfully
   
  console.error(`[telegram:tui] ${msg}`);
  process.exit(1);
});

