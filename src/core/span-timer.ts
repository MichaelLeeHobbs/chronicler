/**
 * Auto-reset idle timeout for a span.
 * Resets on any activity; invokes the callback if idle for the configured duration.
 */
export class SpanTimer {
  private timeoutId: NodeJS.Timeout | undefined;

  constructor(
    private readonly timeout: number,
    private readonly onTimeout: () => void,
  ) {}

  start(): void {
    this.clear();
    if (this.timeout > 0) {
      this.timeoutId = setTimeout(this.onTimeout, this.timeout);
      this.timeoutId.unref();
    }
  }

  /** Reset the timer (keep-alive on activity). */
  touch(): void {
    this.start();
  }

  clear(): void {
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }
}
