/// Example demonstrating request ID usage in various scenarios
/// 
/// Run with: cargo run --example request_id_usage

use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer, middleware as actix_middleware};
use serde_json::json;

// Simulated middleware module (in real code, use: use stellar_api::middleware::*)
mod middleware {
    pub use actix_web::HttpMessage;
    
    #[derive(Clone, Debug)]
    pub struct RequestIdExtension(pub String);
    
    pub fn get_request_id(req: &actix_web::HttpRequest) -> Option<String> {
        req.extensions().get::<RequestIdExtension>().map(|ext| ext.0.clone())
    }
}

use middleware::get_request_id;

/// Example 1: Basic handler with request ID logging
async fn basic_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    
    tracing::info!(
        request_id = %request_id,
        "Processing basic request"
    );
    
    HttpResponse::Ok().json(json!({
        "message": "Success",
        "request_id": request_id
    }))
}

/// Example 2: Error handling with request ID
async fn error_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    
    // Simulate an error
    let result: Result<(), &str> = Err("Database connection failed");
    
    match result {
        Ok(_) => {
            tracing::info!(request_id = %request_id, "Operation successful");
            HttpResponse::Ok().json(json!({
                "success": true,
                "request_id": request_id
            }))
        }
        Err(e) => {
            tracing::error!(
                request_id = %request_id,
                error = %e,
                "Operation failed"
            );
            HttpResponse::InternalServerError().json(json!({
                "success": false,
                "error": e,
                "request_id": request_id,
                "message": "Please provide this request_id when reporting the issue"
            }))
        }
    }
}

/// Example 3: Async operation with request ID propagation
async fn async_operation_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    
    tracing::info!(request_id = %request_id, "Starting async operation");
    
    // Simulate async work
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    tracing::info!(request_id = %request_id, "Async operation completed");
    
    HttpResponse::Ok().json(json!({
        "status": "completed",
        "request_id": request_id
    }))
}

/// Example 4: Calling external service with request ID propagation
async fn external_service_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    
    tracing::info!(
        request_id = %request_id,
        "Calling external service"
    );
    
    // In real code, you would make an actual HTTP request
    // let client = reqwest::Client::new();
    // let response = client
    //     .get("http://external-service/api")
    //     .header("X-Request-ID", &request_id)
    //     .send()
    //     .await?;
    
    tracing::info!(
        request_id = %request_id,
        "External service call completed"
    );
    
    HttpResponse::Ok().json(json!({
        "message": "External service called",
        "request_id": request_id,
        "note": "The same request_id was sent to the external service"
    }))
}

/// Example 5: Database operation with request ID in query
async fn database_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    
    tracing::info!(
        request_id = %request_id,
        "Executing database query"
    );
    
    // In real code with sqlx:
    // let query = format!(
    //     "/* request_id: {} */ SELECT * FROM users WHERE id = $1",
    //     request_id
    // );
    // let result = sqlx::query(&query).bind(user_id).fetch_one(&pool).await?;
    
    tracing::info!(
        request_id = %request_id,
        rows_affected = 1,
        "Database query completed"
    );
    
    HttpResponse::Ok().json(json!({
        "data": {"id": 1, "name": "Example User"},
        "request_id": request_id
    }))
}

/// Example 6: Performance monitoring with request ID
async fn performance_handler(req: HttpRequest) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    let start = std::time::Instant::now();
    
    tracing::info!(request_id = %request_id, "Request started");
    
    // Simulate work
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    
    let duration = start.elapsed();
    
    tracing::info!(
        request_id = %request_id,
        duration_ms = %duration.as_millis(),
        "Request completed"
    );
    
    // You could also send metrics here
    // metrics::histogram!("request.duration", duration.as_secs_f64(), "endpoint" => "performance");
    
    HttpResponse::Ok().json(json!({
        "duration_ms": duration.as_millis(),
        "request_id": request_id
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();
    
    println!("🚀 Starting example server on http://127.0.0.1:8080");
    println!("\nTry these endpoints:");
    println!("  curl http://127.0.0.1:8080/basic");
    println!("  curl http://127.0.0.1:8080/error");
    println!("  curl http://127.0.0.1:8080/async");
    println!("  curl http://127.0.0.1:8080/external");
    println!("  curl http://127.0.0.1:8080/database");
    println!("  curl http://127.0.0.1:8080/performance");
    println!("\nWith custom request ID:");
    println!("  curl -H 'X-Request-ID: my-custom-id' http://127.0.0.1:8080/basic");
    
    HttpServer::new(|| {
        App::new()
            // In real code, add: .wrap(RequestId)
            .wrap(actix_middleware::Logger::default())
            .route("/basic", web::get().to(basic_handler))
            .route("/error", web::get().to(error_handler))
            .route("/async", web::get().to(async_operation_handler))
            .route("/external", web::get().to(external_service_handler))
            .route("/database", web::get().to(database_handler))
            .route("/performance", web::get().to(performance_handler))
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
