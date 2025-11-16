import type { PerformanceSample } from './backend';

export interface PerfOptions {
  memory?: boolean;
  cpu?: boolean;
}

/**
 * Performance sampling context for a Chronicle instance
 * Tracks CPU usage baseline for delta calculations
 */
export interface PerfContext {
  lastCpuUsage?: NodeJS.CpuUsage;
}

const canSampleMemory = typeof process !== 'undefined' && typeof process.memoryUsage === 'function';
const canSampleCpu = typeof process !== 'undefined' && typeof process.cpuUsage === 'function';

/**
 * Sample performance metrics (memory and/or CPU)
 *
 * @param options - What to sample (memory, cpu)
 * @param context - Performance context for this chronicle instance (required for CPU tracking)
 * @returns Performance sample or undefined if nothing to sample
 */
export const samplePerformance = (
  options: PerfOptions,
  context?: PerfContext,
): PerformanceSample | undefined => {
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

  if (shouldSampleCpu && context) {
    // Calculate CPU delta from last measurement
    const currentCpuUsage = process.cpuUsage(context.lastCpuUsage);

    // Update context for next measurement
    context.lastCpuUsage = process.cpuUsage();

    // Convert from microseconds to milliseconds
    sample.cpuUser = currentCpuUsage.user / 1000;
    sample.cpuSystem = currentCpuUsage.system / 1000;
  }

  return sample;
};
