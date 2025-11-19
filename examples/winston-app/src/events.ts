import { defineCorrelationGroup, defineEvent, defineEventGroup, t } from 'chronicler';

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
        port: t.number().doc('Server port number'),
        env: t.string().doc('Environment (development/production)'),
      },
    } as const),
    shutdown: defineEvent({
      key: 'system.shutdown',
      level: 'info',
      message: 'Application shutting down',
      doc: 'Emitted during graceful shutdown',
      fields: {
        reason: t.string().optional().doc('Reason for shutdown'),
      },
    } as const),
    error: defineEvent({
      key: 'system.error',
      level: 'error',
      message: 'System error occurred',
      doc: 'Emitted when an unexpected system error occurs',
      fields: {
        error: t.error().doc('Error object'),
        context: t.string().optional().doc('Error context'),
      },
    } as const),
  },
} as const);

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
        method: t.string().doc('HTTP method'),
        path: t.string().doc('Request path'),
        ip: t.string().optional().doc('Client IP address'),
        userAgent: t.string().optional().doc('User agent string'),
      },
    } as const),
    completed: defineEvent({
      key: 'http.request.completed',
      level: 'info',
      message: 'HTTP request completed',
      doc: 'Emitted when request finishes successfully',
      fields: {
        statusCode: t.number().doc('HTTP status code'),
        duration: t.number().doc('Request duration in ms'),
      },
    } as const),
    error: defineEvent({
      key: 'http.request.error',
      level: 'error',
      message: 'HTTP request error',
      doc: 'Emitted when request encounters an error',
      fields: {
        error: t.error().doc('Error object'),
        statusCode: t.number().optional().doc('HTTP status code'),
      },
    } as const),
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
        action: t.string().doc('Action performed'),
        userId: t.string().doc('User who performed action'),
        resource: t.string().optional().doc('Affected resource'),
        success: t.boolean().doc('Whether action succeeded'),
      },
    } as const),
    login: defineEvent({
      key: 'admin.login',
      level: 'audit',
      message: 'User login attempt',
      doc: 'Emitted for authentication attempts',
      fields: {
        userId: t.string().doc('User ID'),
        success: t.boolean().doc('Login success'),
        ip: t.string().optional().doc('Client IP'),
      },
    } as const),
  },
} as const);

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
        userId: t.string().doc('New user ID'),
        email: t.string().optional().doc('User email'),
      },
    } as const),
    dataProcessed: defineEvent({
      key: 'business.dataProcessed',
      level: 'info',
      message: 'Data processing completed',
      doc: 'Emitted when background data processing completes',
      fields: {
        recordCount: t.number().doc('Number of records processed'),
        duration: t.number().doc('Processing time in ms'),
        success: t.boolean().doc('Processing success'),
      },
    } as const),
  },
} as const);
