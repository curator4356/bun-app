FROM oven/bun:1

WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Create downloads directory
RUN mkdir -p downloads && chown -R bun:bun downloads

# Switch to non-root user
USER bun

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "index.ts"]