# Imagem da API e do worker (contexto: raiz do repositório). Fica fora de apps/api
# para a Vercel não tratar a API como contêiner.
# API e worker compartilham a mesma imagem; o comando define o papel.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @liecimara/api... --frozen-lockfile=false

FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @liecimara/api build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# openssl: exigido pelo schema engine do Prisma (migrate deploy) no Alpine
RUN apk add --no-cache openssl && corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
# prisma.config.ts e src/ são usados por `prisma migrate deploy` e pelo seed (pre-deploy)
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/apps/api/src ./apps/api/src
COPY --from=build /app/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
USER app
EXPOSE 4000
CMD ["node", "dist/main.js"]
