import { FLOW_LIMITS, type UploadRequest, type UploadAck, type ManifestFile } from "./confirmedProtocol";
type SenderFlow = { transferWindowBytes: number; maxInFlightRequests: number };

export class ConfirmedSender {
  readonly transferId: string;
  private next = 0;
  private stopped = false;
  private pending = new Map<number, { resolve(): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }>();
  private readonly transferWindowBytes: number;
  private readonly maxInFlightRequests: number;
  constructor(private socket: WebSocket, private makeId: () => string, negotiatedFlow?: Partial<SenderFlow>) {
    this.transferId = makeId();
    // Bridges anteriores não anunciavam janela pipelined; preserve o envio stop-and-wait nesses casos.
    this.maxInFlightRequests = Number.isSafeInteger(negotiatedFlow?.maxInFlightRequests) && negotiatedFlow!.maxInFlightRequests! > 0
      ? Math.min(FLOW_LIMITS.maxInFlightRequests, negotiatedFlow!.maxInFlightRequests!) : 1;
    this.transferWindowBytes = Number.isSafeInteger(negotiatedFlow?.transferWindowBytes) && negotiatedFlow!.transferWindowBytes! >= FLOW_LIMITS.frameBytes
      ? Math.min(FLOW_LIMITS.transferWindowBytes, negotiatedFlow!.transferWindowBytes!) : FLOW_LIMITS.frameBytes;
  }
  accept(message: UploadAck) {
    const pending = this.pending.get(message.requestId);
    if (message.protocolVersion === 2 && message.transferId === this.transferId && pending) {
      this.pending.delete(message.requestId);
      if (pending.timer) clearTimeout(pending.timer); pending.resolve();
    }
  }
  abort(message = "Conexão interrompida. Reinicie o envio junto ao totem.") {
    this.stopped = true;
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer); pending.reject(new Error(message));
    }
    this.pending.clear();
  }
  private request(payload: Omit<UploadRequest, "type" | "protocolVersion" | "transferId" | "requestId">): Promise<void> {
    if (this.stopped || this.socket.readyState !== 1 || this.pending.size >= this.maxInFlightRequests) return Promise.reject(new Error("Envio interrompido."));
    const id = this.next++;
    const text = JSON.stringify({ type: "upload-request", protocolVersion: 2, transferId: this.transferId, requestId: id, ...payload });
    const frameBytes = new TextEncoder().encode(text).length;
    if (frameBytes > FLOW_LIMITS.frameBytes) throw new Error("Mensagem acima do orçamento de envio.");
    return new Promise<void>((resolve, reject) => {
      const pending = { resolve, reject, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      this.pending.set(id, pending);
      let attempts = 0;
      const transmit = () => {
        if (this.pending.get(id) !== pending) return;
        if (this.stopped || this.socket.readyState !== 1 || this.socket.bufferedAmount + frameBytes > this.transferWindowBytes) {
          this.abort(); return;
        }
        try {
          attempts++; this.socket.send(text);
          // Um ACK pode ser síncrono em transportes de teste.
          if (this.pending.get(id) !== pending) return;
          pending.timer = setTimeout(() => {
            if (attempts < (payload.operation === "finish" ? 1 : Math.ceil(FLOW_LIMITS.requestTimeoutMs / 15_000) + 2)) transmit();
            else this.abort("O totem não confirmou o envio no prazo. Reinicie junto ao totem.");
          }, payload.operation === "finish" ? FLOW_LIMITS.completionTimeoutMs + 10_000 : 15_000);
        } catch { this.abort(); }
      };
      transmit();
    });
  }
  async send(files: readonly File[], progress: (index: number, value: number, done: boolean) => void) {
    const manifest: ManifestFile[] = files.map(file => ({ fileId: this.makeId(), name: file.name,
      size: file.size, mime: file.type || "image/jpeg" }));
    try {
      await this.request({ operation: "start", files: manifest });
      for (let index = 0; index < files.length; index++) {
        const file = files[index]!, fileId = manifest[index]!.fileId;
        const inFlight: Array<{ promise: Promise<void>; size: number }> = [];
        let offset = 0, seq = 0, acknowledged = 0;
        while (offset < file.size || inFlight.length) {
          while (offset < file.size && inFlight.length < this.maxInFlightRequests &&
            inFlight.reduce((sum, item) => sum + item.size, 0) < this.transferWindowBytes) {
          if (this.stopped) throw new Error("Envio interrompido.");
          const buffer = await file.slice(offset, offset + FLOW_LIMITS.chunkBytes).arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
          let binary = "";
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          const chunkBase64 = btoa(binary), promise = this.request({ operation: "chunk", fileId, seq, chunkBase64, sha256 });
          void promise.catch(() => undefined);
          inFlight.push({ promise, size: chunkBase64.length + 256 });
          offset += bytes.length; seq++;
          }
          if (inFlight.length) {
            const completed = inFlight.shift()!;
            await completed.promise;
            acknowledged = Math.min(file.size, acknowledged + FLOW_LIMITS.chunkBytes);
            progress(index, Math.min(99, Math.floor(acknowledged / file.size * 100)), false);
          }
        }
        await this.request({ operation: "file-complete", fileId }); progress(index, 100, true);
      }
      await this.request({ operation: "finish" });
    } catch (error) { this.abort(); throw error; }
  }
}
