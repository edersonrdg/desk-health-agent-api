import { z } from 'zod';

export const TENANT_LOCALES = ['pt-BR', 'en', 'es'] as const;
export type TenantLocale = (typeof TENANT_LOCALES)[number];

export const tenantLocaleSchema = z.enum(TENANT_LOCALES);

/** IANA time zone name, e.g. "America/Sao_Paulo". */
export const timezoneSchema = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'must be an IANA time zone name' },
);

/**
 * Tenant scheduling policies, stored in `tenant.policies`. Every key is
 * optional: the features that read a policy own its default.
 */
export const tenantPoliciesSchema = z.strictObject({
  cancellation_min_notice_minutes: z.int().min(0).optional(),
  hold_ttl_seconds: z.int().positive().optional(),
});

export type TenantPolicies = z.infer<typeof tenantPoliciesSchema>;
