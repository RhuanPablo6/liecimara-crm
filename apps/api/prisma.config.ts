// Configuração da CLI do Prisma.
// Com prisma.config.ts o Prisma deixa de ler o .env automaticamente, então
// carregamos aqui o .env da pasta da API ou, se não existir, o da raiz do
// monorepo (é onde o .env.example orienta criá-lo).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

for (const candidate of ['.env', '../../.env']) {
  const file = path.resolve(__dirname, candidate);
  if (existsSync(file)) {
    process.loadEnvFile(file); // não sobrescreve variáveis já definidas
    break;
  }
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
