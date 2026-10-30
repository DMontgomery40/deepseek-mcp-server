import { webcrypto } from "node:crypto";

// The HTTP adapter expects Web Crypto even when Node starts with it disabled.
if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
