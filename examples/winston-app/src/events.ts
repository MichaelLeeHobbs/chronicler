/**
 * Event catalog for the example app.
 *
 * Keys come from the object path: `admin.login`, `http.request.started`, ...
 *
 * This module must not import the chronicle (`services/chronicler.ts`): the chronicle imports
 * this catalog, and a circular import would hand `createChronicle()` an undefined entry.
 */

import { correlation, defineEvents, event, field, group } from '@ubercode/chronicler';

export const events = defineEvents({
  system: group(
    { doc: 'System lifecycle and operational events' },
    {
      startup: event({
        level: 'info',
        message: 'Application started',
        doc: 'Emitted when the application starts successfully',
        fields: {
          port: field.number().doc('Server port number'),
          env: field.string().doc('Environment (development/production)'),
        },
      }),
      shutdown: event({
        level: 'info',
        message: 'Application shutting down',
        doc: 'Emitted during graceful shutdown',
        fields: {
          reason: field.string().optional().doc('Reason for shutdown'),
        },
      }),
      error: event({
        level: 'error',
        message: 'System error occurred',
        doc: 'Emitted when an unexpected system error occurs',
        fields: {
          error: field.error().doc('Error object'),
          context: field.string().optional().doc('Error context'),
        },
      }),
      dependencyChecked: event({
        level: 'debug',
        message: 'Dependency checked',
        doc: 'Emitted by the deep health check for each dependency it probes',
        fields: {
          dependency: field.string().doc('Dependency name'),
          healthy: field.boolean().doc('Whether the dependency responded'),
        },
      }),
    },
  ),

  http: group(
    { doc: 'HTTP traffic' },
    {
      request: correlation({
        doc: 'HTTP request lifecycle tracking',
        timeout: 30_000,
        events: {
          started: event({
            level: 'info',
            message: 'HTTP request started',
            doc: 'Emitted when request processing begins',
            fields: {
              method: field.string().doc('HTTP method'),
              path: field.string().doc('Request path'),
              ip: field.string().optional().doc('Client IP address'),
              userAgent: field.string().optional().doc('User agent string'),
            },
          }),
          completed: event({
            level: 'info',
            message: 'HTTP request completed',
            doc: 'Emitted when the response has been sent',
            fields: {
              statusCode: field.number().doc('HTTP status code'),
              duration: field.number().doc('Request duration in ms'),
            },
          }),
          error: event({
            level: 'error',
            message: 'HTTP request error',
            doc: 'Emitted when the response has a 4xx or 5xx status',
            fields: {
              error: field.error().doc('Error object'),
              statusCode: field.number().optional().doc('HTTP status code'),
            },
          }),
        },
      }),
    },
  ),

  admin: group(
    { doc: 'Administrative and audit trail events' },
    {
      action: event({
        level: 'audit',
        message: 'Administrative action performed',
        doc: 'Emitted for auditable administrative actions',
        fields: {
          action: field.string().doc('Action performed'),
          userId: field.string().doc('User who performed action'),
          resource: field.string().optional().doc('Affected resource'),
          success: field.boolean().doc('Whether action succeeded'),
        },
      }),
      login: event({
        level: 'audit',
        message: 'User login attempt',
        doc: 'Emitted for authentication attempts',
        fields: {
          userId: field.string().doc('User ID'),
          success: field.boolean().doc('Login success'),
          ip: field.string().optional().doc('Client IP'),
        },
      }),
    },
  ),

  business: group(
    { doc: 'Business logic and domain events' },
    {
      userCreated: event({
        level: 'info',
        message: 'User created',
        doc: 'Emitted when a new user is created',
        fields: {
          userId: field.string().doc('New user ID'),
          email: field.string().optional().doc('User email'),
        },
      }),
      dataProcessed: event({
        level: 'info',
        message: 'Data processing completed',
        doc: 'Emitted when background data processing completes',
        fields: {
          recordCount: field.number().doc('Number of records processed'),
          duration: field.number().doc('Processing time in ms'),
          success: field.boolean().doc('Processing success'),
        },
      }),
    },
  ),
});
