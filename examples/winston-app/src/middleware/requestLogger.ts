/**
 * HTTP request logging middleware
 * Tracks request lifecycle with correlation
 */

import type { NextFunction, Request, Response } from 'express';

import { httpRequest } from '../events.js';
import { chronicleHttp } from '../services/chronicler.js';

/**
 * Request logger middleware
 * Creates a correlation for each HTTP request
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const requestId =
    (req.headers['x-request-id'] as string) ||
    `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Start correlation
  const correlation = chronicleHttp.startCorrelation(httpRequest, {
    requestId,
  });

  // Log request started
  correlation.event(httpRequest.events.started, {
    method: req.method,
    path: req.path,
    ip: req.ip || 'unknown',
    userAgent: req.get('user-agent') || 'unknown',
  });

  // Attach correlation to request for use in handlers
  (req as any).chronicle = correlation;

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    if (res.statusCode >= 400) {
      // Log error if status is 4xx or 5xx
      correlation.event(httpRequest.events.error, {
        error: new Error(`HTTP ${res.statusCode}: ${req.path}`),
        statusCode: res.statusCode,
      });
    }

    // Log completion
    correlation.event(httpRequest.events.completed, {
      statusCode: res.statusCode,
      duration,
    });

    correlation.complete();
  });

  next();
}
