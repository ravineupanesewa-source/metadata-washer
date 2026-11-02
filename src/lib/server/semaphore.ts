import { AppError } from "../security/errors";

/**
 * Bounded concurrency with a bounded wait queue. When the queue is full,
 * callers get BUSY immediately instead of piling up memory.
 */
export class Semaphore {
  #active = 0;
  readonly #waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  constructor(
    readonly limit: number,
    readonly maxQueue: number,
  ) {}

  get active() {
    return this.#active;
  }

  get queued() {
    return this.#waiters.length;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.#acquire(signal);
    try {
      return await fn();
    } finally {
      this.#release();
    }
  }

  #acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.#active < this.limit) {
      this.#active += 1;
      return Promise.resolve();
    }
    if (this.#waiters.length >= this.maxQueue) return Promise.reject(new AppError("BUSY"));

    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new AppError("ABORTED"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #release() {
    const next = this.#waiters.shift();
    if (next) next.resolve(); // hand the slot over directly
    else this.#active -= 1;
  }
}
