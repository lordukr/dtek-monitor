# Use official Playwright image with Node.js and browsers pre-installed
FROM mcr.microsoft.com/playwright:v1.55.0-noble

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application files
COPY monitor.js ./

# Create artifacts directory
RUN mkdir -p artifacts

# Set environment variables (will be overridden by docker-compose)
ENV NODE_ENV=production

# Default command (overridden by docker-compose)
CMD ["node", "monitor.js"]
