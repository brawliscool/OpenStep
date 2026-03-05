const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "DeepSeek-V3.2";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const PROJECT_ROOT = process.cwd();

const sendJson = (res, status, payload) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

const sendFile = (res, filePath) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
};

const extractOutputText = (payload) => {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  return "";
};

const solveWithModel = async (imageDataUrl) => {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("Missing DEEPSEEK_API_KEY. Set it in your terminal before starting the server.");
  }

  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    throw new Error("Invalid image payload. Upload a valid image and try again.");
  }

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a helpful school assistant. Solve the main problem from the uploaded image and return plain text only in this format: Problem: ..., Step 1: ..., Step 2: ...",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Solve this homework problem from the image clearly and briefly.",
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl },
          },
        ],
      },
    ],
    stream: false,
    max_tokens: 700,
  };

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiError =
      payload?.error?.message ||
      payload?.message ||
      `Model request failed with status ${response.status}.`;
    throw new Error(apiError);
  }

  const answer = extractOutputText(payload);
  if (!answer) {
    throw new Error("Model response was empty. Try another image.");
  }

  return answer;
};

const handleApiSolve = async (req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10 * 1024 * 1024) req.destroy();
  });

  req.on("end", async () => {
    try {
      const parsed = JSON.parse(body || "{}");
      const answer = await solveWithModel(parsed.imageDataUrl);
      sendJson(res, 200, { answer });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to solve image.";
      sendJson(res, 400, { error: message });
    }
  });
};

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Bad request" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "POST" && url.pathname === "/api/solve") {
    await handleApiSolve(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, "");
  const filePath = path.join(PROJECT_ROOT, safePath);

  if (!filePath.startsWith(PROJECT_ROOT)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`OpenStep server running on http://${HOST}:${PORT}`);
});
