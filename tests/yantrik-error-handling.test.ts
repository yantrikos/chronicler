// Regression coverage for the "Error executing tool …" JSON.parse crash
// the UI hit on demo-load ("Unexpected token 'E', 'Error exec'… is not
// valid JSON"). Tests the three new primitives that replace the raw
// JSON.parse call sites in client.ts.

import {
  YantrikClient,
  YantrikError,
  parseYantrikResult,
  retryOnBackpressure,
  type YantrikDBTransport,
} from "../src/lib/yantrikdb/client";

function ok(msg: string): void { console.log("  ok  ", msg); }
function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`${msg}: got ${String(a)} want ${String(b)}`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function throws(fn: () => void, kind: string, msg: string): YantrikError {
  try { fn(); } catch (e) {
    if (!(e instanceof YantrikError))
      throw new Error(`${msg}: threw non-YantrikError ${String(e)}`);
    if (e.kind !== kind)
      throw new Error(`${msg}: expected kind=${kind} got kind=${e.kind}`);
    return e;
  }
  throw new Error(`${msg}: did not throw`);
}

// ────────────────────────────────────────────────────────────────────
// parseYantrikResult
// ────────────────────────────────────────────────────────────────────

function test_parses_valid_json_result(): void {
  console.log("--- parseYantrikResult: happy-path JSON payload ---");
  const parsed = parseYantrikResult(
    { result: '{"rid":"abc","status":"recorded"}' },
    "remember"
  ) as { rid: string };
  eq(parsed.rid, "abc", "rid extracted");
  ok("valid JSON parsed");
}

function test_classifies_ingest_queue_full_as_queue_full(): void {
  console.log("--- parseYantrikResult: 'ingest queue full' → queue_full ---");
  const err = throws(
    () => parseYantrikResult(
      { result: "Error executing tool remember: ingest queue full (954 pending ops, max=256); retry after 50ms" },
      "remember"
    ),
    "queue_full",
    "queue_full classification"
  );
  assert(err.serverMessage.includes("ingest queue full"), "raw message preserved");
  assert(err.rawResult === err.serverMessage, "rawResult carried");
  ok("queue_full classified");
}

function test_classifies_not_found(): void {
  console.log("--- parseYantrikResult: 'not found' → not_found ---");
  throws(
    () => parseYantrikResult(
      { result: "Error executing tool skill: skill xyz not found in substrate" },
      "skill"
    ),
    "not_found",
    "not_found classification"
  );
  ok("not_found classified");
}

function test_generic_server_error(): void {
  console.log("--- parseYantrikResult: unknown error text → server_error ---");
  throws(
    () => parseYantrikResult(
      { result: "Error executing tool remember: index write failed halfway" },
      "remember"
    ),
    "server_error",
    "server_error classification"
  );
  ok("server_error classified");
}

function test_malformed_response_never_leaks_syntaxerror(): void {
  console.log("--- parseYantrikResult: non-JSON result → malformed (not SyntaxError) ---");
  const err = throws(
    () => parseYantrikResult({ result: "<html>Bad Gateway</html>" }, "recall"),
    "malformed",
    "malformed classification"
  );
  assert(err.serverMessage.includes("not valid JSON"), "clean message");
  assert(!err.serverMessage.includes("Unexpected token"),
    "no raw JSON.parse SyntaxError leaks through");
  ok("no SyntaxError leak");
}

function test_bare_object_passes_through(): void {
  console.log("--- parseYantrikResult: bare object (InMemoryTransport shape) passes through ---");
  // InMemoryTransport returns plain objects without a {result:string}
  // envelope; that path is legitimate and stays supported.
  const parsed = parseYantrikResult({ rid: "abc" } as unknown, "remember") as { rid: string };
  eq(parsed.rid, "abc", "bare object preserved");
  ok("bare object pass-through");
}

// ────────────────────────────────────────────────────────────────────
// retryOnBackpressure
// ────────────────────────────────────────────────────────────────────

