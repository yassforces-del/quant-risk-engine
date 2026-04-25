export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureThreshold: number = 3;
  private failures: number = 0;
  private nextAttempt: number = 0;

  async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error("Circuit ouvert : l'API est temporairement indisponible.");
      }
    }

    try {
      const result = await action();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  public resetState() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.nextAttempt = 0;
  }

  private recordFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + 30000;
    }
  }

  private reset() {
    this.state = 'CLOSED';
    this.failures = 0;
  }
}

export const groqCircuitBreaker = new CircuitBreaker();