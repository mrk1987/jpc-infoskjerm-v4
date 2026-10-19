FROM node:22-alpine

# Skjermen viser lokal tid; uten tzdata faller Node tilbake til UTC.
# curl brukes av Coolifys helsesjekk, som ellers feiler stille.
RUN apk add --no-cache tzdata curl
ENV TZ=Europe/Oslo \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1
CMD ["node", "server.js"]
