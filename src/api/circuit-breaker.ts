/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Circuit breaker pattern for API resilience.
 *
 * Prevents cascading failures when the Resideo / Honeywell Home API is down:
 * after a threshold of service-health failures the breaker opens, subsequent
 * requests fail fast until a cooldown elapses, then a limited half-open probe
 * decides whether to close again or stay open.
 */

import { CircuitBreakerError } from '../errors'

/** Circuit breaker states. */
export enum CircuitState {
  /** Normal operation — requests flow through. */
  CLOSED = 'CLOSED',
  /** Circuit tripped — requests fail immediately. */
  OPEN = 'OPEN',
  /** Testing whether the service recovered. */
  HALF_OPEN = 'HALF_OPEN',
}

/** Circuit breaker configuration. */
export interface CircuitBreakerConfig {
  /** Number of failures within the window before opening the circuit. */
  failureThreshold: number
  /** Time in ms before trying half-open after opening. */
  resetTimeout: number
  /** Max concurrent probe requests allowed in half-open state. */
  halfOpenMax: number
  /** Sliding window (ms) for counting failures. */
  failureWindow?: number
  /**
   * Invoked whenever the circuit transitions between states. Used for
   * observability so operators can see when the breaker opens or recovers.
   */
  onStateChange?: (from: CircuitState, to: CircuitState) => void
}

/**
 * Default circuit breaker configuration.
 *
 * `halfOpenMax` is 1 on purpose for this plugin: device polls run with bounded
 * concurrency, and overlapping half-open probes can race (one failure re-opens
 * while another success is still in flight). A single probe keeps recovery
 * deterministic.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30_000,
  halfOpenMax: 1,
  failureWindow: 60_000,
}

/** Circuit breaker status snapshot. */
export interface CircuitBreakerStatus {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number | null
  halfOpenRequests: number
  isOpen: boolean
  remainingResetTime: number | null
}

/**
 * Circuit breaker for API resilience.
 * Prevents hammering the Resideo API when it is returning sustained failures.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number
  private readonly resetTimeout: number
  private readonly halfOpenMax: number
  private readonly failureWindow: number
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void

  private _state: CircuitState = CircuitState.CLOSED
  private failures = 0
  private successes = 0
  private lastFailureTime: number | null = null
  private halfOpenRequests = 0
  private failureTimestamps: number[] = []

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    const merged = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config }
    this.failureThreshold = merged.failureThreshold
    this.resetTimeout = merged.resetTimeout
    this.halfOpenMax = merged.halfOpenMax
    this.failureWindow = merged.failureWindow ?? 60_000
    this.onStateChange = merged.onStateChange
  }

  /** Current circuit state. */
  get state(): CircuitState {
    return this._state
  }

  /** True when the circuit is open (requests should fail fast). */
  get isOpen(): boolean {
    return this._state === CircuitState.OPEN
  }

  /**
   * Transition to a new state, notifying observers only on an actual change.
   */
  private transitionTo(next: CircuitState): void {
    if (this._state === next) {
      return
    }
    const previous = this._state
    this._state = next
    this.onStateChange?.(previous, next)
  }

  /** Drop failure timestamps that fall outside the sliding window. */
  private cleanupFailures(): void {
    const cutoff = Date.now() - this.failureWindow
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts > cutoff)
    this.failures = this.failureTimestamps.length
  }

  /** Whether the circuit currently allows a request through. */
  canRequest(): boolean {
    if (this._state === CircuitState.CLOSED) {
      return true
    }

    if (this._state === CircuitState.OPEN) {
      if (this.lastFailureTime && (Date.now() - this.lastFailureTime) >= this.resetTimeout) {
        this.halfOpenRequests = 0
        this.successes = 0
        this.transitionTo(CircuitState.HALF_OPEN)
        return true
      }
      return false
    }

    if (this._state === CircuitState.HALF_OPEN) {
      return this.halfOpenRequests < this.halfOpenMax
    }

    return false
  }

  /** Record a successful request. */
  recordSuccess(): void {
    if (this._state === CircuitState.HALF_OPEN) {
      this.successes++
      if (this.successes >= this.halfOpenMax) {
        this.reset()
      }
    } else if (this._state === CircuitState.OPEN) {
      // A request that was already in flight when the breaker re-opened still
      // proves the service is reachable — close immediately rather than waiting
      // out the full cooldown.
      this.reset()
    } else if (this._state === CircuitState.CLOSED) {
      this.cleanupFailures()
    }
  }

  /** Record a failed request that reflects service health. */
  recordFailure(): void {
    // Already open: ignore late failures from overlapping half-open probes so
    // they cannot keep pushing lastFailureTime forward and extend the cooldown.
    if (this._state === CircuitState.OPEN) {
      return
    }

    const now = Date.now()
    this.lastFailureTime = now
    this.failureTimestamps.push(now)

    if (this._state === CircuitState.HALF_OPEN) {
      this.halfOpenRequests = 0
      this.successes = 0
      this.transitionTo(CircuitState.OPEN)
    } else if (this._state === CircuitState.CLOSED) {
      this.cleanupFailures()
      if (this.failures >= this.failureThreshold) {
        this.transitionTo(CircuitState.OPEN)
      }
    }
  }

  /** Track a half-open probe request against the concurrency cap. */
  trackHalfOpenRequest(): void {
    if (this._state === CircuitState.HALF_OPEN) {
      this.halfOpenRequests++
    }
  }

  /** Reset the circuit breaker to closed state. */
  reset(): void {
    this.failures = 0
    this.successes = 0
    this.lastFailureTime = null
    this.halfOpenRequests = 0
    this.failureTimestamps = []
    this.transitionTo(CircuitState.CLOSED)
  }

  /** Current circuit breaker status. */
  getStatus(): CircuitBreakerStatus {
    const now = Date.now()
    let remainingResetTime: number | null = null

    if (this._state === CircuitState.OPEN && this.lastFailureTime) {
      remainingResetTime = Math.max(0, this.resetTimeout - (now - this.lastFailureTime))
    }

    return {
      state: this._state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      halfOpenRequests: this.halfOpenRequests,
      isOpen: this.isOpen,
      remainingResetTime,
    }
  }

  /**
   * Execute a function with circuit breaker protection.
   *
   * @param isFailure Optional predicate controlling which thrown errors count
   *   as service-health failures while CLOSED. Defaults to treating every
   *   rejection as a failure. The Resideo API client uses a narrower predicate
   *   (5xx/network/timeout/parse) via its own gate; prefer that for HTTP calls.
   *   While HALF_OPEN, every terminal rejection still re-opens the breaker so
   *   the probe slot cannot wedge.
   */
  async execute<T>(
    fn: () => Promise<T>,
    isFailure: (error: unknown) => boolean = () => true,
  ): Promise<T> {
    if (!this.canRequest()) {
      const status = this.getStatus()
      throw new CircuitBreakerError(status.remainingResetTime ?? this.resetTimeout)
    }

    if (this._state === CircuitState.HALF_OPEN) {
      this.trackHalfOpenRequest()
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (error) {
      if (this._state === CircuitState.HALF_OPEN || isFailure(error)) {
        this.recordFailure()
      }
      throw error
    }
  }

  /** Create a wrapped version of a function with circuit breaker protection. */
  wrap<T extends unknown[], R>(
    fn: (...args: T) => Promise<R>,
    isFailure?: (error: unknown) => boolean,
  ): (...args: T) => Promise<R> {
    return (...args: T) => this.execute(() => fn(...args), isFailure)
  }
}
