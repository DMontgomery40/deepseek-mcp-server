FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

LABEL io.modelcontextprotocol.server.name="io.github.DMontgomery40/deepseek"
LABEL org.opencontainers.image.source="https://github.com/DMontgomery40/deepseek-mcp-server"

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/build ./build

ENTRYPOINT ["node", "build/index.js"]
