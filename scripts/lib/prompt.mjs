import readline from "node:readline";
import { Writable } from "node:stream";

/** Ask a visible question and return one line of input. */
export function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Read a secret without echoing it. Passwords are never accepted as
 * command-line arguments (they would end up in shell history and process
 * listings). In a real terminal input is hidden; when stdin is a pipe (CI or
 * scripted local setup) lines are buffered without echo.
 */
export function askHidden(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question}(read from stdin)\n`);
    return readLineFromStdin();
  }
  return new Promise((resolve) => {
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
    });
    process.stdout.write(question);
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

// One shared buffer for piped stdin: `printf 'a\nb\n' | cli` can deliver both
// lines in a single chunk, so each read must consume exactly one line.
let buffer = "";
let ended = false;
let listening = false;
const waiters = [];

function ensureStdinListener() {
  if (listening) return;
  listening = true;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    flushStdin();
  });
  process.stdin.on("end", () => {
    ended = true;
    flushStdin();
  });
}

function flushStdin() {
  while (waiters.length > 0) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    waiters.shift()(line);
  }
  if (ended && waiters.length > 0) {
    while (waiters.length > 0) {
      const line = buffer;
      buffer = "";
      waiters.shift()(line);
    }
  }
  if (waiters.length === 0) process.stdin.pause();
}

function readLineFromStdin() {
  ensureStdinListener();
  return new Promise((resolve) => {
    waiters.push(resolve);
    flushStdin();
  });
}
