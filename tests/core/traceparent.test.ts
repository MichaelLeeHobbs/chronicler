import { describe, expect, it } from 'vitest';

import { formatTraceparent, parseTraceparent } from '../../src/core/traceparent';
import { setup } from '../helpers/fixtures';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';
const HEADER = `00-${TRACE}-${PARENT}-01`;

describe('parseTraceparent', () => {
  it('reads the trace and parent span ids', () => {
    expect(parseTraceparent(HEADER)).toEqual({ traceId: TRACE, parentSpanId: PARENT });
    expect(parseTraceparent(` ${HEADER} `)).toEqual({ traceId: TRACE, parentSpanId: PARENT });
  });

  it('accepts future versions with extra fields', () => {
    expect(parseTraceparent(`01-${TRACE}-${PARENT}-00-extra`)).toEqual({
      traceId: TRACE,
      parentSpanId: PARENT,
    });
  });

  it.each([
    ['empty', ''],
    ['garbage', 'not-a-header'],
    ['uppercase', HEADER.toUpperCase()],
    ['short trace id', `00-${TRACE.slice(1)}-${PARENT}-01`],
    ['version ff', `ff-${TRACE}-${PARENT}-01`],
    ['extra data on version 00', `${HEADER}-extra`],
    ['all-zero trace id', `00-${'0'.repeat(32)}-${PARENT}-01`],
    ['all-zero parent id', `00-${TRACE}-${'0'.repeat(16)}-01`],
  ])('rejects %s', (_name, header) => {
    expect(parseTraceparent(header)).toBeUndefined();
  });

  it('round-trips with formatTraceparent', () => {
    expect(formatTraceparent(TRACE, PARENT)).toBe(HEADER);
  });
});

describe('spans and traceparent', () => {
  it('continues the incoming trace in begin()', () => {
    const { mock, chronicle } = setup();
    const req = chronicle.http.request.begin({ requestId: 'r1' }, { traceparent: HEADER });
    req.ping();
    expect(req.traceId).toBe(TRACE);
    for (const p of mock.getPayloads()) {
      expect(p).toMatchObject({ traceId: TRACE, spanId: 'c1', parentSpanId: PARENT });
    }
    expect(mock.findByKey('http.request.start')).not.toHaveProperty('_validation');
    req.complete();
  });

  it('continues the incoming trace in run(context, options, fn)', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run({ requestId: 'r1' }, { traceparent: HEADER }, (req) => {
      chronicle.admin.heartbeat();
      req.complete();
    });
    expect(mock.findByKey('admin.heartbeat')).toMatchObject({
      traceId: TRACE,
      parentSpanId: PARENT,
      metadata: { requestId: 'r1' },
    });
  });

  it('exposes an outgoing traceparent on handles and forks', () => {
    const { chronicle } = setup();
    const req = chronicle.http.request.begin({}, { traceparent: HEADER });
    expect(req.traceparent).toBe(`00-${TRACE}-c1-01`);
    expect(req.fork().traceparent).toBe(req.traceparent);
    req.complete();
  });

  it('ignores an undefined header', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin({}, { traceparent: undefined }).complete();
    expect(mock.findByKey('http.request.start')).toMatchObject({ traceId: 't1', spanId: 'c1' });
    expect(mock.findByKey('http.request.start')).not.toHaveProperty('parentSpanId');
    expect(mock.findByKey('http.request.start')).not.toHaveProperty('_validation');
  });

  it('starts a new trace and flags an invalid header', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.begin({}, { traceparent: 'bogus' }).complete();
    const start = mock.findByKey('http.request.start');
    expect(start).toMatchObject({ traceId: 't1', _validation: { invalidTraceparent: true } });
    expect(start).not.toHaveProperty('parentSpanId');
  });

  it('keeps the local parent for nested spans', () => {
    const { mock, chronicle } = setup();
    chronicle.http.request.run((req) => {
      chronicle.job.batch.begin({}, { traceparent: HEADER }).complete();
      req.complete();
    });
    const start = mock.findByKey('job.batch.start');
    expect(start).toMatchObject({ traceId: 't1', spanId: 'c2', parentSpanId: 'c1' });
    expect(start).not.toHaveProperty('_validation');
  });

  it('requires a function in run()', () => {
    const { chronicle } = setup();
    const starter = chronicle.http.request as unknown as { run: (...args: unknown[]) => unknown };
    expect(() => starter.run({}, { traceparent: HEADER })).toThrow(TypeError);
  });
});
