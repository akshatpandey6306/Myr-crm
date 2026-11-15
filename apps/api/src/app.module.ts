import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { OrgGuard } from "./auth/org.guard.js";
import { HealthModule } from "./health/health.module.js";
import { LeadsController } from "./leads/leads.controller.js";
import { ContactsController } from "./contacts/contacts.controller.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { CompaniesController } from "./companies/companies.controller.js";
import { DealsController } from "./deals/deals.controller.js";
import { PipelinesController } from "./pipelines/pipelines.controller.js";
import { ActivitiesController } from "./activities/activities.controller.js";
import { AutomationsController } from "./automations/automations.controller.js";
import { AutomationsService } from "./automations/automations.service.js";
import { EmailsController } from "./emails/emails.controller.js";
import { ReportsController } from "./reports/reports.controller.js";
import { NotificationsController } from "./notifications/notifications.controller.js";
import { AuditLogsController } from "./audit-logs/audit-logs.controller.js";
import { AuditLogInterceptor } from "./audit-logs/audit-log.interceptor.js";
import { AuditLogsService } from "./audit-logs/audit-logs.service.js";
import { SettingsController } from "./settings/settings.controller.js";
import { RateLimitGuard } from "./auth/rate-limit.guard.js";
import { MembersController } from "./organizations/members.controller.js";
import { BillingController } from "./billing/billing.controller.js";
import { ControlPanelController } from "./control-panel/control-panel.controller.js";
import { DashboardController } from "./dashboard/dashboard.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { PlatformAdminGuard } from "./auth/platform-admin.guard.js";
import { AuthEmailService } from "./auth/email.service.js";
import { DemoDataController, DemoDataService } from "./demo-data/demo-data.controller.js";
import { VendorsController } from "./vendors/vendors.controller.js";
import { InvoicingController } from "./invoicing/invoicing.controller.js";
import { PayUService } from "./billing/payu.service.js";
import { ProvisioningController } from "./provisioning/provisioning.controller.js";
import { TenantProvisioningService } from "./provisioning/tenant-provisioning.service.js";
import { PartnerAdminController, PartnerIntegrationController } from "./partners/partner-integration.controller.js";

@Module({
  imports: [HealthModule, PrismaModule],
  controllers: [AuthController, ProvisioningController, PartnerIntegrationController, PartnerAdminController, OrganizationsController, MembersController, LeadsController, ContactsController, CompaniesController, VendorsController, InvoicingController, DealsController, PipelinesController, ActivitiesController, AutomationsController, EmailsController, ReportsController, NotificationsController, AuditLogsController, SettingsController, BillingController, ControlPanelController, DashboardController, DemoDataController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OrgGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    AutomationsService,
    AuditLogsService,
    AuditService,
    PlatformAdminGuard,
    AuthEmailService,
    DemoDataService,
    PayUService,
    TenantProvisioningService,
  ],
})
export class AppModule {}
