# @ubercode/chronicler-cli

Command-line tool for [Chronicler](https://github.com/MichaelLeeHobbs/chronicler). It validates event definitions and generates event documentation.

The CLI is published separately so that `@ubercode/chronicler` has no runtime dependencies. Install it as a devDependency next to the library:

```bash
npm install @ubercode/chronicler
npm install --save-dev @ubercode/chronicler-cli
```

```bash
# Validate all event definitions
npx chronicler validate

# Generate Markdown docs
npx chronicler docs --format markdown --output docs/events.md
```

See the [main README](https://github.com/MichaelLeeHobbs/chronicler#cli) for the `chronicler.config.ts` format and all options.
