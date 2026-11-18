// SPDX-License-Identifier: CC0-1.0
//
// Minimal type declarations for the parts of ws the server uses. Written
// for this project (not part of ws).
//

import type { Server } from "node:http";

export class WebSocketServer {
  constructor(opts: { server: Server, path?: string });
  on(event: "connection", f: (ws: WebSocket) => void): void;
  close(): void;
}

export class WebSocket {
  constructor(url: string);
  readyState : number;
  send(data: string): void;
  close(): void;
  terminate(): void;
  on(event: "message", f: (data: unknown) => void): void;
  on(event: "open" | "close", f: () => void): void;
}
