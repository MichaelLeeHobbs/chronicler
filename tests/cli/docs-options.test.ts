import { describe, expect, it } from 'vitest';

import type { ChroniclerCliConfig } from '../../src/cli/config';
import { resolveDocsOptions } from '../../src/cli/docs-options';

describe('resolveDocsOptions', () => {
  it('preserves docs.eol from config (regression for #7: CLI dropped eol)', () => {
    const config: ChroniclerCliConfig = {
      eventsFile: './src/events.ts',
      docs: {
        format: 'markdown',
        outputPath: './docs/chronicler-events.md',
        eol: 'crlf',
      },
    };

    // Mirror the real CLI invocation: commander supplies the default --format.
    const resolved = resolveDocsOptions(config, { format: 'markdown' });

    expect(resolved.eol).toBe('crlf');
  });

  it('keeps eol while applying CLI format/output overrides', () => {
    const config: ChroniclerCliConfig = {
      eventsFile: './src/events.ts',
      docs: {
        format: 'markdown',
        outputPath: './docs/chronicler-events.md',
        eol: 'crlf',
      },
    };

    const resolved = resolveDocsOptions(config, {
      format: 'json',
      output: './out/events.json',
    });

    expect(resolved.eol).toBe('crlf');
    expect(resolved.format).toBe('json');
    expect(resolved.outputPath).toBe('./out/events.json');
  });

  it('falls back to defaults when docs config is absent', () => {
    const config: ChroniclerCliConfig = { eventsFile: './src/events.ts' };

    const resolved = resolveDocsOptions(config, {});

    expect(resolved.format).toBe('markdown');
    expect(resolved.outputPath).toBe('./docs/chronicler-events.md');
    expect(resolved.eol).toBeUndefined();
  });

  it('uses config format/outputPath when no CLI flags are given', () => {
    const config: ChroniclerCliConfig = {
      eventsFile: './src/events.ts',
      docs: { format: 'json', outputPath: './custom/events.json', eol: 'lf' },
    };

    const resolved = resolveDocsOptions(config, {});

    expect(resolved.format).toBe('json');
    expect(resolved.outputPath).toBe('./custom/events.json');
    expect(resolved.eol).toBe('lf');
  });

  it('throws on an invalid format', () => {
    const config: ChroniclerCliConfig = { eventsFile: './src/events.ts' };

    expect(() => resolveDocsOptions(config, { format: 'yaml' })).toThrow(/Invalid format "yaml"/);
  });
});
