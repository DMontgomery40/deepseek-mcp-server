use rmcp::{
    ErrorData as McpError, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::*,
    tool, tool_handler, tool_router,
    transport::stdio,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;

const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
const DEFAULT_MODEL: &str = "deepseek-chat";
const DEFAULT_FALLBACK_MODEL: &str = "deepseek-chat";
const DEFAULT_TIMEOUT_MS: u64 = 120_000;

#[derive(Clone)]
struct DeepSeekMcpServer {
    api: Arc<DeepSeekApiClient>,
    default_model: String,
    tool_router: ToolRouter<Self>,
}

impl DeepSeekMcpServer {
    fn from_env() -> Result<Self, String> {
        let api_key = std::env::var("DEEPSEEK_API_KEY")
            .map_err(|_| "DEEPSEEK_API_KEY is required".to_string())?;

        let base_url = normalize_base_url(
            &std::env::var("DEEPSEEK_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string()),
        );

        let default_model = std::env::var("DEEPSEEK_DEFAULT_MODEL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_MODEL.to_string());

        let fallback_model = std::env::var("DEEPSEEK_FALLBACK_MODEL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_FALLBACK_MODEL.to_string());

        let enable_reasoner_fallback = env_bool("DEEPSEEK_ENABLE_REASONER_FALLBACK", true);
        let timeout_ms = env_u64("DEEPSEEK_REQUEST_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

        let api = DeepSeekApiClient::new(DeepSeekApiClientOptions {
            api_key,
            base_url,
            timeout_ms,
            enable_reasoner_fallback,
            fallback_model,
        });

        Ok(Self {
            api: Arc::new(api),
            default_model,
            tool_router: Self::tool_router(),
        })
    }
}

#[tool_router]
impl DeepSeekMcpServer {
    #[tool(description = "List available models from DeepSeek (GET /models)")]
    async fn list_models(&self) -> Result<CallToolResult, McpError> {
        Ok(match self.api.list_models().await {
            Ok(payload) => success_json(payload),
            Err(error) => tool_error(error.to_string()),
        })
    }

    #[tool(description = "Get account balance from DeepSeek (GET /user/balance)")]
    async fn get_user_balance(&self) -> Result<CallToolResult, McpError> {
        Ok(match self.api.get_user_balance().await {
            Ok(payload) => success_json(payload),
            Err(error) => tool_error(error.to_string()),
        })
    }

    #[tool(
        description = "Call DeepSeek chat completions (POST /chat/completions) with optional reasoner fallback"
    )]
    async fn chat_completion(
        &self,
        Parameters(input): Parameters<ChatCompletionToolInput>,
    ) -> Result<CallToolResult, McpError> {
        if input.messages.is_empty() {
            return Ok(tool_error("messages must not be empty"));
        }

        let model = input
            .model
            .clone()
            .unwrap_or_else(|| self.default_model.clone());

        match self.api.create_chat_completion(input.with_model(model)).await {
            Ok(execution) => {
                let response_text = execution
                    .response
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|choices| choices.first())
                    .and_then(|choice| choice.get("message"))
                    .and_then(|message| message.get("content"))
                    .and_then(Value::as_str)
                    .unwrap_or("");

                let mut summary = String::new();
                if let Some(fallback) = execution.fallback {
                    summary.push_str(&format!(
                        "Fallback used: {} -> {}\n",
                        fallback.from_model, fallback.to_model
                    ));
                }

                if response_text.is_empty() {
                    summary.push_str("(no assistant content returned)\n");
                } else {
                    summary.push_str(response_text);
                    summary.push('\n');
                }

                summary.push_str("\nRaw response:\n");
                summary.push_str(&pretty_json(&execution.response));

                Ok(CallToolResult::success(vec![Content::text(summary)]))
            }
            Err(error) => Ok(tool_error(error.to_string())),
        }
    }

    #[tool(description = "Call DeepSeek completions (POST /completions) with beta base URL retry")]
    async fn completion(
        &self,
        Parameters(input): Parameters<CompletionToolInput>,
    ) -> Result<CallToolResult, McpError> {
        match self.api.create_completion(input).await {
            Ok(execution) => {
                let mut summary = String::new();
                if execution.used_beta_base {
                    summary.push_str("Retried via beta base URL: true\n");
                }

                summary.push_str(&pretty_json(&execution.response));

                Ok(CallToolResult::success(vec![Content::text(summary)]))
            }
            Err(error) => Ok(tool_error(error.to_string())),
        }
    }
}

#[tool_handler]
impl ServerHandler for DeepSeekMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::LATEST,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation::from_build_env(),
            instructions: Some(
                "Official MCP server for DeepSeek.ai (Rust branch preview). Tools: list_models, get_user_balance, chat_completion, completion."
                    .to_string(),
            ),
        }
    }
}

