import { describe, expect, it } from "vitest";
import { Semaphore } from "./semaphore";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("Semaphore", () => {
  it("never exceeds the limit", async () => {
    const sem = new Semaphore(2, 10);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        sem.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(sem.active).toBe(0);
  });

  it("rejects with BUSY when the queue is full", async () => {
    const sem = new Semaphore(1, 1);
    const gate = deferred();
    const first = sem.run(() => gate.promise);
    const second = sem.run(async () => undefined);
    await expect(sem.run(async () => undefined)).rejects.toMatchObject({ code: "BUSY" });
    gate.resolve();
    await Promise.all([first, second]);
  });

  it("removes aborted waiters from the queue", async () => {
    const sem = new Semaphore(1, 5);
    const gate = deferred();
    const first = sem.run(() => gate.promise);
    const controller = new AbortController();
    const waiting = sem.run(async () => "never", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "ABORTED" });
    expect(sem.queued).toBe(0);
    gate.resolve();
    await first;
    expect(sem.active).toBe(0);
  });

  it("releases the slot when the task throws", async () => {
    const sem = new Semaphore(1, 0);
    await expect(sem.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(sem.active).toBe(0);
  });
});
