/**
 * Simulation Package Logger
 * =========================
 * Centralized logger for the simulation package with namespace '@quantbot/backtest'
 */

import { createPackageLogger } from '@quantbot/infra/utils';

export const logger = createPackageLogger('@quantbot/backtest');
