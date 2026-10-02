FROM node:24-alpine
# BEAUDIT E5: the brand-logo resolver shells out to python3.
RUN apk add --no-cache python3 chromium
WORKDIR /app/server

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Context is filtered by .dockerignore so local .env / .env.* files are never copied.
COPY . .
RUN test -d .image-assets || (echo "run node scripts/stage-server-image-assets.mjs before docker build" >&2; exit 1)
RUN mv .image-assets/* .. && rmdir .image-assets

ENV LISTEN_HOST=0.0.0.0
ENV PORT=3847
ENV JOBBORED_CHROMIUM_PATH=/usr/bin/chromium-browser
EXPOSE 3847
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3847)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# When bound to 0.0.0.0 every non-health endpoint requires a shared token.
# Provide one at runtime and send it as `Authorization: Bearer ...` or `x-api-token`.
# Set explicit browser origins too: -e COMMAND_CENTER_ALLOWED_ORIGINS=https://your.app
CMD ["node", "index.mjs"]
