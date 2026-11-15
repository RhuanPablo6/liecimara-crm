# Imagem do painel (contexto: raiz do repositório).
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @liecimara/web... --frozen-lockfile=false

FROM deps AS build
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @liecimara/web build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# O servidor standalone do Next escuta em HOSTNAME; sem isto ele usaria o nome do contêiner.
ENV HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
