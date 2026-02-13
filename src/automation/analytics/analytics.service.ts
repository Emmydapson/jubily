/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private clampDays(n: number) {
    if (!Number.isFinite(n)) return 7;
    return Math.min(Math.max(Math.floor(n), 1), 30);
  }

  private dayKey(date: Date, timeZone: string) {
    // en-CA -> YYYY-MM-DD format
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(date);
  }

  private dayLabel(date: Date, timeZone: string) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    });
    return fmt.format(date); // Mon, Tue...
  }

  async weekly(opts: { days?: number; timeZone?: string }) {
    const days = this.clampDays(opts.days ?? 7);
    const timeZone = opts.timeZone || 'America/New_York';

    const now = new Date();
    const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    // (we aggregate by timezone dayKey; range filter is rough UTC window, good enough for dashboard)

    const [clicks, conversions] = await Promise.all([
      this.prisma.click.findMany({
        where: { createdAt: { gte: from, lte: now } },
        select: { createdAt: true },
      }),
      this.prisma.conversion.findMany({
        where: { createdAt: { gte: from, lte: now } },
        select: { createdAt: true, amount: true, currency: true },
      }),
    ]);

    // Build day buckets
    const pointsMap = new Map<string, { date: string; day: string; clicks: number; conversions: number; revenue: number }>();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = this.dayKey(d, timeZone);
      pointsMap.set(key, {
        date: key,
        day: this.dayLabel(d, timeZone),
        clicks: 0,
        conversions: 0,
        revenue: 0,
      });
    }

    for (const c of clicks) {
      const key = this.dayKey(c.createdAt, timeZone);
      const p = pointsMap.get(key);
      if (p) p.clicks += 1;
    }

    for (const cv of conversions) {
      const key = this.dayKey(cv.createdAt, timeZone);
      const p = pointsMap.get(key);
      if (p) {
        p.conversions += 1;
        if (typeof cv.amount === 'number') p.revenue += cv.amount;
      }
    }

    const points = Array.from(pointsMap.values());
    const totals = points.reduce(
      (acc, p) => {
        acc.clicks += p.clicks;
        acc.conversions += p.conversions;
        acc.revenue += p.revenue;
        return acc;
      },
      { clicks: 0, conversions: 0, revenue: 0 },
    );

    return {
      timeZone,
      range: { from: from.toISOString(), to: now.toISOString(), days },
      points,
      totals,
    };
  }
}
