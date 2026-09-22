#!/bin/sh
set -eu

PLANTCARE_LOG_LEVEL="info"
PLANTCARE_STALE_SENSOR_HOURS="72"
PLANTCARE_HOME_ASSISTANT_NOTIFICATIONS="true"
PLANTCARE_CLOUDFLARE_ACCOUNT_ID=""
PLANTCARE_CLOUDFLARE_API_TOKEN=""
PLANTCARE_DOCTOR_PROVIDER="auto"
PLANTCARE_GEMINI_API_KEY=""
PLANTCARE_GEMINI_MODEL="gemini-3.6-flash"
PLANTCARE_DOCTOR_CLOUDFLARE_FALLBACK="false"
if [ -r /data/options.json ]; then
  PLANTCARE_LOG_LEVEL="$(jq -r '.log_level // "info"' /data/options.json)"
  PLANTCARE_STALE_SENSOR_HOURS="$(jq -r '.stale_sensor_hours // 72' /data/options.json)"
  PLANTCARE_HOME_ASSISTANT_NOTIFICATIONS="$(jq -r '.home_assistant_notifications // true' /data/options.json)"
  PLANTCARE_CLOUDFLARE_ACCOUNT_ID="$(jq -r '.cloudflare_account_id // empty' /data/options.json)"
  PLANTCARE_CLOUDFLARE_API_TOKEN="$(jq -r '.cloudflare_api_token // empty' /data/options.json)"
  PLANTCARE_DOCTOR_PROVIDER="$(jq -r '.doctor_provider // "auto"' /data/options.json)"
  PLANTCARE_GEMINI_API_KEY="$(jq -r '.gemini_api_key // empty' /data/options.json)"
  PLANTCARE_GEMINI_MODEL="$(jq -r '.gemini_model // "gemini-3.6-flash"' /data/options.json)"
  PLANTCARE_DOCTOR_CLOUDFLARE_FALLBACK="$(jq -r '.doctor_cloudflare_fallback // false' /data/options.json)"
fi

export PLANTCARE_ENV="production"
export PLANTCARE_DATA_DIR="/data"
export PLANTCARE_STATIC_DIR="/app/frontend"
export PLANTCARE_LOG_LEVEL
export PLANTCARE_STALE_SENSOR_HOURS
export PLANTCARE_HOME_ASSISTANT_NOTIFICATIONS
export PLANTCARE_CLOUDFLARE_ACCOUNT_ID
export PLANTCARE_CLOUDFLARE_API_TOKEN
export PLANTCARE_DOCTOR_PROVIDER
export PLANTCARE_GEMINI_API_KEY
export PLANTCARE_GEMINI_MODEL
export PLANTCARE_DOCTOR_CLOUDFLARE_FALLBACK

cd /app
/opt/venv/bin/alembic -c /app/alembic.ini upgrade head
exec /usr/bin/supervisord -c /etc/supervisord.conf
