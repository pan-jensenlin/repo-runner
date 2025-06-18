# Start from the lsproxy image and add Node to it
FROM agenticlabs/lsproxy:0.4.3

# Install tools from your original Dockerfile, plus prerequisites for adding the Node.js repository.
RUN apt-get update && \
  apt-get install -y curl tree ca-certificates gnupg && \
  rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list > /dev/null
RUN apt-get update && \
  apt-get install -y nodejs

# Create directories and set permissions from your original Dockerfile
RUN mkdir -p /mnt/workspace /usr/local/cargo \
    && chown -R 1000:1000 /mnt/workspace /usr/local/cargo

# Set rustup default from your original Dockerfile
RUN rustup default 1.81.0

# Set the working directory for the action
WORKDIR /app

# Copy package manifests and install dependencies
# Using --chown to ensure the user can write to the directories
COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm install

# Copy the rest of the action's source code
COPY --chown=1000:1000 . .

# Build the application
RUN npm run package

# Switch to a non-root user
USER 1000

# Set the entrypoint to run the action
ENTRYPOINT ["node", "/app/dist/index.js"]