# Introducing HaiKIT, as a container. Build from this folder:
#
#   docker build -t haikit-intro .
#   docker run -p 8080:8080 haikit-intro
#
# Optional: ANTHROPIC_API_KEY (Claude Haiku 5.5 instead of the scripted guide),
# HAI_MODEL (another Claude model), DATABASE_URL (durable conversations in
# Postgres instead of memory).

FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app

# dependencies first, so a code change doesn't reinstall them
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server/main.ts"]
