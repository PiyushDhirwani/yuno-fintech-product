import { Controller, Post, Logger } from '@nestjs/common';
import { SeedService } from './seed.service';

@Controller('seed')
export class SeedController {
  private readonly logger = new Logger(SeedController.name);

  constructor(private readonly seedService: SeedService) {}

  /**
   * POST /api/seed
   * Clears the store and populates it with 53 test payments and 10+ duplicate
   * scenarios — enough to demonstrate all idempotency and timeout use-cases.
   */
  @Post()
  async seed() {
    this.logger.log('Seeding test data...');
    return this.seedService.seed();
  }
}
