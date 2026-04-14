import { describe, it, expect } from "vitest";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests within the limit", async () => {
    const limiter = new RateLimiter(100);
    // Should not throw or block significantly
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // Should be nearly instant
  });

  it("delays when bucket is empty", async () => {
    const limiter = new RateLimiter(600); // 600 per minute = 10/sec
    // Drain the bucket
    for (let i = 0; i < 600; i++) {
      await limiter.acquire();
    }
    // Next request should wait ~100ms for a token
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
  }, 10000);

  it("backoff drains tokens and waits", async () => {
    const limiter = new RateLimiter(100);
    const start = Date.now();
    await limiter.backoff(100); // 100ms backoff
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });
});
