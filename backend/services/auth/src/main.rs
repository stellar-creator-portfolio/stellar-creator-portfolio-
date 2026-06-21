use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use rand::RngCore;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use totp_lite::{totp_custom, Sha1};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Error, Debug)]
pub enum MfaError {
    #[error("Invalid TOTP code")]
    InvalidCode,
    #[error("Secret generation failed")]
    SecretGenerationFailed,
    #[error("QR code generation failed: {0}")]
    QrCodeFailed(String),
    #[error("Base32 decode error")]
    Base32DecodeError,
}

/// Errors that can occur during Ed25519 signature verification.
#[derive(Error, Debug, PartialEq)]
pub enum SigError {
    #[error("Invalid public key: {0}")]
    InvalidPublicKey(String),
    #[error("Invalid signature: {0}")]
    InvalidSignature(String),
    #[error("Signature verification failed")]
    VerificationFailed,
}

/// Verify an Ed25519 signature against a message hash and public key.
///
/// # Arguments
/// * `public_key_bytes` – 32-byte Ed25519 public key (raw bytes).
/// * `signature_bytes`  – 64-byte Ed25519 signature (raw bytes).
/// * `message`          – The original message whose hash was signed.
///   The function hashes it with SHA-256 before verifying.
///
/// # Returns
/// `Ok(true)` when the signature is valid, `Err(SigError)` otherwise.
pub fn verify_signature(
    public_key_bytes: &[u8],
    signature_bytes: &[u8],
    message: &[u8],
) -> Result<bool, SigError> {
    use sha2::{Digest, Sha256};

    let key_bytes: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| SigError::InvalidPublicKey(format!("expected 32 bytes, got {}", public_key_bytes.len())))?;

    let verifying_key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| SigError::InvalidPublicKey(e.to_string()))?;

    let sig_bytes: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| SigError::InvalidSignature(format!("expected 64 bytes, got {}", signature_bytes.len())))?;

    let signature = Signature::from_bytes(&sig_bytes);

    // Hash the message with SHA-256 before verifying so callers pass the
    // raw message rather than a pre-hashed digest.
    let digest = Sha256::digest(message);

    verifying_key
        .verify(&digest, &signature)
        .map(|_| true)
        .map_err(|_| SigError::VerificationFailed)
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MfaSetupRequest {
    pub user_id: String,
    pub issuer: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MfaSetupResponse {
    pub secret: String,
    pub qr_code_url: String,
    pub manual_entry_key: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MfaVerifyRequest {
    pub user_id: String,
    pub secret: String,
    pub code: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MfaVerifyResponse {
    pub valid: bool,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VerifySignatureRequest {
    pub public_key: String,
    pub signature: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VerifySignatureResponse {
    pub token: String,
    pub refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

/// Refresh token entry stored in memory.
#[derive(Clone, Debug)]
pub struct RefreshEntry {
    pub subject: String,
    pub expires_at: u64,
}

/// In-memory refresh token store: token → entry.
pub type RefreshStore = Arc<Mutex<HashMap<String, RefreshEntry>>>;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RefreshResponse {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    fn ok(data: T) -> Self {
        ApiResponse {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    fn err(error: String) -> Self {
        ApiResponse {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

/// Generate a random base32-encoded secret for TOTP
fn generate_secret() -> Result<String, MfaError> {
    use sha2::{Digest, Sha256};
    
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| MfaError::SecretGenerationFailed)?
        .as_nanos();
    
    let random_data = format!("{}{}", timestamp, rand_string(32));
    let mut hasher = Sha256::new();
    hasher.update(random_data.as_bytes());
    let hash = hasher.finalize();
    
    let secret = base32::encode(base32::Alphabet::RFC4648 { padding: false }, &hash[..20]);
    Ok(secret)
}

/// Generate a simple random string (not cryptographically secure, for demo purposes)
fn rand_string(len: usize) -> String {
    use std::time::SystemTime;
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    
    (0..len)
        .map(|i| {
            let val = ((seed + i as u128) % 26) as u8;
            (b'a' + val) as char
        })
        .collect()
}

/// Generate TOTP code from secret
fn generate_totp(secret: &str, time_step: u64) -> Result<String, MfaError> {
    let decoded = base32::decode(base32::Alphabet::RFC4648 { padding: false }, secret)
        .ok_or(MfaError::Base32DecodeError)?;
    
    let code = totp_custom::<Sha1>(30, 6, &decoded, time_step);
    Ok(format!("{code:06}"))
}

/// Verify TOTP code
fn verify_totp(secret: &str, code: &str) -> Result<bool, MfaError> {
    let current_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| MfaError::InvalidCode)?
        .as_secs();
    
    // Check current time step and ±1 time step for clock skew tolerance
    for offset in [-1, 0, 1] {
        let time_step = (current_time as i64 + offset * 30) as u64;
        let expected_code = generate_totp(secret, time_step)?;
        
        if expected_code == code {
            return Ok(true);
        }
    }
    
    Ok(false)
}

/// Generate QR code URL for authenticator apps
fn generate_qr_code_url(user_id: &str, secret: &str, issuer: &str) -> String {
    let label = format!("{issuer}:{user_id}");
    let otpauth_url = format!(
        "otpauth://totp/{}?secret={secret}&issuer={}&algorithm=SHA1&digits=6&period=30",
        urlencoding::encode(&label),
        urlencoding::encode(issuer)
    );
    otpauth_url
}

/// Generate a cryptographically secure random nonce (32 bytes, hex-encoded)
fn generate_nonce() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[derive(Serialize)]
pub struct ChallengeResponse {
    pub nonce: String,
}

async fn get_challenge() -> HttpResponse {
    let nonce = generate_nonce();
    tracing::debug!("Generated auth challenge nonce");
    HttpResponse::Ok().json(ApiResponse::ok(ChallengeResponse { nonce }))
}

async fn verify_auth_signature(
    store: web::Data<RefreshStore>,
    body: web::Json<VerifySignatureRequest>,
) -> HttpResponse {
    tracing::info!("Verifying auth signature for public key: {}", body.public_key);

    let pub_key_bytes = match hex::decode(&body.public_key) {
        Ok(b) => b,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<VerifySignatureResponse>::err(
                "Invalid hex in public_key".to_string(),
            ))
        }
    };

    let sig_bytes = match hex::decode(&body.signature) {
        Ok(b) => b,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<VerifySignatureResponse>::err(
                "Invalid hex in signature".to_string(),
            ))
        }
    };

    match verify_signature(&pub_key_bytes, &sig_bytes, body.message.as_bytes()) {
        Ok(true) => match create_jwt(&body.public_key) {
            Ok(token) => {
                let refresh = issue_refresh_token(&store, &body.public_key);
                HttpResponse::Ok().json(ApiResponse::ok(VerifySignatureResponse {
                    token,
                    refresh_token: refresh,
                }))
            }
            Err(e) => {
                tracing::error!("JWT encoding error: {}", e);
                HttpResponse::InternalServerError().json(ApiResponse::<VerifySignatureResponse>::err(
                    "Failed to generate token".to_string(),
                ))
            }
        },
        Ok(false) | Err(_) => HttpResponse::Unauthorized()
            .json(ApiResponse::<VerifySignatureResponse>::err("Invalid signature".to_string())),
    }
}

async fn refresh_token(
    store: web::Data<RefreshStore>,
    body: web::Json<RefreshRequest>,
) -> HttpResponse {
    if body.refresh_token.trim().is_empty() {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<RefreshResponse>::err("refresh_token is required".to_string()));
    }

    match consume_refresh_token(&store, &body.refresh_token) {
        Some(subject) => match create_jwt(&subject) {
            Ok(access_token) => {
                let new_refresh = issue_refresh_token(&store, &subject);
                HttpResponse::Ok().json(ApiResponse::ok(RefreshResponse {
                    access_token,
                    refresh_token: new_refresh,
                }))
            }
            Err(e) => {
                tracing::error!("JWT encoding error during refresh: {}", e);
                HttpResponse::InternalServerError()
                    .json(ApiResponse::<RefreshResponse>::err("Failed to generate token".to_string()))
            }
        },
        None => HttpResponse::Unauthorized()
            .json(ApiResponse::<RefreshResponse>::err("Invalid or expired refresh token".to_string())),
    }
}

/// Create a JWT for a given public key.
pub fn create_jwt(public_key: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs() as usize
        + 24 * 3600;

    let claims = Claims {
        sub: public_key.to_string(),
        exp: expiration,
    };

    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "default_secret_for_development_only".to_string());

    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(jwt_secret.as_ref()),
    )
}

/// Issue a new opaque refresh token (64-byte hex) and store it.
pub fn issue_refresh_token(store: &RefreshStore, subject: &str) -> String {
    let token = generate_nonce() + &generate_nonce(); // 128 hex chars
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 30 * 24 * 3600; // 30 days
    store.lock().unwrap().insert(
        token.clone(),
        RefreshEntry { subject: subject.to_string(), expires_at },
    );
    token
}

/// Validate a refresh token and return the subject if valid.
pub fn consume_refresh_token(store: &RefreshStore, token: &str) -> Option<String> {
    let mut map = store.lock().unwrap();
    let entry = map.remove(token)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    if entry.expires_at > now { Some(entry.subject) } else { None }
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "stellar-auth",
        "version": "0.1.0",
        "features": ["mfa", "totp"]
    }))
}

