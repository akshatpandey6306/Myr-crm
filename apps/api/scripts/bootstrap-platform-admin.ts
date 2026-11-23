import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import { PrismaClient } from "../generated/prisma/client.js";
import { hashPassword } from "../src/auth/password.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

async function bootstrap() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Platform Administrator";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const configuredAdminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase() ?? "";

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; no changes were made.");
  if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL to a valid email address; no changes were made.");
  }
  if (configuredAdminEmail !== email) {
    throw new Error("Set PLATFORM_ADMIN_EMAIL to the same address as BOOTSTRAP_ADMIN_EMAIL; no changes were made.");
  }
  if (name.length > 120) throw new Error("BOOTSTRAP_ADMIN_NAME must be at most 120 characters; no changes were made.");
  if (password.length < 12 || password.length > 128) {
    throw new Error("The temporary bootstrap password must be 12 to 128 characters; no changes were made.");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
        where: { email },
        update: {
          name,
          passwordHash,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        create: {
          email,
          name,
          passwordHash,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
    // Platform administrators authenticate through the global email allowlist
    // and must never be enrolled as workspace owners.
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    console.log(`Platform-admin account is ready: ${email}`);
    console.log("No workspace membership or subscription was created for the platform administrator.");
    console.log("The password was stored as a hash. Keep the password you entered in your password manager.");
  } finally {
    await prisma.$disconnect();
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "";
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Platform-admin bootstrap failed; no password was printed.");
  process.exitCode = 1;
});
