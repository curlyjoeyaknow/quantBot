import React from 'react';
import { render } from 'ink';
import { TelegramTuiOptions } from './types.js';
import { TelegramTuiApp } from './app.js';

export async function runTelegramTui(opts: TelegramTuiOptions): Promise<void> {
  render(<TelegramTuiApp {...opts} />);
}

