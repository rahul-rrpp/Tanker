/**
 * Secure, out-of-band Super Admin provisioning. There is deliberately no HTTP endpoint for this.
 *
 *   npm run create-super-admin -- --name "Asha Rao" --phone 9876543210 --email admin@example.com
 *
 * The password is read from the SUPER_ADMIN_PASSWORD env var or prompted interactively (hidden),
 * never passed as a command-line argument (which would leak into shell history / process lists).
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password.service';
import { emailSchema, fullNameSchema, passwordSchema, phoneSchema } from '../src/utils/validators';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const { values } = parseArgs({
    options: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } },
  });
  const fullName = fullNameSchema.parse(values.name);
  const phone = phoneSchema.parse(values.phone);
  const email = emailSchema.parse(values.email);

  let password = process.env.SUPER_ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password: ');
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) throw new Error('Passwords do not match');
  }
  passwordSchema.parse(password);

  const prisma = new PrismaClient();
  try {
    const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
    if (!role) throw new Error('Roles are not seeded. Run "npm run db:seed" first.');
    const existing = await prisma.user.findFirst({ where: { OR: [{ phone }, { email }] } });
    if (existing) throw new Error('A user with this phone or email already exists');

    const user = await prisma.user.create({
      data: {
        fullName,
        phone,
        email,
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        isPhoneVerified: true,
        isEmailVerified: true,
        accountStatus: 'ACTIVE',
        roles: { create: { roleId: role.id } },
      },
    });
    console.log(`Super Admin created: ${user.fullName} <${user.email}> (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
