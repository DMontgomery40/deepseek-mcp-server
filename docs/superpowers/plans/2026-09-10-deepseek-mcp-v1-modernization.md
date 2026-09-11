# DeepSeek MCP v1 Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `deepseek-mcp-server@1.0.0` with DeepSeek V4.1 Flash visual input, Files API tools, and dual-era MCP 2026/legacy transports.

**Architecture:** Extend the existing DeepSeek fetch client with typed multimodal JSON and multipart Files API operations, then expose those through the established MCP server factory. Replace MCP SDK v1 transport wiring with the stable v2 split packages, using `serveStdio` and `createMcpHandler` so explicit conversation handles remain application state while protocol transport becomes stateless.

**Tech Stack:** TypeScript 6, Node.js 20+, Zod 4, Vitest 5, MCP TypeScript SDK v2, native fetch/FormData/Blob.

**Spec:** `docs/superpowers/specs/2026-09-10-deepseek-mcp-v1-modernization-design.md`

## Global Constraints

- Target package and server version is exactly `1.0.0`; Git tag is exactly `v1.0.0`.
- Default model is exactly `deepseek-flash`.
- Preserve all seven existing MCP tool names and add exactly `upload_file`, `list_files`, `retrieve_file`, and `delete_file`.
- Keep `include_raw_response` opt-in and conversation storage capped by `CONVERSATION_MAX_MESSAGES`.
- Do not accept server-local paths for upload and do not echo uploaded image bytes in output or errors.
- Serve MCP `2026-07-28` and legacy MCP clients over stdio and HTTP.
- Do not claim or publish an OCI `1.0.0` image.
- Extend shared tests with bug-family matrices; do not add a new test framework.

---

### Task 1: Multimodal and Files Contract Types

**Files:**
- Modify: `src/deepseek/types.ts`
- Modify: `src/deepseek/schemas.ts`
- Modify: `test/schemas.test.ts`

**Interfaces:**
- Produces: `DeepSeekChatContentPart`, `DeepSeekResponseInputItem`, `DeepSeekFile`, `DeepSeekFileList`, `DeepSeekFileDeletion`
- Produces: `uploadFileToolInputSchema`, `listFilesToolInputSchema`, `fileIdToolInputSchema`
- Produces: `UploadFileToolInput`, `ListFilesToolInput`, `FileIdToolInput`

- [ ] **Step 1: Write failing schema matrix tests**

Add table-driven tests whose literal valid cases include:

```ts
{ message: [{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "https://example.com/a.png", detail: "low" } }] }
{ message: [{ type: "file", file_id: "file-api-abc123" }] }
{ input: [{ role: "user", content: [{ type: "input_text", text: "describe" }, { type: "input_image", file_id: "file-api-abc123" }] }] }
{ filename: "pixel.png", file_data: "iVBORw0KGgo=", expires_after_seconds: 3600 }
```

Add literal invalid cases for missing/both image sources, file-data filename misuse, invalid roles, malformed base64, unsupported media type, invalid `file_id`, and expiry values `3599` and `2592001`.

- [ ] **Step 2: Run schema tests and verify the new cases fail because the contracts are absent**

Run: `npm test -- test/schemas.test.ts`

Expected: existing cases pass; new multimodal/File cases fail validation or import resolution for the new schemas.

- [ ] **Step 3: Implement discriminated types and Zod schemas**

Implement these exact public shapes:

```ts
export type DeepSeekImageDetail = "low" | "high" | "original" | "auto";
export type DeepSeekChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: DeepSeekImageDetail } }
  | { type: "file"; file_id?: string; file_data?: string; filename?: string };

export interface DeepSeekFile {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  filename: string;
  purpose: "user_data";
  expires_at?: number;
}

export interface DeepSeekFileList {
  object: "list";
  data: DeepSeekFile[];
  first_id?: string;
  last_id?: string;
  has_more: boolean;
}

export interface DeepSeekFileDeletion {
  id: string;
  object: "file";
  deleted: boolean;
}
```

Use `.superRefine` for mutually exclusive fields and base64 validation. Expand Chat and Responses reasoning effort enums to the values in the approved spec.

- [ ] **Step 4: Run schema tests and full tests**

Run: `npm test -- test/schemas.test.ts && npm test`

