FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/src/index.js"]
