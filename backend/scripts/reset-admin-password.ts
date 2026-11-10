/**
 * Sets a new password for an existing Super Admin and clears any login lockout.
 *
 *   PowerShell:  $env:NEW_PASSWORD = "YourNewPass@123"; npx tsx scripts/reset-admin-password.ts 9876543210
 *   bash:        NEW_PASSWORD='YourNewPass@123' npx tsx scripts/reset-admin-password.ts 9876543210
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password.service';
import { passwordSchema, phoneSchema } from '../src/utils/validators';

async function main() {
  const phone = phoneSchema.parse(process.argv[2]);
  const password = process.env.NEW_PASSWORD;
  if (!password) throw new Error('Set NEW_PASSWORD first');
  passwordSchema.parse(password);

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({ where: { phone, roles: { some: { role: { name: 'SUPER_ADMIN' } } } }, select: { id: true } });
    if (!user) throw new Error(`No Super Admin with phone ${phone}`);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
    console.log(`Password updated for ${phone}. Sign in at /login.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
