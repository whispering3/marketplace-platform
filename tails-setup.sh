#!/bin/bash

# ==============================================================================
# OLYMPUS: TAILS ADMIN WORKSTATION SETUP
# Location: /home/amnesia/Persistent/tails-setup.sh
# ==============================================================================
# This script configures your environment in Tails for Market Management.
# Run this every time you boot your Tails stick.
# ==============================================================================

PROJECT_DIR="/home/amnesia/Persistent/Market"
NODE_DIR="/home/amnesia/Persistent/node"

echo "🛡️ OLYMPUS: Initializing Secure Workstation..."

# 1. Check for Persistent Storage
if [ ! -d "/home/amnesia/Persistent" ]; then
    echo "❌ ERROR: Persistent storage not found. Did you unlock it at login?"
    exit 1
fi

# 2. Configure Node.js Path
# Assuming you downloaded Node.js to $NODE_DIR
if [ -d "$NODE_DIR/bin" ]; then
    export PATH="$NODE_DIR/bin:$PATH"
    echo "✅ Node.js detected and added to PATH."
else
    echo "⚠️ Node.js not found in $NODE_DIR. Please install it there for persistence."
fi

# 3. Secure Environment Aliases
alias market-build="cd $PROJECT_DIR && npm run build"
alias market-prisma="cd $PROJECT_DIR && npx prisma"
alias market-register="cd $PROJECT_DIR && npx prisma db execute --file prisma/register_mirrors.sql"

# 4. OpSec Reminders
echo "----------------------------------------------------------------"
echo "🔐 OPSEC STATUS: MAXIMUM"
echo "🌍 NETWORK: Forced through Tor (Tails Native)"
echo "💾 STORAGE: Encrypted Persistent /home/amnesia/Persistent"
echo "----------------------------------------------------------------"
echo "Commands available:"
echo "  market-build    - Recompiles the marketplace"
echo "  market-prisma   - General database/schema management"
echo "  market-register - Sychronizes Mirror Grid in the database"
echo "----------------------------------------------------------------"

cd $PROJECT_DIR
echo "🚩 Workstation Ready. You are now inside $PROJECT_DIR."
