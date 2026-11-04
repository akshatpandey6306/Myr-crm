import dotenv from "dotenv";
import "reflect-metadata";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const envPath = [
  resolve(moduleDirectory, "../../../.env"),
  resolve(moduleDirectory, "../../../../.env"),
].find(existsSync);
dotenv.config(envPath ? { path: envPath } : {});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: false });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix("api/v1");
  await app.listen(Number(process.env.PORT ?? 4000), "0.0.0.0");
}

void bootstrap();
