FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY . .

ENV LISTEN_HOST=0.0.0.0
ENV PORT=3847
EXPOSE 3847

# When bound to 0.0.0.0 every non-health endpoint requires a shared token.
# Provide one at runtime and send it as `Authorization: Bearer ...` or `x-api-token`.
# Set explicit browser origins too: -e COMMAND_CENTER_ALLOWED_ORIGINS=https://your.app
CMD ["node", "index.mjs"]
