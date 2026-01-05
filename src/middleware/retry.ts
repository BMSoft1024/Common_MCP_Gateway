import { getLogger } from '../utils/logger';

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay?: number;
}

export class RetryEngine {
  private logger = getLogger();

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions,
    context: { requestId: string; serverId: string; tool: string }
  ): Promise<T> {
    const { maxAttempts, baseDelay, maxDelay = 30000 } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.info({
            message: 'Retrying operation',
            ...context,
            attempt: attempt + 1,
            maxAttempts
          });
        }

        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxAttempts - 1) {
          this.logger.error({
            message: 'All retry attempts failed',
            ...context,
            attempts: maxAttempts,
            error: lastError.message
          });
          throw lastError;
        }

        const delay = this.calculateDelay(attempt, baseDelay, maxDelay);
        
        this.logger.warn({
          message: 'Operation failed, retrying',
          ...context,
          attempt: attempt + 1,
          maxAttempts,
          delay,
          error: lastError.message
        });

        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Retry logic failed unexpectedly');
  }

  private calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
