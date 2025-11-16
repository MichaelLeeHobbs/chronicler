# Winston Example App

This example shows how to use Chronicler with **Winston** as the logging backend.

## Prerequisites

- Node 20+
- pnpm

## Install & Run

From the repository root:

```powershell
# install workspace deps and build the chronicler package (exports to dist/)
pnpm install
pnpm -w run build

# run the example
cd examples/winston-app
pnpm install
pnpm run dev
```

You should see JSON logs printed to the console with `payload` containing Chronicler's structured envelope.

## Documentation Generation

Generate event documentation from your event definitions:

```powershell
cd examples/winston-app
pnpm run docs
```

This creates `logs.md` in the example directory with auto-generated documentation for all events, including:

- Event keys, levels, and messages
- Field definitions with types and descriptions
- Auto-events for correlation groups (start, complete, timeout, metadataWarning)

The documentation is configured via `chronicler.config.ts`:

- `eventsFile`: Points to `src/events.ts` where events are defined
- `docs.outputPath`: Sets output to `./logs.md`
- `docs.format`: Uses `'markdown'` (can also be `'json'`)

## Configuration

- `LOG_LEVEL`: Winston logger level (default `info`)
- `NODE_ENV`: appended to metadata (`env`)
- `PORT`: demo port number for `system.startup`

## What's inside

- `WinstonBackend` adapter mapping Chronicler levels to Winston levels
- Typed event definitions in `src/events.ts` (`system`, `api.request`)
- Correlation with auto `start/complete/timeout` events
- Fork demo producing hierarchical `forkId`
- Memory performance sampling (`_perf`)
- CLI config for documentation generation

## Notes

- Keep reserved names out of metadata (e.g., `environment`), use `env` instead
- Error fields use `error` type and are serialized as strings
- For production, add transports like CloudWatch, Loki, or file rotation
- The `logs.md` file is auto-generated and gitignored
