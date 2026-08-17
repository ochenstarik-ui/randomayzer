interface IdempotentResponse {
  statusCode: number;
  body: any;
  createdAt: number;
}

export class IdempotencyStore {
  private static store = new Map<string, IdempotentResponse>();
  private static readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  public static get(key: string): IdempotentResponse | null {
    const cached = this.store.get(key);
    if (!cached) return null;

    if (Date.now() - cached.createdAt > this.TTL_MS) {
      this.store.delete(key);
      return null;
    }

    return cached;
  }

  public static set(key: string, statusCode: number, body: any): void {
    this.store.set(key, {
      statusCode,
      body,
      createdAt: Date.now(),
    });
  }

  public static clear(): void {
    this.store.clear();
  }
}
