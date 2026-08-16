FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
EXPOSE 3004
USER node
CMD ["node", "index.js"]
