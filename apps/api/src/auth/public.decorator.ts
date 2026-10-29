import { SetMetadata } from "@nestjs/common";
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const SKIP_ORG_CONTEXT_KEY = "skipOrganizationContext";
export const SkipOrganizationContext = () => SetMetadata(SKIP_ORG_CONTEXT_KEY, true);
