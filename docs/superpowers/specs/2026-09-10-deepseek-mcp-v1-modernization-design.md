# DeepSeek MCP v1 Modernization Design

**Status:** Approved direction, pending written-spec review  
**Date:** 2026-09-10  
**Target release:** `deepseek-mcp-server@1.0.0` / Git tag `v1.0.0`

## Problem

The current `0.6.0` server targets DeepSeek V4 Flash/Pro and the legacy
`@modelcontextprotocol/sdk` v1 package. Since that release, DeepSeek has made
`deepseek-flash` (DeepSeek V4.1 Flash) its canonical API model, added native
visual input and a Files API, retired the old Flash models behind temporary
aliases, and announced the phase-out routing of V4 Pro. MCP has also shipped
the stable split v2 TypeScript packages and the `2026-07-28` protocol revision.

The server needs one coherent major release that adopts those current
contracts without gratuitously renaming its established MCP tools.

## Upstream Contract Snapshot

This design is based on the official public contracts available on
2026-09-10:

- The canonical model is `deepseek-flash`, currently DeepSeek V4.1 Flash.
- `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are retired names that
  temporarily route to `deepseek-flash`.
- `deepseek-v4-pro` remains accepted, but is scheduled to route to V4.1 Flash
  starting 2026-09-14 until V4.1 Pro is released.
- `deepseek-flash` supports text and image input through Chat Completions and
  Responses. Supported image sources are HTTPS URLs, base64 data URLs, and
  Files API `file_id` references.
- The OpenAI-compatible Files API supports upload, list, retrieve, and delete.
- The stable MCP TypeScript SDK is split into `@modelcontextprotocol/server`,
  `@modelcontextprotocol/client`, `@modelcontextprotocol/node`, and
  `@modelcontextprotocol/core` packages at v2.
- MCP `2026-07-28` uses a stateless protocol core, per-request identity and
  capabilities, header routing, deterministic/cacheable lists, and optional
  discovery. The v2 SDK can serve modern and legacy clients from the same
  server factory.

## Goals

1. Make `deepseek-flash` the default model everywhere user-facing defaults are
   declared.
2. Add typed image inputs to the existing `chat_completion` and
   `create_response` tools.
3. Expose the OpenAI-compatible DeepSeek Files API as four MCP tools:
   `upload_file`, `list_files`, `retrieve_file`, and `delete_file`.
4. Migrate all production, test, and smoke-test imports from the v1 MCP package
   to the stable v2 packages.
5. Serve MCP `2026-07-28` over HTTP and stdio while retaining legacy MCP client
   compatibility through the SDK's dual-era serving paths.
6. Adopt current MCP metadata where it improves interoperability: output
   schemas, structured results, tool behavior annotations, and cache hints.
7. Preserve all existing MCP tool names and keep `include_raw_response`
   opt-in.
8. Keep conversation storage bounded by `CONVERSATION_MAX_MESSAGES`.
9. Update README, examples, runtime resources, `.env.example`, package
   metadata, lockfile, and MCP Registry metadata in the same release.
10. Verify, publish npm `1.0.0`, push `v1.0.0`, and create a GitHub release.

## Non-Goals

- Image generation, video, audio, and document understanding are not implied by
  DeepSeek's current visual-input support and will not be advertised.
- The server will not add a separate Anthropic-format MCP tool. Chat
  Completions and Responses already expose the model capabilities without
  duplicating request formats.
- The upload tool will not accept an arbitrary server filesystem path. That
  would be unsafe for hosted deployments and would not refer to the MCP
  client's local filesystem over HTTP.
- This release will not add persistent database-backed conversation storage.
- This release will not publish a new OCI image unless separately requested.
  Existing OCI references must remain truthful rather than pointing at an
  unpublished `1.0.0` image.
- This release will not deploy or reconfigure the hosted
  `deepseek-mcp.ragweld.com` service. The remote endpoint remains documented,
  and its smoke test will run only when the required credential is available.

## Compatibility and Versioning

The package version becomes `1.0.0` because the MCP SDK dependency, transport
lifecycle, and protocol-era behavior change materially. Existing tool names
and ordinary arguments remain compatible:

- `chat_completion`
- `create_response`
- `completion`
- `list_models`
- `get_user_balance`
- `reset_conversation`
- `list_conversations`

`chat_completion.message` expands from a string to either a string or an array
of typed content parts. Text callers therefore continue to work unchanged.
`create_response.input` similarly retains every existing accepted shape while
adding current image and custom-tool item variants.

`MCP_HTTP_STATEFUL_SESSION` is removed from the supported configuration. MCP
2026 no longer has protocol-level sessions, and the existing default was
already stateless. Legacy clients are served through the v2 SDK's stateless
legacy fallback.

## Architecture

### DeepSeek Types and Validation

`src/deepseek/types.ts` will define reusable discriminated unions for:

- Chat text parts, image URL parts, and file parts.
- Responses `input_text`, `output_text`, and `input_image` parts.
- Responses message, function-call, custom-tool, reasoning, and web-search
  items.
- DeepSeek file objects, list results, and deletion results.

`src/deepseek/schemas.ts` will mirror those public contracts with strict
validation of required discriminators and conditional fields. In particular:

- A Chat image URL part requires an HTTP(S) URL or an image data URL and may
  use `detail: low | high | original | auto`.
- A Chat file part accepts exactly one of `file_id` and `file_data`; `filename`
  is valid only with `file_data`.
- A Responses `input_image` accepts exactly one of `image_url` and `file_id`.
- Images are accepted only in the roles/output positions documented by
  DeepSeek.
- `reasoning_effort` accepts DeepSeek's current canonical and compatibility
  values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` where
  the endpoint supports them.
