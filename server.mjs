import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

const TOPICS = new Set(["delivery", "pricing", "other"]);
const MODEL_TIMEOUT_MS = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function invalidInput(response) {
  return json(response, 400, { status: "invalid_input" });
}

function manualReview(response) {
  return json(response, 200, { status: "manual_review", topic: null, draft: null });
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleTriage(request, response) {
  let text;
  try {
    const body = JSON.parse(await readText(request));
    text = body?.text;
  } catch {
    return invalidInput(response);
  }

  if (typeof text !== "string" || text.trim() === "") {
    return invalidInput(response);
  }

  let result;
  try {
    const raw = await classify(text, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
    result = JSON.parse(raw);
  } catch {
    return manualReview(response);
  }

  const validTopic = TOPICS.has(result?.topic);
  const validDraft = typeof result?.draft === "string" && result.draft.trim() !== "";
  if (!validTopic || !validDraft) {
    return manualReview(response);
  }

  return json(response, 200, { status: "ready", topic: result.topic, draft: result.draft });
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch {
    json(response, 500, { status: "server_error" });
  }
}).listen(Number(process.env.PORT || 3000), "127.0.0.1");