async fn setup_mfa(body: web::Json<MfaSetupRequest>) -> HttpResponse {
    tracing::info!("Setting up MFA for user: {}", body.user_id);
    
    let secret = match generate_secret() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to generate secret: {}", e);
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<MfaSetupResponse>::err(e.to_string()));
        }
    };
    
    let qr_code_url = generate_qr_code_url(&body.user_id, &secret, &body.issuer);
    
    let response = MfaSetupResponse {
        secret: secret.clone(),
        qr_code_url,
        manual_entry_key: secret,
    };
    
    HttpResponse::Ok().json(ApiResponse::ok(response))
}

async fn verify_mfa(body: web::Json<MfaVerifyRequest>) -> HttpResponse {
    tracing::info!("Verifying MFA code for user: {}", body.user_id);
    
    match verify_totp(&body.secret, &body.code) {
        Ok(valid) => {
            let response = MfaVerifyResponse {
                valid,
                message: if valid {
                    "TOTP code is valid".to_string()
                } else {
                    "TOTP code is invalid or expired".to_string()
                },
            };
            HttpResponse::Ok().json(ApiResponse::ok(response))
        }
        Err(e) => {
            tracing::error!("MFA verification error: {}", e);
            HttpResponse::BadRequest().json(ApiResponse::<MfaVerifyResponse>::err(e.to_string()))
        }
    }
}

