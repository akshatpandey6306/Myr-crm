import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
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

@Module({
  imports: [HealthModule, PrismaModule],
  controllers: [AuthController, OrganizationsController, LeadsController, ContactsController, CompaniesController, DealsController, PipelinesController, ActivitiesController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OrgGuard },
  ],
})
export class AppModule {}
