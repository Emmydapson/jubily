/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { Digistore24Controller } from './digistore24.controller';
import { Digistore24Service } from './digistore24.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [Digistore24Controller],
  providers: [Digistore24Service, PrismaService],
})
export class Digistore24Module {}
