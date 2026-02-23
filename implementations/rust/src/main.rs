use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelItem>,
}

#[derive(Debug, Deserialize)]
struct ModelItem {
    id: String,
}

fn normalize_base_url(input: &str) -> String {
    input.trim_end_matches('/').to_string()
}

async fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, reqwest::Error> {
    let url = format!("{}/models", normalize_base_url(base_url));

    let response = reqwest::Client::new()
        .get(url)
        .bearer_auth(api_key)
        .header("accept", "application/json")
        .send()
        .await?
        .error_for_status()?;

    let payload: ModelsResponse = response.json().await?;
    Ok(payload.data.into_iter().map(|m| m.id).collect())
}

#[tokio::main]
async fn main() {
    let api_key = match std::env::var("DEEPSEEK_API_KEY") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("DEEPSEEK_API_KEY is required");
            std::process::exit(2);
        }
    };

    let base_url = std::env::var("DEEPSEEK_BASE_URL").unwrap_or_else(|_| "https://api.deepseek.com".to_string());

    match list_models(&base_url, &api_key).await {
        Ok(models) => {
            println!("Rust bootstrap smoke test OK. Models:");
            for model in models {
                println!("- {}", model);
            }
        }
        Err(error) => {
            eprintln!("Rust bootstrap smoke test failed: {}", error);
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_base_url;

    #[test]
    fn trims_trailing_slash() {
        assert_eq!(normalize_base_url("https://api.deepseek.com/"), "https://api.deepseek.com");
        assert_eq!(normalize_base_url("https://api.deepseek.com"), "https://api.deepseek.com");
    }
}
