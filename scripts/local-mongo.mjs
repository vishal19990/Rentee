#!/usr/bin/env node
/**
 * Local MongoDB helper for development.
 *
 *   node scripts/local-mongo.mjs                 -> run a persistent local mongod until Ctrl+C
 *   node scripts/local-mongo.mjs <cmd> [args...] -> ensure a local mongod is running, then run <cmd>
 *
 * A mongod (via mongodb-memory-server, data persisted in .data/db) is only started when
 * MONGODB_URI points at 127.0.0.1/localhost:27017 and nothing is already listening there.
 * If you have a real MongoDB (local or remote), it is used as-is.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import dotenv from "dotenv";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/rentee";
const PORT = 27017;

function targetsLocalDefault(u) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/,?]+)/.exec(u);
  if (!m) return false;
  const [host, port = "27017"] = m[1].split(":");
  return ["127.0.0.1", "localhost"].includes(host) && Number(port) === PORT;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function ensureMongo() {
  if (!targetsLocalDefault(uri)) {
    console.log(`[local-mongo] MONGODB_URI is not the local default; using it as-is.`);
    return null;
  }
  if (await portOpen(PORT)) {
    console.log(`[local-mongo] Something is already listening on ${PORT}; reusing it.`);
    return null;
  }
  const dbPath = path.join(root, ".data", "db");
  fs.mkdirSync(dbPath, { recursive: true });
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  console.log(`[local-mongo] Starting local mongod on ${PORT} (data: ${dbPath}) ...`);
  const server = await MongoMemoryServer.create({
    instance: { port: PORT, ip: "127.0.0.1", dbPath, storageEngine: "wiredTiger" },
  });
  console.log(`[local-mongo] mongod ready at ${server.getUri()}`);
  return server;
}

const [cmd, ...args] = process.argv.slice(2);
const server = await ensureMongo();

let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  if (server) {
    // Keep the data directory: this is a persistent dev database.
    await server.stop({ doCleanup: false, force: false }).catch(() => {});
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (!cmd) {
  if (!server) process.exit(0);
  console.log("[local-mongo] Press Ctrl+C to stop.");
} else {
  const child = spawn(cmd, args, { stdio: "inherit", shell: true, env: process.env });
  child.on("exit", (code) => shutdown(code ?? 0));
}
