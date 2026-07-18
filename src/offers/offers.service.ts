import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { ListOffersQueryDto } from './dto/list-offers-query.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { normalizeAndValidateOfferInput } from './offer.validation';

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
  ) {}

  async list(query: ListOffersQueryDto, workspaceId?: string | null) {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.OfferWhereInput = {};
    if (workspaceId !== undefined) where.workspaceId = workspaceId;
    if (query.network) where.network = query.network;
    if (query.nicheTag) where.nicheTag = query.nicheTag;
    if (query.active != null) where.active = query.active;
    if (query.q) {
      const q = String(query.q).trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { nicheTag: { contains: q, mode: 'insensitive' } },
        { externalProductId: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take: limit,
        include: {
          _count: {
            select: { clicks: true, conversions: true, videoJobs: true },
          },
        },
      }),
      this.prisma.offer.count({ where }),
    ]);

    return { items, page, limit, total };
  }

  async getOne(id: string, workspaceId?: string | null) {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      include: {
        _count: {
          select: { clicks: true, conversions: true, videoJobs: true },
        },
      },
    });
    if (
      !offer ||
      (workspaceId !== undefined && offer.workspaceId !== workspaceId)
    ) {
      throw new NotFoundException('Offer not found');
    }
    return offer;
  }

  async create(dto: CreateOfferDto, workspaceId?: string | null) {
    const data = normalizeAndValidateOfferInput(dto) as Required<
      Pick<Prisma.OfferCreateInput, 'network' | 'name' | 'hoplink'>
    > &
      Pick<
        Prisma.OfferCreateInput,
        'externalProductId' | 'nicheTag' | 'active'
      >;

    await this.ensureNoDuplicate(data, workspaceId);

    return this.prisma.offer.create({
      data: {
        workspaceId: workspaceId ?? null,
        network: data.network,
        name: data.name,
        hoplink: data.hoplink,
        nicheTag: data.nicheTag ?? null,
        externalProductId: data.externalProductId ?? null,
        active: data.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateOfferDto, workspaceId?: string | null) {
    const current = await this.getOne(id, workspaceId);
    const data = normalizeAndValidateOfferInput(dto, { partial: true });
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one field is required');
    }

    await this.ensureNoDuplicate(
      {
        id,
        network: data.network ?? current.network,
        hoplink: data.hoplink ?? current.hoplink,
        externalProductId:
          data.externalProductId !== undefined
            ? data.externalProductId
            : current.externalProductId,
      },
      workspaceId,
    );

    return this.prisma.offer.update({
      where: { id },
      data,
    });
  }

  async deactivate(id: string, workspaceId?: string | null) {
    await this.getOne(id, workspaceId);
    return this.prisma.offer.update({
      where: { id },
      data: { active: false },
    });
  }

  async reactivate(id: string, workspaceId?: string | null) {
    await this.getOne(id, workspaceId);
    return this.prisma.offer.update({
      where: { id },
      data: { active: true },
    });
  }

  async performance(id: string, workspaceId?: string | null) {
    const offer = await this.getOne(id, workspaceId);
    const scoped = workspaceId !== undefined ? { workspaceId } : {};

    const [
      clicks,
      conversions,
      videoJobs,
      revenueByCurrency,
      lastClick,
      lastConversion,
    ] = await Promise.all([
      this.prisma.click.count({ where: { offerId: id, ...scoped } }),
      this.prisma.conversion.count({ where: { offerId: id, ...scoped } }),
      this.prisma.videoJob.count({ where: { offerId: id, ...scoped } }),
      this.prisma.conversion.groupBy({
        by: ['currency'],
        where: { offerId: id, ...scoped },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.click.findFirst({
        where: { offerId: id, ...scoped },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.conversion.findFirst({
        where: { offerId: id, ...scoped },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      offer,
      totals: {
        clicks,
        conversions,
        videoJobs,
        conversionRate: clicks > 0 ? conversions / clicks : 0,
        revenueByCurrency: revenueByCurrency.map((row) => ({
          currency: row.currency ?? 'UNKNOWN',
          conversions: row._count._all,
          amount: row._sum.amount ?? 0,
        })),
      },
      recent: {
        lastClickAt: lastClick?.createdAt ?? null,
        lastConversionAt: lastConversion?.createdAt ?? null,
      },
    };
  }

  async testRedirect(id: string, workspaceId?: string | null) {
    const offer = await this.getOne(id, workspaceId);
    const previewClickId = '00000000-0000-4000-8000-000000000000';
    const redirectUrl = await this.tracking.buildOfferUrl(id, previewClickId);
    return {
      offerId: id,
      network: offer.network,
      hoplink: offer.hoplink,
      previewClickId,
      redirectUrl,
      createsClick: false,
    };
  }

  private async ensureNoDuplicate(
    data: Partial<{
      id: string;
      network: string;
      externalProductId: string | null;
      hoplink: string;
    }>,
    workspaceId?: string | null,
  ) {
    if (data.externalProductId) {
      const existing = await this.prisma.offer.findFirst({
        where: {
          externalProductId: data.externalProductId,
          workspaceId: workspaceId ?? null,
          ...(data.id ? { id: { not: data.id } } : {}),
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException('externalProductId is already in use');
      }
    }

    if (data.network && data.hoplink) {
      const existing = await this.prisma.offer.findFirst({
        where: {
          network: data.network,
          hoplink: data.hoplink,
          workspaceId: workspaceId ?? null,
          ...(data.id ? { id: { not: data.id } } : {}),
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(
          'An offer with this network and hoplink already exists',
        );
      }
    }
  }
}
