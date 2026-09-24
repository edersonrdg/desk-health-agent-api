import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  exports: [TypeOrmModule],
})
export class TenantModule {}
