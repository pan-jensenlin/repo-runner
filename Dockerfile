# ---- Builder ----
# Use a full Node image as the builder to compile our TypeScript
FROM node:20 as builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

# Build the distributable files. This step creates a self-contained 'dist' directory
RUN npm run package


# ---- Final ----
# Start from the original base image which has the rust environment
FROM agenticlabs/lsproxy:0.4.3

# We still need Node.js to run the compiled JavaScript, install it cleanly.
RUN apt-get update && \
  apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
  rm -rf /var/lib/apt/lists/*
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list > /dev/null
RUN apt-get update && \
  apt-get install -y --no-install-recommends nodejs && \
  rm -rf /var/lib/apt/lists/*

# Create directories and set permissions as before.
# The base image already contains the rustup/cargo setup.
RUN mkdir -p /mnt/workspace /app \
    && chown -R 1000:1000 /mnt/workspace /app

WORKDIR /app

# Copy the compiled application from the builder
COPY --chown=1000:1000 --from=builder /app/dist ./dist

# Switch to a non-root user
USER 1000

# Set the entrypoint to run the action
ENTRYPOINT ["node", "/app/dist/index.js"]
