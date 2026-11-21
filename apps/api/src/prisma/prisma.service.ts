import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to start the API");
    let databaseUrl: URL;
    try {
      databaseUrl = new URL(connectionString);
    } catch {
      throw new Error("DATABASE_URL must be a valid PostgreSQL URL. URL-encode special characters in its username or password.");
    }
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname || !databaseUrl.pathname || databaseUrl.pathname === "/") {
      throw new Error("DATABASE_URL must include a PostgreSQL host and database name. URL-encode special characters in its username or password.");
    }
    // Supabase's pooled connection can take longer than Prisma's 2s/5s
    // interactive-transaction defaults, especially while the CRM is warming
    // up or plan updates fan out to existing workspaces. Give transactions
    // enough time to acquire a connection and finish without failing as 500s.
    super({
      adapter: new PrismaPg({ connectionString }),
      transactionOptions: {
        maxWait: 15_000,
        timeout: 30_000,
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
