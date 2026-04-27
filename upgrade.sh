#!/bin/bash

# Baseful VPS Upgrade Script
# Usage:
#   curl -sSL https://raw.githubusercontent.com/getbaseful/baseful/refs/heads/main/upgrade.sh | bash
# Optional:
#   INSTALL_DIR=/opt/baseful BASEFUL_BRANCH=main bash upgrade.sh

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/baseful}"
DEFAULT_REMOTE_URL="https://github.com/getbaseful/baseful.git"

if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
else
    SUDO="sudo"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()    { printf "%b%s%b\n" "$BLUE" "$1" "$NC"; }
success() { printf "%b%b%s%b\n" "$GREEN" "$BOLD" "$1" "$NC"; }
warn()    { printf "%b%s%b\n" "$YELLOW" "$1" "$NC"; }
error()   { printf "%b%b%s%b\n" "$RED" "$BOLD" "$1" "$NC"; }

run_docker()         { $SUDO docker "$@"; }
run_docker_compose() { $SUDO $DOCKER_COMPOSE_CMD "$@"; }

generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64
    fi
}

get_env_value() {
    local key="$1"
    [ -f "$ENV_FILE" ] || return 0
    awk -v key="$key" '
        index($0, key "=") == 1 {
            value = substr($0, length(key) + 2)
        }
        END {
            if (value != "") {
                print value
            }
        }
    ' "$ENV_FILE"
}

set_env_value() {
    local key="$1"
    local value="$2"
    local tmp_file

    tmp_file="$(mktemp)"
    if [ -f "$ENV_FILE" ]; then
        awk -v key="$key" -v value="$value" '
            BEGIN {
                updated = 0
            }
            index($0, key "=") == 1 {
                if (!updated) {
                    print key "=" value
                    updated = 1
                }
                next
            }
            {
                print
            }
            END {
                if (!updated) {
                    print key "=" value
                }
            }
        ' "$ENV_FILE" > "$tmp_file"
    else
        printf "%s=%s\n" "$key" "$value" > "$tmp_file"
    fi

    cat "$tmp_file" > "$ENV_FILE"
    rm -f "$tmp_file"
}

ensure_env_default() {
    local key="$1"
    local value="$2"
    local current_value

    current_value="$(get_env_value "$key")"
    if [ -z "$current_value" ]; then
        set_env_value "$key" "$value"
        ENV_CHANGED=1
        info "Added $key to .env"
    fi
}

ensure_env_secret() {
    local key="$1"
    local current_value

    current_value="$(get_env_value "$key")"
    if [ -z "$current_value" ]; then
        set_env_value "$key" "$(generate_secret)"
        ENV_CHANGED=1
        info "Generated $key"
    fi
}

is_proxy_host_placeholder() {
    local host="$1"
    case "$host" in
        ""|"0.0.0.0"|"::"|"localhost"|"127.0.0.1"|"::1"|"[::1]")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

