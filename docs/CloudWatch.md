# CloudWatch Logs Insights Cookbook

These queries assume Chronicler emits structured JSON logs with top-level fields like:

- eventKey, level, message
- correlationId, forkId
- parentCorrelationId (nested correlations only), rootCorrelationId (any correlated event)
- correlationState (only on events logged after the correlation timed out, completed or failed)
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

Find errors with correlationId:

```
fields @timestamp, eventKey, message, correlationId
| filter level in ['error','critical','fatal']
| filter correlationId = 'abc-123'
| sort @timestamp asc
```

## Correlations

All events for a correlation in order with durations:

```
fields @timestamp, eventKey, message, correlationId, fields.duration
| filter correlationId = 'abc-123'
| sort @timestamp asc
```

List slow completes (> 2s):

```
fields @timestamp, eventKey, correlationId, fields.duration
| filter eventKey like /\.complete$/
| filter ispresent(fields.duration) and fields.duration > 2000
| sort fields.duration desc
| limit 100
```

Find timeouts:

```
fields @timestamp, eventKey, correlationId
| filter eventKey like /\.timeout$/
| sort @timestamp desc
```

A whole request, including correlations nested inside it (database queries, jobs it started):

```
fields @timestamp, eventKey, correlationId, parentCorrelationId, forkId
| filter rootCorrelationId = 'abc-123'
| sort @timestamp asc
```

Events logged after their correlation ended (work outliving a timeout, or forks used after `complete()`):

```
fields @timestamp, eventKey, correlationId, correlationState
| filter ispresent(correlationState)
| stats count() by eventKey, correlationState
```

Leaked ambient work: events whose ambient correlation had already finished, so they were logged outside it. Wrap the code that logs them in `chronicle.run(...)`:

```
fields @timestamp, eventKey, _validation.staleCorrelationId
| filter ispresent(_validation.staleCorrelationId)
| stats count() by eventKey
```

Correlations started past `limits.maxActiveCorrelations` (often correlations that are never completed):

```
fields @timestamp, eventKey
| filter ispresent(_validation.correlationLimitExceeded)
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
| filter correlationId = 'abc-123' and forkId like /^1(\.|$)/
| sort @timestamp asc
```