- `upload_file` accepts `filename`, base64 image data (raw base64 or a supported
  image data URL), and optional expiry seconds from 3,600 through 2,592,000.
- File identifiers must use the documented `file-api-...` form.

Pass-through `extra_body` remains available for forward-compatible fields but
cannot overwrite explicitly validated top-level fields.

### DeepSeek Client

`src/deepseek/client.ts` will retain one authenticated transport layer and add
the request capabilities needed by the Files API:

- GET query parameters.
- DELETE requests.
- Multipart form-data uploads without forcing a JSON content type.

The client will add `uploadFile`, `listFiles`, `retrieveFile`, and `deleteFile`
methods. Multipart construction uses the runtime's native `FormData`, `Blob`,
and `fetch`; no file is read from disk. Invalid base64 and unsupported image
media types are rejected before network transmission.

Existing JSON and SSE behavior remains shared across Chat, Responses, and FIM.
The default user agent changes to `deepseek-mcp-server/1.0.0`.

### MCP Tool Surface

`src/mcp-server.ts` will continue to build one server with resources, prompts,
and tools. Every tool will declare an input schema, output schema, and current
annotations when applicable:

| Tool | Behavior annotation | Structured result |
| --- | --- | --- |
| `chat_completion` | open-world, non-destructive | model, text, reasoning, tool calls, usage |
| `create_response` | open-world, non-destructive | model, status, output text/items, usage |
| `completion` | open-world, non-destructive | model, text, usage |
| `list_models` | read-only | live model collection |
| `get_user_balance` | read-only | availability and balances |
| `upload_file` | open-world, non-destructive | uploaded file metadata |
| `list_files` | read-only | page of file metadata |
| `retrieve_file` | read-only | file metadata |
| `delete_file` | destructive and idempotent | deletion result |
| `reset_conversation` | destructive and idempotent | cleared state |
| `list_conversations` | read-only | conversation identifiers |

Human-readable text content remains present for clients that do not consume
`structuredContent`. `include_raw_response` remains opt-in for model-generation
tools.

The runtime resource will identify `deepseek-flash` as current and separately
label legacy aliases instead of implying that aliases are distinct active
models. The live-model resource remains backed by `GET /models`.

### MCP v2 and Protocol 2026

Production server imports move to `@modelcontextprotocol/server`; Node HTTP
bridging uses `@modelcontextprotocol/node`. Tests use
`@modelcontextprotocol/client`.

- Stdio starts through `serveStdio(() => createServer())`, allowing the opening
  exchange to select the modern or legacy era.
- HTTP uses `createMcpHandler(() => createServer())` and the Node adapter. The
  factory creates a server per request as required by the stateless modern
  protocol and the SDK's legacy stateless fallback.
- The existing exact Origin allowlist and CORS preflight behavior remain in a
  wrapper around the SDK handler. Modern routing headers are allowed and
  exposed as required.
- No protocol session map or `Mcp-Session-Id` lifecycle remains in application
  code.
