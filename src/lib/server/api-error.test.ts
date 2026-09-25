import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mock } from "node:test";
import { error, isHttpError, isRedirect, redirect } from "@sveltejs/kit";
import { ApiError, DEFAULT_MAX_BODY_BYTES, errorResponse, readJsonBody, withRoute } from "./api-error";
import type { RequestEvent } from "@sveltejs/kit";

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return error.code;
  }
  assert.fail("expected readJsonBody to reject");
}

describe("readJsonBody", () => {
  it("parses a JSON object under the default cap", async () => {
    assert.deepEqual(await readJsonBody(jsonRequest('{"a":1}')), { a: 1 });
  });

  it("refuses a body over the default cap as payload_too_large", async () => {
    const body = JSON.stringify({ text: "x".repeat(DEFAULT_MAX_BODY_BYTES) });
    assert.equal(await rejectionCode(readJsonBody(jsonRequest(body))), "payload_too_large");
  });

  it("accepts the same body when the route raises its own cap", async () => {
    const body = JSON.stringify({ text: "x".repeat(DEFAULT_MAX_BODY_BYTES) });
    const parsed = await readJsonBody(jsonRequest(body), {
      maxBytes: 2 * DEFAULT_MAX_BODY_BYTES,
    });
    assert.equal((parsed.text as string).length, DEFAULT_MAX_BODY_BYTES);
  });

  it("counts UTF-8 bytes, not characters", async () => {
    // 100 three-byte characters: 100 chars, 300+ bytes.
    const body = JSON.stringify({ text: "€".repeat(100) });
    assert.equal(
      await rejectionCode(readJsonBody(jsonRequest(body), { maxBytes: 200 })),
      "payload_too_large",
    );
  });

  it("refuses early on an oversized Content-Length", async () => {
    const request = jsonRequest("{}", { "content-length": String(10 * 1024 * 1024) });
    assert.equal(await rejectionCode(readJsonBody(request)), "payload_too_large");
  });

  it("still requires a JSON content type and a plain object", async () => {
    const text = new Request("https://example.test/api", { method: "POST", body: "{}" });
    assert.equal(await rejectionCode(readJsonBody(text)), "invalid_request");
    assert.equal(await rejectionCode(readJsonBody(jsonRequest("[1]"))), "invalid_request");
    assert.equal(await rejectionCode(readJsonBody(jsonRequest("{"))), "invalid_request");
  });
});

describe("errorResponse", () => {
  it("maps a code to its status and the envelope", async () => {
    const res = errorResponse(new ApiError("rate_limited", "Slow down.", { headers: { "Retry-After": "30" } }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "30");
    assert.deepEqual(await res.json(), { error: { code: "rate_limited", message: "Slow down." } });
  });

  it("includes per-field messages only when present", async () => {
    const res = errorResponse(new ApiError("invalid_request", "Check the form.", { fields: { email: "Enter your email address." } }));
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).error.fields, { email: "Enter your email address." });
  });
});

describe("withRoute", () => {
  const event = {} as RequestEvent;

  it("turns an ApiError into its envelope", async () => {
    const handler = withRoute("t", async () => { throw new ApiError("unauthenticated", "Please sign in to continue."); });
    const res = await handler(event);
    assert.equal(res.status, 401);
  });

  it("never leaks an unexpected error's message", async () => {
    const handler = withRoute("t", async () => { throw new Error("connection to postgres://secret failed"); });
    const res = await handler(event);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /postgres|secret/);
    assert.match(text, /internal_error/);
  });

  it("logs error name and code but never the message", async () => {
    const errorMock = mock.method(console, 'error', () => {});
    try {
      const handler = withRoute("test-route", async () => { throw new Error("connection to postgres://secret failed"); });
      await handler(event);
      assert.equal(errorMock.mock.callCount(), 1);
      const args = errorMock.mock.calls[0].arguments.join(' ');
      assert.doesNotMatch(args, /postgres|secret/);
      assert.match(args, /test-route/);
      assert.match(args, /Error/);
    } finally {
      errorMock.mock.restore();
    }
  });

  it("rethrows redirect() control flow", async () => {
    const handler = withRoute("t", async () => { throw redirect(303, '/x'); });
    try {
      await handler(event);
      assert.fail("expected redirect to be rethrown");
    } catch (err) {
      assert.ok(isRedirect(err));
    }
  });

  it("rethrows error() control flow", async () => {
    const handler = withRoute("t", async () => { throw error(404, 'nope'); });
    try {
      await handler(event);
      assert.fail("expected error() to be rethrown");
    } catch (err) {
      assert.ok(isHttpError(err));
    }
  });
});