printf "\033[H\033[2J"
printf "%b%b" "$BLUE" "$BOLD"
cat << "EOF"
  ____                 _____       _
 |  _ \               |  ___|     | |
 | |_) | __ _ ___  ___| |_ _   _| |
 |  _ < / _` / __|/ _ \  _| | | | |
 | |_) | (_| \__ \  __/ | | |_| | |
 |____/ \__,_|___/\___|_|  \__,_|_|

   Baseful Upgrade
EOF
printf "%b" "$NC"
echo "------------------------------------------------"

info "[1/6] Checking prerequisites..."

if ! command -v git >/dev/null 2>&1; then
    error "Git is required but was not found."
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    error "Docker is required but was not found."
    exit 1
fi

if $SUDO docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    error "Docker Compose is required but was not found."
    exit 1
fi

success "✓ Prerequisites look good."

info "[2/6] Validating existing Baseful install..."

if [ ! -d "$INSTALL_DIR/.git" ]; then
    error "No git checkout found at $INSTALL_DIR"
    info "Set INSTALL_DIR=/path/to/baseful if your install lives elsewhere."
    exit 1
fi

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    error "No docker-compose.yml found at $INSTALL_DIR"
    exit 1
fi

cd "$INSTALL_DIR"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    error "Tracked file changes were found in $INSTALL_DIR."
    info "Please commit/stash them first so the upgrade can fast-forward safely."
    exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "HEAD" ]; then
    CURRENT_BRANCH="main"
fi
TARGET_BRANCH="${BASEFUL_BRANCH:-$CURRENT_BRANCH}"

ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
if [ -z "$ORIGIN_URL" ]; then
    git remote add origin "$DEFAULT_REMOTE_URL"
    ORIGIN_URL="$DEFAULT_REMOTE_URL"
fi

success "✓ Found Baseful install at $INSTALL_DIR."

info "[3/6] Pulling the latest code from GitHub..."
git fetch origin "$TARGET_BRANCH"
git pull --ff-only origin "$TARGET_BRANCH"
success "✓ Repository updated from $TARGET_BRANCH."

info "[4/6] Migrating environment configuration..."

ENV_FILE="$INSTALL_DIR/.env"
ENV_EXAMPLE="$INSTALL_DIR/backend/.env.example"
ENV_BACKUP="$INSTALL_DIR/.env.bak.$(date +%Y%m%d%H%M%S)"
ENV_CHANGED=0
WARNINGS=()

if [ ! -f "$ENV_FILE" ]; then
    if [ ! -f "$ENV_EXAMPLE" ]; then
        error "Cannot create .env because $ENV_EXAMPLE is missing."
        exit 1
    fi
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ENV_CHANGED=1
    warn "No .env file existed. Created a new one from backend/.env.example."
fi

cp "$ENV_FILE" "$ENV_BACKUP"
info "Backed up .env to $ENV_BACKUP"

JWT_SECRET_VALUE="$(get_env_value "JWT_SECRET")"
if [ -z "$JWT_SECRET_VALUE" ]; then
    JWT_SECRET_VALUE="$(generate_secret)"
    set_env_value "JWT_SECRET" "$JWT_SECRET_VALUE"
    ENV_CHANGED=1
    WARNINGS+=("JWT_SECRET was missing and has been generated. Existing issued tokens may need to be recreated after restart.")
fi

ensure_env_secret "USER_JWT_SECRET"
ensure_env_secret "PROXY_JWT_SECRET"
ensure_env_default "PROXY_TOKEN_TTL" "90d"
ensure_env_default "ENABLE_UNSAFE_RESET_ADMIN" "false"
ensure_env_default "PROXY_MAX_CONNECTIONS" "500"
ensure_env_default "PROXY_MAX_CONNECTIONS_PER_IP" "25"
ensure_env_default "PROXY_CONNECTION_RATE_PER_MINUTE" "120"
ensure_env_default "PROXY_LOG_PATH" "/var/log/proxy/proxy.log"

LEGACY_CERT_PATH="$(get_env_value "PROXY_TLS_CERT_FILE")"
LEGACY_KEY_PATH="$(get_env_value "PROXY_TLS_KEY_FILE")"
PROXY_CERT_PATH="$(get_env_value "PROXY_CERT_FILE")"
PROXY_KEY_PATH="$(get_env_value "PROXY_KEY_FILE")"

if [ -z "$PROXY_CERT_PATH" ] && [ -n "$LEGACY_CERT_PATH" ]; then
    set_env_value "PROXY_CERT_FILE" "$LEGACY_CERT_PATH"
    ENV_CHANGED=1
    info "Migrated PROXY_TLS_CERT_FILE -> PROXY_CERT_FILE"
fi
if [ -z "$PROXY_KEY_PATH" ] && [ -n "$LEGACY_KEY_PATH" ]; then
    set_env_value "PROXY_KEY_FILE" "$LEGACY_KEY_PATH"
    ENV_CHANGED=1
    info "Migrated PROXY_TLS_KEY_FILE -> PROXY_KEY_FILE"
fi

DOMAIN_NAME_VALUE="$(get_env_value "DOMAIN_NAME")"
PUBLIC_IP_VALUE="$(get_env_value "PUBLIC_IP")"
PROXY_HOST_VALUE="$(get_env_value "PROXY_HOST")"

if [ -n "$DOMAIN_NAME_VALUE" ]; then
    if is_proxy_host_placeholder "$PROXY_HOST_VALUE" || [ "$PROXY_HOST_VALUE" = "$PUBLIC_IP_VALUE" ]; then
        set_env_value "PROXY_HOST" "$DOMAIN_NAME_VALUE"
        PROXY_HOST_VALUE="$DOMAIN_NAME_VALUE"
        ENV_CHANGED=1
        info "Set PROXY_HOST to DOMAIN_NAME ($DOMAIN_NAME_VALUE)"
    fi
elif is_proxy_host_placeholder "$PROXY_HOST_VALUE" && [ -n "$PUBLIC_IP_VALUE" ]; then
    set_env_value "PROXY_HOST" "$PUBLIC_IP_VALUE"
    PROXY_HOST_VALUE="$PUBLIC_IP_VALUE"
    ENV_CHANGED=1
    WARNINGS+=("PROXY_HOST was updated to PUBLIC_IP ($PUBLIC_IP_VALUE). Public proxy TLS now expects a certificate valid for that exact host. A DNS hostname is strongly recommended.")
fi

if is_proxy_host_placeholder "$PROXY_HOST_VALUE"; then
    WARNINGS+=("PROXY_HOST is still set to a local placeholder value. Production proxy connections should use a real public hostname with a valid TLS certificate.")
fi

if [ -z "$DOMAIN_NAME_VALUE" ]; then
    WARNINGS+=("DOMAIN_NAME is not set. If this VPS serves public production databases, configure a DNS hostname and working TLS before relying on newly generated public connection strings.")
fi

if [ "$ENV_CHANGED" -eq 1 ]; then
    success "✓ Environment settings updated."
else
    success "✓ Environment already had the required settings."
fi

info "[5/6] Rebuilding and restarting Baseful..."

$SUDO mkdir -p /var/log/proxy >/dev/null 2>&1 || true
$SUDO chmod 755 /var/log/proxy >/dev/null 2>&1 || true

if ! run_docker network ls | grep -q "baseful-network"; then
    run_docker network create baseful-network >/dev/null
    info "Created missing baseful-network"
fi

run_docker_compose up -d --build
success "✓ Containers rebuilt and restarted."

info "[6/6] Current service status..."
run_docker_compose ps

printf "\n"
success "Upgrade complete."
info "Env backup:  $ENV_BACKUP"
info "Install dir: $INSTALL_DIR"

if [ "${#WARNINGS[@]}" -gt 0 ]; then
    printf "\n"
    warn "Important follow-up:"
    for warning_text in "${WARNINGS[@]}"; do
        printf " - %s\n" "$warning_text"
    done
fi

printf "\n"
warn "After this deploy:"
printf "1. Verify the proxy is healthy: cd %s && %s ps\n" "$INSTALL_DIR" "$DOCKER_COMPOSE_CMD"
printf "2. Check startup logs if anything looks off: cd %s && %s logs --tail=100\n" "$INSTALL_DIR" "$DOCKER_COMPOSE_CMD"
printf "3. If your older databases were created before the proxy hardening, close any legacy raw Postgres host ports at the VPS firewall or recreate those database containers.\n"
printf "\n"
