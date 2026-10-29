# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN npm i -g pnpm@10.6.5
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @town/server...
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @town/server... build \
 && pnpm --filter @town/server deploy --prod --legacy /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=2567
COPY --from=build /out .
COPY world ./world
ENV WORLD_DIR=/app/world
EXPOSE 2567
CMD ["node", "dist/index.js"]
