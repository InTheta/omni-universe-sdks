import WebSocket from "ws";
import { OmniConfigurationError } from "./errors.js";
import type { NewsWebSocketTicket, WebSocketEvent } from "./types.js";

export interface OmniWebSocketOptions {
  baseUrl?: string;
  maxQueueSize?: number;
  WebSocketImpl?: typeof WebSocket;
}

export class OmniWebSocketClient {
  private readonly baseUrl: string;
  private readonly maxQueueSize: number;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(options: OmniWebSocketOptions = {}) {
    this.baseUrl = options.baseUrl ?? "wss://api.omniterminal.app";
    this.maxQueueSize = options.maxQueueSize ?? 1_000;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    if (!Number.isInteger(this.maxQueueSize) || this.maxQueueSize < 1) throw new RangeError("maxQueueSize must be a positive integer");
  }

  news<T = unknown>(ticket: NewsWebSocketTicket | string): AsyncIterable<WebSocketEvent<T>> {
    const token = typeof ticket === "string" ? ticket : ticket.ticket;
    if (!token) throw new OmniConfigurationError("A single-use news WebSocket ticket is required");
    const url = new URL("/ws/v1/news", this.baseUrl);
    url.searchParams.set("ticket", token);
    return this.connect<T>(url, 55_000, this.maxQueueSize);
  }

  private connect<T>(url: URL, pingEveryMs: number | undefined, maxQueueSize: number): AsyncIterable<WebSocketEvent<T>> {
    const WebSocketImpl = this.WebSocketImpl;
    return {
      [Symbol.asyncIterator](): AsyncIterator<WebSocketEvent<T>> {
        const socket = new WebSocketImpl(url);
        const queue: WebSocketEvent<T>[] = [];
        const waiting: Array<{ resolve: (value: IteratorResult<WebSocketEvent<T>>) => void; reject: (reason: unknown) => void }> = [];
        let closed = false;
        let stopped = false;
        let terminalError: unknown;
        let timer: NodeJS.Timeout | undefined;

        socket.on("open", () => {
          if (pingEveryMs) timer = setInterval(() => {
            if (!stopped && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
          }, pingEveryMs);
        });
        socket.on("message", (raw) => {
          if (stopped) return;
          let data: unknown = raw.toString();
          try { data = JSON.parse(String(data)); } catch { /* text frames are valid */ }
          const event = { data: data as T, receivedAt: Date.now() };
          const waiter = waiting.shift();
          if (waiter) waiter.resolve({ value: event, done: false });
          else {
            if (queue.length >= maxQueueSize) queue.shift();
            queue.push(event);
          }
        });
        socket.on("error", (error) => {
          terminalError = error;
          while (waiting.length) waiting.shift()?.reject(error);
        });
        socket.on("close", () => {
          closed = true;
          if (timer) clearInterval(timer);
          while (waiting.length) waiting.shift()?.resolve({ value: undefined, done: true });
        });

        return {
          next(): Promise<IteratorResult<WebSocketEvent<T>>> {
            const item = queue.shift();
            if (item) return Promise.resolve({ value: item, done: false });
            if (terminalError) return Promise.reject(terminalError);
            if (closed) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
          },
          return(): Promise<IteratorResult<WebSocketEvent<T>>> {
            stopped = true;
            if (timer) clearInterval(timer);
            socket.close(1000, "client complete");
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }
}
