/**
 * Express application setup
 */

import express from 'express';

import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import routes from './routes/index.js';

/**
 * Create and configure Express application
 */
export function createApp(): express.Express {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware (creates correlations)
  app.use(requestLogger);

  // API routes
  app.use('/api', routes);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
