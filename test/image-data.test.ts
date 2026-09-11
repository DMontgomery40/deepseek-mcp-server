import { describe, expect, it } from "vitest";

import {
  MAX_DEEPSEEK_FILE_BYTES,
  base64DecodedByteLength,
  inspectCanonicalBase64,
  isBase64SizeWithinLimit,
} from "../src/deepseek/image-data.js";

describe("base64 image sizing", () => {
  it("enforces the DeepSeek 64 MiB boundary without allocating the payload", () => {
    const atLimit = encodedShapeForBytes(MAX_DEEPSEEK_FILE_BYTES);
    const overLimit = encodedShapeForBytes(MAX_DEEPSEEK_FILE_BYTES + 1);

    expect(base64DecodedByteLength(atLimit.encodedLength, atLimit.padding)).toBe(
      MAX_DEEPSEEK_FILE_BYTES,
    );
    expect(isBase64SizeWithinLimit(atLimit.encodedLength, atLimit.padding)).toBe(true);
    expect(base64DecodedByteLength(overLimit.encodedLength, overLimit.padding)).toBe(
      MAX_DEEPSEEK_FILE_BYTES + 1,
    );
    expect(isBase64SizeWithinLimit(overLimit.encodedLength, overLimit.padding)).toBe(false);
  });

  it.each([
    ["AA==", 1],
    ["AAA=", 2],
    ["AAAA", 3],
    ["iVBORw0KGgo=", 8],
  ])("accepts canonical base64 %s", (payload, decodedBytes) => {
    expect(inspectCanonicalBase64(payload)).toMatchObject({ decodedBytes });
  });

  it.each(["", "A", "AAA", "AB==", "AAB=", "AAAA=", "not base64!"])(
    "rejects non-canonical base64 %s",
    (payload) => {
      expect(inspectCanonicalBase64(payload)).toBeUndefined();
    },
  );
});

function encodedShapeForBytes(bytes: number): { encodedLength: number; padding: number } {
  return {
    encodedLength: Math.ceil(bytes / 3) * 4,
    padding: bytes % 3 === 0 ? 0 : 3 - (bytes % 3),
  };
}
