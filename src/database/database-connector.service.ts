import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { errorMessage } from '../common/error-message';

export const RETRY_INTERVAL_MS = 5_000;

/**
 * Opens the TypeORM DataSource without blocking bootstrap, retrying every
 * 5 s until it succeeds. Once connected, the pg pool reconnects per query.
 * TypeOrmModule destroys the DataSource on shutdown.
 */
@Injectable()
export class DatabaseConnector
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DatabaseConnector.name);
  private retryTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    void this.connect();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  private async connect(): Promise<void> {
    try {
      await this.dataSource.initialize();
    } catch (err) {
      if (this.stopped) return;
      // Driver messages carry host and port at most, never the password.
      this.logger.warn(
        `Postgres connection failed, retrying in ${RETRY_INTERVAL_MS / 1000}s: ${errorMessage(err)}`,
      );
      this.retryTimer = setTimeout(
        () => void this.connect(),
        RETRY_INTERVAL_MS,
      );
      return;
    }

    if (this.stopped) {
      // Shutdown ran while this attempt was in flight.
      await this.dataSource.destroy();
      return;
    }
    this.logger.log('Postgres connection established');
  }
}
