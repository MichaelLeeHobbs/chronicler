import type { PerformanceSample } from './backend';
import { MICROSECONDS_TO_MS } from './constants';

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
 * **Memory Monitoring:**
 * - Captures current heap and RSS usage from Node.js
 * - No state required - always returns current values
 * - Safe on all platforms where Node.js runs
 *
 * **CPU Monitoring:**
 * - Tracks CPU time delta since last measurement
 * - Requires PerfContext to store last measurement baseline
 * - First call returns total usage, subsequent calls return deltas
 * - Wrapped in try-catch for platform compatibility
 * - Returns undefined on platforms without process.cpuUsage()
 *
 * **Why return undefined?**
 * Logs should succeed even if performance monitoring fails. The _perf field
 * is optional in the payload, so undefined means "no perf data available".
 *
 * @param options - What to sample (memory, cpu)
 * @param context - Performance context for this chronicle instance (required for CPU tracking)
 * @returns Performance sample or undefined if nothing to sample / monitoring unavailable
 *
 * @example
 * ```typescript
 * const perfContext: PerfContext = {};
 * const sample = samplePerformance({ memory: true, cpu: true }, perfContext);
 * // First call: { heapUsed: 12000000, ..., cpuUser: 150.2, cpuSystem: 45.1 }
 * // Second call: { heapUsed: 13000000, ..., cpuUser: 10.5, cpuSystem: 2.3 } (delta!)
 * ```
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
    sample.cpuUser = currentCpuUsage.user / MICROSECONDS_TO_MS;
    sample.cpuSystem = currentCpuUsage.system / MICROSECONDS_TO_MS;
  }

  return sample;
};
