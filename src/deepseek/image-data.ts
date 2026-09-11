export const MAX_DEEPSEEK_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_DEEPSEEK_FILE_BASE64_CHARS =
  Math.ceil(MAX_DEEPSEEK_FILE_BYTES / 3) * 4;

const BASE64_PATTERN = /^[a-zA-Z0-9+/]+={0,2}$/;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface Base64Inspection {
  decodedBytes: number;
  padding: number;
}

export function inspectCanonicalBase64(payload: string): Base64Inspection | undefined {
  if (payload.length === 0 || payload.length % 4 !== 0 || !BASE64_PATTERN.test(payload)) {
    return undefined;
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const lastDataCharacter = payload[payload.length - padding - 1];
  const lastDataValue = BASE64_ALPHABET.indexOf(lastDataCharacter);

  if (lastDataValue < 0) {
    return undefined;
  }
  if (padding === 2 && (lastDataValue & 0b1111) !== 0) {
    return undefined;
  }
  if (padding === 1 && (lastDataValue & 0b11) !== 0) {
    return undefined;
  }

  const decodedBytes = base64DecodedByteLength(payload.length, padding);
  if (decodedBytes === undefined || decodedBytes === 0) {
    return undefined;
  }

  return { decodedBytes, padding };
}

export function base64DecodedByteLength(
  encodedLength: number,
  padding: number,
): number | undefined {
  if (
    !Number.isSafeInteger(encodedLength) ||
    encodedLength <= 0 ||
    encodedLength % 4 !== 0 ||
    !Number.isInteger(padding) ||
    padding < 0 ||
    padding > 2
  ) {
    return undefined;
  }

  return (encodedLength / 4) * 3 - padding;
}

export function isBase64SizeWithinLimit(
  encodedLength: number,
  padding: number,
  maxBytes = MAX_DEEPSEEK_FILE_BYTES,
): boolean {
  const decodedBytes = base64DecodedByteLength(encodedLength, padding);
  return (
    Number.isSafeInteger(maxBytes) &&
    maxBytes >= 0 &&
    decodedBytes !== undefined &&
    decodedBytes <= maxBytes
  );
}
