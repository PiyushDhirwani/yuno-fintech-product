import { Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { DuplicateAttempt, PaymentRecord } from '../types/payment.types';

const PAYMENTS_IDX = 'payments:index';
const DUPES_IDX = 'duplicates:index';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    this.logger.log('Store initialised with Upstash Redis');
  }

  async getPayment(key: string): Promise<PaymentRecord | undefined> {
    const record = await this.redis.get<PaymentRecord>(`payment:${key}`);
    return record ?? undefined;
  }

  async setPayment(record: PaymentRecord): Promise<void> {
    await Promise.all([
      this.redis.set(`payment:${record.idempotencyKey}`, record),
      this.redis.sadd(PAYMENTS_IDX, record.idempotencyKey),
    ]);
  }

  async updatePayment(
    key: string,
    updates: Partial<PaymentRecord>,
  ): Promise<PaymentRecord | undefined> {
    const existing = await this.getPayment(key);
    if (!existing) return undefined;
    const updated: PaymentRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.setPayment(updated);
    return updated;
  }

  async recordDuplicate(key: string, attempt: DuplicateAttempt): Promise<void> {
    const existing: DuplicateAttempt[] =
      (await this.redis.get<DuplicateAttempt[]>(`duplicates:${key}`)) ?? [];
    await Promise.all([
      this.redis.set(`duplicates:${key}`, [...existing, attempt]),
      this.redis.sadd(DUPES_IDX, key),
    ]);
  }

  async getAllPayments(): Promise<PaymentRecord[]> {
    const keys = await this.redis.smembers(PAYMENTS_IDX);
    if (!keys.length) return [];
    const records = await Promise.all(
      keys.map((k) => this.redis.get<PaymentRecord>(`payment:${k}`)),
    );
    return records
      .filter((r): r is PaymentRecord => r !== null)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  private async getDuplicateAttempts(): Promise<
    Record<string, DuplicateAttempt[]>
  > {
    const keys = await this.redis.smembers(DUPES_IDX);
    if (!keys.length) return {};
    const entries = await Promise.all(
      keys.map(async (k) => {
        const dupes =
          (await this.redis.get<DuplicateAttempt[]>(`duplicates:${k}`)) ?? [];
        return [k, dupes] as [string, DuplicateAttempt[]];
      }),
    );
    return Object.fromEntries(entries);
  }

  async clear(): Promise<void> {
    const [paymentKeys, dupeKeys] = await Promise.all([
      this.redis.smembers(PAYMENTS_IDX),
      this.redis.smembers(DUPES_IDX),
    ]);
    const allKeys: string[] = [
      PAYMENTS_IDX,
      DUPES_IDX,
      ...paymentKeys.map((k) => `payment:${k}`),
      ...dupeKeys.map((k) => `duplicates:${k}`),
    ];
    if (allKeys.length) {
      await this.redis.del(allKeys[0], ...allKeys.slice(1));
    }
    this.logger.log('Store cleared');
  }

  async getStats() {
    const [allPayments, duplicateAttempts] = await Promise.all([
      this.getAllPayments(),
      this.getDuplicateAttempts(),
    ]);

    const byStatus: Record<string, number> = {};
    const byCurrency: Record<string, { count: number; amount: number }> = {};
    let approvedTotal = 0;

    for (const p of allPayments) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      if (!byCurrency[p.currency])
        byCurrency[p.currency] = { count: 0, amount: 0 };
      byCurrency[p.currency].count++;
      byCurrency[p.currency].amount += p.amount;
      if (p.status === 'approved') approvedTotal += p.amount;
    }

    const allDupes = Object.entries(duplicateAttempts);
    const duplicatesBlocked = allDupes.reduce(
      (sum, [, v]) => sum + v.length,
      0,
    );

    const paymentsMap = new Map(allPayments.map((p) => [p.idempotencyKey, p]));
    let amountSaved = 0;

    const paymentsWithDuplicates = allDupes
      .filter(([, dupes]) => dupes.length > 0)
      .map(([key, dupes]) => {
        const original = paymentsMap.get(key);
        const saved = (original?.amount ?? 0) * dupes.length;
        amountSaved += saved;
        return {
          idempotencyKey: key,
          orderId: original?.orderId ?? 'unknown',
          amount: original?.amount ?? 0,
          currency: original?.currency ?? 'unknown',
          originalTime: original?.createdAt ?? '',
          retryCount: dupes.length,
          finalStatus: original?.status ?? 'unknown',
          amountSaved: saved,
        };
      })
      .sort((a, b) => b.retryCount - a.retryCount);

    return {
      totalRequests: allPayments.length + duplicatesBlocked,
      uniquePayments: allPayments.length,
      duplicatesBlocked,
      approvedTotal,
      amountSavedFromDuplicates: amountSaved,
      successRate:
        allPayments.length > 0
          ? Math.round(
              ((byStatus['approved'] ?? 0) / allPayments.length) * 100,
            )
          : 0,
      byStatus,
      byCurrency,
      paymentsWithDuplicates,
    };
  }
}
