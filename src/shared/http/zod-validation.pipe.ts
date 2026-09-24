import { PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Validates a body against a Zod schema. The 422 lists issue paths and codes
 * only: never received values, which may be health data (spec 004 D20, D21).
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Invalid payload',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
        })),
      });
    }
    return result.data;
  }
}
