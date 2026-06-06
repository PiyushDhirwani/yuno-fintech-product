import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PaymentRecord, DuplicateAttempt, StoreData } from '../types/payment.types';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  // Module-level maps serve as primary in-memory store
  private readonly payments = new Map<string, PaymentRecord>();
  private readonly duplicateAttempts = new Map<string, DuplicateAttempt[]>();

  private readonly dataFile: string;

  constructor() {
    // Use /tmp on Vercel (serverless), ./data locally
    const dataDir =
      process.env.NODE_ENV === 'production'
        ? '/tmp'
        : path.join(process.cwd(), 'data');
    this.dataFile = path.join(dataDir, 'payments.json');
    this.loadFromFile();
  }

  private loadFromFile(): void {
    try {
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (fs.existsSync(this.dataFile)) {
        const raw = fs.readFileSync(this.dataFile, 'utf-8');
        const data: StoreData = JSON.parse(raw);

        Object.values(data.payments || {}).forEach((p) =>
          this.payments.set(p.idempotencyKey, p),
        );
        Object.entries(data.duplicateAttempts || {}).forEach(([k, v]) =>
          this.duplicateAttempts.set(k, v),
        );

        this.logger.log(
          `Loaded ${this.payments.size} payments from ${this.dataFile}`,
        );
      }
    } catch (e) {
      this.logger.warn(`Could not load store from file: ${(e as Error).message}`);
    }
  }

  private persist(): void {
    try {
      const data: StoreData = {
        payments: Object.fromEntries(this.payments),
        duplicateAttempts: Object.fromEntries(this.duplicateAttempts),
      };
      fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
    } catch (e) {
      this.logger.warn(`Could not persist store: ${(e as Error).message}`);
    }
  }

  getPayment(key: string): PaymentRecord | undefined {
    return this.payments.get(key);
  }

  setPayment(record: PaymentRecord): void {
    this.payments.set(record.idempotencyKey, record);
    this.persist();
  }

  updatePayment(
    key: string,
    updates: Partial<PaymentRecord>,
  ): PaymentRecord | undefined {
    const existing = this.payments.get(key);
    if (!existing) return undefined;
    const updated: PaymentRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.payments.set(key, updated);
    this.persist();
    return updated;
  }

  recordDuplicate(key: string, attempt: DuplicateAttempt): void {
    const existing = this.duplicateAttempts.get(key) ?? [];
    this.duplicateAttempts.set(key, [...existing, attempt]);
    this.persist();
  }

  getAllPayments(): PaymentRecord[] {
    return Array.from(this.payments.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getDuplicateAttempts(): Record<string, DuplicateAttempt[]> {
    return Object.fromEntries(this.duplicateAttempts);
  }

  clear(): void {
    this.payments.clear();
    this.duplicateAttempts.clear();
    this.persist();
  }

  getStats() {
    const allPayments = Array.from(this.payments.values());
    const allDuplicates = Array.from(this.duplicateAttempts.entries());

    const byStatus: Record<string, number> = {};
    const byCurrency: Record<string, { count: number; amount: number }> = {};
    let approvedTotal = 0;

    allPayments.forEach((p) => {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

      if (!byCurrency[p.currency]) {
        byCurrency[p.currency] = { count: 0, amount: 0 };
      }
      byCurrency[p.currency].count++;
      byCurrency[p.currency].amount += p.amount;

      if (p.status === 'approved') approvedTotal += p.amount;
    });

    const duplicatesBlocked = allDuplicates.reduce(
      (sum, [, v]) => sum + v.length,
      0,
    );

    let amountSaved = 0;
    allDuplicates.forEach(([key, dupes]) => {
      const original = this.payments.get(key);
      if (original) amountSaved += original.amount * dupes.length;
    });

    const paymentsWithDuplicates = allDuplicates
      .filter(([, dupes]) => dupes.length > 0)
      .map(([key, dupes]) => {
        const original = this.payments.get(key);
        return {
          idempotencyKey: key,
          orderId: original?.orderId ?? 'unknown',
          amount: original?.amount ?? 0,
          currency: original?.currency ?? 'unknown',
          originalTime: original?.createdAt ?? '',
          retryCount: dupes.length,
          finalStatus: original?.status ?? 'unknown',
          amountSaved: (original?.amount ?? 0) * dupes.length,
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
