import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorrelationTimer } from '../../src/core/CorrelationTimer';

describe('CorrelationTimer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls .unref() on the timeout handle', () => {
    const unrefSpy = vi.fn();
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue({
      unref: unrefSpy,
      [Symbol.dispose]: vi.fn(),
    } as unknown as NodeJS.Timeout);

    const timer = new CorrelationTimer(5000, vi.fn());
    timer.start();

    expect(unrefSpy).toHaveBeenCalledOnce();
    timer.clear();
  });

  it('invokes onTimeout callback when timer expires', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timer = new CorrelationTimer(100, onTimeout);

    timer.start();
    vi.advanceTimersByTime(100);

    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('resets timer on touch()', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timer = new CorrelationTimer(100, onTimeout);

    timer.start();
    vi.advanceTimersByTime(80);
    timer.touch();
    vi.advanceTimersByTime(80);

    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('does not start timer when timeout is 0', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timer = new CorrelationTimer(0, onTimeout);

    timer.start();
    vi.advanceTimersByTime(10000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clear() prevents callback', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timer = new CorrelationTimer(100, onTimeout);

    timer.start();
    timer.clear();
    vi.advanceTimersByTime(200);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
