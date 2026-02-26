# Go Webserver Code Review Guide

## Linter
Run `golangci-lint run ./...` and include any findings in your review.

---

## 1. Error Handling

- **Always check returned errors.** Discarding errors (`_ = doSomething()`) is almost always a bug.
- **Wrap errors with context:** `fmt.Errorf("failed to fetch user: %w", err)` — not bare `return err`.
- **Custom error types** for domain errors that callers need to inspect. Use `errors.Is` and `errors.As`.
- **Don't use `panic`** for expected error conditions. Reserve `panic` for truly unrecoverable programmer errors.
- **Sentinel errors** (`var ErrNotFound = errors.New(...)`) for well-known error conditions.
- **Don't log and return** — do one or the other. Logging then returning causes duplicate error reporting.

---

## 2. Concurrency

- **Goroutine leaks:** every goroutine must have a clear exit path. Use `context.Context` for cancellation.
- **Channel usage:** buffered vs unbuffered must be intentional. Unbuffered channels block until both sides are ready.
- **`sync.Mutex` vs `sync.RWMutex`:** use `RWMutex` when reads heavily outnumber writes.
- **Context propagation:** pass `context.Context` as the first parameter to all functions in the call chain.
- **`errgroup.Group`** for coordinating concurrent operations with error collection.
- **Never start goroutines in `init()`.** Initialization should be deterministic.

---

## 3. HTTP Handlers

- **Middleware pattern:** authentication, logging, rate limiting belong in middleware — not in individual handlers.
- **Request validation:** validate request body, query params, and path params before processing. Return 400 for invalid input.
- **Response status codes:** use correct HTTP status codes (201 for created, 404 for not found, etc.) — not 200 for everything.
- **Content-Type headers:** set `Content-Type` on all responses. `application/json` for JSON APIs.
- **Request timeouts:** set `http.Server.ReadTimeout` and `WriteTimeout`. Don't use zero-value (infinite) timeouts.
- **Graceful shutdown:** use `server.Shutdown(ctx)` to drain in-flight requests on SIGTERM.

---

## 4. Database

- **Connection pooling:** configure `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime` on `sql.DB`.
- **Prepared statements** or parameterized queries for all SQL — never string concatenation.
- **Transaction handling:** always `defer tx.Rollback()` immediately after `Begin()`, then explicitly `Commit()`.
- **Close rows:** `defer rows.Close()` after any query that returns `*sql.Rows`.
- **Null handling:** use `sql.NullString`, `sql.NullInt64`, etc. for nullable columns.
- **Migrations:** schema changes should be in versioned migration files — not in application code.

---

## 5. Testing

- **Table-driven tests** for functions with multiple input/output cases.
- **`testify`** for assertions (`assert`, `require`) — `require` for fatal checks, `assert` for non-fatal.
- **`httptest`** for testing HTTP handlers — create `httptest.NewServer` or `httptest.NewRecorder`.
- **Mock interfaces** — accept interfaces, return structs. Mock at the interface boundary.
- **Test helpers:** use `t.Helper()` in helper functions so test failures report the correct line.
- **Parallel tests:** use `t.Parallel()` for tests that don't share state.
- **No external dependencies in unit tests** — no real databases, no real HTTP calls.

---

## 6. Package Structure

- **`internal/`** for packages that should not be imported by external code.
- **Clean dependency direction:** handlers → services → repositories. Never the reverse.
- **Small, focused packages** — avoid a single `utils` package. Name packages by what they provide.
- **No circular dependencies.** If two packages need each other, introduce an interface.
- **`cmd/`** for application entry points. `main` package should be thin — just wiring.

---

## 7. Performance

- **`strings.Builder`** for string concatenation in loops — not `+` or `fmt.Sprintf` repeatedly.
- **`sync.Pool`** for frequently allocated/freed objects (buffers, temporary structs).
- **Avoid unnecessary allocations:** pass pointers for large structs, use slice pre-allocation (`make([]T, 0, capacity)`).
- **JSON encoding:** use `json.NewEncoder(w).Encode()` for HTTP responses — not `json.Marshal` + `w.Write`.
- **Profile before optimizing.** Use `pprof` for CPU and memory profiling.

---

## 8. Security

- **Input validation** on all user-provided data. Validate length, format, and range.
- **CORS configuration:** be explicit about allowed origins. Never use `*` in production.
- **Rate limiting** on public endpoints. Use token bucket or sliding window.
- **No secrets in source code.** Use environment variables or secret managers.
- **HTTPS only** in production. Redirect HTTP to HTTPS.
- **SQL injection prevention:** always use parameterized queries.
- **No sensitive data in logs.** Mask tokens, passwords, PII.

---

## 9. Context Usage

- **Pass `context.Context` as the first parameter** named `ctx` to every function that does I/O or may be cancelled.
- **Respect cancellation:** check `ctx.Err()` or `select` on `ctx.Done()` in long-running operations.
- **Set timeouts:** use `context.WithTimeout` or `context.WithDeadline` for external calls.
- **Don't store contexts** in structs — pass them through the call chain.
- **Don't use `context.Background()`** in request handlers — use the request's context.

---

## 10. Interface Design

- **Small interfaces:** prefer 1-2 method interfaces. Compose larger behaviors from small interfaces.
- **Accept interfaces, return structs.** This makes testing easier and reduces coupling.
- **Define interfaces where they're used** — not where they're implemented (consumer-side interfaces).
- **Don't create interfaces for a single implementation** unless it's needed for testing.

---

## 11. Logging

- **Structured logging** with key-value pairs — not formatted strings.
- **Appropriate levels:** `Debug` for development detail, `Info` for operational events, `Warn` for recoverable issues, `Error` for failures requiring attention.
- **Include request context** in logs (request ID, user ID, trace ID).
- **Don't log expected conditions** at Error level (e.g., 404s, validation failures).
- **No sensitive data in logs** — mask tokens, passwords, PII.

---

## 12. Go Idioms

- **`defer` for cleanup** — but be aware it runs at function return, not block exit.
- **Receiver naming:** short, consistent (`s` for a service, `h` for a handler) — not `this` or `self`.
- **Exported vs unexported:** only export what's part of the public API. Start with unexported.
- **Error messages:** lowercase, no punctuation. "failed to connect" not "Failed to connect."
- **Named return values** only for documentation — don't use them for naked returns (confusing).
- **`iota`** for const enums with a meaningful zero value.
