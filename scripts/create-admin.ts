import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function argValue(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

function allowedAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

async function main() {
  const email = normalizeEmail(argValue('email') || process.env.ADMIN_EMAIL || '');
  const password = String(argValue('password') || process.env.ADMIN_PASSWORD || '');
  const allowedEmails = allowedAdminEmails();

  if (!email) {
    throw new Error('ADMIN_EMAIL or --email is required');
  }

  if (!password) {
    throw new Error('ADMIN_PASSWORD or --password is required');
  }

  if (password.length < 6) {
    throw new Error('Admin password must be at least 6 characters');
  }

  if (!allowedEmails.includes(email)) {
    throw new Error('ADMIN_EMAIL must be included in ADMIN_EMAILS allowlist');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      role: 'ADMIN',
      active: true,
    },
    update: {
      passwordHash,
      role: 'ADMIN',
      active: true,
    },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      updatedAt: true,
    },
  });

  console.log(
    `Admin ready: ${admin.email} (${admin.role}, active=${admin.active}) id=${admin.id}`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create admin: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
