"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groqCircuitBreaker = exports.CircuitBreaker = void 0;
class CircuitBreaker {
    constructor() {
        this.state = 'CLOSED';
        this.failureThreshold = 3;
        this.failures = 0;
        this.nextAttempt = 0;
    }
    async execute(action) {
        if (this.state === 'OPEN') {
            if (Date.now() > this.nextAttempt) {
                this.state = 'HALF_OPEN';
            }
            else {
                throw new Error("Circuit ouvert : l'API est temporairement indisponible.");
            }
        }
        try {
            const result = await action();
            this.reset();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    resetState() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.nextAttempt = 0;
    }
    recordFailure() {
        this.failures++;
        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + 30000;
        }
    }
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
    }
}
exports.CircuitBreaker = CircuitBreaker;
exports.groqCircuitBreaker = new CircuitBreaker();
