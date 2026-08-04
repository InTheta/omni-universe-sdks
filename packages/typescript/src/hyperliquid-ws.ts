import WebSocket from "ws";
import type { HyperliquidInterval } from "./hyperliquid.js";
import type { WebSocketEvent } from "./types.js";

export type HyperliquidSubscription =
  | { type: "allMids"; dex?: string }
  | { type: "candle"; coin: string; interval: HyperliquidInterval }
  | { type: "l2Book"; coin: string; nSigFigs?: 2 | 3 | 4 | 5 | null; mantissa?: 1 | 2 | 5 }
  | { type: "trades"; coin: string };

export interface HyperliquidWebSocketMessage<T = unknown> {
  channel: string;
  data: T;
}

export interface HyperliquidWebSocketOptions {
  baseUrl?: string;
  maxReconnects?: number;
  reconnectDelayMs?: number;
  maxQueueSize?: number;
  WebSocketImpl?: typeof WebSocket;
}

export class HyperliquidWebSocketClient {
  private readonly baseUrl: string;
  private readonly maxReconnects: number;
  private readonly reconnectDelayMs: number;
  private readonly maxQueueSize: number;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(options: HyperliquidWebSocketOptions = {}) {
    this.baseUrl = options.baseUrl ?? "wss://api.hyperliquid.xyz/ws";
    this.maxReconnects = options.maxReconnects ?? 3;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 250;
    this.maxQueueSize = options.maxQueueSize ?? 1_000;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    if (!Number.isInteger(this.maxReconnects) || this.maxReconnects < 0) throw new RangeError("maxReconnects must be a non-negative integer");
    if (!Number.isInteger(this.maxQueueSize) || this.maxQueueSize < 1) throw new RangeError("maxQueueSize must be a positive integer");
    if (!Number.isFinite(this.reconnectDelayMs) || this.reconnectDelayMs < 0) throw new RangeError("reconnectDelayMs must be non-negative");
  }

  allMids<T = { mids: Record<string, string> }>(dex?: string) {
    return this.subscribe<T>({ type: "allMids", ...(dex ? { dex } : {}) });
  }

  candles<T = unknown>(coin: string, interval: HyperliquidInterval = "1m") {
    return this.subscribe<T>({ type: "candle", coin, interval });
  }

  l2Book<T = unknown>(coin: string) {
    return this.subscribe<T>({ type: "l2Book", coin });
  }

  trades<T = unknown>(coin: string) {
    return this.subscribe<T>({ type: "trades", coin });
  }

  subscribe<T = unknown>(subscription: HyperliquidSubscription): AsyncIterable<WebSocketEvent<HyperliquidWebSocketMessage<T>>> {
    const { WebSocketImpl, baseUrl, maxReconnects, reconnectDelayMs, maxQueueSize } = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<WebSocketEvent<HyperliquidWebSocketMessage<T>>> {
        const queue: Array<WebSocketEvent<HyperliquidWebSocketMessage<T>>> = [];
        const waiting: Array<{
          resolve: (value: IteratorResult<WebSocketEvent<HyperliquidWebSocketMessage<T>>>) => void;
          reject: (reason: unknown) => void;
        }> = [];
        let socket: WebSocket | undefined;
        let reconnectTimer: NodeJS.Timeout | undefined;
        let reconnects = 0;
        let stopped = false;
        let finished = false;
        let terminalError: unknown;

        const finish = (error?: unknown) => {
          if (finished) return;
          finished = true;
          terminalError = error;
          while (waiting.length) {
            const waiter = waiting.shift()!;
            if (error) waiter.reject(error);
            else waiter.resolve({ value: undefined, done: true });
          }
        };

        const deliver = (event: WebSocketEvent<HyperliquidWebSocketMessage<T>>) => {
          const waiter = waiting.shift();
          if (waiter) waiter.resolve({ value: event, done: false });
          else {
            if (queue.length >= maxQueueSize) queue.shift();
            queue.push(event);
          }
        };

        const connect = () => {
          if (stopped) return;
          const currentSocket = new WebSocketImpl(baseUrl);
          socket = currentSocket;
          currentSocket.on("open", () => {
            terminalError = undefined;
            currentSocket.send(JSON.stringify({ method: "subscribe", subscription }));
          });
          currentSocket.on("message", (raw) => {
            if (stopped || socket !== currentSocket) return;
            let message: HyperliquidWebSocketMessage<T>;
            try { message = JSON.parse(raw.toString()) as HyperliquidWebSocketMessage<T>; }
            catch { return; }
            if (message.channel === "subscriptionResponse") return;
            deliver({ data: message, receivedAt: Date.now() });
          });
          currentSocket.on("error", (error) => {
            if (socket !== currentSocket) return;
            terminalError = error;
          });
          currentSocket.on("close", () => {
            if (socket !== currentSocket) return;
            if (stopped) return finish();
            if (reconnects >= maxReconnects) return finish(terminalError ?? new Error("Hyperliquid WebSocket closed"));
            const wait = Math.min(reconnectDelayMs * 2 ** reconnects, 5_000);
            reconnects++;
            reconnectTimer = setTimeout(connect, wait);
          });
        };

        connect();
        return {
          next(): Promise<IteratorResult<WebSocketEvent<HyperliquidWebSocketMessage<T>>>> {
            const event = queue.shift();
            if (event) return Promise.resolve({ value: event, done: false });
            if (finished) return terminalError ? Promise.reject(terminalError) : Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
          },
          return(): Promise<IteratorResult<WebSocketEvent<HyperliquidWebSocketMessage<T>>>> {
            stopped = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ method: "unsubscribe", subscription }));
              socket.close(1000, "client complete");
            } else if (socket && socket.readyState < WebSocket.CLOSING) {
              socket.close();
            }
            finish();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }
}
