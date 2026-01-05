import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger';

export class TimeoutWatchdog {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private logger = getLogger();

  start(requestId: string, timeout: number, onTimeout: () => void): void {
    if (this.timers.has(requestId)) {
      this.logger.warn(`Timeout already exists for request ${requestId}, clearing...`);
      this.cancel(requestId);
    }

    const timer = setTimeout(() => {
      this.logger.error(`Request ${requestId} timed out after ${timeout}ms`);
      this.timers.delete(requestId);
      onTimeout();
    }, timeout);

    this.timers.set(requestId, timer);
    this.logger.debug(`Timeout watchdog started for request ${requestId} (${timeout}ms)`);
  }

  cancel(requestId: string): void {
    const timer = this.timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(requestId);
      this.logger.debug(`Timeout watchdog cancelled for request ${requestId}`);
    }
  }

  cancelAll(): void {
    this.logger.info(`Cancelling all ${this.timers.size} active timeouts`);
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  getActiveCount(): number {
    return this.timers.size;
  }
}

export function generateRequestId(): string {
  return uuidv4();
}
