import type { PerformanceSample } from './backend';

export interface PerfOptions {
  memory?: boolean;
  cpu?: boolean;
}

const canSampleMemory = typeof process !== 'undefined' && typeof process.memoryUsage === 'function';
const canSampleCpu = typeof process !== 'undefined' && typeof process.cpuUsage === 'function';

// Track previous CPU usage for delta calculation
let previousCpuUsage: NodeJS.CpuUsage | undefined;

export const samplePerformance = (options: PerfOptions): PerformanceSample | undefined => {
  const shouldSampleMemory = options.memory && canSampleMemory;
  const shouldSampleCpu = options.cpu && canSampleCpu;

  if (!shouldSampleMemory && !shouldSampleCpu) {
    return undefined;
  }

  const sample: PerformanceSample = {
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    rss: 0,
  };

  if (shouldSampleMemory) {
    const usage = process.memoryUsage();
    sample.heapUsed = usage.heapUsed;
    sample.heapTotal = usage.heapTotal;
    sample.external = usage.external;
    sample.rss = usage.rss;
  }

  if (shouldSampleCpu) {
    const currentCpuUsage = process.cpuUsage(previousCpuUsage);
    previousCpuUsage = process.cpuUsage(); // Update for next measurement

    // Convert from microseconds to milliseconds
    sample.cpuUser = currentCpuUsage.user / 1000;
    sample.cpuSystem = currentCpuUsage.system / 1000;
  }

  return sample;
};
