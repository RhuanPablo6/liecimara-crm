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

// Mesma busca da API (src/config/env.ts), já compilada em dist/.
const { findDatabaseUrl } = await import('../dist/config/env.js');
const pooled = findDatabaseUrl(process.env);
if (!pooled) {
  console.warn('\n⚠ Nenhuma URL de banco encontrada (DATABASE_URL, POSTGRES_URL...): migrações e seed ignorados.');
  console.warn('  Conecte o banco em Storage e faça Redeploy.');
  process.exit(0);
}
const direct = findDatabaseUrl(process.env, { direct: true });
run('npx prisma migrate deploy', { ...process.env, DATABASE_URL: direct });

if (process.env.SEED_ADMIN_PASSWORD) run('npx tsx prisma/seed.ts', { ...process.env, DATABASE_URL: pooled });
else console.warn('\n⚠ SEED_ADMIN_PASSWORD não definida: administrador inicial não criado.');
