import { Buffer } from "buffer";

// @ts-ignore
globalThis.process ??= { env: {} };
globalThis.Buffer ??= Buffer;
