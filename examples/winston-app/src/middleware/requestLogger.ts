/**
 * HTTP request logging middleware
 * Runs every request inside an ambient `http.request` span
 */

import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { http } from '../services/chronicler.js';

/**
 * Request logger middleware
 *
 * `http.request.run()` starts the span and makes it ambient for everything downstream,
 * including async handlers. Controllers call `admin.login(...)` etc. and their events carry
 * this request's trace id without receiving anything from the request object.
 *
 * `run()` never completes the span on its own (the response is sent later), so it is
 * completed when the response finishes. If the client disconnects first, it is failed.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = req.get('x-request-id') ?? `req-${randomUUID()}`;

  // Continue the caller's trace when it sent a W3C traceparent header
  http.request.run({ requestId }, { traceparent: req.get('traceparent') }, (request) => {
    const startTime = Date.now();

    request.started({
      method: req.method,
      path: req.path,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('user-agent') ?? 'unknown',
    });

    // Let clients quote the trace id in bug reports
    res.setHeader('x-trace-id', request.traceId);

    res.on('finish', () => {
      if (res.statusCode >= 400) {
        request.error({
          error: new Error(`HTTP ${res.statusCode}: ${req.path}`),
          statusCode: res.statusCode,
        });
      }

      request.completed({
        statusCode: res.statusCode,
        duration: Date.now() - startTime,
      });

      request.complete();
    });

    // 'close' also fires after 'finish'; only a connection closed before the response was sent
    // fails the span (a second complete()/fail() is ignored anyway).
    res.on('close', () => {
      if (!res.writableFinished) {
        request.fail(new Error('Client closed the connection before the response was sent'));
      }
    });

    next();
  });
}
