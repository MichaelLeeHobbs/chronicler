# CloudWatch Logs Insights Cookbook

These queries assume Chronicler emits structured JSON logs with top-level fields like:

- eventKey, level, message
- correlationId, forkId
- timestamp
- metadata (object)
- fields (object)
- \_validation (object, optional)
- \_perf (object, optional)

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

Metadata collisions:

```
fields @timestamp, eventKey, _validation.contextCollisions
| filter ispresent(_validation.contextCollisions)
| sort @timestamp desc
```

## Performance Metrics

Memory high-water emitters (requires monitoring.memory):

```
fields @timestamp, eventKey, _perf.heapUsed, _perf.rss
| filter ispresent(_perf.heapUsed)
| sort _perf.heapUsed desc
| limit 100
```

CPU heavy events (requires monitoring.cpu):

```
fields @timestamp, eventKey, _perf.cpuUser, _perf.cpuSystem
| filter ispresent(_perf.cpuUser)
| sort _perf.cpuUser desc
| limit 100
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

## Reserved-Field Mistakes

Detect attempted use of reserved top-level names in metadata (blocked):

- Not logged directly. Instead, look for `api.request.metadataWarning` auto-events with attemptedKey, existingValue, attemptedValue in fields.

```
fields @timestamp, eventKey, fields.attemptedKey, fields.existingValue, fields.attemptedValue
| filter eventKey like /\.metadataWarning$/
| sort @timestamp desc
```
