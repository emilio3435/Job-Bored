/**
 * Per-request HTTP body cap.
 *
 * 2 MiB is comfortably larger than the largest plausible resume payload
 * (client-side extraction already truncates to a few tens of KB) while
 * preventing an unauthenticated-or-authenticated client from forcing the
 * worker to buffer arbitrary megabytes. Extracted out of server.ts so the
 * cap can be unit-tested without booting the live HTTP server (server.ts
 * has top-level side effects: it calls server.listen on import).
 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
    this.limit = limit;
  }
}

export async function readBody(
  request: import("node:http").IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      // Drain the remaining payload so the client gets a clean 413 instead of
      // an aborted connection that upstream proxies might retry.
      request.resume();
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
