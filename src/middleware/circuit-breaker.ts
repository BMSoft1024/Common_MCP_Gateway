import { getLogger } from '../utils/logger';
import { CircuitBreakerConfig } from '../types/config';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private logger = getLogger();

  constructor(
    private serverId: string,
    private config: CircuitBreakerConfig
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      return await operation();
    }

    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.logger.info({
          message: 'Circuit breaker transitioning to HALF_OPEN',
          serverId: this.serverId,
          previousState: this.state
        });
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        const error = new Error(`Circuit breaker OPEN for ${this.serverId}`);
        error.name = 'CircuitBreakerOpenError';
        throw error;
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 2) {
        this.logger.info({
          message: 'Circuit breaker transitioning to CLOSED',
          serverId: this.serverId,
          previousState: this.state
        });
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.logger.warn({
      message: 'Circuit breaker failure recorded',
      serverId: this.serverId,
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold,
      currentState: this.state
    });

    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.warn({
        message: 'Circuit breaker transitioning to OPEN from HALF_OPEN',
        serverId: this.serverId
      });
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.logger.error({
        message: 'Circuit breaker transitioning to OPEN',
        serverId: this.serverId,
        failureCount: this.failureCount
      });
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.logger.info({
      message: 'Circuit breaker manually reset',
      serverId: this.serverId,
      previousState: this.state
    });
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}
