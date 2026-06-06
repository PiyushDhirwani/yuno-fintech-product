import { Module } from '@nestjs/common';
import { PaymentsModule } from './payments/payments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SeedModule } from './seed/seed.module';

// Static file serving is handled by main.ts (local dev) or Vercel CDN (production).
// Keeping this module clean of @nestjs/serve-static avoids bundling issues on Vercel.
@Module({
  imports: [PaymentsModule, DashboardModule, SeedModule],
})
export class AppModule {}