Expected: all schema and existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/deepseek/types.ts src/deepseek/schemas.ts test/schemas.test.ts
git commit -m "feat: add DeepSeek multimodal contracts"
```

### Task 2: Files API Client

**Files:**
- Modify: `src/deepseek/client.ts`
- Modify: `test/deepseek-client.test.ts`

**Interfaces:**
- Consumes: `DeepSeekFile`, `DeepSeekFileList`, `DeepSeekFileDeletion`
- Produces: `uploadFile(input: UploadFileRequest): Promise<DeepSeekFile>`
- Produces: `listFiles(input?: ListFilesRequest): Promise<DeepSeekFileList>`
- Produces: `retrieveFile(fileId: string): Promise<DeepSeekFile>`
- Produces: `deleteFile(fileId: string): Promise<DeepSeekFileDeletion>`

- [ ] **Step 1: Write failing client boundary tests**

Add fetch-boundary tests that call the wished-for methods through a typed
compatibility cast until implementation exists. Assert literal contracts:

```ts
expect(url).toBe("https://api.deepseek.com/files?after=file-api-a&limit=25&order=desc&purpose=user_data");
expect(init.method).toBe("GET");
expect(init.headers).not.toHaveProperty("Content-Type");
```

For upload, assert `init.body` is a `FormData`, `purpose` is `user_data`, the
filename is preserved, and expiry fields are paired. Add retrieve/delete path
tests and an upstream failure test that does not include the supplied base64
payload in the thrown message.

- [ ] **Step 2: Run the client tests and verify red**

Run: `npm test -- test/deepseek-client.test.ts`

Expected: new cases fail because Files methods do not exist.

- [ ] **Step 3: Implement generalized request transport and Files methods**

Extend request options to support `DELETE`, `URLSearchParams`, and `BodyInit`.
Only set `Content-Type: application/json` for JSON bodies; allow `fetch` to set
the multipart boundary for `FormData`. Decode upload base64 into a `Blob` with
one of `image/jpeg`, `image/png`, `image/gif`, or `image/webp`.

- [ ] **Step 4: Run client and full tests**

Run: `npm test -- test/deepseek-client.test.ts && npm test`

Expected: all client and full-suite tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/deepseek/client.ts test/deepseek-client.test.ts
git commit -m "feat: add DeepSeek Files API client"
```

### Task 3: MCP Multimodal and Files Tools

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `test/mcp-server.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and Task 2 client methods
- Produces: four Files API MCP tools and expanded existing generation tools

- [ ] **Step 1: Write failing MCP contract tests**

Extend the harness API with complete file fixtures and assert the exact tool
set contains eleven names. Add behavior tests that call:

```ts
await client.callTool({
  name: "chat_completion",
  arguments: {
    message: [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ],
  },
});
```

Assert the array reaches the DeepSeek client unchanged. Call every Files tool
and assert human-readable `content`, schema-conforming `structuredContent`, and
the expected read-only/destructive annotations returned by `tools/list`.

- [ ] **Step 2: Run MCP tests and verify red**

Run: `npm test -- test/mcp-server.test.ts`

Expected: tool-list and multimodal forwarding expectations fail.

- [ ] **Step 3: Register current tool contracts**

Set server version `1.0.0`, current model metadata to `deepseek-flash`, and add
the four Files registrations. Use output schemas that match every returned
`structuredContent` object. Preserve raw response opt-in and text output.

- [ ] **Step 4: Run MCP and full tests**

Run: `npm test -- test/mcp-server.test.ts && npm test`

Expected: all MCP and full-suite tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.ts test/mcp-server.test.ts
git commit -m "feat: expose multimodal and Files MCP tools"
```

### Task 4: MCP SDK v2 and Protocol 2026

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/index.ts`
- Modify: `src/transports/http.ts`
- Modify: `src/config.ts`
- Modify: `test/http-transport.test.ts`
- Modify: `test/mcp-server.test.ts`
- Modify: `scripts/live-smoke.mjs`
- Modify: `scripts/remote-smoke.mjs`

**Interfaces:**
- Produces: `startStreamableHttpServer(createServer, options)` backed by `createMcpHandler`
- Produces: dual-era stdio startup through `serveStdio`
- Removes: `MCP_HTTP_STATEFUL_SESSION`

- [ ] **Step 1: Add v2 packages alongside v1 and install**

Add runtime `@modelcontextprotocol/server@^2.0.0` and
`@modelcontextprotocol/node@^2.0.0`, plus development
`@modelcontextprotocol/client@^2.0.0`. Keep v1 temporarily so red tests can run,
then run `npm install`.

- [ ] **Step 2: Write modern-protocol and compatibility tests**

Use a v2 `Client` with `versionNegotiation: { mode: "auto" }` against the HTTP
runtime and assert `getProtocolEra()` returns `modern`. Add a second client
with legacy negotiation and assert the same eleven tools work. Preserve Origin
allowlist, preflight, structured-error, and close tests.

- [ ] **Step 3: Run HTTP tests and verify red**

Run: `npm test -- test/http-transport.test.ts`

Expected: modern negotiation fails against the v1 transport implementation.

- [ ] **Step 4: Migrate production and tests to v2**

Use these v2 entry points:

```ts
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
```

Wrap the web-standard handler with exact-Origin CORS checks and Node's HTTP
adapter. Remove v1 transport/session maps and the stateful-session config.
Update allowed/exposed headers for `Mcp-Protocol-Version`, `Mcp-Method`, and
`Mcp-Name`.

- [ ] **Step 5: Remove the v1 dependency and verify no imports remain**

Run: `rg -n '@modelcontextprotocol/sdk' src test scripts package.json`

Expected: no matches.

- [ ] **Step 6: Run build, HTTP tests, and full tests**

Run: `npm run build && npm test -- test/http-transport.test.ts && npm test`

Expected: TypeScript builds and all tests pass on SDK v2.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/index.ts src/transports/http.ts src/config.ts test scripts
git commit -m "feat: migrate to MCP 2026 and SDK v2"
```

