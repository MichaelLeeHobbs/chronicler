# CloudWatch Logs Insights Cookbook

These queries assume Chronicler emits structured JSON logs with top-level fields like:

- eventKey, level, message
- traceId, spanId (events logged inside a span; W3C hex ids), forkId
- parentSpanId (nested spans, or spans continuing an incoming `traceparent`)
- spanState (only on events logged after the span timed out, completed or failed)
- timestamp
- metadata (object)
- fields (object)
- \_validation (object, optional)

If your ingestion flattens objects, adapt field paths accordingly.

## Basics

List newest logs for a service:

```
fields @timestamp, eventKey, level, message
| filter metadata.service = 'api'
| sort @timestamp desc
| limit 50
```

Find errors in one request (trace):

```
fields @timestamp, eventKey, message, spanId
| filter level in ['error','critical','fatal']
| filter traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
| sort @timestamp asc
```

## Spans

All events for a span in order with durations:

```
fields @timestamp, eventKey, message, spanId, fields.duration
| filter spanId = '00f067aa0ba902b7'
| sort @timestamp asc
```

List slow completes (> 2s):

```
fields @timestamp, eventKey, spanId, fields.duration
| filter eventKey like /\.complete$/
| filter ispresent(fields.duration) and fields.duration > 2000
| sort fields.duration desc
| limit 100
```

Find timeouts:

```
fields @timestamp, eventKey, spanId
| filter eventKey like /\.timeout$/
| sort @timestamp desc
```

A whole request, including spans nested inside it (database queries, jobs it started):

```
fields @timestamp, eventKey, spanId, parentSpanId, forkId
| filter traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
| sort @timestamp asc
```

Events logged after their span ended (work outliving a timeout, or forks used after `complete()`):

```
fields @timestamp, eventKey, spanId, spanState
| filter ispresent(spanState)
| stats count() by eventKey, spanState
```

Leaked ambient work: events whose ambient span had already finished, so they were logged outside it. Wrap the code that logs them in `chronicle.run(...)`:

```
fields @timestamp, eventKey, _validation.staleSpanId
| filter ispresent(_validation.staleSpanId)
| stats count() by eventKey
```

Spans started past `limits.maxActiveSpans` (often spans that are never completed):

```
fields @timestamp, eventKey
| filter ispresent(_validation.spanLimitExceeded)
| stats count() by eventKey
```

Spans that received an invalid `traceparent` header:

```
fields @timestamp, eventKey
| filter ispresent(_validation.invalidTraceparent)
| stats count() by eventKey
```

## Field Validation

Missing required fields:

```
fields @timestamp, eventKey, _validation.missingFields, fields
| filter ispresent(_validation.missingFields)
| sort @timestamp desc
```

Type errors:

```
fields @timestamp, eventKey, _validation.typeErrors, fields
| filter ispresent(_validation.typeErrors)
| sort @timestamp desc
```

Values outside an enum (and other invalid values):

```
fields @timestamp, eventKey, _validation.invalidValues
| filter ispresent(_validation.invalidValues)
| stats count() by eventKey
```

Truncated arrays (raise `limits.maxArrayLength` or log less):

```
fields @timestamp, eventKey, _validation.truncatedFields
| filter ispresent(_validation.truncatedFields)
| stats count() by eventKey
```

## Audit & Levels

Audits in the last day:

```
fields @timestamp, eventKey, message
| filter level = 'audit'
| sort @timestamp desc
```

Top error event keys:

```
stats count() by eventKey
| filter level = 'error'
| sort count() desc
| limit 20
```

## Forks & Parallelism

Find logs from a specific fork:

```
fields @timestamp, eventKey, forkId
| filter spanId = '00f067aa0ba902b7' and forkId like /^1(\.|$)/
| sort @timestamp asc
```
