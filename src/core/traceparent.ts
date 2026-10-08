/**
 * W3C Trace Context `traceparent` headers: `00-<trace id>-<parent span id>-<flags>`.
 * https://www.w3.org/TR/trace-context/#traceparent-header
 */

/** The trace and parent span ids carried by a `traceparent` header. */
export interface TraceParent {
  readonly traceId: string;
  readonly parentSpanId: string;
}

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ALL_ZEROS_RE = /^0+$/;

/**
 * Parse a `traceparent` header. Returns `undefined` for anything the spec says to ignore:
 * malformed values, version `ff`, extra data after a version `00` header, and all-zero ids.
 */
export const parseTraceparent = (header: string): TraceParent | undefined => {
  const match = TRACEPARENT_RE.exec(header.trim());
  if (match === null) return undefined;
  const [, version, traceId, parentSpanId, , rest] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string | undefined,
  ];
  if (version === 'ff' || (version === '00' && rest !== undefined)) return undefined;
  if (ALL_ZEROS_RE.test(traceId) || ALL_ZEROS_RE.test(parentSpanId)) return undefined;
  return { traceId, parentSpanId };
};

/** Format a version `00` `traceparent` header for the given span, flagged as sampled. */
export const formatTraceparent = (traceId: string, spanId: string): string =>
  `00-${traceId}-${spanId}-01`;
