/**
 * Error handling middleware
 */

import type { NextFunction, Request, Response } from 'express';

import { system } from '../events.js';
import { chronicleMain } from '../services/chronicler.js';

/**
 * Global error handler
 * Logs errors and returns appropriate response
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  // Log system error
  chronicleMain.event(system.events.error, {
    error: err,
    context: `${req.method} ${req.path}`,
  });

  // Determine status code
  const statusCode = (err as any).statusCode || 500;

  // Send response
  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal Server Error' : err.message,
    path: req.path,
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: err.message,
    }),
  });
}

/**
 * 404 handler
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
  });
}
