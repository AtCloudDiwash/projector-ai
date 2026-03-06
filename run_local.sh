#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Local development startup script for The Cinematic Narrator
# Run from the project root: bash run_local.sh
# ─────────────────────────────────────────────────────────────

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
VENV_DIR="$BACKEND_DIR/venv"
ENV_FILE="$PROJECT_ROOT/.env"

echo ""
echo "  The Cinematic Narrator — Local Start"
echo "  ─────────────────────────────────────"
echo ""

# Check for .env
if [ ! -f "$ENV_FILE" ]; then
  echo "  ERROR: .env file not found at $ENV_FILE"
  echo "  Copy .env.example or edit the .env file with your credentials."
  exit 1
fi

# Check GEMINI_API_KEY is set
source "$ENV_FILE" 2>/dev/null || true
if [ -z "$GEMINI_API_KEY" ] || [ "$GEMINI_API_KEY" = "your-gemini-api-key-here" ]; then
  echo "  ERROR: GEMINI_API_KEY is not set in .env"
  echo "  Get your key from: https://aistudio.google.com/app/apikey"
  exit 1
fi

# Check for Python 3.12
if [ ! -f "$VENV_DIR/bin/python3.12" ]; then
  echo "  Setting up Python virtual environment..."
  python3.12 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt" --quiet
  echo "  Dependencies installed."
fi

# Copy .env to backend directory so python-dotenv finds it
cp "$ENV_FILE" "$BACKEND_DIR/.env"

echo "  Starting server at http://localhost:8080"
echo "  Press Ctrl+C to stop."
echo ""

cd "$BACKEND_DIR"
"$VENV_DIR/bin/python3.12" main.py
