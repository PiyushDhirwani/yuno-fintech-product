import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StoreModule } from '../store/store.module';
import { ProcessorModule } from '../processor/processor.module';

@Module({
  imports: [StoreModule, ProcessorModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
