/**
 * CorrelationTimer manages automatic timeout for correlation groups
 *
 * The timer automatically resets whenever activity occurs (log events, fork creation).
 * If no activity happens within the timeout period, the onTimeout callback is invoked.
 */
export class CorrelationTimer {
  private timeoutId: NodeJS.Timeout | undefined;

  constructor(
    private readonly timeout: number,
    private readonly onTimeout: () => void,
  ) {}

  /**
   * Start or restart the timeout timer
   * Automatically clears any existing timer to prevent leaks
   */
  start(): void {
    this.clear();
    if (this.timeout > 0) {
      this.timeoutId = setTimeout(this.onTimeout, this.timeout);
    }
  }

  /**
   * Reset the timer (called on any activity)
   * This is the auto-reset mechanism that prevents spurious timeouts
   */
  touch(): void {
    this.start();
  }

  /**
   * Clear the timer without invoking the callback
   */
  clear(): void {
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }
}
