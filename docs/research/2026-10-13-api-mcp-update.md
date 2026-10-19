# DeepSeek API and MCP release contract refresh

Checked against official documentation and npm on October 13, 2026. This is a
source-contract snapshot, not proof of live provider or hosted endpoint execution.

## October 19, 2026 addendum: Search, Fetch, and Responses web search

DeepSeek's October 17 update supersedes the web-search finding below. The
current [Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
says `web_search` runs server-side with `deepseek-v4-pro` and is ignored with
`deepseek-flash`. The MCP `create_response` input already admits that tool
shape. DeepSeek also opened separate raw JSON
[Search and Fetch APIs](https://api-docs.deepseek.com/guides/search/) at
`POST /v1/tools/search` and `POST /v1/tools/fetch`; this MCP server does not
expose standalone tools for them.

The guide prices each endpoint at $0.75 per 1,000 successful requests. Only
HTTP 200 calls with non-empty Search results or Fetch content are billed;
these request fees are separate from model-token charges. DeepSeek's
[October 17 announcement](https://api-docs.deepseek.com/news/news261017/)
says server-side Search/Fetch calls through DeepSeek Harness, Claude Code, and
Codex are temporarily free for DeepSeek API users, with per-request billing
starting October 31, 2026 at 16:00 UTC. It does not promise the same waiver
for other integrations. The announcement also says `deepseek-flash` now serves
DeepSeek-V4.1-Flash-1017 without changing its calling method or model-token
pricing. The original October 13 audit remains below as a dated record.

## Released models

The current canonical models are `deepseek-flash` (DeepSeek V4.1 Flash) and
`deepseek-v4-pro` (DeepSeek V4 Pro 0813). Both support thinking, Chat Completions,
Responses, JSON output, function calls, and beta FIM/prefix completion. Both
advertise 1M context and maximum 384K output; vision is available on Flash only.
The retired Flash/Vision model IDs remain compatibility aliases for V4.1 Flash.
[Official model table](https://api-docs.deepseek.com/quick_start/pricing/)

The September announcement originally said Pro would redirect to Flash on
September 14. The current changelog explicitly reverses that plan: Pro remains
available with unchanged billing. Update README's future-tense rerouting claim.
No V4.1 Pro release appears in the current official changelog.
[Official changelog](https://api-docs.deepseek.com/updates/)

## API compatibility fixes

- Chat and Responses canonical thinking efforts are `none`, `low`, `high`, and
  `max`. Compatibility aliases remain accepted: `minimal` maps to `low`;
  `medium` and `xhigh` map to `high`. The linked thinking guide additionally
  maps `ultra` to `max`, which the endpoint reference's abbreviated list omits.
  Retain these aliases without presenting them as distinct effort levels.
  [Thinking guide](https://api-docs.deepseek.com/guides/thinking_mode/)
- Chat `stream_options` requires `stream=true`. Function names must satisfy
  `[a-zA-Z0-9_-]`, be no longer than 128 characters, and be unique. Forced Chat
  tool choices (`required` or a named function) fail in thinking mode. Chat
  `max_tokens` is bounded at 393216. Frequency/presence penalties are ignored.
  [Chat reference](https://api-docs.deepseek.com/api/create-chat-completion/)
- Responses is stateless. Images are allowed in user/developer messages and
  tool outputs, but fail in system/assistant messages. `developer` is treated
  as user. Function call IDs must pair with corresponding outputs. Keep
  full-history multi-turn guidance and validate unsupported image positions.
  [Responses reference](https://api-docs.deepseek.com/api/create-response/)
- Responses custom tools support only `{ "type": "custom", "name":
  "apply_patch" }`; other custom names return 400. The current server accepts
  custom call input items but lacks this tool-definition shape. Add it.
- Responses built-ins such as `web_search`, `file_search`, `code_interpreter`,
  `computer_use`, and `mcp` are ignored. Remove README's web-search execution
  claim. Legacy `web_search_call` history items may still be restored into
  context. `previous_response_id`, `conversation`, `store`, and Responses
  `stream_options` do not add provider state or streaming controls. Semantic
  streams end with completed/incomplete/failed events, already matching the
  client's aggregation strategy.
  [Responses compatibility guide](https://api-docs.deepseek.com/guides/responses_api/)
- Prefix Chat requires an assistant final message with `prefix=true` and the
  `/beta` base. Strict function calling also requires `/beta`, with strict
  enabled on every function. The current default Chat route does not select
  beta for either feature. Ensure beta routing preserves configured base URLs.
  [Prefix guide](https://api-docs.deepseek.com/guides/chat_prefix_completion/),
  [Strict tool guide](https://api-docs.deepseek.com/guides/tool_calls/)
- FIM remains beta and non-thinking only. Its route is `/beta/completions`;
  avoid duplicating `/beta` if the configured base already ends with it.
  `echo=true` cannot accompany `suffix` or `logprobs`. Add typed
  `stream_options` forwarding with the stream=true prerequisite. The FIM guide
  still documents a 4K limit while the reference supplies no maximum; preserve
  this distinction rather than asserting the Chat maximum applies to FIM.
  [FIM reference](https://api-docs.deepseek.com/api/create-completion/),
  [FIM guide](https://api-docs.deepseek.com/guides/fim_completion/)
- Files contracts still match existing implementation: image-only uploads,
  JPEG/PNG/GIF/WebP, 64 MiB, `user_data`, and optional paired expiry fields
  between 3600 and 2592000 seconds.
  [Upload reference](https://api-docs.deepseek.com/api/create-file/)

## MCP and dependency release choices

The current released protocol remains `2026-07-28`; official SDK documentation
calls v2 the stable release line. Keep the existing `serveStdio` and
`createMcpHandler` entry points; a directly connected `McpServer` alone does
not opt into the modern protocol.
[Versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning),
[Stable SDK](https://ts.sdk.modelcontextprotocol.io/v2/)

Live `npm view` resolves `latest` to server/client **2.3.1** (published October
5) and Node adapter **2.1.1** (published October 2). The adapter declares server
`^2.3.0` as its peer; update these together. All require Node >=20. Core 2.3.1
is the server's exact transitive dependency; no direct core dependency is
necessary for the repository's existing imports.
[npm server registry](https://registry.npmjs.org/@modelcontextprotocol%2fserver),
[npm client registry](https://registry.npmjs.org/@modelcontextprotocol%2fclient),
[npm node registry](https://registry.npmjs.org/@modelcontextprotocol%2fnode),
[Official releases](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1)

Modern HTTP requires standard protocol/method/name headers matching its body.
SDK handlers validate these. Cacheable results receive conservative cache
fields by default. Modern cancellation uses stream-close; in-memory linked
transports cover legacy behavior only. Keep explicit modern HTTP and spawned
stdio tests alongside existing legacy tests when refreshing dependencies.
[Protocol migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

The registry manifest schema is separate from the wire protocol. Official
examples still use `2025-12-11/server.schema.json`, so retain that schema rather
than replacing its date with the protocol date. Preserve package `mcpName`
matching the manifest name. A new package version does not prove the listed
hosted service or old OCI tag was updated.
[Registry package requirements](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx)

The existing npm `latest` is 1.0.1, but historical version IDs 1.0.0, 1.1.0,
1.2.0, and 1.3.0 appear in registry history. Choose an unpublished identifier
and verify availability before publishing; npm version history is immutable.
[Package registry](https://registry.npmjs.org/deepseek-mcp-server)

## Appendix: complete Responses, vision, and Files contract audit

This follow-up read covers these eight pages' complete substantive content,
including examples, compatibility tables, response shapes, and streaming
sections, against the updated source on October 13. It does **not** claim all
DeepSeek documentation was read. Upload initially timed out in the browsing
tool; a subsequent direct HTTPS retrieval succeeded and its entire live
article, including request/schema/both examples, was read as well.

| Page read | Coverage |
| --- | --- |
| [Responses reference](https://api-docs.deepseek.com/api/create-response/) | Entire request, nested inputs, formats, tools, response/usage/errors, both response modes and examples |
| [Responses guide](https://api-docs.deepseek.com/guides/responses_api/) | All events, image fields/limits, every parameter/item/tool compatibility row |
| [Vision guide](https://api-docs.deepseek.com/guides/vision/) | All three input paths, examples, detail, limits, tokens, restrictions, Anthropic/Responses variants |
| [Files guide](https://api-docs.deepseek.com/guides/files_api/) | All operations, expiry, examples, reuse, ownership, Anthropic alternatives and quotas |
| [Upload reference](https://api-docs.deepseek.com/api/create-file/) | Full live multipart fields, response fields and both examples |
| [List reference](https://api-docs.deepseek.com/api/list-files/) | All queries/defaults, file/list fields and both examples |
| [Retrieve reference](https://api-docs.deepseek.com/api/retrieve-file/) | Path input, complete metadata response and both examples |
| [Delete reference](https://api-docs.deepseek.com/api/delete-file/) | Path input, complete deletion result and both examples |

### Remaining actionable gaps

| Finding in current code | Required action and source |
| --- | --- |
| Inline image validation reuses the **64 MiB upload** ceiling. | Separate inline **32 MiB** ceiling; check final serialized JSON **48 MiB**, image count **600**, and known aggregate sizes **64 MiB** (or **200 MiB** with file references). Remote/file sizes remain provider-validated unless known. [Vision](https://api-docs.deepseek.com/guides/vision/) |
| No dimension checks or limit guidance. | Explain **8192 px/side**, reduced to **4096** for >=15 images. If adding local checks, parse actual inline image headers; retain provider enforcement for remote/file inputs. External downloads have a 60s provider deadline. [Vision](https://api-docs.deepseek.com/guides/vision/) |
| Responses tools enforce each function name, but allow duplicate definitions. Input call IDs require nonempty strings but lack cross-item checks. | Reject duplicate tool names and duplicate/unpaired function/custom call IDs before sending. Preserve one call and corresponding output sharing an ID. [Responses reference](https://api-docs.deepseek.com/api/create-response/), [guide](https://api-docs.deepseek.com/guides/responses_api/) |
| `reasoning.effort` is required inside the tool's reasoning object, whereas the client type makes it optional. The object is strict. | Make effort optional if mirroring provider syntax; explicitly accept or explain rejection of ignored `summary`. This is compatibility acceptance, not summary generation. [Responses reference](https://api-docs.deepseek.com/api/create-response/), [guide](https://api-docs.deepseek.com/guides/responses_api/) |
| Text requires `format` whenever `text` exists; nested formats pass extra fields. | Supported text/json_object/json_schema formats are covered. `text.verbosity` has no effect; accepting it alone would be compatibility only. Do not advertise an additional feature. [Responses guide](https://api-docs.deepseek.com/guides/responses_api/) |
| Provider nullable fields are rejected by tool schemas, and several text/array shapes require nonempty values absent that constraint in docs. | Decide/document narrower MCP syntax or normalize optional nulls; add representative round-trip coverage for empty text content and reasoning history. No missing supported input *category* was found. [Responses reference](https://api-docs.deepseek.com/api/create-response/) |
| Responses output flattening discards original message/reasoning item boundaries; complete history requires `include_raw_response`. | Consider exposing additive `output_items` for lossless round-trip history without enabling entire raw response. Current function/custom call arrays retain their original fields; custom input is accepted via index signatures but lacks a named output type field. [Responses reference](https://api-docs.deepseek.com/api/create-response/) |
| Shared request timeout defaults to 120s for Files uploads. Quotas are absent from guidance. | Document tuning for large uploads (provider permits up to 10 minutes), storage **25 GiB/user**, **10000 files/user**. Do not infer account remaining quota from local state. [Files guide](https://api-docs.deepseek.com/guides/files_api/) |

### Coverage and intentional capability boundaries

- All six supported Responses input categories are present, together with
  historical `web_search_call` compatibility. Message roles and image
  positions, URL/file exclusivity, detail values, function/custom output
  images, and `apply_patch` definition are represented. Unsupported file input
  parts and arbitrary custom names remain excluded.
  [Responses reference](https://api-docs.deepseek.com/api/create-response/),
  [Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
- Only string modes and named **function** `tool_choice` are documented by
  DeepSeek. A named custom `tool_choice` form is **not established** by these
  sources; do not infer it from the broader OpenAI format. Web-search choices
  remain compatibility syntax, not evidence of working search.
  [Responses reference](https://api-docs.deepseek.com/api/create-response/)
- Schema forwarding covers every supported top-level Responses parameter.
  Unsupported and ignored options may travel through `extra_body`; they
  do not establish server persistence, background runs, hosted tools,
  truncation, or configurable cache policy. Provider Responses tokens include
  reasoning in the output budget; the model limits still apply.
  [Responses guide](https://api-docs.deepseek.com/guides/responses_api/),
  [model limits](https://api-docs.deepseek.com/quick_start/pricing/)
- Completed/incomplete/failed streaming terminal payloads are recognized.
  Intermediate item/content/text/reasoning/function/custom events are consumed
  and counted; the complete terminal object provides the result. This is
  aggregation, not a live delta stream to the MCP caller.
  [Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
- Upload fields, paired expiry, format/signature checks, filename limits,
  metadata fields and optional expiry all align. Retrieve means metadata,
  not file-content download. List returns a single page with `first_id`,
  `last_id`, and `has_more`; pagination inputs/defaults match. Delete returns
  `id`, `object`, and `deleted`. No missing OpenAI-compatible Files operation
  was found. Anthropic Files routes differ and are outside the present tool
  contract.
  [Upload](https://api-docs.deepseek.com/api/create-file/),
  [list](https://api-docs.deepseek.com/api/list-files/),
  [retrieve](https://api-docs.deepseek.com/api/retrieve-file/),
  [delete](https://api-docs.deepseek.com/api/delete-file/),
  [Files guide](https://api-docs.deepseek.com/guides/files_api/)

The code inspection above is static evidence. Boundary tests, live successful
requests for each capability, and the hosted endpoint are separate checks.

## Complete release audit disposition

The team read all nine OpenAI-compatible endpoint references and all current
API feature guides, plus quick-start behavior and the changelog. Root's complete
reads supplement the eight-page focused appendix above. The official-first
inventory is: first call; pricing; token usage; rate/isolation; error codes; Chat;
Responses; FIM; models; balance; upload/list/retrieve/delete Files; thinking;
multi-round chat; prefix completion; FIM guide; JSON output; tool calls; vision;
Files guide; Responses guide; context caching; Anthropic compatibility; current
release announcement; changelog. That is 27 pages, including both examples and
request/response/streaming fields in supported endpoint references. Temporary
source snapshots were retained outside the repo; this note contains findings.

Closed implementation gaps: SDK versions; Pro availability; ignored built-ins;
apply_patch definition/results; output_items history; optional reasoning effort
and summary; ultra alias; runtime default model across Chat/FIM/Responses; beta
routing; forced-tool/prefix/strict-mode constraints; tool-name bounds/uniqueness;
Responses call/output pairing; streaming options; FIM echo conflicts; Chat token
ceiling and positive top_p; inline32MiB, JSON48MiB, 600-image guards; end-to-end
deadlines, cancellation, SSE parsing/errors, and streamed logprobs/fingerprint.

Known provider-owned checks: actual remote/file image dimensions and bytes,
aggregate64/200MiB image totals, remote download deadline, account storage/file
quotas, model context length, and strict JSON Schema support. The wrapper does
not fetch arbitrary images or perform extra file metadata calls to estimate
these. It preserves provider validation errors. Anthropic-format routes are
not MCP tools; all existing OpenAI-compatible routes remain supported.

The MCP schemas deliberately use optional omitted fields rather than covering
every nullable/empty spelling tolerated by OpenAI compatibility. Ignored future
parameters can pass through extra_body, subject to reserved-field protection.
Chat tool-image support is retained because the endpoint reference explicitly
includes it, despite narrower wording in the general vision guide.

Fresh evidence: 87 tests on Node20.20.2 and the local Node22 runtime; zero audit
vulnerabilities; valid registry manifest; 18-file npm tarball without .env or
tokens; live smoke passed9endpoint checks and5MCP calls, including strict beta,
apply_patch, vision, and Files cleanup. No hosted token was available, so the
separately deployed hosted endpoint was not updated or certified by this release.
