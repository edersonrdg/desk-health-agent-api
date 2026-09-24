import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ name: z.string(), age: z.number() }),
  );

  it('returns the parsed value', () => {
    expect(pipe.transform({ name: 'a', age: 1 })).toEqual({
      name: 'a',
      age: 1,
    });
  });

  it('throws 422 listing paths and codes, never values', () => {
    let error: unknown;
    try {
      pipe.transform({ name: 'dor no peito', age: 'secret-value' });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const body = (error as UnprocessableEntityException).getResponse();
    expect(body).toEqual({
      statusCode: 422,
      message: 'Invalid payload',
      issues: [{ path: 'age', code: 'invalid_type' }],
    });
    expect(JSON.stringify(body)).not.toContain('secret-value');
  });
});
