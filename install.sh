#!/bin/bash

# Baseful Installation Script
# Usage: curl -sSL https://raw.githubusercontent.com/getbaseful/baseful/refs/heads/main/install.sh | bash
# Update mode: ... | bash -s -- update
# Works for both root and non-root users (non-root requires sudo access).

set -e

# --- Configuration ---
INSTALL_DIR="/opt/baseful"
GITHUB_REPO="https://github.com/getbaseful/baseful.git"

# --- Mode flags ---
UPDATE_MODE=0
if [ "${1:-}" = "update" ] || [ "${1:-}" = "--update" ] || [ "${1:-}" = "-u" ]; then
    UPDATE_MODE=1
fi

# --- Privilege helper: root runs directly, non-root uses sudo ---
if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
else
    SUDO="sudo"
fi

# --- Colors ---
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

# Helper to run docker commands — uses sudo for non-root until group is active
run_docker()         { $SUDO docker "$@"; }
run_docker_compose() { $SUDO $DOCKER_COMPOSE_CMD "$@"; }

# Clear screen and show banner
printf "\033[H\033[2J"
printf "%b%b" "$BLUE" "$BOLD"
cat << "EOF"
  ____                 _____       _
 |  _ \               |  ___|     | |
 | |_) | __ _ ___  ___| |_ _   _| |
 |  _ < / _` / __|/ _ \  _| | | | |
 | |_) | (_| \__ \  __/ | | |_| | |
 |____/ \__,_|___/\___|_|  \__,_|_|

   The Open Source Postgres Platform
EOF
printf "%b" "$NC"
echo "------------------------------------------------"

# ============================================================
# Pre-flight: Ask about security hardening
# ============================================================
printf "\n"
if [ "$UPDATE_MODE" -eq 1 ]; then
    DO_HARDEN=0
    info "Update mode enabled (security hardening prompt skipped)."
    warn "Security hardening will be skipped in update mode."
else
    info "Security hardening installs UFW, Fail2ban, and unattended upgrades."
    printf "Apply security hardening? (yes/no) [yes]: "
    read -r HARDEN < /dev/tty
    # Default to yes if empty
    if [ -z "$HARDEN" ]; then
        HARDEN="yes"
    fi
    if [ "$HARDEN" = "yes" ] || [ "$HARDEN" = "y" ]; then
        DO_HARDEN=1
        success "✓ Security hardening will be applied."
    else
        DO_HARDEN=0
        warn "Skipping security hardening."
    fi
fi
printf "\n"

# ============================================================
# [1/8] System Requirements Check
# ============================================================
info "[1/8] Checking system requirements..."

if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
    if command -v systemctl >/dev/null 2>&1; then
        $SUDO systemctl enable --now docker > /dev/null 2>&1
    fi
    if [ "$(id -u)" -ne 0 ]; then
        $SUDO usermod -aG docker "$(whoami)"
        warn "Added $(whoami) to the docker group (takes effect on next login)."
        warn "Using sudo for docker commands during this install session."
    fi
fi

if $SUDO docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    error "Docker Compose is required but not found."
    info "Please install it: https://docs.docker.com/compose/install/"
    exit 1
fi

if ! command -v git >/dev/null 2>&1; then
    warn "Git not found. Installing git..."
    if command -v apt-get >/dev/null 2>&1; then
        $SUDO apt-get update -qq && $SUDO apt-get install -y git > /dev/null 2>&1
    elif command -v yum >/dev/null 2>&1; then
        $SUDO yum install -y git > /dev/null 2>&1
    fi
fi

success "✓ Dependencies are ready."

# ============================================================
# [2/8] Clone Repository
# ============================================================
info "[2/8] Cloning Baseful repository..."

$SUDO mkdir -p "$INSTALL_DIR"
$SUDO chown -R "$(whoami):$(whoami)" "$INSTALL_DIR"

if [ -f "$INSTALL_DIR/docker-compose.yml" ] && grep -q "baseful" "$INSTALL_DIR/docker-compose.yml"; then
    warn "Existing Baseful install found. Updating..."
    cd "$INSTALL_DIR"
    git pull
elif [ -d "$INSTALL_DIR/.git" ]; then
    warn "Directory $INSTALL_DIR already exists. Updating..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone "$GITHUB_REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

success "✓ Repository ready at $INSTALL_DIR."

# ============================================================
# [3/8] Environment Configuration
# ============================================================
info "[3/8] Configuring environment..."

ENV_FILE="$INSTALL_DIR/.env"
ENV_EXAMPLE="$INSTALL_DIR/backend/.env.example"

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"

    info "Generating secure JWT secret..."
    if command -v openssl >/dev/null 2>&1; then
        RAND_SECRET=$(openssl rand -hex 32)
    else
        RAND_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)
    fi
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$ENV_FILE"

    info "Detecting Public IP..."
    DETECTED_IP=$(curl -s -4 https://ifconfig.me 2>/dev/null || curl -s -4 https://api.ipify.org 2>/dev/null || echo "localhost")
    sed -i "s|^PUBLIC_IP=.*|PUBLIC_IP=$DETECTED_IP|" "$ENV_FILE"

    info "Configuring security settings..."
    sed -i "s|^PROXY_SSL_ENABLED=.*|PROXY_SSL_ENABLED=false|"              "$ENV_FILE"
    sed -i "s|^PROXY_IDLE_TIMEOUT=.*|PROXY_IDLE_TIMEOUT=30m|"              "$ENV_FILE"
    sed -i "s|^PROXY_QUERY_TIMEOUT=.*|PROXY_QUERY_TIMEOUT=5m|"             "$ENV_FILE"
    sed -i "s|^PROXY_REVOCATION_CHECK=.*|PROXY_REVOCATION_CHECK=true|"     "$ENV_FILE"
    sed -i "s|^PROXY_MAX_LOG_ENTRIES=.*|PROXY_MAX_LOG_ENTRIES=10000|"       "$ENV_FILE"
    sed -i "s|^PROXY_LOG_PATH=.*|PROXY_LOG_PATH=/var/log/proxy/proxy.log|" "$ENV_FILE"

    success "✓ Configured .env with IP: $DETECTED_IP"
else
    warn "Existing .env file found. Skipping configuration."
    DETECTED_IP=$(grep "^PUBLIC_IP=" "$ENV_FILE" | cut -d'=' -f2)
fi

# ============================================================
# [4/8] Log Directories
# ============================================================
info "[4/8] Creating log directories..."
$SUDO mkdir -p /var/log/proxy
$SUDO chmod 755 /var/log/proxy
success "✓ Log directories ready."

# ============================================================
# [5/8] Docker Network
# ============================================================
info "[5/8] Initializing Docker network..."
if ! run_docker network ls | grep -q "baseful-network"; then
    run_docker network create baseful-network > /dev/null
    success "✓ Created baseful-network."
else
    success "✓ baseful-network already exists."
fi

# ============================================================
# [6/8] Build and Deploy
# ============================================================
info "[6/8] Building and starting services..."
cd "$INSTALL_DIR"
run_docker_compose up -d --build
success "✓ Services started."

# ============================================================
# [7/8] Security Hardening
# ============================================================
if [ "$DO_HARDEN" -eq 1 ]; then
    info "[7/8] Applying security hardening..."

    # --- UFW ---
    if ! command -v ufw >/dev/null 2>&1; then
        $SUDO apt-get install -y ufw > /dev/null 2>&1
    fi

    if ! $SUDO ufw status | grep -q "Status: active"; then
        info "Configuring firewall..."
        $SUDO ufw default deny incoming  > /dev/null 2>&1
        $SUDO ufw default allow outgoing > /dev/null 2>&1
        $SUDO ufw allow 22/tcp           > /dev/null 2>&1
        $SUDO ufw allow 80/tcp           > /dev/null 2>&1
        $SUDO ufw allow 443/tcp          > /dev/null 2>&1
        $SUDO ufw allow 3000/tcp         > /dev/null 2>&1
        $SUDO ufw allow 6432/tcp         > /dev/null 2>&1
        echo "y" | $SUDO ufw enable      > /dev/null 2>&1
        success "✓ UFW firewall configured."
    else
        warn "UFW already active. Skipping — review rules with: ${SUDO} ufw status"
    fi

    # --- Fail2ban ---
    if ! command -v fail2ban-client >/dev/null 2>&1; then
        $SUDO apt-get update -qq         > /dev/null 2>&1
        $SUDO apt-get install -y fail2ban > /dev/null 2>&1
    fi

    if [ ! -f /etc/fail2ban/jail.local ]; then
        info "Configuring Fail2ban..."
        $SUDO tee /etc/fail2ban/jail.local > /dev/null << 'JAIL'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled  = true
port     = ssh
logpath  = %(sshd_log)s

[baseful-proxy]
enabled  = true
port     = 6432
filter   = baseful-proxy
logpath  = /var/log/proxy/proxy.log
maxretry = 10
findtime = 5m
bantime  = 1h
JAIL

        $SUDO tee /etc/fail2ban/filter.d/baseful-proxy.conf > /dev/null << 'FILTER'
[Definition]
failregex = ^\{"timestamp":"[^"]+","level":"WARNING","component":"proxy","message":"(?:Connection failed|Token expired|Token revoked)[^"]*","connection":\{"remote_ip":"<HOST>:
ignoreregex =
FILTER

        $SUDO systemctl enable fail2ban > /dev/null 2>&1
        $SUDO systemctl restart fail2ban > /dev/null 2>&1
        success "✓ Fail2ban configured (SSH + proxy jails active)."
    else
        warn "Fail2ban jail.local already exists. Skipping."
    fi

    # --- Unattended Upgrades ---
    if ! dpkg -l 2>/dev/null | grep -q unattended-upgrades; then
        $SUDO apt-get install -y unattended-upgrades > /dev/null 2>&1
    fi

    if [ ! -f /etc/apt/apt.conf.d/20auto-upgrades ]; then
        info "Enabling unattended security upgrades..."
        $SUDO tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null << 'UPGRADES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
UPGRADES
        success "✓ Automatic security upgrades enabled."
    else
        warn "Unattended upgrades already configured. Skipping."
    fi

    success "✓ Security hardening complete."
else
    info "[7/8] Skipping security hardening."
fi

# ============================================================
# [8/8] Finalization
# ============================================================
info "[8/8] Finalizing installation..."
sleep 3

PUBLIC_IP=$(grep "^PUBLIC_IP=" "$ENV_FILE" | cut -d'=' -f2)

printf "\n\033[1;32m🚀 Baseful has been successfully installed!\033[0m\n"
echo "------------------------------------------------"
printf "\033[1mDashboard:\033[0m      http://%s:3000\n" "$PUBLIC_IP"
printf "\033[1mDatabase Proxy:\033[0m %s:6432\n" "$PUBLIC_IP"
echo "------------------------------------------------"
if [ "$DO_HARDEN" -eq 1 ]; then
    printf "\033[1mSecurity:\033[0m\n"
    printf "  ✔ UFW firewall active\n"
    printf "  ✔ Fail2ban active (SSH + proxy)\n"
    printf "  ✔ Automatic security upgrades enabled\n"
    echo "------------------------------------------------"
fi
warn "Recommended next steps (manual):"
printf "1. Set up Tailscale and lock SSH behind it\n"
printf "2. Harden SSH: disable password auth, set ListenAddress\n"
printf "3. Set up encrypted backups to Cloudflare R2\n\n"
info "Logs:       cd $INSTALL_DIR && $DOCKER_COMPOSE_CMD logs -f"
info "Proxy logs: tail -f /var/log/proxy/proxy.log"
printf "\n"
