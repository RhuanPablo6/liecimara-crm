// Build na Vercel: gera o Prisma Client, compila a API, aplica as migrações e
// garante o administrador inicial. Migrações usam a conexão direta do Neon
// (DATABASE_URL_UNPOOLED) quando existir.
import { execSync } from 'node:child_process';

const run = (cmd, env = process.env) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env });
};

run('npx prisma generate');
run('npx tsc -p tsconfig.json');

if (!process.env.DATABASE_URL) {
  console.warn('\n⚠ DATABASE_URL não definida: migrações e seed ignorados.');
  process.exit(0);
}
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
run('npx prisma migrate deploy', { ...process.env, DATABASE_URL: direct });

if (process.env.SEED_ADMIN_PASSWORD) run('npx tsx prisma/seed.ts');
else console.warn('\n⚠ SEED_ADMIN_PASSWORD não definida: administrador inicial não criado.');