- Conversation state remains application-level state keyed by the explicit
  `conversation_id` tool argument, so it continues to work across stateless MCP
  requests.
- Static tool/resource/prompt lists use deterministic registration order and
  SDK cache hints. The live-model and conversation resources are private and
  short-lived or non-cacheable because their data changes.

### Error Handling

DeepSeek HTTP errors continue to become MCP tool errors with sanitized,
structured metadata. Retryability remains limited to timeout, throttling, and
transient upstream status/error codes. Validation failures remain local and do
not call DeepSeek.

File upload errors identify malformed base64, unsupported image media type,
invalid expiration, or upstream rejection without echoing image bytes. Delete
errors remain explicit; a successful deletion is reported only from a DeepSeek
success response.

## Testing Strategy

The implementation follows red-green TDD and extends shared suites rather than
adding isolated one-case tests.

### Schema Matrix

Tests cover:

- Plain text plus each valid Chat image/file source.
- Each valid Responses image placement.
- Raw base64 and supported image data URLs for upload.
- Mutually exclusive/missing image fields, invalid roles, malformed base64,
  unsupported media types, invalid file IDs, and expiry boundaries.
- Current reasoning-effort aliases and the new default model.

### Client Contracts

Fetch-mock tests verify exact method, URL, query, headers, JSON/multipart body,
stream aggregation, and error handling for every endpoint. File tests cover all
four CRUD operations and ensure binary content is not logged or returned in
errors.

### MCP Contracts

In-process tests verify the complete tool list, schemas, annotations,
structured outputs, raw-response opt-in, conversation behavior, and DeepSeek
request forwarding. HTTP tests exercise both a modern `2026-07-28` client and a
legacy client against the same endpoint, including CORS and failure results.
Stdio smoke coverage confirms the dual-era serving entry can start and stop
cleanly.

### Verification Commands

The release gate is:

```bash
npm run build
npm test
npm pack --dry-run
```

When credentials are already available without exposing them:

```bash
npm run test:live
npm run test:remote
```

The live smoke test must cover model listing, balance, text chat, thinking
streaming, one visual request using a small generated fixture, Responses, FIM,
and Files upload/retrieve/list/delete with cleanup in `finally`.

## Documentation and Metadata

`README.md` will lead with the current canonical model and supported
capabilities, include multimodal examples for URL/data/file inputs, document
the Files tools and their safety boundary, explain MCP 2026 plus legacy
compatibility, and include migration notes from `0.6.0`.

The following must agree on version, model names, tool surface, and environment
variables:

- `package.json` and `package-lock.json`
- `server.json`
- `README.md`
- `.env.example`
- `smithery.yaml`
- `src/docs/deepseek-api-example.md`
- `src/docs/llms-full.txt`
- Runtime server and user-agent versions

The README and registry metadata will not claim an OCI `1.0.0` image exists.

## Release Procedure

After all verification gates pass:

1. Confirm the working tree contains only the intended release changes.
2. Confirm npm authentication and package ownership.
3. Commit the implementation and release metadata on `main`.
4. Create annotated tag `v1.0.0` at the verified release commit.
5. Publish `deepseek-mcp-server@1.0.0` to npm with public access.
6. Push `main` and `v1.0.0` to `origin`.
7. Create a GitHub release from `v1.0.0` with capability, compatibility, and
   migration notes.
8. Verify the npm registry version, GitHub tag, and GitHub release remotely.

If npm requires an interactive one-time password or another unavailable human
authentication step, the release stops before publication and reports that
single remaining action. No tag or release will be presented as published
until the corresponding remote state is verified.

## Acceptance Criteria

- `deepseek-flash` is the runtime, schema-example, Smithery, and README default.
- Valid visual requests reach Chat and Responses unchanged after validation.
- Files CRUD tools call the documented DeepSeek endpoints and expose structured
  results.
- All previous tools remain registered under their existing names.
- HTTP and stdio serve MCP 2026 clients and retain legacy client support.
- No production or test source imports `@modelcontextprotocol/sdk`.
- Build, full tests, and npm package dry-run pass from the release commit.
- Available live/remote smoke tests pass, or unavailable credentials are
  reported precisely.
- npm reports version `1.0.0` after publication.
- `origin` contains tag `v1.0.0`, and GitHub shows a release for that tag.
- README and registry metadata describe only capabilities and artifacts that
  exist at release time.
