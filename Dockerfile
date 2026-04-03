FROM node:22-alpine AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

COPY src ./src
COPY tsconfig.json ./
COPY README.md LICENSE ./

RUN pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV MCP_PATH=/
ENV HEALTH_PATH=/healthz

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/build ./build
COPY README.md LICENSE ./

EXPOSE 3000

CMD ["node", "build/http.js"]
