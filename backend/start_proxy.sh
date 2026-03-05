#!/bin/bash

# baseful/backend/start_proxy.sh
# Starts the PostgreSQL proxy in a Docker container on baseful-network

set -e

echo "=== Baseful PostgreSQL Proxy ==="
echo ""

# Get the absolute path to the backend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if proxy is already running
if docker ps --format '{{.Names}}' | grep -q "^baseful-proxy$"; then
    echo "Proxy is already running"
    exit 0
fi

# Kill any existing proxy containers
echo "Cleaning up any existing proxy containers..."
docker rm -f baseful-proxy 2>/dev/null || true

# Determine architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    GOARCH="arm64"
elif [ "$ARCH" = "x86_64" ]; then
    GOARCH="amd64"
else
    GOARCH="amd64"  # Default to amd64
fi

echo "Building proxy for $ARCH ($GOARCH)..."
CGO_ENABLED=0 GOOS=linux GOARCH="$GOARCH" go build -o proxy-server main.go

echo "Starting proxy container..."
docker run -d \
    --name baseful-proxy \
    --network baseful-network \
    -p 6432:6432 \
    -v "$SCRIPT_DIR/data.db:/app/data.db:ro" \
    -e PROXY_PORT=6432 \
    -e PROXY_HOST=0.0.0.0 \
    -e PROXY_ON_HOST=false \
    -e DB_READ_ONLY=true \
    -e PROXY_ONLY=true \
    golang:1.25-alpine \
    /app/proxy-server

echo ""
echo "Waiting for proxy to start..."
sleep 3

# Check if proxy is running
if docker ps --format '{{.Names}}' | grep -q "^baseful-proxy$"; then
    echo "Proxy is running!"
    echo ""
    echo "You can now connect to databases using:"
    echo "  psql \"postgresql://token:<JWT_TOKEN>@localhost:6432/db_<DATABASE_ID>\""
    echo ""
    echo "Example:"
    echo "  psql \"postgresql://token:eyJ...@localhost:6432/db_1\""
else
    echo "Proxy failed to start"
    echo ""
    echo "Check logs with:"
    echo "  docker logs baseful-proxy"
    exit 1
fi
