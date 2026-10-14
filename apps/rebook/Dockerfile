# Rebook, as a container. Build from this folder:
#
#   docker build -t haikit-rebook .
#   docker run -p 8080:8080 haikit-rebook
#
# With no ANTHROPIC_API_KEY it runs the scripted guide, at no model cost.
FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server/main.ts"]
