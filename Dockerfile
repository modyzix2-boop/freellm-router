FROM ghcr.io/tashfeenahmed/freellmapi:latest

USER root
COPY start.sh /usr/local/bin/fapi-start.sh
RUN chmod 755 /usr/local/bin/fapi-start.sh

ENV PORT=7860
ENV HOST_BIND=0.0.0.0
ENV NODE_ENV=production

EXPOSE 7860

# Base entrypoint (docker-entrypoint.sh) chowns the data dir, drops to the
# node user, then execs this CMD.
CMD ["sh", "/usr/local/bin/fapi-start.sh"]

# Arabic RTL chat UI, served same-origin (avoids CORS) at /ar.html
COPY ui/app.html /app/client/dist/ar.html
