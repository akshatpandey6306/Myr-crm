export type HttpRequest = {
  userId?: string;
  token?: string;
  orgId?: string;
  organizationRole?: 'owner' | 'admin' | 'sales_manager' | 'sales_rep' | 'read_only';
  organizationId?: string;
};

export type RolePermission = {
  role: string;
  permissions: string[];
};
