import { createHash, randomBytes, scryptSync } from "node:crypto";
import { BadRequestException, Controller, Delete, ForbiddenException, Get, Inject, Injectable, Post, Req, UnauthorizedException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

const demoLeadKeys = ["lead-01", "lead-02", "lead-03", "lead-04", "lead-05", "lead-06", "lead-07", "lead-08", "lead-09", "lead-10", "lead-11", "lead-12", "lead-13", "lead-14", "lead-15", "lead-16"] as const;
const demoContactKeys = ["contact-01", "contact-02", "contact-03", "contact-04", "contact-05", "contact-06", "contact-07", "contact-08"] as const;
const demoCompanyKeys = ["company-01", "company-02", "company-03", "company-04", "company-05", "company-06"] as const;
const demoDealKeys = ["deal-01", "deal-02", "deal-03", "deal-04", "deal-05", "deal-06"] as const;
const demoActivityKeys = ["activity-01", "activity-02", "activity-03", "activity-04", "activity-05", "activity-06", "activity-07", "activity-08"] as const;
const demoAutomationKeys = ["automation-01", "automation-02"] as const;
const demoRunKeys = ["automation-run-01", "automation-run-02", "automation-run-03"] as const;
const demoEmailKeys = ["email-01", "email-02", "email-03"] as const;
const demoNotificationKeys = ["notification-01", "notification-02", "notification-03"] as const;
const demoAuditKeys = ["audit-01", "audit-02", "audit-03", "audit-04", "audit-05"] as const;
const demoMemberKeys = ["member-jordan", "member-sasha", "member-noah"] as const;
const demoPipelineKey = "pipeline";
const demoStageKeys = ["stage-discovery", "stage-qualified", "stage-proposal", "stage-won"] as const;

const moduleNames = ["leads", "contacts", "companies", "deals", "activities", "team", "automation", "email", "reports", "audit-logs", "settings"];
const demoCompanies = [
  { name: "Northstar Labs", industry: "Technology", website: "https://northstar.example", phone: "+1 415 555 0134" },
  { name: "Forma Studio", industry: "Design", website: "https://forma.example", phone: "+1 415 555 0182" },
  { name: "Greenway Co.", industry: "Sustainability", website: "https://greenway.example", phone: "+1 415 555 0117" },
  { name: "Kinfield Group", industry: "Healthcare", website: "https://kinfield.example", phone: "+1 415 555 0164" },
  { name: "Atlas Works", industry: "Professional Services", website: "https://atlas.example", phone: "+1 415 555 0176" },
  { name: "Juniper Market", industry: "Retail", website: "https://juniper.example", phone: "+1 415 555 0195" },
] as const;

const demoContacts = [
  { name: "Olivia Rhye", email: "olivia@northstar.example", phone: "+1 415 555 0134", title: "VP of Operations", company: "Northstar Labs" },
  { name: "Phoenix Baker", email: "phoenix@forma.example", phone: "+1 415 555 0182", title: "Founder", company: "Forma Studio" },
  { name: "Lana Steiner", email: "lana@greenway.example", phone: "+1 415 555 0117", title: "Partnerships Lead", company: "Greenway Co." },
  { name: "Demi Wilkinson", email: "demi@kinfield.example", phone: "+1 415 555 0164", title: "Director of Sales", company: "Kinfield Group" },
  { name: "Alex Morgan", email: "alex@atlas.example", phone: "+1 415 555 0176", title: "Managing Partner", company: "Atlas Works" },
  { name: "Riley Jones", email: "riley@juniper.example", phone: "+1 415 555 0195", title: "Head of Growth", company: "Juniper Market" },
  { name: "Jordan Lee", email: "jordan@northstar.example", phone: "+1 415 555 0128", title: "Finance Director", company: "Northstar Labs" },
  { name: "Sam Rivera", email: "sam@forma.example", phone: "+1 415 555 0149", title: "Operations Manager", company: "Forma Studio" },
] as const;

const demoLeads = [
  { name: "Taylor Kim", company: "Northstar Labs", source: "WEBSITE" as const, status: "QUALIFIED" as const },
  { name: "Casey Patel", company: "Forma Studio", source: "REFERRAL" as const, status: "CONTACTED" as const },
  { name: "Morgan Ellis", company: "Greenway Co.", source: "LINKEDIN" as const, status: "NEW" as const },
  { name: "Jamie Chen", company: "Kinfield Group", source: "WEBSITE" as const, status: "CONTACTED" as const },
  { name: "Avery Brooks", company: "Atlas Works", source: "REFERRAL" as const, status: "QUALIFIED" as const },
  { name: "Drew Wallace", company: "Juniper Market", source: "LINKEDIN" as const, status: "NEW" as const },
  { name: "Robin Shah", company: "Northstar Labs", source: "OTHER" as const, status: "DISQUALIFIED" as const },
  { name: "Cameron Diaz", company: "Forma Studio", source: "WEBSITE" as const, status: "NEW" as const },
  { name: "Aria Bennett", company: "Meridian Health", source: "REFERRAL" as const, status: "CONTACTED" as const },
  { name: "Dev Malhotra", company: "Cloudline Systems", source: "LINKEDIN" as const, status: "QUALIFIED" as const },
  { name: "Noah Williams", company: "Brightpath Learning", source: "WEBSITE" as const, status: "NEW" as const },
  { name: "Mira Kapoor", company: "Evergreen Retail", source: "OTHER" as const, status: "CONTACTED" as const },
  { name: "Ethan Brooks", company: "Summit Logistics", source: "REFERRAL" as const, status: "QUALIFIED" as const },
  { name: "Zara Iyer", company: "Nova Financial", source: "LINKEDIN" as const, status: "NEW" as const },
  { name: "Leo Martin", company: "Cedar & Stone", source: "WEBSITE" as const, status: "DISQUALIFIED" as const },
  { name: "Anaya Shah", company: "Bluepeak Energy", source: "OTHER" as const, status: "CONTACTED" as const },
] as const;

const demoTeam = [
  { key: "member-jordan", name: "Jordan Lee", role: "SALES_MANAGER" as const, enabledModules: moduleNames.filter((name) => name !== "team") },
] as const;

function demoId(organizationId: string, key: string) {
  const bytes = Buffer.from(createHash("sha1").update(`myrcrm-demo:${organizationId}:${key}`).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function ids(organizationId: string, keys: readonly string[]) {
  return keys.map((key) => demoId(organizationId, key));
}

function hiddenPasswordHash() {
  const salt = randomBytes(16);
  const password = randomBytes(48);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function dateOffset(days: number, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

@Injectable()
export class DemoDataService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async status(organizationId: string) {
    const counts = await this.counts(organizationId);
    return { data: { loaded: Object.values(counts).some((count) => count > 0), counts } };
  }

  async ensureTrialSamples(organizationId: string, userId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true },
    });
    if (organization?.subscriptionStatus !== "TRIAL") return;

    const marker = await this.prisma.organizationDemoData.findUnique({ where: { organizationId } });
    if (marker?.clearedAt) return;
    if (marker?.loadedAt) return;

    const counts = await this.counts(organizationId);
    if (Object.values(counts).some((count) => count > 0)) {
      await this.prisma.organizationDemoData.upsert({
        where: { organizationId },
        update: { loadedAt: new Date() },
        create: { organizationId, loadedAt: new Date() },
      });
      return;
    }
    await this.load(organizationId, userId);
  }

  async load(organizationId: string, userId: string) {
    const leadIds = ids(organizationId, demoLeadKeys);
    const contactIds = ids(organizationId, demoContactKeys);
    const companyIds = ids(organizationId, demoCompanyKeys);
    const dealIds = ids(organizationId, demoDealKeys);
    const activityIds = ids(organizationId, demoActivityKeys);
    const automationIds = ids(organizationId, demoAutomationKeys);
    const memberIds = ids(organizationId, demoMemberKeys);
    const pipelineId = demoId(organizationId, demoPipelineKey);
    const stageIds = ids(organizationId, demoStageKeys);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const [index, member] of demoTeam.entries()) {
        const memberId = memberIds[index];
        if (!memberId) continue;
        const suffix = createHash("sha256").update(organizationId).digest("hex").slice(0, 10);
        const email = `${member.name.toLowerCase().replace(/\s+/g, ".")}+${suffix}@example.invalid`;
        await tx.user.upsert({
          where: { id: memberId },
          update: { name: member.name, emailVerifiedAt: null, status: "ACTIVE" },
          create: { id: memberId, email, name: member.name, passwordHash: hiddenPasswordHash(), status: "ACTIVE" },
        });
        await tx.membership.upsert({
          where: { organizationId_userId: { organizationId, userId: memberId } },
          update: { role: member.role, status: "ACTIVE", enabledModules: [...member.enabledModules] },
          create: { organizationId, userId: memberId, role: member.role, status: "ACTIVE", enabledModules: [...member.enabledModules] },
        });
      }

      await tx.pipeline.upsert({
        where: { id: pipelineId },
        update: { name: "Demo sales pipeline", isDefault: false },
        create: { id: pipelineId, organizationId, name: "Demo sales pipeline", isDefault: false },
      });
      const stageNames = ["Discovery", "Qualified", "Proposal", "Won"];
      for (const [position, stageName] of stageNames.entries()) {
        const stageId = stageIds[position];
        if (!stageId) continue;
        await tx.pipelineStage.upsert({
          where: { id: stageId },
          update: { name: stageName, position },
          create: { id: stageId, organizationId, pipelineId, name: stageName, position },
        });
      }

      await tx.company.createMany({
        skipDuplicates: true,
        data: demoCompanies.map((company, index) => ({
          ...company,
          id: companyIds[index]!,
          organizationId,
          ownerUserId: userId,
          createdByUserId: userId,
        })),
      });
      await tx.contact.createMany({
        skipDuplicates: true,
        data: demoContacts.map((contact, index) => ({
          ...contact,
          id: contactIds[index]!,
          organizationId,
          ownerUserId: userId,
          createdByUserId: userId,
        })),
      });
      await tx.lead.createMany({
        skipDuplicates: true,
        data: demoLeads.map((lead, index) => ({
          ...lead,
          id: leadIds[index]!,
          organizationId,
          phone: `+1 415 555 ${String(1200 + index).slice(-4)}`,
          email: `prospect-${String(index + 1).padStart(2, "0")}@example.invalid`,
          state: ["California", "New York", "Texas", "Washington"][index % 4],
          city: ["San Francisco", "New York", "Austin", "Seattle"][index % 4],
          address: `${100 + index} Market Street`,
          staffCount: [12, 28, 45, 80, 16, 34, 60, 105][index % 8],
          productRequirement: ["Sales pipeline and team reporting", "Lead tracking with automated follow-up", "Customer database and analytics", "Workspace onboarding and integrations"][index % 4],
          demoType: index % 2 ? "Online walkthrough" : "Product demo",
          demoAt: dateOffset((index % 7) - 2, 10 + (index % 6)),
          remarks: "Sample prospect record for workspace chart and workflow previews.",
          followUpAt: dateOffset((index % 5) - 1, 9 + (index % 7)),
          ownerUserId: userId,
          createdByUserId: userId,
        })),
      });

      const stageForDeal = [2, 1, 0, 2, 1, 3];
      const dealData = [
        { name: "Enterprise workspace", value: "24000.00", company: 0, closeIn: 12 },
        { name: "Annual platform plan", value: "18500.00", company: 1, closeIn: 20 },
        { name: "Team rollout", value: "12800.00", company: 2, closeIn: 30 },
        { name: "CRM migration", value: "9200.00", company: 3, closeIn: 40 },
        { name: "Customer success package", value: "14600.00", company: 4, closeIn: 55 },
        { name: "Retail expansion", value: "22100.00", company: 5, closeIn: 65 },
      ] as const;
      await tx.deal.createMany({
        skipDuplicates: true,
        data: dealData.map((deal, index) => ({
          id: dealIds[index]!,
          organizationId,
          name: deal.name,
          value: deal.value,
          closeDate: dateOffset(deal.closeIn),
          status: index === 5 ? "WON" as const : "OPEN" as const,
          companyId: companyIds[deal.company]!,
          pipelineId,
          stageId: stageIds[stageForDeal[index] ?? 0]!,
          ownerUserId: userId,
          createdByUserId: userId,
        })),
      });

      const activityData = [
        { type: "CALL" as const, title: "Discovery call with Northstar", description: "Understand team size, current CRM, and rollout timeline.", status: "OPEN" as const, priority: "HIGH" as const, dueIn: 1, relatedToType: "DEAL" as const, relatedToId: dealIds[0]! },
        { type: "TASK" as const, title: "Prepare workspace proposal", description: "Include onboarding, migration, and support options.", status: "IN_PROGRESS" as const, priority: "NORMAL" as const, dueIn: 2, relatedToType: "DEAL" as const, relatedToId: dealIds[0]! },
        { type: "MEETING" as const, title: "Product walkthrough", description: "Show the sales and reporting workflows to the Forma team.", status: "OPEN" as const, priority: "HIGH" as const, dueIn: 3, relatedToType: "COMPANY" as const, relatedToId: companyIds[1]! },
        { type: "EMAIL" as const, title: "Send implementation overview", description: "Follow up with an overview of the implementation plan.", status: "OPEN" as const, priority: "NORMAL" as const, dueIn: 4, relatedToType: "CONTACT" as const, relatedToId: contactIds[2]! },
        { type: "TASK" as const, title: "Confirm decision makers", description: "Map stakeholders and approval steps.", status: "OPEN" as const, priority: "LOW" as const, dueIn: 5, relatedToType: "LEAD" as const, relatedToId: leadIds[4]! },
        { type: "NOTE" as const, title: "Budget confirmed", description: "The prospect has confirmed the expected budget range.", status: "COMPLETED" as const, priority: "NORMAL" as const, dueIn: -2, relatedToType: "LEAD" as const, relatedToId: leadIds[0]! },
        { type: "CALL" as const, title: "Quarterly account check-in", description: "Review adoption and expansion opportunities.", status: "OPEN" as const, priority: "NORMAL" as const, dueIn: 7, relatedToType: "COMPANY" as const, relatedToId: companyIds[2]! },
        { type: "TASK" as const, title: "Share renewal options", description: "Prepare a renewal comparison for the customer.", status: "OPEN" as const, priority: "HIGH" as const, dueIn: 8, relatedToType: "DEAL" as const, relatedToId: dealIds[1]! },
      ];
      await tx.activity.createMany({
        skipDuplicates: true,
        data: activityData.map(({ dueIn, ...activity }, index) => ({
          ...activity,
          id: activityIds[index]!,
          organizationId,
          dueAt: dateOffset(dueIn),
          completedAt: activity.status === "COMPLETED" ? dateOffset(-2) : null,
          assignedToUserId: userId,
          createdByUserId: userId,
        })),
      });

      const ruleData = [
        { name: "Demo · New lead follow-up", trigger: "LEAD_CREATED" as const, triggerStatus: null, activityTitle: "Follow up with new lead", activityPriority: "NORMAL" as const, dueInDays: 1 },
        { name: "Demo · Qualified lead handoff", trigger: "LEAD_STATUS_CHANGED" as const, triggerStatus: "QUALIFIED" as const, activityTitle: "Schedule a qualification call", activityPriority: "HIGH" as const, dueInDays: 2 },
      ];
      await tx.automationRule.createMany({
        skipDuplicates: true,
        data: ruleData.map((rule, index) => ({ ...rule, id: automationIds[index]!, organizationId, createdByUserId: userId, enabled: false })),
      });
      await tx.automationRun.createMany({
        skipDuplicates: true,
        data: [0, 1, 2].map((index) => ({
          id: demoId(organizationId, demoRunKeys[index]!),
          organizationId,
          ruleId: automationIds[index === 0 ? 0 : 1]!,
          leadId: leadIds[index]!,
          activityId: activityIds[index]!,
          ranAt: new Date(now.getTime() - (index + 1) * 60 * 60 * 1000),
        })),
      });

      await tx.emailMessage.createMany({
        skipDuplicates: true,
        data: [
          { subject: "Welcome to your new workspace", contact: 0, body: "Hi Olivia,\n\nThanks for taking the time to speak with us. Here is a quick overview of the workspace setup we discussed.\n\nThis is an unsent sample message." },
          { subject: "Your product walkthrough", contact: 1, body: "Hi Phoenix,\n\nHere are the topics we will cover in the upcoming product walkthrough.\n\nThis is an unsent sample message." },
          { subject: "Following up on your requirements", contact: 2, body: "Hi Lana,\n\nI have captured your requirements and will share the proposed next steps shortly.\n\nThis is an unsent sample message." },
        ].map((email, index) => ({
          id: ids(organizationId, demoEmailKeys)[index]!,
          organizationId,
          contactId: contactIds[email.contact]!,
          createdByUserId: userId,
          recipientName: demoContacts[email.contact]!.name,
          recipientEmail: demoContacts[email.contact]!.email,
          subject: email.subject,
          body: email.body,
          deliveryStatus: "NOT_CONFIGURED" as const,
        })),
      });

      await tx.notification.createMany({
        skipDuplicates: true,
        data: [
          { activity: 0, title: "Demo activity assigned", body: "Discovery call with Northstar is due tomorrow." },
          { activity: 2, title: "Demo meeting coming up", body: "Product walkthrough is scheduled in three days." },
          { activity: 4, title: "Demo follow-up needed", body: "Confirm decision makers for the qualified lead." },
        ].map((notification, index) => ({
          id: ids(organizationId, demoNotificationKeys)[index]!,
          organizationId,
          recipientUserId: userId,
          activityId: activityIds[notification.activity]!,
          resourceId: dealIds[0]!,
          type: "ACTIVITY_ASSIGNED" as const,
          title: notification.title,
          body: notification.body,
        })),
      });

      await tx.auditLog.createMany({
        skipDuplicates: true,
        data: [
          { resourceType: "lead", resourceId: leadIds[0]! },
          { resourceType: "contact", resourceId: contactIds[0]! },
          { resourceType: "company", resourceId: companyIds[0]! },
          { resourceType: "deal", resourceId: dealIds[0]! },
          { resourceType: "activity", resourceId: activityIds[0]! },
        ].map((entry, index) => ({
          id: ids(organizationId, demoAuditKeys)[index]!,
          organizationId,
          actorUserId: userId,
          action: "CREATE" as const,
          ...entry,
          createdAt: new Date(now.getTime() - (index + 1) * 60 * 60 * 1000),
        })),
      });

    });

    await this.prisma.organizationDemoData.upsert({
      where: { organizationId },
      update: { loadedAt: new Date(), clearedAt: null },
      create: { organizationId, loadedAt: new Date() },
    });

    return { data: { loaded: true, counts: await this.counts(organizationId) } };
  }

  async clear(organizationId: string) {
    const leadIds = ids(organizationId, demoLeadKeys);
    const contactIds = ids(organizationId, demoContactKeys);
    const companyIds = ids(organizationId, demoCompanyKeys);
    const dealIds = ids(organizationId, demoDealKeys);
    const activityIds = ids(organizationId, demoActivityKeys);
    const automationIds = ids(organizationId, demoAutomationKeys);
    const memberIds = ids(organizationId, demoMemberKeys);
    const pipelineId = demoId(organizationId, demoPipelineKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { organizationId, id: { in: ids(organizationId, demoNotificationKeys) } } });
      await tx.auditLog.deleteMany({ where: { organizationId, id: { in: ids(organizationId, demoAuditKeys) } } });
      await tx.emailMessage.deleteMany({ where: { organizationId, id: { in: ids(organizationId, demoEmailKeys) } } });
      await tx.automationRun.deleteMany({ where: { organizationId, id: { in: ids(organizationId, demoRunKeys) } } });
      await tx.activity.deleteMany({ where: { organizationId, id: { in: activityIds } } });
      await tx.deal.deleteMany({ where: { organizationId, id: { in: dealIds } } });
      await tx.lead.deleteMany({ where: { organizationId, id: { in: leadIds } } });
      await tx.contact.deleteMany({ where: { organizationId, id: { in: contactIds } } });
      await tx.company.deleteMany({ where: { organizationId, id: { in: companyIds } } });
      await tx.automationRule.deleteMany({ where: { organizationId, id: { in: automationIds } } });
      await tx.pipelineStage.deleteMany({ where: { organizationId, pipelineId } });
      await tx.pipeline.deleteMany({ where: { organizationId, id: pipelineId } });
      await tx.membership.deleteMany({ where: { organizationId, userId: { in: memberIds } } });
      await tx.user.deleteMany({ where: { id: { in: memberIds }, memberships: { none: {} }, sessions: { none: {} } } });
    });

    await this.prisma.organizationDemoData.upsert({
      where: { organizationId },
      update: { clearedAt: new Date() },
      create: { organizationId, clearedAt: new Date() },
    });

    return { data: { loaded: false, counts: await this.counts(organizationId) } };
  }

  private async counts(organizationId: string) {
    const [leads, contacts, companies, deals, activities, automations, emails, team, pipeline, auditLogs, notifications] = await Promise.all([
      this.prisma.lead.count({ where: { organizationId, id: { in: ids(organizationId, demoLeadKeys) } } }),
      this.prisma.contact.count({ where: { organizationId, id: { in: ids(organizationId, demoContactKeys) } } }),
      this.prisma.company.count({ where: { organizationId, id: { in: ids(organizationId, demoCompanyKeys) } } }),
      this.prisma.deal.count({ where: { organizationId, id: { in: ids(organizationId, demoDealKeys) } } }),
      this.prisma.activity.count({ where: { organizationId, id: { in: ids(organizationId, demoActivityKeys) } } }),
      this.prisma.automationRule.count({ where: { organizationId, id: { in: ids(organizationId, demoAutomationKeys) } } }),
      this.prisma.emailMessage.count({ where: { organizationId, id: { in: ids(organizationId, demoEmailKeys) } } }),
      this.prisma.membership.count({ where: { organizationId, userId: { in: ids(organizationId, demoMemberKeys) } } }),
      this.prisma.pipeline.count({ where: { organizationId, id: demoId(organizationId, demoPipelineKey) } }),
      this.prisma.auditLog.count({ where: { organizationId, id: { in: ids(organizationId, demoAuditKeys) } } }),
      this.prisma.notification.count({ where: { organizationId, id: { in: ids(organizationId, demoNotificationKeys) } } }),
    ]);
    return { leads, contacts, companies, deals, activities, automations, emails, team, pipelines: pipeline, auditLogs, notifications };
  }

}

