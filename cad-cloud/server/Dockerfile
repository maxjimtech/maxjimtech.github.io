# Build from repository root on the cloud host, never on the user's computer.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY api/cad.mjs api/cad.mjs
COPY cad-cloud/server/guest.mjs cad-cloud/server/guest.mjs
COPY cad-cloud/server/start.mjs cad-cloud/server/start.mjs
USER node
EXPOSE 8080
CMD ["node","cad-cloud/server/start.mjs"]
