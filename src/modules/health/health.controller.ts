import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

export const CHECK_TIMEOUT_MS = 1_000;

type DependencyStatus = 'up' | 'down';

export interface ReadinessResponse {
  status: 'ok' | 'error';
  details: { postgres: DependencyStatus; redis: DependencyStatus };
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Liveness: no dependency checks. */
  @Get()
  check(): void {}

  /** Readiness: 200 when Postgres and Redis both answer, 503 otherwise. */
  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    let result: HealthCheckResult;
    try {
      result = await this.health.check([
        () =>
          this.postgres.pingCheck('postgres', { timeout: CHECK_TIMEOUT_MS }),
        () => this.redis.pingCheck('redis', { timeout: CHECK_TIMEOUT_MS }),
      ]);
    } catch (err) {
      if (!(err instanceof ServiceUnavailableException)) throw err;
      const failed = err.getResponse() as HealthCheckResult;
      this.logFailures(failed);
      // Error text stays in the logs; the body only says up or down.
      throw new ServiceUnavailableException(this.toResponse(failed));
    }
    return this.toResponse(result);
  }

  private toResponse(result: HealthCheckResult): ReadinessResponse {
    const statusOf = (key: string): DependencyStatus =>
      result.details[key]?.status === 'up' ? 'up' : 'down';
    const details = {
      postgres: statusOf('postgres'),
      redis: statusOf('redis'),
    };
    const allUp = details.postgres === 'up' && details.redis === 'up';
    return {
      status: result.status === 'ok' && allUp ? 'ok' : 'error',
      details,
    };
  }

  private logFailures(result: HealthCheckResult): void {
    for (const [key, detail] of Object.entries(result.details)) {
      if (detail.status === 'up') continue;
      // TypeOrmHealthIndicator drops driver errors (only timeouts carry a
      // message); DatabaseConnector logs connection failures on its own.
      const message: unknown = detail.message;
      this.logger.warn(
        `Readiness check "${key}" failed: ${typeof message === 'string' ? message : 'no detail from indicator'}`,
      );
    }
  }
}
