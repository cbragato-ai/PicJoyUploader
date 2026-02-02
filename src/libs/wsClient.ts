// wsClient.ts
export type WSMessage =
  | { type: "register"; role: "web"; id: string; sessionId?: string }
  | { type: "notify"; toSession: string; message: string } // notify server to forward to electron
  | {
      type: "file-start";
      toSession: string;
      fileName: string;
      size: number;
      mime: string;
      fileId: string;
    }
  | {
      type: "file-chunk";
      toSession: string;
      fileId: string;
      seq: number;
      chunk: string;
    } // chunk: base64
  | {
      type: "file-complete";
      toSession: string;
      fileId: string;
      fileName: string;
    };

export interface UploadProgress {
  fileId: string;
  fileName: string;
  sentBytes: number;
  totalBytes: number;
  percent: number;
  done: boolean;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string;
  private reconnectDelay = 2000;
  private onOpenCb?: () => void;
  private onMessageCb?: (m: any) => void;

  constructor(url: string, sessionId: string) {
    this.url = url;
    this.sessionId = sessionId;
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => {
      // register as web client
      this.send({
        type: "register",
        role: "web",
        id: `${this.sessionId}-web`,
        sessionId: this.sessionId,
      });
      this.onOpenCb?.();
    });
    this.ws.addEventListener("message", (ev) => {
      // basic message pass-through
      let text: string;
      if (typeof ev.data === "string") text = ev.data;
      else if (ev.data instanceof Blob) {
        // blob -> text
        ev.data.text().then((t) => {
          try {
            this.onMessageCb?.(JSON.parse(t));
          } catch {
            this.onMessageCb?.(t);
          }
        });
        return;
      } else if (
        ev.data instanceof ArrayBuffer ||
        ev.data instanceof Uint8Array
      ) {
        text = new TextDecoder().decode(ev.data as ArrayBuffer);
      } else {
        // unknown
        try {
          this.onMessageCb?.(JSON.parse(String(ev.data)));
        } catch {
          this.onMessageCb?.(ev.data);
        }
        return;
      }
      try {
        const parsed = JSON.parse(text);
        this.onMessageCb?.(parsed);
      } catch {
        this.onMessageCb?.(text);
      }
    });
    this.ws.addEventListener("close", () => {
      console.warn("WS closed. Reconnecting in", this.reconnectDelay);
      setTimeout(() => this.connect(), this.reconnectDelay);
    });
    this.ws.addEventListener("error", (err) => {
      console.error("WS error", err);
      // socket may close and reconnection handled on close
    });
  }

  onOpen(cb: () => void) {
    this.onOpenCb = cb;
  }

  onMessage(cb: (m: any) => void) {
    this.onMessageCb = cb;
  }

  send(msg: WSMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not open, cannot send", msg);
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  // notify the server to inform the electron machine (server should forward)
  notify(toSession: string, message: string) {
    this.send({ type: "notify", toSession, message });
  }

  // send file (chunked) — each chunk is base64
  async sendFile(
    file: File,
    toSession: string,
    onProgress?: (p: UploadProgress) => void
  ) {
    const chunkSize = 128 * 1024; // 128KB
    const total = file.size;
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // send start meta
    this.send({
      type: "file-start",
      toSession,
      fileName: file.name,
      size: file.size,
      mime: file.type,
      fileId,
    });

    let offset = 0;
    let seq = 0;
    while (offset < total) {
      const slice = file.slice(offset, Math.min(offset + chunkSize, total));
      const ab = await slice.arrayBuffer();
      const base64 = arrayBufferToBase64(ab);
      this.send({ type: "file-chunk", toSession, fileId, seq, chunk: base64 });
      offset += chunkSize;
      seq++;
      onProgress?.({
        fileId,
        fileName: file.name,
        sentBytes: offset,
        totalBytes: total,
        percent: Math.round((offset / total) * 100),
        done: false,
      });
      // small pause to avoid saturating bridge
      await smallDelay(20);
    }

    // complete
    this.send({
      type: "file-complete",
      toSession,
      fileId,
      fileName: file.name,
    });
    onProgress?.({
      fileId,
      fileName: file.name,
      sentBytes: total,
      totalBytes: total,
      percent: 100,
      done: true,
    });
    return fileId;
  }
}

// helpers
function smallDelay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  // converts ArrayBuffer to base64 safely by chunks
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}
