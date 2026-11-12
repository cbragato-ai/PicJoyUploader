export const UPLOAD_PROTOCOL_VERSION = 1;

export class UploadError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export const UPLOAD_LIMITS = {
  maxFiles: 100,
  maxFileBytes: Number.MAX_SAFE_INTEGER,
  maxTotalBytes: Number.MAX_SAFE_INTEGER,
  maxChunkChars: 64 * 1024,
};

export function validateSelection(files: readonly File[], limits = UPLOAD_LIMITS, allowDuplicateNames = false): string {
  if (files.length > limits.maxFiles) return `Selecione até ${limits.maxFiles} fotos por envio.`;
  if (files.some(file => !Number.isSafeInteger(file.size) || file.size <= 0)) {
    return "Selecione fotos com conteúdo e tamanho válido.";
  }
  if (!Number.isSafeInteger(files.reduce((total, file) => total + file.size, 0))) {
    return "Os tamanhos informados para as fotos são inválidos.";
  }
  if (!allowDuplicateNames && new Set(files.map(file => file.name)).size !== files.length) {
    return "Há fotos com o mesmo nome. Renomeie os arquivos antes de enviar.";
  }
  return "";
}
