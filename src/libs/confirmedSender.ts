import { FLOW_LIMITS, type UploadRequest, type UploadAck, type ManifestFile } from "./confirmedProtocol";

export class ConfirmedSender {
  readonly transferId: string;
  private next = 0;
  private stopped = false;
  private pending?: { id: number; resolve(): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> };
  constructor(private socket: WebSocket, private makeId: () => string) { this.transferId = makeId(); }
  accept(message: UploadAck) {
    if (message.protocolVersion === 2 && message.transferId === this.transferId && message.requestId === this.pending?.id) {
      const pending = this.pending; this.pending = undefined;
      if (pending.timer) clearTimeout(pending.timer); pending.resolve();
    }
  }
  abort(message = "Conexão interrompida. Reinicie o envio junto ao totem.") {
    this.stopped = true;
    const pending = this.pending; this.pending = undefined;
    if (pending?.timer) clearTimeout(pending.timer); pending?.reject(new Error(message));
  }
  private async request(payload: Omit<UploadRequest, "type" | "protocolVersion" | "transferId" | "requestId">) {
    if (this.stopped || this.socket.readyState !== 1 || this.pending) throw new Error("Envio interrompido.");
    const id = this.next++;
    const text = JSON.stringify({ type: "upload-request", protocolVersion: 2, transferId: this.transferId, requestId: id, ...payload });
    const frameBytes = new TextEncoder().encode(text).length;
    if (frameBytes > FLOW_LIMITS.frameBytes) throw new Error("Mensagem acima do orçamento de envio.");
    await new Promise<void>((resolve, reject) => {
      const pending = { id, resolve, reject, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      this.pending = pending;
      let attempts = 0;
      const transmit = () => {
        if (this.pending !== pending) return;
        if (this.stopped || this.socket.readyState !== 1 || this.socket.bufferedAmount + frameBytes > FLOW_LIMITS.frameBytes) {
          this.abort(); return;
        }
        try {
          attempts++; this.socket.send(text);
          // Um ACK pode ser síncrono em transportes de teste.
          if (this.pending !== pending) return;
          pending.timer = setTimeout(() => {
            if (attempts < (payload.operation === "finish" ? 1 : 3)) transmit();
            else this.abort("O totem não confirmou o envio no prazo. Reinicie junto ao totem.");
          }, payload.operation === "finish" ? 600_000 : 15_000);
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
        for (let offset = 0, seq = 0; offset < file.size; offset += FLOW_LIMITS.chunkBytes, seq++) {
          if (this.stopped) throw new Error("Envio interrompido.");
          const buffer = await file.slice(offset, offset + FLOW_LIMITS.chunkBytes).arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
          let binary = "";
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          await this.request({ operation: "chunk", fileId, seq, chunkBase64: btoa(binary), sha256 });
          progress(index, Math.min(99, Math.floor(Math.min(offset + bytes.length, file.size) / file.size * 100)), false);
        }
        await this.request({ operation: "file-complete", fileId }); progress(index, 100, true);
      }
      await this.request({ operation: "finish" });
    } catch (error) { this.abort(); throw error; }
  }
}
