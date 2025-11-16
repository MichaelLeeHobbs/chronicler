/**
 * Winston logger service with multiple streams
 * Supports development (console) and production (CloudWatch) modes
 */

import winston, { type LeveledLogMethod } from 'winston';

import { config } from '../config/index.js';
import { MockCloudWatchTransport } from './mock-cloudwatch.js';

const isProduction = config.environment === 'production';

/**
 * Custom log levels matching Chronicler
 */
export const customLevels = {
  levels: {
    fatal: 0,
    critical: 1,
    alert: 2,
    error: 3,
    warn: 4,
    audit: 5,
    http: 6,
    info: 7,
    debug: 8,
    trace: 9,
  },
  colors: {
    fatal: 'red bold',
    critical: 'red',
    alert: 'yellow bold',
    error: 'red',
    warn: 'yellow',
    audit: 'magenta',
    http: 'cyan',
    info: 'green',
    debug: 'blue',
    trace: 'grey',
  },
};

export type LogLevel = keyof typeof customLevels.levels;

type CustomLogger = winston.Logger & {
  [L in LogLevel]: LeveledLogMethod;
};

// Register colors for console output
winston.addColors(customLevels.colors);

/**
 * Development format: colorized console output
 */
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = meta && Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message}${metaStr ? '\n' + metaStr : ''}`;
  }),
);

/**
 * Production format: JSON for CloudWatch
 */
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

/**
 * Create a logger for a specific stream
 */
function createLogger(
  streamName: string,
  opts?: {
    level?: LogLevel;
    logGroupName?: string;
  },
): CustomLogger {
  const transports: winston.transport[] = [];

  if (isProduction) {
    // Production: Use CloudWatch transport
    try {
      transports.push(
        new MockCloudWatchTransport({
          ...config.awsCloudWatch,
          logStreamName: streamName,
          logGroupName: opts?.logGroupName || config.awsCloudWatch.logGroupName,
        }),
      );
    } catch (e) {
      console.error(`Failed to create CloudWatch transport for ${streamName}:`, e);
      // Fallback to console
      transports.push(new winston.transports.Console());
    }
  } else {
    // Development: Use console
    transports.push(new winston.transports.Console());
  }

  return winston.createLogger({
    levels: customLevels.levels,
    level: opts?.level || config.logger.level,
    format: isProduction ? prodFormat : devFormat,
    defaultMeta: { stream: streamName },
    transports,
  }) as CustomLogger;
}

/**
 * Pre-configured loggers for different purposes
 */

// Main application logger
export const loggerMain = createLogger('main');

// Audit/compliance logger
export const loggerAudit = createLogger('audit');

// HTTP request logger
export const loggerHttp = createLogger('http');

// Default export: main logger
export default loggerMain;
