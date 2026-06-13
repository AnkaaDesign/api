import { Global, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Global()
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      // Optional: Add any Prisma client options here
      // log: ['query', 'info', 'warn', 'error'],
      // Never ship credential material in query results — applies to nested
      // relation payloads too (e.g. include: { user: true } anywhere).
      // Auth flows that legitimately need these fields re-enable them
      // per-query via UserRepository.findByIdWithCredentials.
      omit: {
        user: {
          password: true,
          sessionToken: true,
        },
      },
      transactionOptions: {
        maxWait: 15000, // default: 2000, increased to 15s for complex operations
        timeout: 60000, // default: 5000, increased to 60s for complex operations like file processing
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
