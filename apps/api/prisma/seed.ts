import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { randomBytes, scryptSync } from "node:crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter });

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function main() {
  const email = "maya@studionorth.co";
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { id: "00000000-0000-4000-8000-000000000001", email, name: "Maya Chen", passwordHash: hashPassword("password123") },
    });
    await tx.organization.upsert({
      where: { id: "11111111-1111-4111-8111-111111111111" },
      update: {},
      create: { id: "11111111-1111-4111-8111-111111111111", name: "Studio North" },
    });
    await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: "11111111-1111-4111-8111-111111111111", userId: user.id } },
      update: {},
      create: { userId: user.id, organizationId: "11111111-1111-4111-8111-111111111111", role: "OWNER" },
    });
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const demoLeads = [
      { id: "22222222-2222-4222-8222-222222222201", name: "Olivia Rhye", company: "Northstar Labs", source: "WEBSITE" as const, status: "QUALIFIED" as const },
      { id: "22222222-2222-4222-8222-222222222202", name: "Phoenix Baker", company: "Forma Studio", source: "REFERRAL" as const, status: "CONTACTED" as const },
      { id: "22222222-2222-4222-8222-222222222203", name: "Lana Steiner", company: "Greenway Co.", source: "LINKEDIN" as const, status: "NEW" as const },
      { id: "22222222-2222-4222-8222-222222222204", name: "Demi Wilkinson", company: "Kinfield Group", source: "WEBSITE" as const, status: "CONTACTED" as const },
    ];
    for (const lead of demoLeads) {
      await tx.lead.upsert({
        where: { id: lead.id },
        update: {},
        create: { ...lead, organizationId, ownerUserId: user.id, createdByUserId: user.id },
      });
    }
    const demoContacts = [
      { id: "33333333-3333-4333-8333-333333333301", name: "Olivia Rhye", email: "olivia@northstar.io", phone: "+1 415 555 0134", title: "VP of Operations", company: "Northstar Labs" },
      { id: "33333333-3333-4333-8333-333333333302", name: "Phoenix Baker", email: "phoenix@forma.co", phone: "+1 415 555 0182", title: "Founder", company: "Forma Studio" },
      { id: "33333333-3333-4333-8333-333333333303", name: "Lana Steiner", email: "lana@greenway.co", phone: "+1 415 555 0117", title: "Partnerships Lead", company: "Greenway Co." },
    ];
    for (const contact of demoContacts) {
      await tx.contact.upsert({
        where: { id: contact.id },
        update: {},
        create: { ...contact, organizationId, email: contact.email, ownerUserId: user.id, createdByUserId: user.id },
      });
    }
    const demoCompanies = [
      { id: "44444444-4444-4444-8444-444444444401", name: "Northstar Labs", industry: "Technology", website: "https://northstar.io" },
      { id: "44444444-4444-4444-8444-444444444402", name: "Forma Studio", industry: "Design", website: "https://forma.co" },
      { id: "44444444-4444-4444-8444-444444444403", name: "Greenway Co.", industry: "Sustainability", website: "https://greenway.co" },
      { id: "44444444-4444-4444-8444-444444444404", name: "Kinfield Group", industry: "Healthcare", website: "https://kinfield.com" },
    ];
    for (const company of demoCompanies) {
      await tx.company.upsert({
        where: { id: company.id },
        update: {},
        create: { ...company, organizationId, ownerUserId: user.id, createdByUserId: user.id },
      });
    }
    const pipeline = await tx.pipeline.upsert({
      where: { organizationId_name: { organizationId, name: "Sales pipeline" } },
      update: {},
      create: { organizationId, name: "Sales pipeline", isDefault: true },
    });
    const stages = ["Discovery", "Qualified", "Proposal", "Negotiation"];
    for (const [position, name] of stages.entries()) {
      await tx.pipelineStage.upsert({
        where: { organizationId_pipelineId_name: { organizationId, pipelineId: pipeline.id, name } },
        update: { position },
        create: { organizationId, pipelineId: pipeline.id, name, position },
      });
    }
    const stageRecords = await tx.pipelineStage.findMany({
      where: { organizationId, pipelineId: pipeline.id },
      select: { id: true, name: true },
    });
    const stageIds = new Map(stageRecords.map((stage) => [stage.name, stage.id]));
    const demoDeals = [
      { id: "55555555-5555-4555-8555-555555555501", name: "Enterprise plan", value: "24000.00", closeDate: new Date("2026-11-14T00:00:00.000Z"), companyId: "44444444-4444-4444-8444-444444444401", stageName: "Proposal" },
      { id: "55555555-5555-4555-8555-555555555502", name: "Annual subscription", value: "18500.00", closeDate: new Date("2026-11-08T00:00:00.000Z"), companyId: "44444444-4444-4444-8444-444444444402", stageName: "Negotiation" },
      { id: "55555555-5555-4555-8555-555555555503", name: "Team workspace", value: "12800.00", closeDate: new Date("2026-11-21T00:00:00.000Z"), companyId: "44444444-4444-4444-8444-444444444403", stageName: "Qualified" },
      { id: "55555555-5555-4555-8555-555555555504", name: "CRM migration", value: "9200.00", closeDate: new Date("2026-12-02T00:00:00.000Z"), companyId: "44444444-4444-4444-8444-444444444404", stageName: "Discovery" },
    ];
    for (const deal of demoDeals) {
      const stageId = stageIds.get(deal.stageName);
      if (!stageId) throw new Error(`Missing default pipeline stage: ${deal.stageName}`);
      await tx.deal.upsert({
        where: { id: deal.id },
        update: {},
        create: {
          id: deal.id,
          name: deal.name,
          value: deal.value,
          closeDate: deal.closeDate,
          organizationId,
          companyId: deal.companyId,
          pipelineId: pipeline.id,
          stageId,
          ownerUserId: user.id,
          createdByUserId: user.id,
        },
      });
    }
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
