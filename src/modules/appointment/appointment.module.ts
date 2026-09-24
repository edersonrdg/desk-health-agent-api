import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentEntity } from './appointment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AppointmentEntity])],
  exports: [TypeOrmModule],
})
export class AppointmentModule {}
