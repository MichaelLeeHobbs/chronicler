import type { ChroniclerCliConfig } from '../../src/cli/config';

const config: ChroniclerCliConfig = {
  eventsFile: './src/events.ts',
  docs: {
    outputPath: './logs.md',
    format: 'markdown',
  },
};

export default config;
