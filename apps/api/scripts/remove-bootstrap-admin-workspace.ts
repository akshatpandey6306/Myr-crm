import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../generated/prisma/client.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

async function removeWorkspace() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  if (!email || !process.env.DATABASE_URL) throw new Error("PLATFORM_ADMIN_EMAIL and DATABASE_URL are required.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!admin) throw new Error("Configured platform-admin account was not found.");

    const outcome = await prisma.$transaction(async (tx) => {
      const workspace = await tx.organization.findUnique({
        where: { slug: "myr-crm-admin" },
        select: {
          id: true,
          name: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          memberships: { select: { userId: true, role: true } },
        },
      });
      if (!workspace) return "No bootstrap workspace exists.";
      if (workspace.name !== "Myr CRM Admin Workspace" || workspace.subscriptionPlan !== null || workspace.subscriptionStatus !== "PENDING") {
        throw new Error("The workspace no longer matches the empty bootstrap workspace; no changes were made.");
      }
      if (workspace.memberships.length !== 1 || workspace.memberships[0].userId !== admin.id || workspace.memberships[0].role !== "OWNER") {
        throw new Error("The workspace has additional or changed memberships; no changes were made.");
      }

      const counts = await Promise.all([
        tx.lead.count({ where: { organizationId: workspace.id } }),
        tx.leadCall.count({ where: { organizationId: workspace.id } }),
        tx.contact.count({ where: { organizationId: workspace.id } }),
        tx.company.count({ where: { organizationId: workspace.id } }),
        tx.vendor.count({ where: { organizationId: workspace.id } }),
        tx.deal.count({ where: { organizationId: workspace.id } }),
        tx.activity.count({ where: { organizationId: workspace.id } }),
        tx.subscriptionPayment.count({ where: { organizationId: workspace.id } }),
        tx.billingInvoice.count({ where: { organizationId: workspace.id } }),
        tx.billingQuotation.count({ where: { organizationId: workspace.id } }),
        tx.partnerCustomerMapping.count({ where: { organizationId: workspace.id } }),
      ]);
      if (counts.some((count) => count !== 0)) throw new Error("The bootstrap workspace contains data; no changes were made.");

      await tx.organization.delete({ where: { id: workspace.id } });
      return "Removed the empty bootstrap-only workspace. The platform-admin account remains independent.";
    });
    console.log(outcome);
  } finally {
    await prisma.$disconnect();
  }
}

removeWorkspace().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Workspace cleanup failed; no secret values were printed.");
  process.exitCode = 1;
});
