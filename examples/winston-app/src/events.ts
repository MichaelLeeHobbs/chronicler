import { defineCorrelationGroup, defineEvent, defineEventGroup } from 'chronicler';

/**
 * System lifecycle events
 */
export const system = defineEventGroup({
  key: 'system',
  type: 'system',
  doc: 'System lifecycle and operational events',
  events: {
    startup: defineEvent({
      key: 'system.startup',
      level: 'info',
      message: 'Application started',
      doc: 'Emitted when the application starts successfully',
      fields: {
        port: { type: 'number', required: true, doc: 'Server port number' },
        env: { type: 'string', required: true, doc: 'Environment (development/production)' },
      },
    }),
    shutdown: defineEvent({
      key: 'system.shutdown',
      level: 'info',
      message: 'Application shutting down',
      doc: 'Emitted during graceful shutdown',
      fields: {
        reason: { type: 'string', required: false, doc: 'Reason for shutdown' },
      },
    }),
    error: defineEvent({
      key: 'system.error',
      level: 'error',
      message: 'System error occurred',
      doc: 'Emitted when an unexpected system error occurs',
      fields: {
        error: { type: 'error', required: true, doc: 'Error object' },
        context: { type: 'string', required: false, doc: 'Error context' },
      },
    }),
  },
});

/**
 * HTTP request correlation group
 */
export const httpRequest = defineCorrelationGroup({
  key: 'http.request',
  type: 'correlation',
  doc: 'HTTP request lifecycle tracking',
  timeout: 30000, // 30 second timeout
  events: {
    started: defineEvent({
      key: 'http.request.started',
      level: 'info',
      message: 'HTTP request started',
      doc: 'Emitted when request processing begins',
      fields: {
        method: { type: 'string', required: true, doc: 'HTTP method' },
        path: { type: 'string', required: true, doc: 'Request path' },
        ip: { type: 'string', required: false, doc: 'Client IP address' },
        userAgent: { type: 'string', required: false, doc: 'User agent string' },
      },
    }),
    completed: defineEvent({
      key: 'http.request.completed',
      level: 'info',
      message: 'HTTP request completed',
      doc: 'Emitted when request finishes successfully',
      fields: {
        statusCode: { type: 'number', required: true, doc: 'HTTP status code' },
        duration: { type: 'number', required: true, doc: 'Request duration in ms' },
      },
    }),
    error: defineEvent({
      key: 'http.request.error',
      level: 'error',
      message: 'HTTP request error',
      doc: 'Emitted when request encounters an error',
      fields: {
        error: { type: 'error', required: true, doc: 'Error object' },
        statusCode: { type: 'number', required: false, doc: 'HTTP status code' },
      },
    }),
  },
});

/**
 * Admin/audit action events
 */
export const admin = defineEventGroup({
  key: 'admin',
  type: 'system',
  doc: 'Administrative and audit trail events',
  events: {
    action: defineEvent({
      key: 'admin.action',
      level: 'audit',
      message: 'Administrative action performed',
      doc: 'Emitted for auditable administrative actions',
      fields: {
        action: { type: 'string', required: true, doc: 'Action performed' },
        userId: { type: 'string', required: true, doc: 'User who performed action' },
        resource: { type: 'string', required: false, doc: 'Affected resource' },
        success: { type: 'boolean', required: true, doc: 'Whether action succeeded' },
      },
    }),
    login: defineEvent({
      key: 'admin.login',
      level: 'audit',
      message: 'User login attempt',
      doc: 'Emitted for authentication attempts',
      fields: {
        userId: { type: 'string', required: true, doc: 'User ID' },
        success: { type: 'boolean', required: true, doc: 'Login success' },
        ip: { type: 'string', required: false, doc: 'Client IP' },
      },
    }),
  },
});

/**
 * Business logic events
 */
export const business = defineEventGroup({
  key: 'business',
  type: 'system',
  doc: 'Business logic and domain events',
  events: {
    userCreated: defineEvent({
      key: 'business.userCreated',
      level: 'info',
      message: 'User created',
      doc: 'Emitted when a new user is created',
      fields: {
        userId: { type: 'string', required: true, doc: 'New user ID' },
        email: { type: 'string', required: false, doc: 'User email' },
      },
    }),
    dataProcessed: defineEvent({
      key: 'business.dataProcessed',
      level: 'info',
      message: 'Data processing completed',
      doc: 'Emitted when background data processing completes',
      fields: {
        recordCount: { type: 'number', required: true, doc: 'Number of records processed' },
        duration: { type: 'number', required: true, doc: 'Processing time in ms' },
        success: { type: 'boolean', required: true, doc: 'Processing success' },
      },
    }),
  },
});
