/** Simple async mutex to serialize access to a shared resource. */
export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.locked = true;
    return () => {
      this.locked = false;
      this.queue.shift()?.();
    };
  }
}
