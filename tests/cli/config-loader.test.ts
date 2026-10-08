import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/cli/config-loader';

describe('loadConfig', () => {
  const baseTmp = path.join(__dirname, '../__temp__');
  let dir: string;

  const writeConfig = (body: string) => {
    fs.writeFileSync(path.join(dir, 'chronicler.config.ts'), `export default ${body};\n`);
  };

  beforeEach(() => {
    fs.mkdirSync(baseTmp, { recursive: true });
    dir = fs.mkdtempSync(path.join(baseTmp, 'config-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('applies defaults for docs and keys', async () => {
    writeConfig(`{ eventsFile: './events.ts' }`);

    const config = await loadConfig(dir);

    expect(config.eventsFile).toBe('./events.ts');
    expect(config.eventsExport).toBeUndefined();
    expect(config.docs).toEqual({
      outputPath: './docs/chronicler-events.md',
      format: 'markdown',
      eol: 'lf',
    });
    expect(config.keys).toEqual({ lockfile: 'chronicler.lock.json' });
  });

  it('reads eventsExport and keys.lockfile', async () => {
    writeConfig(
      `{ eventsFile: './events.ts', eventsExport: 'events', keys: { lockfile: 'locks/keys.json' } }`,
    );

    const config = await loadConfig(dir);

    expect(config.eventsExport).toBe('events');
    expect(config.keys?.lockfile).toBe('locks/keys.json');
  });

  it('rejects a non-string eventsExport', async () => {
    writeConfig(`{ eventsFile: './events.ts', eventsExport: 42 }`);

    await expect(loadConfig(dir)).rejects.toThrow(/eventsExport .* must be a string/);
  });
});
