/**
 * Error handling middleware
 */

import type { NextFunction, Request, Response } from 'express';

import { system } from '../services/chronicler.js';

/**
 * Global error handler
 * Logs errors and returns appropriate response.
 * Runs inside the request's ambient correlation, so the event carries its correlation id.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  system.error({
    error: err,
    context: `${req.method} ${req.path}`,
  });

  // Determine status code
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;

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
