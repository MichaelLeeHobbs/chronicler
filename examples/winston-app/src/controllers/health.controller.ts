/**
 * Health check controller
 */

import type { Request, Response } from 'express';

import { chronicleMain } from '../services/chronicler.js';
import { system } from '../events.js';

export const healthCheck = (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

export const healthDeep = async (_req: Request, res: Response) => {
  // Simulate checking various services
  const checks = {
    database: true,
    cache: true,
    external: true,
  };

  const allHealthy = Object.values(checks).every((v) => v);

  if (!allHealthy) {
    chronicleMain.event(system.events.error, {
      error: new Error('Health check failed'),
      context: 'deep-health-check',
    });
  }

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'unhealthy',
    checks,
    timestamp: new Date().toISOString(),
  });
};
