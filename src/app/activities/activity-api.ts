import { crmApiFetch } from "../../lib/api-client";

export type RelatedRecordType = "lead" | "contact" | "company" | "deal";
export type RelatedRecordOption = { id: string; name: string };

const routes: Record<RelatedRecordType, string> = {
  lead: "leads",
  contact: "contacts",
  company: "companies",
  deal: "deals",
};

export function apiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Something went wrong. Please try again.";
  const error = payload as { error?: { message?: unknown }; message?: unknown };
  const message = error.error?.message ?? error.message;
  return typeof message === "string" ? message : "Something went wrong. Please try again.";
}

export async function loadRelatedRecordOptions(
  type: RelatedRecordType,
  signal?: AbortSignal,
): Promise<RelatedRecordOption[]> {
  const response = await crmApiFetch(`/${routes[type]}?page=1&pageSize=100&sortBy=createdAt&sortOrder=desc`, { signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(payload));
  if (
    !payload
    || typeof payload !== "object"
    || !("data" in payload)
    || !Array.isArray(payload.data)
  ) {
    throw new Error("The CRM API returned an invalid related-record list.");
  }
  return payload.data.map((record: unknown) => {
    if (
      !record
      || typeof record !== "object"
      || !("id" in record)
      || typeof record.id !== "string"
      || !("name" in record)
      || typeof record.name !== "string"
    ) {
      throw new Error("The CRM API returned an invalid related record.");
    }
    return { id: record.id, name: record.name };
  });
}
