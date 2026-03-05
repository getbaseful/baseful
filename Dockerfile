# Stage 1: Build the Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Stage 3: Final Runtime Image
FROM alpine:latest
RUN apk --no-cache add ca-certificates docker-cli docker-compose git caddy

WORKDIR /app
# Copy backend binary
COPY --from=backend-builder /app/backend/main /app/main
# Copy frontend built assets into the expected location for the Go backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose the default port
EXPOSE 8080

# Run the application
# Specify PORT env var if you want to run on a different port, e.g. -e PORT=3000
CMD ["/app/main"]
