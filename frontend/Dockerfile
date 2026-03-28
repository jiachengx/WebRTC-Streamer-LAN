# Copyright (c) 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved.
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Serve with a lightweight static server
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