async function test_retries_queue_full_then_succeeds(): Promise<void> {
  console.log("--- retryOnBackpressure: retries queue_full until it succeeds ---");
  let attempts = 0;
  const result = await retryOnBackpressure(async () => {
    attempts++;
    if (attempts < 3) {
      throw new YantrikError(
        "queue_full",
        "remember",
        "ingest queue full (954 pending ops, max=256); retry after 5ms",
        "raw"
      );
    }
    return { rid: "eventually-succeeded" };
  }, { base_delay_ms: 5 });
  eq(attempts, 3, "retried until success");
  eq(result.rid, "eventually-succeeded", "final result returned");
  ok("retry-until-success");
}

async function test_non_retryable_errors_propagate_immediately(): Promise<void> {
  console.log("--- retryOnBackpressure: server_error propagates first try ---");
  let attempts = 0;
  try {
    await retryOnBackpressure(async () => {
      attempts++;
      throw new YantrikError("server_error", "remember", "boom", "raw");
    }, { base_delay_ms: 5 });
    throw new Error("should have thrown");
  } catch (e) {
    if (!(e instanceof YantrikError)) throw new Error("wrong error type");
    eq(attempts, 1, "did not retry non-retryable");
    eq(e.kind, "server_error", "kind preserved");
    ok("no retry on non-retryable");
  }
}

async function test_gives_up_after_max_attempts(): Promise<void> {
  console.log("--- retryOnBackpressure: throws after max_attempts on persistent queue_full ---");
  let attempts = 0;
  try {
    await retryOnBackpressure(async () => {
      attempts++;
      throw new YantrikError(
        "queue_full",
        "remember",
        "ingest queue full; retry after 5ms",
        "raw"
      );
    }, { max_attempts: 3, base_delay_ms: 5 });
    throw new Error("should have thrown");
  } catch (e) {
    if (!(e instanceof YantrikError)) throw new Error("wrong error type");
    eq(attempts, 3, "exhausted attempts");
    eq(e.kind, "queue_full", "final error still queue_full");
    ok("max_attempts respected");
  }
}

// ────────────────────────────────────────────────────────────────────
// End-to-end via YantrikClient.remember() with a fake transport
// ────────────────────────────────────────────────────────────────────

async function test_client_remember_retries_transient_queue_full(): Promise<void> {
  console.log("--- YantrikClient.remember: transient queue_full is retried transparently ---");
  let call_count = 0;
  const transport: YantrikDBTransport = {
    async call(tool, _args) {
      call_count++;
      if (call_count < 2) {
        return { result: "Error executing tool remember: ingest queue full; retry after 5ms" };
      }
      return { result: '{"rid":"019eee00-abc","status":"recorded"}' };
    },
  };
  const client = new YantrikClient(transport);
  const { rid } = await client.remember({
    text: "hi",
    metadata: {},
  });
  eq(rid, "019eee00-abc", "rid recovered after retry");
  eq(call_count, 2, "one retry, one success");
  ok("client retries transient queue_full");
}

async function test_client_remember_surfaces_server_error(): Promise<void> {
  console.log("--- YantrikClient.remember: server_error surfaces as YantrikError, not SyntaxError ---");
  const transport: YantrikDBTransport = {
    async call() {
      return { result: "Error executing tool remember: index write failed halfway" };
    },
  };
  const client = new YantrikClient(transport);
  try {
    await client.remember({ text: "hi", metadata: {} });
    throw new Error("should have thrown");
  } catch (e) {
    if (!(e instanceof YantrikError))
      throw new Error(`expected YantrikError, got ${String(e)}`);
    eq(e.kind, "server_error", "kind is server_error");
    assert(
      !e.message.includes("Unexpected token"),
      "message does NOT leak JSON.parse SyntaxError"
    );
    ok("typed error surfaces cleanly");
  }
}

(async () => {
  try {
    test_parses_valid_json_result();
    test_classifies_ingest_queue_full_as_queue_full();
    test_classifies_not_found();
    test_generic_server_error();
    test_malformed_response_never_leaks_syntaxerror();
    test_bare_object_passes_through();
    await test_retries_queue_full_then_succeeds();
    await test_non_retryable_errors_propagate_immediately();
    await test_gives_up_after_max_attempts();
    await test_client_remember_retries_transient_queue_full();
    await test_client_remember_surfaces_server_error();
    console.log("\n--- PASS: yantrik-error-handling ---");
  } catch (e) {
    console.error("--- FAIL: yantrik-error-handling ---", e);
    process.exit(1);
  }
})();
