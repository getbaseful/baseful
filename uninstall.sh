#!/bin/bash

# Baseful Uninstall Script
# Completely removes Baseful and all related components.
# Usage: bash uninstall.sh

# --- Privilege helper ---
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

INSTALL_DIR="/opt/baseful"

echo ""
warn "⚠️  This will completely remove Baseful and ALL related components:"
printf "   - All Baseful Docker containers, images, and volumes\n"
printf "   - The $INSTALL_DIR directory\n"
printf "   - Docker (fully uninstalled)\n"
printf "   - Fail2ban (fully uninstalled)\n"
printf "   - UFW (disabled and uninstalled)\n"
printf "   - Unattended upgrades\n"
printf "   - Proxy log directory (/var/log/proxy)\n"
echo ""
printf "Are you sure? Type 'yes' to continue: "
read -r CONFIRM < /dev/tty

if [ "$CONFIRM" != "yes" ]; then
    info "Aborted."
    exit 0
fi

echo ""
info "Starting uninstall..."
echo "------------------------------------------------"

# ============================================================
# [1/7] Stop and remove Baseful containers + volumes
# ============================================================
info "[1/7] Removing Baseful containers and volumes..."

if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    cd "$INSTALL_DIR"
    if command -v docker >/dev/null 2>&1; then
        $SUDO docker compose down --volumes --remove-orphans 2>/dev/null || \
        $SUDO docker-compose down --volumes --remove-orphans 2>/dev/null || true
    fi
    success "✓ Containers and volumes removed."
else
    warn "No docker-compose.yml found in $INSTALL_DIR. Skipping."
fi

if command -v docker >/dev/null 2>&1; then
    # Remove any lingering baseful containers
    BASEFUL_CONTAINERS=$($SUDO docker ps -aq --filter "name=baseful" 2>/dev/null || true)
    if [ -n "$BASEFUL_CONTAINERS" ]; then
        $SUDO docker rm -f $BASEFUL_CONTAINERS 2>/dev/null || true
    fi

    # Remove baseful images
    BASEFUL_IMAGES=$($SUDO docker images -q --filter "reference=*baseful*" 2>/dev/null || true)
    if [ -n "$BASEFUL_IMAGES" ]; then
        $SUDO docker rmi -f $BASEFUL_IMAGES 2>/dev/null || true
    fi

    # Remove baseful network
    $SUDO docker network rm baseful-network 2>/dev/null || true

    success "✓ Containers, images, and network removed."
fi

# ============================================================
# [2/7] Remove install directory
# ============================================================
info "[2/7] Removing $INSTALL_DIR..."
if [ -d "$INSTALL_DIR" ]; then
    $SUDO rm -rf "$INSTALL_DIR"
    success "✓ Removed $INSTALL_DIR."
else
    warn "Directory $INSTALL_DIR not found. Skipping."
fi

# ============================================================
# [3/7] Uninstall Docker
# ============================================================
info "[3/7] Uninstalling Docker..."

if command -v docker >/dev/null 2>&1 || dpkg -l | grep -q docker 2>/dev/null; then
    $SUDO systemctl stop docker 2>/dev/null || true
    $SUDO systemctl stop docker.socket 2>/dev/null || true
    $SUDO systemctl disable docker 2>/dev/null || true

    $SUDO apt-get purge -y \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-compose-plugin \
        docker-ce-rootless-extras \
        docker-buildx-plugin \
        docker-model-plugin \
        docker.io \
        docker-compose \
        2>/dev/null || true

    $SUDO rm -rf /var/lib/docker
    $SUDO rm -rf /var/lib/containerd
    $SUDO rm -rf /etc/docker
    $SUDO rm -f /etc/apt/sources.list.d/docker.list
    $SUDO rm -f /etc/apt/keyrings/docker.asc
    $SUDO rm -f /etc/apt/keyrings/docker.gpg

    $SUDO apt-get autoremove -y 2>/dev/null || true
    $SUDO apt-get autoclean 2>/dev/null || true

    success "✓ Docker fully removed."
else
    warn "Docker not found. Skipping."
fi

# ============================================================
# [4/7] Uninstall Fail2ban
# ============================================================
info "[4/7] Uninstalling Fail2ban..."

if command -v fail2ban-client >/dev/null 2>&1 || dpkg -l | grep -q fail2ban 2>/dev/null; then
    $SUDO systemctl stop fail2ban 2>/dev/null || true
    $SUDO systemctl disable fail2ban 2>/dev/null || true
    $SUDO apt-get purge -y fail2ban 2>/dev/null || true
    $SUDO rm -rf /etc/fail2ban
    $SUDO rm -rf /var/lib/fail2ban
    $SUDO rm -rf /var/log/fail2ban*
    $SUDO apt-get autoremove -y 2>/dev/null || true
    success "✓ Fail2ban fully removed."
else
    warn "Fail2ban not found. Skipping."
fi

# ============================================================
# [5/7] Disable and uninstall UFW
# ============================================================
info "[5/7] Disabling and uninstalling UFW..."

if command -v ufw >/dev/null 2>&1 || dpkg -l | grep -q "^ii  ufw" 2>/dev/null; then
    echo "y" | $SUDO ufw disable 2>/dev/null || true
    $SUDO apt-get purge -y ufw 2>/dev/null || true
    $SUDO rm -rf /etc/ufw
    $SUDO rm -rf /var/lib/ufw
    $SUDO apt-get autoremove -y 2>/dev/null || true
    success "✓ UFW disabled and removed."
else
    warn "UFW not found. Skipping."
fi

# ============================================================
# [6/7] Remove unattended upgrades
# ============================================================
info "[6/7] Removing unattended upgrades..."

if dpkg -l | grep -q unattended-upgrades 2>/dev/null; then
    $SUDO systemctl stop unattended-upgrades 2>/dev/null || true
    $SUDO systemctl disable unattended-upgrades 2>/dev/null || true
    $SUDO apt-get purge -y unattended-upgrades 2>/dev/null || true
    $SUDO rm -f /etc/apt/apt.conf.d/20auto-upgrades
    $SUDO rm -f /etc/apt/apt.conf.d/50unattended-upgrades
    $SUDO apt-get autoremove -y 2>/dev/null || true
    success "✓ Unattended upgrades removed."
else
    warn "Unattended upgrades not found. Skipping."
fi

# ============================================================
# [7/7] Remove log directory
# ============================================================
info "[7/7] Removing proxy log directory..."
$SUDO rm -rf /var/log/proxy
success "✓ Removed /var/log/proxy."

# ============================================================
# Done
# ============================================================
echo ""
printf "\033[1;32m✅ Everything has been fully uninstalled.\033[0m\n"
echo "------------------------------------------------"
printf "Left in place:\n"
printf "  - Git\n"
printf "  - Your user accounts and SSH config\n"
echo "------------------------------------------------"
printf "\nYou can now re-run the install script cleanly.\n\n"

rm -f "$0"
