import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

function encodeUriComponentPreservingEscapes(value: string) {
  return encodeURIComponent(value).replace(/%25([\da-f]{2})/gi, "%$1");
}

function isCompletePostgresUrl(url: URL) {
  return ["postgres:", "postgresql:"].includes(url.protocol) && Boolean(url.hostname) && Boolean(url.pathname) && url.pathname !== "/";
}

function serializePostgresUrl(url: URL) {
  const username = encodeUriComponentPreservingEscapes(url.username);
  const password = encodeUriComponentPreservingEscapes(url.password);
  const credentials = username || password ? `${username}${url.password ? `:${password}` : ""}@` : "";
  return `${url.protocol}//${credentials}${url.host}${url.pathname}${url.search}${url.hash}`;
}

function normalizePostgresUrl(value: string) {
  const scheme = /^(postgres(?:ql)?:\/\/)/i.exec(value)?.[0];
  if (!scheme) return null;

  try {
    const parsed = new URL(value);
    if (isCompletePostgresUrl(parsed)) return serializePostgresUrl(parsed);
  } catch {
    // A raw special character in credentials can be mistaken for a URL delimiter.
  }

  // Trying boundaries from right to left handles raw @ characters in passwords.
  for (let at = value.lastIndexOf("@"); at > scheme.length; at = value.lastIndexOf("@", at - 1)) {
    const rawCredentials = value.slice(scheme.length, at);
    const separator = rawCredentials.indexOf(":");
    const username = separator < 0 ? rawCredentials : rawCredentials.slice(0, separator);
    const password = separator < 0 ? "" : rawCredentials.slice(separator + 1);
    const encodedCredentials = `${encodeUriComponentPreservingEscapes(username)}${separator < 0 ? "" : `:${encodeUriComponentPreservingEscapes(password)}`}@`;
    const candidate = `${scheme}${encodedCredentials}${value.slice(at + 1)}`;
    try {
      if (isCompletePostgresUrl(new URL(candidate))) return candidate;
    } catch {
      // This @ was not followed by a valid host; try the previous boundary.
    }
  }
  return null;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to start the API");
    const normalizedConnectionString = normalizePostgresUrl(connectionString);
    if (!normalizedConnectionString) throw new Error("DATABASE_URL must contain a valid PostgreSQL URL with a host and database name. Check the scheme, host, and database name; special characters in username/password are safely encoded at startup.");
    // Supabase's pooled connection can take longer than Prisma's 2s/5s
    // interactive-transaction defaults, especially while the CRM is warming
    // up or plan updates fan out to existing workspaces. Give transactions
    // enough time to acquire a connection and finish without failing as 500s.
    super({
      adapter: new PrismaPg({ connectionString: normalizedConnectionString }),
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
