import { Controller, Get, Delete } from '@nestjs/common';
import { StoreService } from '../store/store.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly store: StoreService) {}

  /**
   * GET /api/dashboard
   * Returns duplicate-prevention stats: blocked count, amount saved,
   * status breakdown, per-currency totals, and top duplicate offenders.
   */
  @Get()
  async getStats() {
    return this.store.getStats();
  }

  /**
   * DELETE /api/dashboard/clear
   * Wipes all payment records and duplicate attempts from the store.
   * Useful for resetting the demo between runs.
   */
  @Delete('clear')
  async clearStore() {
    await this.store.clear();
    return { message: 'All payment records cleared successfully.' };
  }
}
