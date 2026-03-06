export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private maxRequests: number = 30,
    private windowMs: number = 60_000,
  ) {}

  check(key: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window || now >= window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }

    if (window.count >= this.maxRequests) {
      return { allowed: false, retryAfterMs: window.resetAt - now };
    }

    window.count++;
    return { allowed: true };
  }
}
