import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsIn,
  IsNotEmpty,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty({ message: 'orderId is required' })
  orderId: string;

  @IsString()
  @IsNotEmpty({ message: 'customerId is required' })
  customerId: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be positive' })
  @Min(1, { message: 'amount must be at least 1' })
  @Max(10_000_000, { message: 'amount exceeds maximum allowed' })
  amount: number;

  @IsString()
  @IsIn(['GHS', 'NGN', 'KES', 'XOF'], {
    message: 'currency must be one of: GHS, NGN, KES, XOF',
  })
  currency: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
