/**
 * Application entry point
 */

import { createApp } from './app.js';
import { config } from './config/index.js';
import { system } from './events.js';
import { chronicleMain } from './services/chronicler.js';

// Create Express app
const app = createApp();
const port = config.port;

// Start server
const server = app.listen(port, () => {
  chronicleMain.event(system.events.startup, {
    port,
    env: config.environment,
  });

  console.log(`🚀 Server running on port ${port}`);
  console.log(`📊 Environment: ${config.environment}`);
  console.log(`📝 Log level: ${config.logger.level}`);
  console.log('\nAvailable endpoints:');
  console.log(`  GET  http://localhost:${port}/api/health`);
  console.log(`  GET  http://localhost:${port}/api/users`);
  console.log(`  POST http://localhost:${port}/api/users`);
  console.log(`  POST http://localhost:${port}/api/admin/login`);
  console.log(`  POST http://localhost:${port}/api/admin/action`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  chronicleMain.event(system.events.shutdown, {
    reason: signal,
  });

  console.log(`\n${signal} received, shutting down gracefully...`);

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  chronicleMain.event(system.events.error, {
    error,
    context: 'uncaughtException',
  });
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  chronicleMain.event(system.events.error, {
    error: reason instanceof Error ? reason : new Error(String(reason)),
    context: 'unhandledRejection',
  });
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});
