/** Bound expensive decoding across all callers, including simultaneous keyboard and transport requests. */
export class AsyncLimiter {
  private active = 0;
  private queue: { priority: number; start: () => void }[] = [];
  constructor(private limit: number) {}
  run<T>(work: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = {
        priority,
        start: () => {
          this.active++;
          void Promise.resolve()
            .then(work)
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              this.drain();
            });
        },
      };
      const index = this.queue.findIndex((item) => item.priority < priority);
      if (index < 0) this.queue.push(task);
      else this.queue.splice(index, 0, task);
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.limit && this.queue.length)
      this.queue.shift()!.start();
  }
}
