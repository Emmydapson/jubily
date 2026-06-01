import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeAndValidateOfferInput } from '../src/offers/offer.validation';

type RawOffer = Record<string, unknown>;

function getSeedPath() {
  const argPath = process.argv.find((arg) => arg.startsWith('--file='));
  return resolve(
    process.cwd(),
    argPath?.slice('--file='.length) ||
      process.env.OFFERS_SEED_FILE ||
      'data/offers.seed.json',
  );
}

function loadOffers(filePath: string): RawOffer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to read offer seed file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Offer seed file must contain a JSON array');
  }

  return parsed as RawOffer[];
}

async function main() {
  const seedPath = getSeedPath();
  const prisma = new PrismaClient();
  const rawOffers = loadOffers(seedPath);

  if (rawOffers.length === 0) {
    throw new Error('Offer seed file must contain at least one offer');
  }

  const results: Array<{ id: string; name: string; action: string }> = [];

  try {
    for (const [index, rawOffer] of rawOffers.entries()) {
      const offer = normalizeAndValidateOfferInput(rawOffer);
      if (!offer.network || !offer.name || !offer.hoplink) {
        throw new Error(`Offer at index ${index} is missing required fields`);
      }

      const existing = offer.externalProductId
        ? await prisma.offer.findFirst({
            where: {
              network: offer.network,
              externalProductId: offer.externalProductId,
            },
          })
        : await prisma.offer.findFirst({
            where: {
              network: offer.network,
              hoplink: offer.hoplink,
            },
          });

      const data = {
        network: offer.network,
        externalProductId: offer.externalProductId ?? null,
        name: offer.name,
        nicheTag: offer.nicheTag ?? null,
        hoplink: offer.hoplink,
        active: offer.active ?? true,
      };

      const saved = existing
        ? await prisma.offer.update({ where: { id: existing.id }, data })
        : await prisma.offer.create({ data });

      results.push({
        id: saved.id,
        name: saved.name,
        action: existing ? 'updated' : 'created',
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        file: seedPath,
        count: results.length,
        offers: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

