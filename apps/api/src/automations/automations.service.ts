import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";

type LeadEvent = {
  organizationId: string;
  actorUserId: string;
  leadId: string;
  leadName: string;
  leadOwnerUserId: string;
  status: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED";
  event: "lead_created" | "lead_status_changed";
};

@Injectable()
export class AutomationsService {
  async runForLead(tx: Prisma.TransactionClient, event: LeadEvent) {
    const generatedActivityIds: string[] = [];
    const trigger = event.event === "lead_created" ? "LEAD_CREATED" : "LEAD_STATUS_CHANGED";
    const rules = await tx.automationRule.findMany({
      where: { organizationId: event.organizationId, trigger, enabled: true, archivedAt: null },
    });

    for (const rule of rules) {
      if (rule.trigger === "LEAD_STATUS_CHANGED" && rule.triggerStatus !== event.status) continue;

      const previousRun = await tx.automationRun.findUnique({
        where: { ruleId_leadId: { ruleId: rule.id, leadId: event.leadId } },
        select: { id: true },
      });
      if (previousRun) continue;

      const dueAt = new Date();
      dueAt.setUTCDate(dueAt.getUTCDate() + rule.dueInDays);
      const activity = await tx.activity.create({
        data: {
          organizationId: event.organizationId,
          type: "TASK",
          title: rule.activityTitle.replaceAll("{{leadName}}", event.leadName).slice(0, 160),
          status: "OPEN",
          priority: rule.activityPriority,
          dueAt,
          assignedToUserId: event.leadOwnerUserId,
          relatedToType: "LEAD",
          relatedToId: event.leadId,
          createdByUserId: event.actorUserId,
        },
        select: { id: true },
      });
      generatedActivityIds.push(activity.id);

      if (event.leadOwnerUserId !== event.actorUserId) {
        await tx.notification.create({
          data: {
            organizationId: event.organizationId,
            recipientUserId: event.leadOwnerUserId,
            activityId: activity.id,
            type: "ACTIVITY_ASSIGNED",
            title: "Activity assigned to you",
            body: rule.activityTitle.replaceAll("{{leadName}}", event.leadName).slice(0, 160),
          },
        });
      }

      await tx.automationRun.create({
        data: {
          organizationId: event.organizationId,
          ruleId: rule.id,
          leadId: event.leadId,
          activityId: activity.id,
        },
      });
    }
    return generatedActivityIds;
  }
}
