FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S slop && adduser -S slop -G slop
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public
RUN chown -R slop:slop /app
USER slop
EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "src/server.ts"]
