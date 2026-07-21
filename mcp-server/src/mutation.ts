export function createKeyedMutationLock() {
  const locks = new Map<string, Promise<void>>();

  return async function withMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    locks.set(key, queued);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(key) === queued) locks.delete(key);
    }
  };
}
