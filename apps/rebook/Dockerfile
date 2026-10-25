# Rebook, as a container. Build from this folder:
#
#   docker build -t haikit-rebook .
#   docker run --env-file .env -p 8080:8080 haikit-rebook
#
# .env never goes into the image (.dockerignore leaves it out): --env-file
# passes its variables when the container starts. With no ANTHROPIC_API_KEY
# it runs the scripted guide, at no model cost.

# The page: Vite builds the components, the ops bar and the Tailwind
# stylesheet into dist/. Only dist/ leaves this stage.
FROM node:24-slim AS page
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The server runs its TypeScript as it is, with no build step.
FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/server src/server
COPY src/shared src/shared
COPY --from=page /app/dist dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server/main.ts"]
