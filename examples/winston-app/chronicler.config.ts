import type { ChroniclerCliConfig } from '@ubercode/chronicler';

const config: ChroniclerCliConfig = {
  eventsFile: './src/events.ts',
  docs: {
    // Example overrides for documentation generation output
    outputPath: './logs.md',
    format: 'markdown',
  },
};

export default config;
