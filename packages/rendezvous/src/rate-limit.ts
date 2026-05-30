// Rate limiter — sliding window for invite_create per IP.
//
// Only max_invites_per_ip_per_hour is config-specified.
// Other rate limits (register, lookup, invite_redeem, notify): no thresholds yet.
// TODO: BACKLOG T-12 "M2 known unknowns #4: rate limit thresholds"
//
// @telos facts/rendezvous-server-config.md

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private counters = new Map<string, { windowStart: number; count: number }>();

  constructor(maxPerHour: number) {
    this.maxRequests = maxPerHour;
    this.windowMs = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Check if a request from ip is allowed.
   * Returns true if allowed, false if rate limited.
   */
  check(ip: string): boolean {
    const now = Date.now();
    const entry = this.counters.get(ip);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      // New window
      this.counters.set(ip, { windowStart: now, count: 1 });

      // Cleanup old entries periodically
      if (Math.random() < 0.01) this.cleanup();
      return true;
    }

    if (entry.count >= this.maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  /** Access current count for an IP (for testing). */
  getCount(ip: string): number {
    const entry = this.counters.get(ip);
    if (!entry) return 0;
    return entry.count;
  }

  /** Reset all counters (for testing). */
  reset(): void {
    this.counters.clear();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [ip, entry] of this.counters) {
      if (entry.windowStart < cutoff) {
        this.counters.delete(ip);
      }
    }
  }
}
