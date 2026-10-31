import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { AuditAction } from "../../generated/prisma/client.js";
import { Observable } from "rxjs";
import { concatMap } from "rxjs/operators";
import { HttpRequest } from "../common/http.types.js";
import { AuditLogsService } from "./audit-logs.service.js";

type AuditableRequest = HttpRequest & {
  method?: string;
  route?: { path?: string };
  params: Record<string, string | undefined>;
};

const actionByMethod: Record<string, AuditAction | undefined> = {
  POST: "CREATE",
  PATCH: "UPDATE",
  DELETE: "ARCHIVE",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ignoredResources = new Set(["auth", "health", "notifications"]);

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly auditLogs: AuditLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditableRequest>();
    const action = actionByMethod[request.method ?? ""];
    const segments = (request.route?.path ?? request.path).split("?").slice(0, 1).join("").split("/").filter(Boolean);
    const routeSegments = segments[0] === "api" && segments[1] === "v1" ? segments.slice(2) : segments;
    let resourceType = routeSegments[0];
    if (resourceType === "organizations" && ["members", "invitations"].includes(routeSegments[1] ?? "")) {
      resourceType = routeSegments[1];
    }
    if (!action || !request.orgId || !request.userId || !resourceType || ignoredResources.has(resourceType)) {
      return next.handle();
    }

    return next.handle().pipe(concatMap(async (response: unknown) => {
      const body = response && typeof response === "object" ? response as { data?: { id?: unknown; userId?: unknown } } : {};
      const candidateId = request.params?.id ?? request.params?.userId ?? body.data?.id ?? body.data?.userId;
      try {
        await this.auditLogs.record({
          organizationId: request.orgId!,
          actorUserId: request.userId!,
          action,
          resourceType,
          resourceId: typeof candidateId === "string" && uuidPattern.test(candidateId) ? candidateId : null,
        });
      } catch (cause) {
        this.logger.error(`Could not persist audit event for ${resourceType}`, cause instanceof Error ? cause.stack : undefined);
      }
      return response;
    }));
  }
}