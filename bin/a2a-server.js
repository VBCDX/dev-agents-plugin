#!/usr/bin/env node
// Entrypoint for the A2A cards server (issue #5).
//
// Environment:
//   PORT             listen port (default 8080)
//   HOST             bind address (default 0.0.0.0)
//   PUBLIC_BASE_URL  the public origin the cards advertise, e.g.
//                    https://agents.example. Set this on the deployment so the
//                    advertised absolute HTTPS card URLs are correct; when unset
//                    the base URL is derived per request from the Host header.
//
// The server serves only public agent cards and needs no credentials of any
// kind. Shuts down cleanly on SIGTERM/SIGINT.

import { createServer } from "../src/a2a/server.js";

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const configuredBaseUrl = process.env.PUBLIC_BASE_URL || undefined;

const server = createServer({ configuredBaseUrl });

server.listen(port, host, () => {
  const base = configuredBaseUrl || `http://${host}:${port}`;
  process.stdout.write(`a2a-cards: listening on ${host}:${port} (base URL ${base})\n`);
});

function shutdown(signal) {
  process.stdout.write(`a2a-cards: received ${signal}, shutting down\n`);
  server.close(() => process.exit(0));
  // Fail-safe: force exit if connections do not drain promptly.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