### Task 5: Documentation, Smokes, and Release Metadata

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `server.json`
- Modify: `smithery.yaml`
- Modify: `src/docs/deepseek-api-example.md`
- Modify: `src/docs/llms-full.txt`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/live-smoke.mjs`
- Modify: `scripts/remote-smoke.mjs`
- Modify: `src/deepseek/client.ts`
- Modify: `src/mcp-server.ts`

**Interfaces:**
- Produces: package and registry metadata for `1.0.0`
- Produces: operator documentation for multimodal, Files, MCP 2026, and migration

- [ ] **Step 1: Update package version and all current defaults**

Run `npm version 1.0.0 --no-git-tag-version`, update the runtime server/user
agent versions, set `deepseek-flash` in all defaults/examples, and update
`server.json` npm metadata. Retain the last truthful OCI identifier without
claiming an unpublished image.

- [ ] **Step 2: Update README and bundled docs**

Document the eleven tools, image source shapes, Files upload safety boundary,
MCP 2026/legacy behavior, removed `MCP_HTTP_STATEFUL_SESSION`, and migration
from `0.6.0`. State that DeepSeek multimodality is visual input, not image
generation/video/audio.

- [ ] **Step 3: Expand smoke tests**

The live smoke uploads a generated 1x1 PNG, retrieves/lists/references it in a
visual request, and deletes it in `finally`. The remote smoke asserts all
eleven tools and calls only non-destructive credential-safe operations.

- [ ] **Step 4: Run metadata and package checks**

Run:

```bash
npm run build
npm test
npm pack --dry-run
npm audit --omit=dev
git diff --check
```

Expected: build/tests/package check pass, no production audit findings, and no
whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example server.json smithery.yaml src/docs package.json package-lock.json scripts src/deepseek/client.ts src/mcp-server.ts
git commit -m "release: prepare deepseek-mcp-server 1.0.0"
```

### Task 6: Release Verification and Publication

**Files:**
- Verify all tracked release files
- Create: annotated Git tag `v1.0.0`
- Publish: npm package and GitHub release

**Interfaces:**
- Consumes: verified release commit from Tasks 1-5
- Produces: npm `deepseek-mcp-server@1.0.0`, remote tag `v1.0.0`, GitHub release

- [ ] **Step 1: Run final release gate from a clean commit**

Run `npm run build && npm test && npm pack --dry-run && npm audit --omit=dev`.
Run live/remote smokes only when their credentials are present.

- [ ] **Step 2: Review release diff and repository state**

Run `git status --short`, `git log --oneline origin/main..HEAD`, and
`git diff --stat origin/main...HEAD`. Confirm only approved changes exist.

- [ ] **Step 3: Merge the verified feature branch to local main**

Fast-forward `main` to `feat/deepseek-mcp-v1` after confirming the main
checkout has no uncommitted files.

- [ ] **Step 4: Verify publication credentials and package ownership**

Run `npm whoami`, `npm owner ls deepseek-mcp-server`, and `gh auth status`.
Do not print tokens.

- [ ] **Step 5: Create tag, publish, and push**

Create annotated tag `v1.0.0`, run
`npm publish --access public`, push `main` and `v1.0.0`, then create the GitHub
release with concise capability and migration notes. If npm demands an OTP,
stop at that prompt and report only that action.

- [ ] **Step 6: Verify remote state**

Run `npm view deepseek-mcp-server version`, `git ls-remote --tags origin
refs/tags/v1.0.0`, and `gh release view v1.0.0`. The task is complete only when
all three identify `1.0.0`/`v1.0.0`.
