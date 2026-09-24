import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatientEntity } from './patient.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PatientEntity])],
  exports: [TypeOrmModule],
})
export class PatientModule {}
