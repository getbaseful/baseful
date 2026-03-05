# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go modules
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Runtime stage
FROM alpine:latest

# Install dependencies
RUN apk --no-cache add ca-certificates docker-cli docker-compose git caddy

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/main /app/main

# Expose API port, HTTP, and HTTPS
EXPOSE 8080 80 443

# Run the application
CMD ["/app/main"]
