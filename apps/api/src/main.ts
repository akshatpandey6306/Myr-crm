import dotenv from "dotenv";
import "reflect-metadata";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { getWebOrigin } from "./common/web-origin.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const envPath = [
  resolve(moduleDirectory, "../../../.env"),
  resolve(moduleDirectory, "../../../../.env"),
].find(existsSync);
dotenv.config(envPath ? { path: envPath } : {});

async function bootstrap() {
  const webOrigin = getWebOrigin();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: webOrigin, credentials: false });
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
  }
  app.getHttpAdapter().getInstance().set("trust proxy", trustedProxyHops);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix("api/v1", { exclude: [
    { path: "internal/v1/tenants/provision", method: RequestMethod.POST },
    { path: "internal/v1/provisioning/:requestId", method: RequestMethod.GET },
    { path: "internal/v1/provisioning/:requestId/activation-email/retry", method: RequestMethod.POST },
  ] });
  await app.listen(Number(process.env.API_PORT ?? process.env.PORT ?? 4000), process.env.API_HOST?.trim() || "0.0.0.0");
}

void bootstrap();
