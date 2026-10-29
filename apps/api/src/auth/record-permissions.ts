import { ForbiddenException } from "@nestjs/common";
import { HttpRequest } from "../common/http.types.js";

const managers = new Set(["owner", "admin", "sales_manager"]);

export function requireRecordWrite(request: HttpRequest) {
  const role = request.organizationRole;
  if (role === "read_only") throw new ForbiddenException({ code: "forbidden", message: "Your organization role cannot change CRM records" });
  if (!role) throw new ForbiddenException({ code: "forbidden", message: "Organization role is required" });
}

export function requireRecordArchive(request: HttpRequest) {
  if (!request.organizationRole || !managers.has(request.organizationRole)) {
    throw new ForbiddenException({ code: "forbidden", message: "Your organization role cannot archive CRM records" });
  }
}

export function requirePipelineManagement(request: HttpRequest) {
  if (!request.organizationRole || !managers.has(request.organizationRole)) {
    throw new ForbiddenException({ code: "forbidden", message: "Your organization role cannot manage pipelines" });
  }
}

export function assignedOwnerFilter(request: HttpRequest) {
  return request.organizationRole === "sales_rep" ? request.userId : undefined;
}
