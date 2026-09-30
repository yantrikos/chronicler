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

# Pinned deliberately. An unpinned `pip install yantrikdb-mcp[onnx]` silently
# drifts on every rebuild — and on 2026-08-04 that drift took the stack down:
# the `mcp` SDK released 2.0.0, which removed `mcp.server.fastmcp`, while
# yantrikdb-mcp v0.10.0 imported that path at module scope. Result:
# ModuleNotFoundError in a crash-loop, from a Dockerfile nobody had edited.
# (Upstream shipped the same-day v0.10.1 hotfix for exactly this.)
#
# yantrikdb's own v0.10.0 release notes name the trap:
#   "version pins fail (the version doesn't move), signature checks fail
#    (behavior moves without them)... Pin immutable refs, probe features
#    not versions, and declare unsupported capabilities at runtime instead
#    of silently degrading."
#
# So: pin both packages, and let the runtime probes
# (scripts/probe-mcp-tools.ts) assert capabilities rather than trusting a
# version string.
#
# YANTRIKDB_MCP_VERSION 0.12.0 buys three things over 0.10.0:
#   - runs on BOTH mcp SDK majors (1.x and 2.x), each gated in upstream CI,
#     so the 2.0.0 breakage above cannot recur
#   - widens the engine pin to <0.12, which pulls yantrikdb 0.11.x — the
#     release carrying the pack substrate
#   - exposes the `pack` MCP tool (feature-probed: absent, rather than
#     present-and-failing, on an engine without pack support)
#
# MCP_VERSION stays on the 1.x line even though 0.12.0 advertises both.
# Verified on 2026-08-04: yantrikdb-mcp 0.12.0 + mcp 2.x crash-loops at
# startup as soon as the CLI sets a host —
#
#   File ".../yantrikdb_mcp/__init__.py", mcp.settings.host = host
#   ValueError: "Settings" object has no field "host"
#
# The 2.x port covered the server-symbol surface (FastMCP -> MCPServer) but
# not the CLI's settings mutation, and our compose command passes
# `--transport streamable-http --host 0.0.0.0 --port 8420`, which walks
# straight into it. 1.x is unaffected and is equally CI-gated upstream, so
# we stay there until a release fixes the 2.x CLI path. Report filed
# against the 0.12.0 "runs on both SDK lines" claim.
#
# The [onnx] extra is required for the 384-dim sentence-transformers embedder
# that existing chronicler DBs were created against. Without it, recall +
# skill calls error with "ONNX embedder requested but optional deps not
# installed", and the slim install falls back to a 64-dim bundled embedder
# that silently recalls nothing from a 384-dim volume.
# Upgraded 0.12.0 -> 0.24.0 on 2026-09-29 (engine 0.11.3 -> 0.23.1, schema
# migrated on open). Verified against a copy of a real 922-memory volume:
# identical memory/entity/conflict counts, 384-dim ONNX embedder loaded,
# recall intact. The 0.12.0 notes above are historical; the boot gate below
# still guards the mcp 2.x crash, so MCP_VERSION stays on 1.x.
ARG MCP_VERSION=">=1.9,<2"
ARG YANTRIKDB_MCP_VERSION="==0.24.0"

RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install "mcp${MCP_VERSION}" "yantrikdb-mcp[onnx]${YANTRIKDB_MCP_VERSION}"

# Build-time gate. Import + `--version` is NOT enough: yantrikdb-mcp 0.12.0
# on mcp 2.x imports cleanly and reports its version, then dies the moment
# the CLI sets a host. So the gate BOOTS THE SERVER with the exact argv
# docker-compose uses and requires it to still be alive a few seconds later.
# A bad resolve now fails the BUILD instead of shipping a crash-looping image.
RUN set -eu; \
    python -c "import yantrikdb_mcp; from yantrikdb_mcp.server import mcp; print('import OK')"; \
    yantrikdb-mcp --version; \
    YANTRIKDB_DB_PATH=/tmp/gate.db yantrikdb-mcp --transport streamable-http \
      --host 127.0.0.1 --port 8421 > /tmp/gate.log 2>&1 & \
    GATE_PID=$!; \
    sleep 12; \
    if ! kill -0 "$GATE_PID" 2>/dev/null; then \
      echo "BOOT GATE FAILED — server died with the argv docker-compose uses:"; \
      cat /tmp/gate.log; exit 1; \
    fi; \
    python -c "import socket; s=socket.create_connection(('127.0.0.1', 8421), 5); s.close(); print('boot gate OK — port accepting')"; \
    kill "$GATE_PID" 2>/dev/null || true; \
    rm -f /tmp/gate.db /tmp/gate.log

# Pack WRITE actions (install / mount / trust / ...) stay disabled by default.
# Importing a third party's memories into a user's substrate is an operator
# decision, not an agent-initiated one — upstream gates it behind this env
# var and Chronicler honors that default. Read actions (list / inspect /
# publishers / embedder_identity) are always available.
# Set YANTRIKDB_ENABLE_PACK_WRITES=1 in docker-compose.yml to opt in.

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8420

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD python -c "import socket; s=socket.create_connection(('localhost', 8420), 3); s.close()" || exit 1

CMD ["yantrikdb-mcp", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8420"]
