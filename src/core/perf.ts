import type { PerformanceSample } from './backend';

export interface PerfOptions {
  memory?: boolean;
}

const canSampleMemory = typeof process !== 'undefined' && typeof process.memoryUsage === 'function';

export const samplePerformance = (options: PerfOptions): PerformanceSample | undefined => {
  if (!options.memory || !canSampleMemory) {
    return undefined;
  }

  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    rss: usage.rss,
  };
};