#[derive(Clone)]
struct DeepSeekApiClient {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
    timeout_ms: u64,
    enable_reasoner_fallback: bool,
    fallback_model: String,
}

struct DeepSeekApiClientOptions {
    api_key: String,
    base_url: String,
    timeout_ms: u64,
    enable_reasoner_fallback: bool,
    fallback_model: String,
}

impl DeepSeekApiClient {
    fn new(options: DeepSeekApiClientOptions) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key: options.api_key,
            base_url: normalize_base_url(&options.base_url),
            timeout_ms: options.timeout_ms,
            enable_reasoner_fallback: options.enable_reasoner_fallback,
            fallback_model: options.fallback_model,
        }
    }

    async fn list_models(&self) -> Result<Value, DeepSeekApiError> {
        self.request_json(reqwest::Method::GET, "/models", None, None)
            .await
    }

    async fn get_user_balance(&self) -> Result<Value, DeepSeekApiError> {
        self.request_json(reqwest::Method::GET, "/user/balance", None, None)
            .await
    }

    async fn create_chat_completion(
        &self,
        request: ChatCompletionToolInput,
    ) -> Result<ChatExecution, DeepSeekApiError> {
        let model = request
            .model
            .clone()
            .unwrap_or_else(|| DEFAULT_MODEL.to_string());

        let payload = to_value_or_error(&request)?;

        match self
            .request_json(reqwest::Method::POST, "/chat/completions", Some(payload), None)
            .await
        {
            Ok(response) => Ok(ChatExecution {
                response,
                fallback: None,
            }),
            Err(error) if self.should_fallback_reasoner(&model, &error) => {
                let fallback_request = request.with_model(self.fallback_model.clone());
                let fallback_payload = to_value_or_error(&fallback_request)?;
                let fallback_response = self
                    .request_json(
                        reqwest::Method::POST,
                        "/chat/completions",
                        Some(fallback_payload),
                        None,
                    )
                    .await?;

                Ok(ChatExecution {
                    response: fallback_response,
                    fallback: Some(FallbackMetadata {
                        from_model: model,
                        to_model: self.fallback_model.clone(),
                    }),
                })
            }
            Err(error) => Err(error),
        }
    }

    async fn create_completion(
        &self,
        request: CompletionToolInput,
    ) -> Result<CompletionExecution, DeepSeekApiError> {
        let payload = to_value_or_error(&request.with_default_model(DEFAULT_MODEL.to_string()))?;

        match self
            .request_json(reqwest::Method::POST, "/completions", Some(payload.clone()), None)
            .await
        {
            Ok(response) => Ok(CompletionExecution {
                response,
                used_beta_base: false,
            }),
            Err(error) if should_retry_completion_beta(&error) => {
                let beta_base_url = build_beta_base_url(&self.base_url);
                let response = self
                    .request_json(
                        reqwest::Method::POST,
                        "/completions",
                        Some(payload),
                        Some(beta_base_url),
                    )
                    .await?;

                Ok(CompletionExecution {
                    response,
                    used_beta_base: true,
                })
            }
            Err(error) => Err(error),
        }
    }

    fn should_fallback_reasoner(&self, model: &str, error: &DeepSeekApiError) -> bool {
        if !self.enable_reasoner_fallback {
            return false;
        }

        if model != "deepseek-reasoner" {
            return false;
        }

        if self.fallback_model == model {
            return false;
        }

        match error.status {
            None => true,
            Some(code) => matches!(code, 408 | 409 | 429 | 500 | 502 | 503 | 504),
        }
    }

    async fn request_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        base_url_override: Option<String>,
    ) -> Result<Value, DeepSeekApiError> {
        let base_url = base_url_override.unwrap_or_else(|| self.base_url.clone());
        let url = format!("{}{}", normalize_base_url(&base_url), path);

        let mut request = self
            .http
            .request(method, url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("User-Agent", "deepseek-mcp-server-rust/0.1.0")
            .timeout(std::time::Duration::from_millis(self.timeout_ms));

        if let Some(body_value) = body.clone() {
            request = request.json(&body_value);
        }

        let response = request.send().await.map_err(|error| DeepSeekApiError {
            status: None,
            message: format!("network error: {error}"),
            payload: None,
        })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();

            if let Ok(payload) = serde_json::from_str::<Value>(&text) {
                return Err(DeepSeekApiError {
                    status: Some(status),
                    message: extract_error_message(&payload)
                        .unwrap_or_else(|| format!("deepseek api error (status {status})")),
                    payload: Some(payload),
                });
            }

            return Err(DeepSeekApiError {
                status: Some(status),
                message: if text.trim().is_empty() {
                    format!("deepseek api error (status {status})")
                } else {
                    text
                },
                payload: None,
            });
        }

        if is_stream_request(&body) {
            let text = response.text().await.map_err(|error| DeepSeekApiError {
                status: None,
                message: format!("failed to read streaming response: {error}"),
                payload: None,
            })?;

            let chunks = parse_sse_chunks(&text);
            return Ok(json!({
                "object": "stream",
                "chunks": chunks,
                "chunk_count": chunks.len()
            }));
        }

        response.json::<Value>().await.map_err(|error| DeepSeekApiError {
            status: None,
            message: format!("failed to decode json response: {error}"),
            payload: None,
        })
    }
}

