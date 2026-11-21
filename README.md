# freellm-router

Docker deploy of [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) (ghcr.io/tashfeenahmed/freellmapi:latest) with a start wrapper that re-seeds the unified API key and config from environment variables on each boot, so restarts on hosts with ephemeral storage keep the same dashboard login and provider keys.

Required env vars: PORT, ENCRYPTION_KEY, UNIFIED_API_KEY, FREEAPI_CONFIG_JSON
