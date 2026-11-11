# Planhane Bulut: tanıtım sitesi (/), web uygulaması (/app), yönetim paneli (/admin) ve API tek kapta.
FROM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build:web-cloud && npm run build:cloud

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 STATIC_ROOT=/app
COPY --from=build /src/cloud-dist ./cloud-dist
COPY --from=build /src/dist-web ./dist-web
COPY --from=build /src/site ./site
COPY --from=build /src/cloud/public ./cloud/public
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "cloud-dist/server.cjs"]
