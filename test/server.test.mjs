import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
const port = 3200 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {
      // Server is not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Server did not start");
}

function triage(body, raw = false) {
  return fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
}

before(async () => {
  server = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  await waitForServer();
});

after(() => {
  server?.kill();
});

test("valid request returns ready with topic and draft", async () => {
  const response = await triage({ text: "Когда будет доставка?" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ready",
    topic: "delivery",
    draft: "Спасибо за обращение. Уточним детали заявки.",
  });
});

test("empty, missing, non-string and broken input returns invalid_input", async () => {
  const bodies = [
    {},
    { text: "" },
    { text: "   " },
    { text: 42 },
    { text: null },
  ];
  for (const body of bodies) {
    const response = await triage(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { status: "invalid_input" });
  }

  const broken = await triage("{", true);
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { status: "invalid_input" });
});

test("model timeout is limited to 300 ms and falls back to manual_review", async () => {
  const startedAt = Date.now();
  const response = await triage({ text: "[timeout]" });
  const elapsed = Date.now() - startedAt;

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "manual_review",
    topic: null,
    draft: null,
  });
  assert.ok(elapsed < 1000, `model wait was ${elapsed} ms`);
});

test("model errors and unsuitable responses fall back to manual_review", async () => {
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    const response = await triage({ text: marker });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "manual_review",
      topic: null,
      draft: null,
    });
  }
});
