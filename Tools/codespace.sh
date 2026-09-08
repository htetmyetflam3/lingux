#!/bin/bash
# ============================================================
# GitHub Codespace One-Shot Login + SSH
# Edit the two variables below, then run: ./gh_connect.sh
# ============================================================

# --- EDIT THESE TWO LINES ---
GH_TOKEN="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"
CODESPACE_NAME="ideal-garbanzo-r44g5q4pgp4rc5wvj"
# ----------------------------

set -e

echo "🔐 Logging into GitHub CLI..."
echo "$GH_TOKEN" | gh auth login --with-token

echo "✅ Logged in."
echo "🚀 Connecting to codespace: $CODESPACE_NAME"
gh codespace ssh -c "$CODESPACE_NAME"



https://redesigned-cod-wr594xjvjvvfgpv9.github.dev/