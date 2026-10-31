import dotenv from "dotenv";
import "reflect-metadata";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: false });
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
  }
  app.getHttpAdapter().getInstance().set("trust proxy", trustedProxyHops);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix("api/v1");
  await app.listen(Number(process.env.PORT ?? 4000), "0.0.0.0");
}

void bootstrap();
