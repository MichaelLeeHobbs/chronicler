/**
 * Demo script for winston-app example
 *
 * This script:
 * 1. Starts the Express server
 * 2. Waits for it to be ready
 * 3. Makes various API calls to demonstrate logging
 * 4. Cleanly shuts down the server
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { setTimeout } from 'timers/promises';

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXAMPLE_ROOT = __dirname;

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const log = {
  section: (msg) => console.log(`\n${colors.bright}${colors.cyan}═══ ${msg} ═══${colors.reset}\n`),
  info: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  api: (method, path) =>
    console.log(`${colors.magenta}→${colors.reset} ${method.padEnd(6)} ${path}`),
  response: (status, body) => {
    const color =
      status >= 200 && status < 300 ? colors.green : status >= 400 ? colors.red : colors.yellow;
    console.log(`${color}←${colors.reset} ${status} ${colors.dim}${body}${colors.reset}`);
  },
};

// Configuration
const SERVER_PORT = 3001; // Use different port to avoid conflicts
const BASE_URL = `http://localhost:${SERVER_PORT}`;
const STARTUP_TIMEOUT = 5000;

let serverProcess = null;
let serverReady = false;

/**
 * Start the Express server
 */
async function startServer() {
  log.section('Starting Express Server');

  return new Promise((resolve, reject) => {
    // Use pnpm to run the dev script, which ensures tsx is found in node_modules/.bin
    serverProcess = spawn('pnpm', ['run', 'dev'], {
      cwd: EXAMPLE_ROOT,
      env: { ...process.env, PORT: SERVER_PORT.toString(), NODE_ENV: 'development' },
      stdio: 'pipe',
      shell: true, // Use shell to ensure pnpm is found on Windows
    });

    // Pipe server output to console
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`${colors.dim}[SERVER]${colors.reset} ${output}`);

        // Check if server is ready
        if (output.includes('Server running on port')) {
          serverReady = true;
          resolve();
        }
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error(`${colors.dim}[SERVER ERR]${colors.reset} ${output}`);
      }
    });

    serverProcess.on('error', (error) => {
      log.error(`Failed to start server: ${error.message}`);
      reject(error);
    });

    serverProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        log.warn(`Server exited with code ${code}`);
      } else if (signal) {
        log.info(`Server terminated by signal ${signal}`);
      }
    });

    // Timeout if server doesn't start
    setTimeout(STARTUP_TIMEOUT).then(() => {
      if (!serverReady) {
        reject(new Error('Server startup timeout'));
      }
    });
  });
}

/**
 * Stop the Express server
 */
async function stopServer() {
  log.section('Stopping Express Server');

  if (serverProcess) {
    return new Promise((resolve) => {
      serverProcess.once('exit', () => {
        log.info('Server stopped successfully');
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      serverProcess.kill('SIGTERM');

      // Force kill after 3 seconds if not stopped
      setTimeout(3000).then(() => {
        if (serverProcess && !serverProcess.killed) {
          log.warn('Force killing server...');
          serverProcess.kill('SIGKILL');
          resolve();
        }
      });
    });
  }
}

/**
 * Make API request and log the result
 */
async function apiCall(method, path, body = null) {
  log.api(method, path);

  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${path}`, options);
    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    const displayBody =
      typeof data === 'object'
        ? JSON.stringify(data).substring(0, 100) + (JSON.stringify(data).length > 100 ? '...' : '')
        : data.toString().substring(0, 100);

    log.response(response.status, displayBody);

    return { status: response.status, data };
  } catch (error) {
    log.error(`Request failed: ${error.message}`);
    throw error;
  }
}

/**
 * Run the demo
 */
async function runDemo() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   Chronicler + Winston + Express Demo                      ║
║                                                            ║
║   Demonstrates multi-stream logging with:                  ║
║   • Main stream (application logs)                         ║
║   • Audit stream (security/compliance)                     ║
║   • HTTP stream (request tracking)                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
\n`);

  try {
    // Start server
    await startServer();

    // Wait a bit for server to fully initialize
    await setTimeout(1000);

    // Health checks
    log.section('Health Checks');
    await apiCall('GET', '/api/health');
    await setTimeout(300);

    // User operations (logs to main stream)
    log.section('User Operations (Main Stream)');

    // Create users
    const user1 = await apiCall('POST', '/api/users', {
      email: 'alice@example.com',
      name: 'Alice Smith',
    });
    await setTimeout(300);

    const user2 = await apiCall('POST', '/api/users', {
      email: 'bob@example.com',
      name: 'Bob Jones',
    });
    await setTimeout(300);

    // Get all users
    await apiCall('GET', '/api/users');
    await setTimeout(300);

    // Get specific user
    if (user1.data?.id) {
      await apiCall('GET', `/api/users/${user1.data.id}`);
      await setTimeout(300);
    }

    // Delete user
    if (user2.data?.id) {
      await apiCall('DELETE', `/api/users/${user2.data.id}`);
      await setTimeout(300);
    }

    // Admin operations (logs to audit stream)
    log.section('Admin Operations (Audit Stream)');

    // Failed login
    await apiCall('POST', '/api/admin/login', {
      userId: 'admin',
      password: 'wrongpassword',
    });
    await setTimeout(300);

    // Successful login
    await apiCall('POST', '/api/admin/login', {
      userId: 'admin',
      password: 'demo123',
    });
    await setTimeout(300);

    // Admin actions
    await apiCall('POST', '/api/admin/action', {
      action: 'delete_user',
      resource: user1.data?.id || 'user-123',
    });
    await setTimeout(300);

    await apiCall('POST', '/api/admin/action', {
      action: 'update_permissions',
      resource: 'role-admin',
    });
    await setTimeout(500);

    // Error scenarios
    log.section('Error Scenarios');

    // 404
    await apiCall('GET', '/api/nonexistent');
    await setTimeout(300);

    // Bad request
    await apiCall('POST', '/api/users', {
      email: 'incomplete',
      // missing name
    });
    await setTimeout(300);

    // Invalid user ID
    await apiCall('GET', '/api/users/invalid-id');
    await setTimeout(500);

    // Final check
    log.section('Final Status Check');
    await apiCall('GET', '/api/users');
    await setTimeout(500);

    // Success summary
    log.section('Demo Complete');
    log.info('All API calls completed successfully');
    log.info('Check the logs above to see:');
    console.log(`  ${colors.dim}• HTTP request correlations with duration tracking${colors.reset}`);
    console.log(`  ${colors.dim}• Business events (user creation) in main stream${colors.reset}`);
    console.log(
      `  ${colors.dim}• Audit events (login, admin actions) in audit stream${colors.reset}`,
    );
    console.log(`  ${colors.dim}• Error handling with context${colors.reset}`);
    console.log(`  ${colors.dim}• Performance monitoring (_perf fields)${colors.reset}`);
  } catch (error) {
    log.error(`Demo failed: ${error.message}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    // Clean shutdown
    await setTimeout(1000);
    await stopServer();

    log.section('Cleanup Complete');
    log.info('Demo script exiting...');
    process.exit(0);
  }
}

// Handle script interruption
process.on('SIGINT', async () => {
  console.log('\n\n');
  log.warn('Received SIGINT, cleaning up...');
  await stopServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n');
  log.warn('Received SIGTERM, cleaning up...');
  await stopServer();
  process.exit(0);
});

// Unhandled errors
process.on('unhandledRejection', async (reason) => {
  log.error(`Unhandled rejection: ${reason}`);
  await stopServer();
  process.exit(1);
});

// Run the demo
runDemo().catch(async (error) => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  await stopServer();
  process.exit(1);
});
