#!/usr/bin/env bash
# Usage: ./run.sh [port]
# Starts Vite via npm script in the background, waits for readiness, then opens the default browser.

PORT=${1:-5173}
LOGFILE="vite.log"

echo "Starting npm run start:open on port ${PORT} (logs -> ${LOGFILE})..."
# Start npm script in background; pass extra args to Vite via --
npm run start:open --silent -- --port ${PORT} > "${LOGFILE}" 2>&1 &
PID=$!

echo "Waiting for server at http://localhost:${PORT} ..."
COUNT=0
MAX=60
while [ ${COUNT} -lt ${MAX} ]; do
  if curl -s --max-time 1 "http://localhost:${PORT}/" >/dev/null; then
    echo "Server is up. Opening browser..."
    # macOS uses "open", Linux commonly has xdg-open
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
      open "http://localhost:${PORT}" >/dev/null 2>&1 || true
    else
      echo "No known browser opener found. Please open http://localhost:${PORT} manually."
    fi
    exit 0
  fi
  sleep 1
  COUNT=$((COUNT+1))
done

echo "Timed out waiting for server. See ${LOGFILE} for details."
if [ -f "${LOGFILE}" ]; then
  tail -n 200 "${LOGFILE}"
fi

echo "Attempting to open browser anyway..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:${PORT}" >/dev/null 2>&1 || true
else
  echo "No known browser opener found. Please open http://localhost:${PORT} manually."
fi

exit 0
