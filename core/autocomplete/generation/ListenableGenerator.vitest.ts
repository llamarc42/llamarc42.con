import { afterEach, describe, expect, it, vi } from "vitest";

import { ListenableGenerator } from "./ListenableGenerator";

describe("ListenableGenerator", () => {
  afterEach(() => vi.useRealTimers());
  // Helper function to create an async generator
  async function* asyncGenerator<T>(values: T[], delay = 0) {
    for (const value of values) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      yield value;
    }
  }

  it("should yield values from the source generator via tee()", async () => {
    const values = [1, 2, 3];
    const source = asyncGenerator(values);
    const onError = vi.fn();

    const lg = new ListenableGenerator<number>(
      source,
      onError,
      new AbortController(),
    );

    const result: number[] = [];
    for await (const value of lg.tee()) {
      result.push(value);
    }

    expect(result).toEqual(values);
    expect(onError).not.toHaveBeenCalled();
  });

  it("should allow listeners to receive values", async () => {
    vi.useFakeTimers();
    const values = [1, 2, 3];
    const source = asyncGenerator(values, 10); // Introduce delay to simulate async behavior
    const onError = vi.fn();

    const lg = new ListenableGenerator<number>(
      source,
      onError,
      new AbortController(),
    );

    const listener = vi.fn();

    // Subscribe after the first value, then deterministically finish the source.
    await vi.advanceTimersByTimeAsync(15);
    lg.listen(listener);
    expect(listener.mock.calls).toEqual([[1]]);
    await vi.runAllTimersAsync();

    expect(listener).toHaveBeenCalledWith(1);
    expect(listener).toHaveBeenCalledWith(2);
    expect(listener).toHaveBeenCalledWith(3);
    // Listener should receive null at the end
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("should buffer values for listeners added after some values have been yielded", async () => {
    vi.useFakeTimers();
    const values = [1, 2, 3];
    const source = asyncGenerator(values, 10);
    const onError = vi.fn();

    const lg = new ListenableGenerator<number>(
      source,
      onError,
      new AbortController(),
    );

    const initialListener = vi.fn();

    lg.listen(initialListener);

    // Wait for the first value to be yielded
    await vi.advanceTimersByTimeAsync(15);
    expect(initialListener.mock.calls).toEqual([[1]]);

    // Add a second listener
    const newListener = vi.fn();
    lg.listen(newListener);

    // Wait for generator to finish
    await vi.runAllTimersAsync();

    // Both listeners should have received all values
    [initialListener, newListener].forEach((listener) => {
      expect(listener).toHaveBeenCalledWith(1);
      expect(listener).toHaveBeenCalledWith(2);
      expect(listener).toHaveBeenCalledWith(3);
      expect(listener).toHaveBeenCalledWith(null);
    });
  });

  it("should handle cancellation", async () => {
    const values = [1, 2, 3, 4, 5];
    const source = asyncGenerator(values, 10);
    const onError = vi.fn();

    const lg = new ListenableGenerator<number>(
      source,
      onError,
      new AbortController(),
    );

    const result: number[] = [];
    const teeIterator = lg.tee();

    const consume = async () => {
      for await (const value of teeIterator) {
        result.push(value);
        if (value === 3) {
          lg.cancel();
        }
      }
    };

    await consume();

    expect(result).toEqual([1, 2, 3]);
    expect(lg["_isEnded"]).toBe(true);
  });

  it("should call onError when the source generator throws an error", async () => {
    async function* errorGenerator() {
      yield 1;
      throw new Error("Test error");
    }

    const source = errorGenerator();
    const onError = vi.fn();

    const lg = new ListenableGenerator<number>(
      source,
      onError,
      new AbortController(),
    );

    const result: number[] = [];
    for await (const value of lg.tee()) {
      result.push(value);
    }

    expect(result).toEqual([1]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(new Error("Test error"));
  });

  it("should notify listeners when the generator ends", async () => {
    const values = [1, 2, 3];
    const source = asyncGenerator(values);
    const onError = vi.fn();

    const lg = new ListenableGenerator<number>(
      source,
      onError,
      new AbortController(),
    );

    const listener = vi.fn();
    lg.listen(listener);

    // Wait for the completion signal rather than an assumed wall-clock delay.
    await new Promise<void>((resolve) => {
      lg.listen((value) => {
        if (value === null) resolve();
      });
    });

    expect(listener).toHaveBeenCalledWith(1);
    expect(listener).toHaveBeenCalledWith(2);
    expect(listener).toHaveBeenCalledWith(3);
    expect(listener).toHaveBeenCalledWith(null);
  });
});
