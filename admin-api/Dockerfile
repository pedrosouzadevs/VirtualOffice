# The building of ProtoBuf "messages" must be done out of Docker because grpc-node does not ship with ARM64 binaries.
# See: https://github.com/grpc/grpc-node/issues/1405
# When the issue above is closed, we can move back messages building inside Dockerfile

# protobuf build
FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS proto-builder
WORKDIR /usr/src
COPY messages/package-lock.json messages/package.json ./
RUN npm ci
COPY messages .
COPY libs ./../libs
RUN npm run tag-version && npm run ts-proto

# final production image
FROM node:24-trixie-slim
EXPOSE 3000
WORKDIR /usr/src
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY admin-api/package.json admin-api/package.json
COPY libs/messages/package.json libs/messages/package.json
RUN npm ci --workspace admin-api
COPY libs ./libs
COPY --from=proto-builder /usr/libs/messages/src ./libs/messages/src
COPY --chown=node:node admin-api admin-api
RUN chown node:node -R /usr/src/admin-api
WORKDIR /usr/src/admin-api

HEALTHCHECK --interval=5s --timeout=10s --start-period=5s --retries=10 CMD curl -f http://localhost:3000/healthz || exit 1
USER node
CMD ["npm", "run", "start"]
