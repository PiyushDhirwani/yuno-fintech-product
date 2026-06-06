import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * POST /api/payments
   * Idempotent payment endpoint. Supply an idempotencyKey to guarantee
   * exactly-once processing; if omitted the key is auto-generated from
   * the business fields (orderId + customerId + amount + currency).
   */
  @Post()
  async createPayment(
    @Body() dto: CreatePaymentDto,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(
      `POST /payments — order: ${dto.orderId}, amount: ${dto.amount} ${dto.currency}, ` +
      `key: ${dto.idempotencyKey ?? '(auto)'}`,
    );
    const { httpStatus, body } = await this.paymentsService.processPayment(dto);
    res.status(httpStatus).json(body);
  }

  /**
   * GET /api/payments
   * Returns all payment records (most recent first).
   */
  @Get()
  getAllPayments() {
    return this.paymentsService.getAllPayments();
  }

  /**
   * GET /api/payments/:key
   * Returns current status of a payment by its idempotency key.
   * If the payment previously timed out (status: unknown), a live processor
   * status query is attempted before returning.
   */
  @Get(':key')
  async getPaymentStatus(@Param('key') key: string) {
    const record = await this.paymentsService.getPaymentStatus(key);
    if (!record) {
      throw new NotFoundException(
        `No payment found for idempotency key: ${key}`,
      );
    }
    return record;
  }
}