#[derive(Debug)]
struct DeepSeekApiError {
    status: Option<u16>,
    message: String,
    payload: Option<Value>,
}

impl fmt::Display for DeepSeekApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(status) = self.status {
            if let Some(payload) = &self.payload {
                write!(
                    f,
                    "DeepSeek API error (status {status}): {} | payload={} ",
                    self.message,
                    pretty_json(payload)
                )
            } else {
                write!(f, "DeepSeek API error (status {status}): {}", self.message)
            }
        } else {
            write!(f, "DeepSeek API error: {}", self.message)
        }
    }
}

impl std::error::Error for DeepSeekApiError {}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct ChatMessage {
    role: String,
    content: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct ChatCompletionToolInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frequency_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    presence_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Value>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

impl ChatCompletionToolInput {
    fn with_model(mut self, model: String) -> Self {
        self.model = Some(model);
        self
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
struct CompletionToolInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    suffix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Value>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

impl CompletionToolInput {
    fn with_default_model(mut self, default_model: String) -> Self {
        if self.model.is_none() {
            self.model = Some(default_model);
        }
        self
    }
}

struct ChatExecution {
    response: Value,
    fallback: Option<FallbackMetadata>,
}

struct CompletionExecution {
    response: Value,
    used_beta_base: bool,
}

struct FallbackMetadata {
    from_model: String,
    to_model: String,
}

fn success_json(value: Value) -> CallToolResult {
    CallToolResult::success(vec![Content::text(pretty_json(&value))])
}

fn tool_error(message: impl Into<String>) -> CallToolResult {
    CallToolResult::success(vec![Content::text(format!("ERROR: {}", message.into()))])
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn is_stream_request(body: &Option<Value>) -> bool {
    body.as_ref()
        .and_then(|v| v.get("stream"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn parse_sse_chunks(payload: &str) -> Vec<Value> {
    let mut chunks = Vec::new();

    for block in payload.replace("\r\n", "\n").split("\n\n") {
        let mut data_lines = Vec::new();

        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("data:") {
                data_lines.push(rest.trim());
            }
        }

        if data_lines.is_empty() {
            continue;
        }

        let data = data_lines.join("\n");
        if data == "[DONE]" {
            break;
        }

        if let Ok(json_value) = serde_json::from_str::<Value>(&data) {
            chunks.push(json_value);
        }
    }

    chunks
}

fn extract_error_message(payload: &Value) -> Option<String> {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .get("message")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn should_retry_completion_beta(error: &DeepSeekApiError) -> bool {
    let msg = error.message.to_lowercase();
    msg.contains("beta")
        || msg.contains("base url")
        || msg.contains("base_url")
        || msg.contains("/beta")
}

fn build_beta_base_url(base_url: &str) -> String {
    let normalized = normalize_base_url(base_url);
    if normalized.ends_with("/beta") {
        normalized
    } else {
        format!("{normalized}/beta")
    }
}

fn normalize_base_url(input: &str) -> String {
    input.trim_end_matches('/').to_string()
}

fn env_bool(name: &str, default_value: bool) -> bool {
    match std::env::var(name) {
        Ok(value) => {
            let v = value.trim().to_ascii_lowercase();
            matches!(v.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => default_value,
    }
}

fn env_u64(name: &str, default_value: u64) -> u64 {
    match std::env::var(name) {
        Ok(value) => value.trim().parse::<u64>().unwrap_or(default_value),
        Err(_) => default_value,
    }
}

fn to_value_or_error<T: Serialize>(input: &T) -> Result<Value, DeepSeekApiError> {
    serde_json::to_value(input).map_err(|error| DeepSeekApiError {
        status: None,
        message: format!("failed to serialize request body: {error}"),
        payload: None,
    })
}

async fn run_smoke(server: &DeepSeekMcpServer) -> Result<(), String> {
    let models = server
        .api
        .list_models()
        .await
        .map_err(|e| format!("models request failed: {e}"))?;

    println!("Rust MCP smoke test OK. Available models:");

    if let Some(items) = models.get("data").and_then(Value::as_array) {
        for item in items {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                println!("- {id}");
            }
        }
    } else {
        println!("- could not parse model list");
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    let server = DeepSeekMcpServer::from_env().map_err(|error| {
        eprintln!("{error}");
        error
    })?;

    if std::env::args().any(|arg| arg == "--smoke") {
        run_smoke(&server).await.map_err(|error| {
            eprintln!("{error}");
            error
        })?;
        return Ok(());
    }

    let service = server.serve(stdio()).await?;
    service.waiting().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_beta_base_url, normalize_base_url, should_retry_completion_beta, DeepSeekApiError};

    #[test]
    fn trims_trailing_slash() {
        assert_eq!(normalize_base_url("https://api.deepseek.com/"), "https://api.deepseek.com");
        assert_eq!(normalize_base_url("https://api.deepseek.com"), "https://api.deepseek.com");
    }

    #[test]
    fn beta_base_url_is_stable() {
        assert_eq!(build_beta_base_url("https://api.deepseek.com"), "https://api.deepseek.com/beta");
        assert_eq!(
            build_beta_base_url("https://api.deepseek.com/beta"),
            "https://api.deepseek.com/beta"
        );
    }

    #[test]
    fn beta_retry_detection_works() {
        let err = DeepSeekApiError {
            status: Some(400),
            message: "Please use https://api.deepseek.com/beta for this endpoint".to_string(),
            payload: None,
        };

        assert!(should_retry_completion_beta(&err));
    }
}
