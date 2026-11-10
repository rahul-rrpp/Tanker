/**
 * Idempotent seed for roles, permissions, role→permission mappings and marketplace reference data
 * (products, tanker types, pricing rules, platform settings). Safe to run on every deploy.
 * Does NOT create any users. Demo data lives in prisma/seed-demo.ts (npm run db:seed:demo).
 */
import { PrismaClient, type RoleName } from '@prisma/client';
import { PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_PERMISSIONS } from '../src/config/rbac';
import { seedReferenceData } from './reference-data';
import { ADMIN_PERMISSION_KEYS } from '../src/config/admin-permissions';
import { seedAdminData } from './admin-seed';

export async function seedRbac(prisma: PrismaClient) {
  const ALL_PERMISSIONS: Record<string, string> = { ...PERMISSIONS, ...ADMIN_PERMISSION_KEYS };
  for (const [key, description] of Object.entries(ALL_PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const permissions = await prisma.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.key, p.id]));

  for (const [name, keys] of Object.entries(ROLE_PERMISSIONS) as [RoleName, string[]][]) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description: ROLE_DESCRIPTIONS[name] },
      create: { name, description: ROLE_DESCRIPTIONS[name] },
    });
    const roleKeys = name === 'SUPER_ADMIN' ? [...keys, ...Object.keys(ADMIN_PERMISSION_KEYS)] : keys;
    const wanted = roleKeys.map((k) => permId.get(k)!);
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } }),
      prisma.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);
  }
  // Remove permissions no longer defined in code.
  await prisma.permission.deleteMany({ where: { key: { notIn: Object.keys(ALL_PERMISSIONS) } } });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedRbac(prisma)
    .then(() => seedReferenceData(prisma))
    .then(() => seedAdminData(prisma))
    .then(async () => {
      const roles = await prisma.role.count();
      const perms = await prisma.permission.count();
      const products = await prisma.product.count();
      const rules = await prisma.pricingRule.count();
      console.log(`Seeded ${roles} roles, ${perms} permissions, ${products} products and ${rules} pricing rules.`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
