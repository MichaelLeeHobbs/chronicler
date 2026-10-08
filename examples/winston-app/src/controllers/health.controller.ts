/**
 * Health check controller
 */

import type { Request, Response } from 'express';

import { chronicle, system } from '../services/chronicler.js';

export const healthCheck = (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

/** Simulate probing a dependency. */
const probe = async (_dependency: string): Promise<boolean> => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return true;
};

export const healthDeep = async (_req: Request, res: Response) => {
  const dependencies = ['database', 'cache', 'external'] as const;

  // Probe dependencies in parallel. Each probe logs from its own fork of the request's
  // span, so its events share the span id but get their own forkId (1, 2, 3).
  const results = await Promise.all(
    dependencies.map(async (dependency) => {
      const fork = chronicle.fork({ dependency });
      const healthy = await probe(dependency);
      fork.system.dependencyChecked({ dependency, healthy });
      return [dependency, healthy] as const;
    }),
  );
  const checks = Object.fromEntries(results);
  const allHealthy = results.every(([, healthy]) => healthy);

  if (!allHealthy) {
    system.error({
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
