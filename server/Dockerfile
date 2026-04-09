FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY . .

ENV LISTEN_HOST=0.0.0.0
ENV PORT=3847
EXPOSE 3847

CMD ["node", "index.mjs"]