@Controller("demo-data")
export class DemoDataController {
  constructor(@Inject(DemoDataService) private readonly demoData: DemoDataService) {}

  @Get("status")
  async status(@Req() request: HttpRequest) {
    const { organizationId, userId } = this.requireAdministrator(request);
    await this.demoData.ensureTrialSamples(organizationId, userId);
    return this.demoData.status(organizationId);
  }

  @Post("load")
  async load(@Req() request: HttpRequest) {
    const { organizationId, userId } = this.requireAdministrator(request);
    return this.demoData.load(organizationId, userId);
  }

  @Delete("clear")
  async clear(@Req() request: HttpRequest) {
    const { organizationId } = this.requireAdministrator(request);
    return this.demoData.clear(organizationId);
  }

  private requireAdministrator(request: HttpRequest) {
    if (!request.userId) throw new UnauthorizedException({ code: "unauthorized", message: "Authenticated user required" });
    if (!request.orgId) throw new BadRequestException({ code: "org_required", message: "Organization context required" });
    if (request.organizationRole !== "owner" && request.organizationRole !== "admin") {
      throw new ForbiddenException({ code: "forbidden", message: "Only the workspace Owner or Admin can manage sample data" });
    }
    return { organizationId: request.orgId, userId: request.userId };
  }
}
