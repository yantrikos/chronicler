# Chronicler — web + API proxy in a single image.
#
# Multi-stage: build frontend with Vite, then ship a slim runtime with Node
# and the built assets + the tiny proxy server.

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --include=dev
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV CHRONICLER_PORT=3001
ENV CHRONICLER_BIND=0.0.0.0
ENV CHRONICLER_YANTRIKDB_URL=http://yantrikdb:8420/mcp
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist

EXPOSE 3001
CMD ["node", "server/index.mjs"]
