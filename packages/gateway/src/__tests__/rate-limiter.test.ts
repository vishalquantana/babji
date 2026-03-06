import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const limiter = new RateLimiter(5, 60_000);

    for (let i = 0; i < 5; i++) {
      expect(limiter.check("user-1").allowed).toBe(true);
    }
  });

  it("blocks requests over the limit", () => {
    const limiter = new RateLimiter(3, 60_000);

    limiter.check("user-1");
    limiter.check("user-1");
    limiter.check("user-1");

    const result = limiter.check("user-1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("resets after the window expires", () => {
    const limiter = new RateLimiter(2, 10_000);

    limiter.check("user-1");
    limiter.check("user-1");

    expect(limiter.check("user-1").allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(10_001);

    expect(limiter.check("user-1").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(false);

    // Different user should still be allowed
    expect(limiter.check("user-2").allowed).toBe(true);
  });

  it("returns retryAfterMs when rate limited", () => {
    const limiter = new RateLimiter(1, 30_000);

    limiter.check("user-1");

    vi.advanceTimersByTime(10_000);

    const result = limiter.check("user-1");
    expect(result.allowed).toBe(false);
    // Should be approximately 20_000ms remaining
    expect(result.retryAfterMs).toBeLessThanOrEqual(20_000);
    expect(result.retryAfterMs).toBeGreaterThan(19_000);
  });

  it("uses default limits when none specified", () => {
    const limiter = new RateLimiter();

    // Should allow up to 30 requests
    for (let i = 0; i < 30; i++) {
      expect(limiter.check("user-1").allowed).toBe(true);
    }

    expect(limiter.check("user-1").allowed).toBe(false);
  });
});