async fn generate_backup_codes() -> HttpResponse {
    tracing::info!("Generating backup codes");
    
    let backup_codes: Vec<String> = (0..10)
        .map(|_| {
            let code = rand_string(8).to_uppercase();
            format!("{}-{}", &code[..4], &code[4..])
        })
        .collect();
    
    HttpResponse::Ok().json(ApiResponse::ok(serde_json::json!({
        "backup_codes": backup_codes,
        "message": "Store these codes securely. Each can only be used once."
    })))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Attempt to load .env file as early as possible
    let dotenv_result = dotenvy::dotenv();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,stellar_auth=debug".to_string()),
        )
        .init();

    // Log the result of loading .env now that tracing is initialized
    match dotenv_result {
        Ok(path) => tracing::info!("Environment variables loaded from {:?}", path),
        Err(e) => tracing::warn!("No .env file found or error loading it: {}", e),
    }

    tracing::info!("🔐 Stellar Auth Service Starting...");

    // Validate required environment variables
    let required_vars = ["JWT_SECRET"];
    let mut missing_vars = Vec::new();
    for var in required_vars {
        if std::env::var(var).is_err() {
            missing_vars.push(var);
        }
    }

    if !missing_vars.is_empty() {
        let err_msg = format!(
            "Fatal: Missing required environment variables: {}. Service cannot start.",
            missing_vars.join(", ")
        );
        tracing::error!("{}", err_msg);
        return Err(std::io::Error::other(err_msg));
    }

    let port = std::env::var("AUTH_PORT")
        .unwrap_or_else(|_| "3002".to_string())
        .parse::<u16>()
        .expect("AUTH_PORT must be a valid port number");

    let host = std::env::var("AUTH_HOST")
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    tracing::info!("🔐 Stellar Auth Service Starting...");
    tracing::info!("Starting Stellar Auth on {}:{}", host, port);
    tracing::info!("Features: TOTP-based 2FA/MFA");

    let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(store.clone()))
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            .route("/health", web::get().to(health))
            .route("/api/auth/challenge", web::get().to(get_challenge))
            .route("/api/auth/verify", web::post().to(verify_auth_signature))
            .route("/api/auth/refresh", web::post().to(refresh_token))
            .route("/api/auth/mfa/setup", web::post().to(setup_mfa))
            .route("/api/auth/mfa/verify", web::post().to(verify_mfa))
            .route("/api/auth/mfa/backup-codes", web::post().to(generate_backup_codes))
    })
    .bind((host.as_str(), port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_secret() {
        let secret = generate_secret().unwrap();
        assert!(!secret.is_empty());
        assert!(secret.len() >= 16);
    }

    #[test]
    fn test_totp_generation_and_verification() {
        let secret = "JBSWY3DPEHPK3PXP".to_string();
        let time_step = 1234567890 / 30;
        
        let code = generate_totp(&secret, time_step).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_verify_totp_invalid_code() {
        let secret = "JBSWY3DPEHPK3PXP".to_string();
        let _result = verify_totp(&secret, "000000").unwrap(); // just verify it doesn't panic
    }

    #[test]
    fn test_qr_code_url_generation() {
        let url = generate_qr_code_url("user@example.com", "SECRET123", "StellarPlatform");
        assert!(url.contains("otpauth://totp/"));
        assert!(url.contains("secret=SECRET123"));
        assert!(url.contains("issuer=StellarPlatform"));
    }

    #[test]
    fn test_backup_code_format() {
        let code = rand_string(8).to_uppercase();
        let formatted = format!("{}-{}", &code[..4], &code[4..]);
        assert_eq!(formatted.len(), 9); // 4 + 1 (dash) + 4
        assert!(formatted.contains('-'));
    }

    #[test]
    fn test_generate_nonce_length() {
        let nonce = generate_nonce();
        // 32 bytes hex-encoded = 64 hex characters
        assert_eq!(nonce.len(), 64);
    }

    #[test]
    fn test_generate_nonce_is_hex() {
        let nonce = generate_nonce();
        assert!(nonce.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_generate_nonce_uniqueness() {
        let n1 = generate_nonce();
        let n2 = generate_nonce();
        assert_ne!(n1, n2, "Two nonces should not be identical");
    }

    #[actix_web::test]
    async fn test_get_challenge_endpoint() {
        use actix_web::test;
        let app = test::init_service(
            App::new().route("/api/auth/challenge", web::get().to(get_challenge)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/auth/challenge")
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let nonce = body["data"]["nonce"].as_str().expect("nonce must be a string");
        assert_eq!(nonce.len(), 64);
        assert!(nonce.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // ── Signature verification tests ─────────────────────────────────────────

    /// Build a deterministic keypair + signature for testing.
    fn make_test_sig(message: &[u8]) -> (Vec<u8>, Vec<u8>) {
        use ed25519_dalek::{Signer, SigningKey};
        use sha2::{Digest, Sha256};

        // Fixed 32-byte seed so tests are deterministic.
        let seed = [0x42u8; 32];
        let signing_key = SigningKey::from_bytes(&seed);
        let digest = Sha256::digest(message);
        let signature = signing_key.sign(&digest);
        let verifying_key = signing_key.verifying_key();
        (verifying_key.to_bytes().to_vec(), signature.to_bytes().to_vec())
    }

    #[test]
    fn test_verify_signature_valid() {
        let message = b"stellar-auth-challenge-nonce";
        let (pub_key, sig) = make_test_sig(message);
        assert_eq!(verify_signature(&pub_key, &sig, message), Ok(true));
    }

    #[test]
    fn test_verify_signature_wrong_message() {
        let message = b"stellar-auth-challenge-nonce";
        let (pub_key, sig) = make_test_sig(message);
        let result = verify_signature(&pub_key, &sig, b"tampered-message");
        assert_eq!(result, Err(SigError::VerificationFailed));
    }

    #[test]
    fn test_verify_signature_wrong_public_key() {
        let message = b"stellar-auth-challenge-nonce";
        let (_, sig) = make_test_sig(message);
        let wrong_key = [0xFFu8; 32];
        // A random 32-byte array may or may not be a valid compressed point;
        // either InvalidPublicKey or VerificationFailed is acceptable.
        let result = verify_signature(&wrong_key, &sig, message);
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_signature_invalid_key_length() {
        let result = verify_signature(&[0u8; 16], &[0u8; 64], b"msg");
        assert_eq!(
            result,
            Err(SigError::InvalidPublicKey(
                "expected 32 bytes, got 16".to_string()
            ))
        );
    }

    #[test]
    fn test_verify_signature_invalid_sig_length() {
        let message = b"stellar-auth-challenge-nonce";
        let (pub_key, _) = make_test_sig(message);
        let result = verify_signature(&pub_key, &[0u8; 32], message);
        assert_eq!(
            result,
            Err(SigError::InvalidSignature(
                "expected 64 bytes, got 32".to_string()
            ))
        );
    }

    #[test]
    fn test_verify_signature_corrupted_signature() {
        let message = b"stellar-auth-challenge-nonce";
        let (pub_key, mut sig) = make_test_sig(message);
        sig[0] ^= 0xFF; // flip bits in first byte
        let result = verify_signature(&pub_key, &sig, message);
        assert_eq!(result, Err(SigError::VerificationFailed));
    }

    #[actix_web::test]
    async fn test_verify_auth_signature_endpoint() {
        use actix_web::test;
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(store))
                .route("/api/auth/verify", web::post().to(verify_auth_signature)),
        )
        .await;

        let message = b"stellar-auth-challenge-nonce";
        let (pub_key_bytes, sig_bytes) = make_test_sig(message);

        let req_body = VerifySignatureRequest {
            public_key: hex::encode(pub_key_bytes),
            signature: hex::encode(sig_bytes),
            message: String::from_utf8(message.to_vec()).unwrap(),
        };

        let req = test::TestRequest::post()
            .uri("/api/auth/verify")
            .set_json(&req_body)
            .to_request();
            
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let token = body["data"]["token"].as_str().expect("token must be a string");
        assert!(token.starts_with("eyJ")); // JWT header
        let refresh = body["data"]["refresh_token"].as_str().expect("refresh_token must be a string");
        assert_eq!(refresh.len(), 128);

        // Verify the token claims
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "default_secret_for_development_only".to_string());
        let token_data = jsonwebtoken::decode::<Claims>(
            token,
            &jsonwebtoken::DecodingKey::from_secret(jwt_secret.as_ref()),
            &jsonwebtoken::Validation::default(),
        )
        .expect("Token should be decodable");

        assert_eq!(token_data.claims.sub, req_body.public_key);
    }

    #[test]
    fn test_create_jwt_valid() {
        let pub_key = "test_pub_key";
        let token = create_jwt(pub_key).expect("Should create token");
        
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "default_secret_for_development_only".to_string());
        let token_data = jsonwebtoken::decode::<Claims>(
            &token,
            &jsonwebtoken::DecodingKey::from_secret(jwt_secret.as_ref()),
            &jsonwebtoken::Validation::default(),
        )
        .expect("Token should be decodable");

        assert_eq!(token_data.claims.sub, pub_key);
        assert!(token_data.claims.exp > (SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as usize));
    }

    #[test]
    fn test_verify_signature_empty_message() {
        let message = b"";
        let (pub_key, sig) = make_test_sig(message);
        assert_eq!(verify_signature(&pub_key, &sig, message), Ok(true));
    }

    #[test]
    fn test_verify_signature_large_message() {
        let message = vec![0u8; 1024 * 1024]; // 1MB message
        let (pub_key, sig) = make_test_sig(&message);
        assert_eq!(verify_signature(&pub_key, &sig, &message), Ok(true));
    }

    // ── Refresh token unit tests ──────────────────────────────────────────────

    #[test]
    fn issue_and_consume_refresh_token_succeeds() {
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let token = issue_refresh_token(&store, "wallet-1");
        assert_eq!(token.len(), 128);
        let subject = consume_refresh_token(&store, &token);
        assert_eq!(subject, Some("wallet-1".to_string()));
    }

    #[test]
    fn consume_refresh_token_removes_it() {
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let token = issue_refresh_token(&store, "wallet-1");
        consume_refresh_token(&store, &token);
        // Second consume must return None (single-use)
        assert_eq!(consume_refresh_token(&store, &token), None);
    }

    #[test]
    fn consume_unknown_refresh_token_returns_none() {
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        assert_eq!(consume_refresh_token(&store, "nonexistent"), None);
    }

    #[test]
    fn two_refresh_tokens_are_unique() {
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let t1 = issue_refresh_token(&store, "wallet-1");
        let t2 = issue_refresh_token(&store, "wallet-1");
        assert_ne!(t1, t2);
    }

    // ── POST /api/auth/refresh integration tests ──────────────────────────────

    fn build_refresh_app(store: RefreshStore) -> actix_web::App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new()
            .app_data(web::Data::new(store))
            .route("/api/auth/refresh", web::post().to(refresh_token))
    }

    #[actix_web::test]
    async fn refresh_with_valid_token_returns_new_tokens() {
        use actix_web::test as awtest;
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let rt = issue_refresh_token(&store, "wallet-1");

        let app = awtest::init_service(build_refresh_app(store)).await;
        let req = awtest::TestRequest::post()
            .uri("/api/auth/refresh")
            .set_json(serde_json::json!({ "refresh_token": rt }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let access = body["data"]["access_token"].as_str().unwrap();
        assert!(access.starts_with("eyJ"));
        let new_rt = body["data"]["refresh_token"].as_str().unwrap();
        assert_eq!(new_rt.len(), 128);
        assert_ne!(new_rt, rt); // rotated
    }

    #[actix_web::test]
    async fn refresh_token_is_single_use() {
        use actix_web::test as awtest;
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let rt = issue_refresh_token(&store, "wallet-1");

        let app = awtest::init_service(build_refresh_app(store)).await;

        // First use succeeds
        let req = awtest::TestRequest::post()
            .uri("/api/auth/refresh")
            .set_json(serde_json::json!({ "refresh_token": rt }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        // Second use with same token must fail
        let req2 = awtest::TestRequest::post()
            .uri("/api/auth/refresh")
            .set_json(serde_json::json!({ "refresh_token": rt }))
            .to_request();
        let resp2 = awtest::call_service(&app, req2).await;
        assert_eq!(resp2.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn refresh_with_invalid_token_returns_401() {
        use actix_web::test as awtest;
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let app = awtest::init_service(build_refresh_app(store)).await;

        let req = awtest::TestRequest::post()
            .uri("/api/auth/refresh")
            .set_json(serde_json::json!({ "refresh_token": "bogus" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert_eq!(body["success"], false);
    }

    #[actix_web::test]
    async fn refresh_with_empty_token_returns_400() {
        use actix_web::test as awtest;
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let app = awtest::init_service(build_refresh_app(store)).await;

        let req = awtest::TestRequest::post()
            .uri("/api/auth/refresh")
            .set_json(serde_json::json!({ "refresh_token": "" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
    }

    #[actix_web::test]
    async fn refreshed_access_token_has_correct_subject() {
        use actix_web::test as awtest;
        let store: RefreshStore = Arc::new(Mutex::new(HashMap::new()));
        let rt = issue_refresh_token(&store, "wallet-abc");

        let app = awtest::init_service(build_refresh_app(store)).await;
        let req = awtest::TestRequest::post()
            .uri("/api/auth/refresh")
            .set_json(serde_json::json!({ "refresh_token": rt }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        let body: serde_json::Value = awtest::read_body_json(resp).await;

        let access = body["data"]["access_token"].as_str().unwrap();
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "default_secret_for_development_only".to_string());
        let data = jsonwebtoken::decode::<Claims>(
            access,
            &jsonwebtoken::DecodingKey::from_secret(jwt_secret.as_ref()),
            &jsonwebtoken::Validation::default(),
        )
        .unwrap();
        assert_eq!(data.claims.sub, "wallet-abc");
    }
}
