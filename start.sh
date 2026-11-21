#!/bin/sh
# FreeLLMAPI start wrapper.
# Ephemeral storage note: on every boot the DB is recreated and
# FREEAPI_CONFIG_JSON re-seeds admin + provider keys. If UNIFIED_API_KEY is
# set, force the settings row to it after boot so the client key survives
# restarts. A tiny shim (shim.js) owns the public port: it serves key-scoped
# chat sync at /v1/client/chats and proxies everything else to upstream.
cd /app || exit 1
UPORT=7861

node /app/shim.js &
SHIM_PID=$!

PORT=$UPORT node server/dist/index.js &
SERVER_PID=$!

if [ -n "$UNIFIED_API_KEY" ]; then
  i=0
  until node -e "fetch('http://127.0.0.1:'+$UPORT+'/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
    i=$((i+1))
    if [ "$i" -gt 90 ]; then
      echo "[start] server did not become healthy in time; skipping unified-key restore"
      break
    fi
    sleep 2
  done
  node -e "
    const Database = require('better-sqlite3');
    const db = new Database('/app/server/data/freeapi.db');
    db.prepare(\"UPDATE settings SET value = ? WHERE key = 'unified_api_key'\").run(process.env.UNIFIED_API_KEY);
    db.close();
    console.log('[start] unified API key restored from UNIFIED_API_KEY secret');
  " || echo "[start] unified-key restore failed"
fi

wait $SERVER_PID $SHIM_PID
