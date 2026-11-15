// Cria o administrador inicial e garante o catálogo de procedimentos da clínica.
// Uso: pnpm --filter @liecimara/api prisma:seed
import { createPrismaClient } from '../src/infra/prisma/client.js';
import { hashPassword } from '../src/modules/auth/auth.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida');
const prisma = createPrismaClient(process.env.DATABASE_URL);

// Procedimentos oferecidos pela clínica (preço sugerido é definido no CRM, em Financeiro → Procedimentos).
const PROCEDURES: [string, number | null][] = [
  ['Preenchimento', null],
  ['Botox', null],
  ['Bioestimulador', null],
  ['Lavieen', null],
  ['Ultraformer MPT', null],
  ['Combo botox + Preenchimento', null],
  ['Combo botox + Bioestimulador', null],
];

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@clinica.local').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!password || password.length < 10) throw new Error('Defina SEED_ADMIN_PASSWORD com ao menos 10 caracteres');

  // As variáveis são a fonte da verdade do administrador inicial: a cada deploy
  // a senha é sincronizada e o acesso reativado (útil para recuperar o acesso).
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Administrador', role: 'ADMIN', passwordHash },
    update: { passwordHash, role: 'ADMIN', active: true },
  });

  for (const [name, price] of PROCEDURES) {
    await prisma.procedure.upsert({ where: { name }, create: { name, defaultPriceCents: price }, update: {} });
  }
  console.log(`Seed concluído. Administrador: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
