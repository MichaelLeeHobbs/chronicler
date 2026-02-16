import { defineCorrelationGroup, defineEvent, defineEventGroup, field } from '@ubercode/chronicler';

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
        port: field.number().doc('Server port number'),
        env: field.string().doc('Environment (development/production)'),
      },
    } as const),
    shutdown: defineEvent({
      key: 'system.shutdown',
      level: 'info',
      message: 'Application shutting down',
      doc: 'Emitted during graceful shutdown',
      fields: {
        reason: field.string().optional().doc('Reason for shutdown'),
      },
    } as const),
    error: defineEvent({
      key: 'system.error',
      level: 'error',
      message: 'System error occurred',
      doc: 'Emitted when an unexpected system error occurs',
      fields: {
        error: field.error().doc('Error object'),
        context: field.string().optional().doc('Error context'),
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
        method: field.string().doc('HTTP method'),
        path: field.string().doc('Request path'),
        ip: field.string().optional().doc('Client IP address'),
        userAgent: field.string().optional().doc('User agent string'),
      },
    } as const),
    completed: defineEvent({
      key: 'http.request.completed',
      level: 'info',
      message: 'HTTP request completed',
      doc: 'Emitted when request finishes successfully',
      fields: {
        statusCode: field.number().doc('HTTP status code'),
        duration: field.number().doc('Request duration in ms'),
      },
    } as const),
    error: defineEvent({
      key: 'http.request.error',
      level: 'error',
      message: 'HTTP request error',
      doc: 'Emitted when request encounters an error',
      fields: {
        error: field.error().doc('Error object'),
        statusCode: field.number().optional().doc('HTTP status code'),
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
        action: field.string().doc('Action performed'),
        userId: field.string().doc('User who performed action'),
        resource: field.string().optional().doc('Affected resource'),
        success: field.boolean().doc('Whether action succeeded'),
      },
    } as const),
    login: defineEvent({
      key: 'admin.login',
      level: 'audit',
      message: 'User login attempt',
      doc: 'Emitted for authentication attempts',
      fields: {
        userId: field.string().doc('User ID'),
        success: field.boolean().doc('Login success'),
        ip: field.string().optional().doc('Client IP'),
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
        userId: field.string().doc('New user ID'),
        email: field.string().optional().doc('User email'),
      },
    } as const),
    dataProcessed: defineEvent({
      key: 'business.dataProcessed',
      level: 'info',
      message: 'Data processing completed',
      doc: 'Emitted when background data processing completes',
      fields: {
        recordCount: field.number().doc('Number of records processed'),
        duration: field.number().doc('Processing time in ms'),
        success: field.boolean().doc('Processing success'),
      },
    } as const),
  },
} as const);
