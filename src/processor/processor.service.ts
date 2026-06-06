import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ProcessorResult } from '../types/payment.types';

@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);

  private readonly declineReasons = [
    'Insufficient funds',
    'Card declined by issuer',
    'Fraud detection triggered',
    'Card expired',
    'Invalid card details',
    'Transaction limit exceeded',
  ];

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Simulates calling an external payment processor.
   * Outcomes: ~70% approved, ~20% declined, ~10% timeout (status unknown).
   */
  async processPayment(
    amount: number,
    currency: string,
    orderId: string,
  ): Promise<ProcessorResult> {
    const rand = Math.random();

    // 10% timeout — processor takes >3s and we never hear back
    if (rand < 0.10) {
      this.logger.warn(`[Processor] TIMEOUT for order ${orderId} (${amount} ${currency})`);
      await this.sleep(3100);
      return {
        success: false,
        status: 'unknown',
        processorMessage: 'Payment processor timed out after 3100ms — actual status unknown',
        latencyMs: 3100,
        timedOut: true,
      };
    }

    // Realistic network latency: 200–2000ms
    const latencyMs = Math.floor(Math.random() * 1800) + 200;
    await this.sleep(latencyMs);

    // 70% approved, 20% declined (out of the 90% non-timeout requests)
    if (rand < 0.80) {
      const transactionId = `txn-${uuidv4().split('-')[0]}-${Date.now()}`;
      this.logger.log(`[Processor] APPROVED ${transactionId} — ${amount} ${currency} (order: ${orderId})`);
      return {
        success: true,
        transactionId,
        status: 'approved',
        processorMessage: 'Payment approved by processor',
        latencyMs,
        timedOut: false,
      };
    }

    const reason = this.declineReasons[Math.floor(Math.random() * this.declineReasons.length)];
    this.logger.log(`[Processor] DECLINED order ${orderId}: ${reason}`);
    return {
      success: false,
      status: 'declined',
      processorMessage: reason,
      latencyMs,
      timedOut: false,
    };
  }

  /**
   * Simulates querying a timed-out transaction's status from the processor.
   * Called when a client retries a payment that previously had status "unknown".
   * Returns null if the processor still cannot confirm the status.
   */
  async queryTransactionStatus(orderId: string): Promise<ProcessorResult | null> {
    await this.sleep(500);
    const rand = Math.random();

    // 30% — processor still can't confirm; client should retry later
    if (rand < 0.30) {
      this.logger.warn(`[Processor] Status query for order ${orderId} still unresolved`);
      return null;
    }

    // 50% eventually approved, 20% declined
    if (rand < 0.80) {
      const transactionId = `txn-recovered-${uuidv4().split('-')[0]}`;
      this.logger.log(`[Processor] Resolved APPROVED for order ${orderId}: ${transactionId}`);
      return {
        success: true,
        transactionId,
        status: 'approved',
        processorMessage: 'Payment confirmed (delayed resolution)',
        latencyMs: 500,
        timedOut: false,
      };
    }

    this.logger.log(`[Processor] Resolved DECLINED for order ${orderId} (post-timeout)`);
    return {
      success: false,
      status: 'declined',
      processorMessage: 'Payment declined (post-timeout resolution)',
      latencyMs: 500,
      timedOut: false,
    };
  }
}
