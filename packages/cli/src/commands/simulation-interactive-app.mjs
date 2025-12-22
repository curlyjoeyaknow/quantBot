/**
 * Interactive Simulation App (ESM module for ink compatibility)
 * This file will be loaded as ESM to work with ink
 */

import React from 'react';
import { render, Text, Box, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import { StrategiesRepository, CallersRepository } from '@quantbot/storage';
import { ensureInitialized } from '../core/initialization-manager.js';
import { handleError } from '../core/error-handler.js';

// Re-export the component and runner
export { InteractiveSimulationApp as default, runInteractiveSimulation };

// Copy all the component code here...
// For now, create a simple version

function InteractiveSimulationApp() {
  return React.createElement(Text, null, 'Interactive simulation - Loading...');
}

async function runInteractiveSimulation() {
  await ensureInitialized();
  render(React.createElement(InteractiveSimulationApp));
}

