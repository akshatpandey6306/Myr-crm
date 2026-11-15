import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";

type CreateWorkspaceOptions = {
  ownerUserId: string;
  name: string;
  membershipStatus?: "ACTIVE" | "PENDING";
  slug?: string | null;
  timezone?: string;
  subscriptionPlan?: string | null;
  subscriptionStatus?: "PENDING" | "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  subscriptionStartedAt?: Date | null;
  subscriptionEndsAt?: Date | null;
  billingProvider?: string | null;
  enabledModules?: string[];
};

@Injectable()
export class TenantProvisioningService {
  static defaultPipelineCreate() {
    return { create: { name: "Sales pipeline", isDefault: true, stages: { create: ["Discovery", "Qualified", "Proposal", "Negotiation"].map((name, position) => ({ name, position })) } } };
  }

  createWorkspace(tx: Prisma.TransactionClient, options: CreateWorkspaceOptions) {
    return tx.organization.create({
      data: {
        name: options.name,
        slug: options.slug,
        timezone: options.timezone ?? "UTC",
        ...(options.subscriptionPlan !== undefined ? { subscriptionPlan: options.subscriptionPlan } : {}),
        ...(options.subscriptionStatus !== undefined ? { subscriptionStatus: options.subscriptionStatus } : {}),
        ...(options.subscriptionStartedAt !== undefined ? { subscriptionStartedAt: options.subscriptionStartedAt } : {}),
        ...(options.subscriptionEndsAt !== undefined ? { subscriptionEndsAt: options.subscriptionEndsAt } : {}),
        ...(options.billingProvider !== undefined ? { billingProvider: options.billingProvider } : {}),
        ...(options.enabledModules !== undefined ? { enabledModules: options.enabledModules } : {}),
        memberships: { create: { userId: options.ownerUserId, role: "OWNER", status: options.membershipStatus ?? "ACTIVE" } },
        pipelines: TenantProvisioningService.defaultPipelineCreate(),
      },
    });
  }
}
