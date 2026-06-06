import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PaymentsModule } from './payments/payments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SeedModule } from './seed/seed.module';

// On Vercel, public/ is served by the CDN (no server needed).
// Locally, ServeStaticModule handles it so you don't need a separate web server.
const staticModule = process.env.VERCEL
  ? []
  : [
      ServeStaticModule.forRoot({
        rootPath: join(__dirname, '..', 'public'),
        serveRoot: '/',
        exclude: ['/api/(.*)'],
      }),
    ];

@Module({
  imports: [...staticModule, PaymentsModule, DashboardModule, SeedModule],
})
export class AppModule {}
