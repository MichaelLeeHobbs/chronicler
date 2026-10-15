# @ubercode/chronicler-cli

Command-line tool for [Chronicler](https://github.com/MichaelLeeHobbs/chronicler). It validates event catalogs, generates event documentation, and keeps a lockfile of event keys so accidental key changes fail CI.

The CLI is published separately so that `@ubercode/chronicler` has no runtime dependencies. Install it as a devDependency next to the library (Chronicler 2.0 or later):

```bash
npm install @ubercode/chronicler
npm install --save-dev @ubercode/chronicler-cli
```

```bash
# Validate the event catalog
npx chronicler validate

# Generate Markdown docs
npx chronicler docs --format markdown --output docs/events.md

# Lock every event key, then fail CI when one is removed or changed
npx chronicler keys --write
npx chronicler keys --check
```

## Configuration

Create a `chronicler.config.ts` in your project root:

```ts
export default {
  eventsFile: './src/events.ts',
  eventsExport: 'events',
  docs: { format: 'markdown', outputPath: './docs/events.md', eol: 'lf' },
  keys: { lockfile: 'chronicler.lock.json' },
};
```

| Option            | Default                         | Description                                                                                                                              |
| ----------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `eventsFile`      | _required_                      | The module that exports your catalog, relative to the config file.                                                                       |
| `eventsExport`    | all root catalogs               | Name of the export holding the `defineEvents()` catalog. Without it, every exported catalog is used, except catalogs mounted in another. |
| `docs.format`     | `'markdown'`                    | `'markdown'` or `'json'`.                                                                                                                |
| `docs.outputPath` | `'./docs/chronicler-events.md'` | Where `docs` writes. Must stay inside the current directory.                                                                             |
| `docs.eol`        | `'lf'`                          | Line endings of generated files (docs and the key lockfile): `'lf'` or `'crlf'`.                                                         |
| `keys.lockfile`   | `'chronicler.lock.json'`        | Key lockfile path, relative to the config file.                                                                                          |

Every command accepts `--config <path>` to use a config file elsewhere.

The events module is compiled with esbuild and imported, so it runs like normal code. The CLI finds catalogs through markers that work across package copies, so the catalog may import `@ubercode/chronicler` from your own `node_modules`.

## Commands

### `chronicler validate`

Loads the catalog and reports:

- `invalid-catalog`: `defineEvents()` rejected the catalog (reserved or non-camelCase names, invalid levels or timeouts, a correlation inside a correlation, duplicate keys, an `undefined` entry from a circular import)
- `parse-error`: no catalog is exported, or `eventsExport` names a missing or non-catalog export
- `duplicate-key`: two exported catalogs define the same key
- `missing-doc`: an event has no `doc`
- `reserved-field`: a field name collides with a payload field (`eventKey`, `correlationId`, `fields`, ...)
- `reserved-prefix`: an event or correlation key starts with `chronicler.`
- `invalid-level`, `invalid-timeout`

Options: `--verbose`, `--json`. Exits 1 when anything is reported.

### `chronicler docs`

Writes Markdown or JSON documentation: namespaces (with their `group()` docs), correlations (timeout, doc, and auto-generated `.start` / `.complete` / `.fail` / `.timeout` events), and every event with its level, message, doc and fields. Events at the catalog root are listed under "Standalone Events".

Options: `-f, --format <markdown|json>`, `-o, --output <path>`. Validation problems are printed as warnings; docs are still generated.

### `chronicler keys`

Event keys come from catalog paths, so renaming or moving an event changes its key and quietly breaks dashboards and alerts. `chronicler keys` records every key in a lockfile, including correlation lifecycle keys, with each key's level and fields.

```bash
chronicler keys            # list keys, levels and fields
chronicler keys --write    # write chronicler.lock.json
chronicler keys --check    # compare the catalog with chronicler.lock.json
chronicler keys --check --json
```

`--check` exits 1 when a key was **removed**, or when a key's **level** changed or a field was **removed** or changed **type** or **required-ness**. A rename shows up as one key removed and one added. **Added** keys and **added** fields are reported but pass. To keep a key stable across a rename, set the `key` option on the event or correlation; to accept the change, run `--write` again and commit the lockfile.

```text
❌ Event keys changed since chronicler.lock.json was written:

Breaking changes:
  removed: user.signIn
  changed: http.request.received (level info → debug; field "ip": string, optional → string)
Non-breaking changes:
  added: user.login
```

The lockfile is sorted JSON, so it diffs cleanly in review:

```json
{
  "version": 1,
  "events": {
    "http.request.complete": {
      "level": "info",
      "fields": {
        "duration": {
          "type": "number",
          "required": false
        }
      }
    }
  }
}
```

With `--json`, `--check` prints `{ success, lockfile, added, removed, changed, extended, errors }` and `--write` prints `{ success, lockfile, keyCount }`. The command exits 1 without touching the lockfile when the catalog cannot be loaded.
