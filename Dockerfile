FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --platform=linux --arch=x64

COPY . .

RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["npx", "tsx", "server.ts"]
