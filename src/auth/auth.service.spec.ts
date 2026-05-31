import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: { compare: jest.fn() },
}));

describe('AuthService', () => {
  const originalEnv = process.env;
  let prisma: {
    adminUser: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let jwt: { signAsync: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    process.env = { ...originalEnv, ADMIN_EMAILS: 'admin@joinjubily.com, ops@joinjubily.com' };
    prisma = {
      adminUser: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    service = new AuthService(prisma as never, jwt as never);
    jest.mocked(bcrypt.compare).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('normalizes allowed admin email, updates last login, and signs the expected JWT payload', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@joinjubily.com',
      passwordHash: 'hash',
      role: 'ADMIN',
      active: true,
    });
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await expect(service.login('  ADMIN@JoinJubily.com ', 'secret')).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      admin: { id: 'admin-1', email: 'admin@joinjubily.com', role: 'ADMIN' },
    });

    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@joinjubily.com' },
    });
    expect(prisma.adminUser.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'admin-1',
      email: 'admin@joinjubily.com',
      role: 'ADMIN',
    });
  });

  it('rejects emails outside the configured admin allowlist before querying credentials', async () => {
    await expect(service.login('attacker@example.com', 'secret')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects inactive admins and bad passwords with the same invalid-credentials path', async () => {
    prisma.adminUser.findUnique.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@joinjubily.com',
      passwordHash: 'hash',
      role: 'ADMIN',
      active: false,
    });

    await expect(service.login('admin@joinjubily.com', 'secret')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    prisma.adminUser.findUnique.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@joinjubily.com',
      passwordHash: 'hash',
      role: 'ADMIN',
      active: true,
    });
    jest.mocked(bcrypt.compare).mockResolvedValue(false as never);

    await expect(service.login('admin@joinjubily.com', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
