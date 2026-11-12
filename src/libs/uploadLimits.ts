export const UPLOAD_PROTOCOL_VERSION = 1;

export class UploadError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export const UPLOAD_LIMITS = {
  maxFiles: 100,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxChunkChars: 64 * 1024,
};

export function validateSelection(files: readonly File[], limits = UPLOAD_LIMITS, allowDuplicateNames = false): string {
  if (files.length > limits.maxFiles) return `Selecione até ${limits.maxFiles} fotos por envio.`;
  if (files.some(file => file.size <= 0 || file.size > limits.maxFileBytes)) {
    return `Cada foto deve ter conteúdo e no máximo ${limits.maxFileBytes / (1024 * 1024)} MiB.`;
  }
  if (files.reduce((total, file) => total + file.size, 0) > limits.maxTotalBytes) {
    return "O tamanho total das fotos ultrapassa o limite do envio (2 GiB).";
  }
  if (!allowDuplicateNames && new Set(files.map(file => file.name)).size !== files.length) {
    return "Há fotos com o mesmo nome. Renomeie os arquivos antes de enviar.";
  }
  return "";
}
