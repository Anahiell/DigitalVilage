# Stateful Node process with persistent volume mounted at /data.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js data.js game-content.js mailer.js mail-queue.js session-lifecycle.js ./
COPY public ./public
COPY deploy ./deploy
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/data/village.db DEV_EMAIL_OUTBOX=0
RUN mkdir -p /data
EXPOSE 3000
CMD ["npm","start"]
