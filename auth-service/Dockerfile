FROM node:20-alpine

# Non-root user — production security best practice
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Dependencies pehle copy karo — better layer caching
# Agar sirf src code badla toh npm install dobara nahi chalega
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Source code copy karo
COPY src/ ./src/

# Apna folder appuser ko do
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
