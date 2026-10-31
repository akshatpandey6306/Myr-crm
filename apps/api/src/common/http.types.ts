export type HttpRequest = {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string | undefined>;
  path: string;
  method?: string;
  ip?: string;
  userId?: string;
  token?: string;
  orgId?: string;
  organizationRole?: "owner" | "admin" | "sales_manager" | "sales_rep" | "read_only";
};

export type HttpResponse = {
  status(code: number): HttpResponse;
  json(body: unknown): void;
};
