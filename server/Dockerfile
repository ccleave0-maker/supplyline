# Portable server image: runs on Railway today, any Docker host (e.g. in Canada) later.
# Build from the repository root:  docker build -f server/Dockerfile -t supplyline-server .
FROM node:24-slim AS build
WORKDIR /repo
RUN npm i -g pnpm@12
COPY . .
RUN pnpm install --frozen-lockfile --filter @supplyline/server...
RUN pnpm --filter @supplyline/server build

FROM node:24-slim
WORKDIR /app
# OpenSSL and the Prisma CLI apply database changes before each deploy:
#   cd server && prisma migrate deploy --config prisma.deploy.config.mjs
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm i -g prisma@7.10.0 && npm cache clean --force
# HOSTNAME: listen on every network interface (Docker sets HOSTNAME to the container id).
ENV NODE_ENV=production PORT=4000 HOSTNAME=0.0.0.0
COPY --from=build /repo/server/.next/standalone ./
COPY --from=build /repo/server/.next/static ./server/.next/static
# Only the schema and migrations (never prisma/private, which holds your own organization's details).
COPY --from=build /repo/server/prisma/schema.prisma ./server/prisma/schema.prisma
COPY --from=build /repo/server/prisma/migrations ./server/prisma/migrations
COPY --from=build /repo/server/prisma.deploy.config.mjs ./server/prisma.deploy.config.mjs
EXPOSE 4000
CMD ["node", "server/server.js"]
