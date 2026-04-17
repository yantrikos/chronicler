# YantrikDB MCP server image. Pre-installs the package + its dependencies at
# build time so containers start in seconds, not minutes. Uses the CPU-only
# torch wheel to avoid downloading 400+MB of CUDA libraries on machines that
# can't use them (Apple Silicon, typical laptops).

FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    YANTRIKDB_DB_PATH=/data/memory.db

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only torch first (much smaller), then yantrikdb-mcp which pulls
# the rest. sentence-transformers needs torch; we want the slim CPU wheel.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install yantrikdb-mcp

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8420

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD python -c "import socket; s=socket.create_connection(('localhost', 8420), 3); s.close()" || exit 1

CMD ["yantrikdb-mcp", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8420"]
