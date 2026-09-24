import {
  tenantLocaleSchema,
  tenantPoliciesSchema,
  timezoneSchema,
} from './tenant-policies.schema';

describe('tenant policies schema', () => {
  it('accepts an empty object and known keys', () => {
    expect(tenantPoliciesSchema.parse({})).toEqual({});
    expect(
      tenantPoliciesSchema.parse({
        cancellation_min_notice_minutes: 0,
        hold_ttl_seconds: 300,
      }),
    ).toEqual({ cancellation_min_notice_minutes: 0, hold_ttl_seconds: 300 });
  });

  it.each([
    [{ cancellation_min_notice_minutes: -1 }],
    [{ hold_ttl_seconds: 0 }],
    [{ hold_ttl_seconds: 1.5 }],
    [{ hold_ttl_seconds: '300' }],
    [{ reminder_offset_minutes: 60 }],
  ])('rejects %j', (policies) => {
    expect(tenantPoliciesSchema.safeParse(policies).success).toBe(false);
  });
});

describe('timezone and locale', () => {
  it('accepts IANA zones and rejects unknown ones', () => {
    expect(timezoneSchema.safeParse('America/Sao_Paulo').success).toBe(true);
    expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });

  it('accepts only supported locales', () => {
    expect(tenantLocaleSchema.safeParse('pt-BR').success).toBe(true);
    expect(tenantLocaleSchema.safeParse('fr').success).toBe(false);
  });
});
