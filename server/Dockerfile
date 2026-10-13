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
# HOSTNAME: listen on every network interface (Docker sets HOSTNAME to the container id).
ENV NODE_ENV=production PORT=4000 HOSTNAME=0.0.0.0
COPY --from=build /repo/server/.next/standalone ./
COPY --from=build /repo/server/.next/static ./server/.next/static
COPY --from=build /repo/server/prisma ./server/prisma
EXPOSE 4000
CMD ["node", "server/server.js"]
