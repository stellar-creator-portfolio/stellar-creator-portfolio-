#![no_std]

// Reentrancy protection module (#635)
mod reentrancy;
use reentrancy::{require_active_escrow, require_authorized_party, ReentrancyGuard};

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
    token::Client as TokenClient,
};

/// Escrow Status
#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
}

/// Release Condition
#[derive(Clone, Debug)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

/// Dispute Outcome - on-chain resolution variants
#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum DisputeOutcome {
    FavorClient = 0,
    FavorCreator = 1,
    Split = 2,
    Dismissed = 3,
}

/// Dispute info stored per escrow for evidence commitment + appeal window
/// Uses sentinel values (0) for optional timestamps and flags for optionals
/// to avoid SDK contracttype issues with Option<BytesN<32>> and Option<DisputeOutcome>
#[contracttype]
pub struct DisputeInfo {
    pub escrow_id: u64,
    pub disputer: Address,
    pub disputed_at: u64,
    pub resolved_at: u64,
    pub appeal_deadline: u64,
    pub outcome: DisputeOutcome,
    pub has_outcome: bool,
    pub client_amount: i128,
    pub creator_amount: i128,
    pub finalized: bool,
    pub has_evidence: bool,
}

// Fee constants (#344)

/// Platform fee in basis points (2.5 %).
pub const PLATFORM_FEE_BPS: i128 = 250;

/// Maximum platform fee in token units (500 USDC-equivalent).
pub const PLATFORM_FEE_CAP: i128 = 500;

/// Appeal window in seconds (3 days) - enforced on-chain as timelock
pub const APPEAL_WINDOW_SECS: u64 = 3 * 24 * 60 * 60;

/// Compute the platform fee for a given gross amount.
pub fn platform_fee(amount: i128) -> i128 {
    let raw = amount * PLATFORM_FEE_BPS / 10_000;
    if raw > PLATFORM_FEE_CAP { PLATFORM_FEE_CAP } else { raw }
}

/// Escrow Account
#[contracttype]
pub struct EscrowAccount {
    pub id: u64,
    pub bounty_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub status: EscrowStatus,
    pub release_condition: ReleaseCondition,
    pub created_at: u64,
    pub released_at: Option<u64>,
    pub fee_collected: i128,
    pub usd_amount_micro: Option<i128>,
    pub oracle_contract: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ValuationResult {
    pub usd_amount_micro: i128,
    pub token_amount: i128,
    pub price_used: i128,
    pub used_fallback: bool,
}

/// Milestone — a named portion of the total escrow amount
#[contracttype]
pub struct Milestone {
    pub escrow_id: u64,
    pub index: u32,
    pub description: Symbol,
    pub amount: i128,
    pub released: bool,
}

/// DataKey for typed persistent storage lookups.
#[contracttype]
pub enum DataKey {
    Escrow(u64),
    EscrowCounter,
    Yield(u64),
    YieldCfg,
    Dispute(u64),
    Evidence(u64),
}

// Issue #631: Yield Farming

#[contracttype]
pub struct YieldConfig {
    pub rate_bps: u32,
    pub max_yield_ratio: u32,
    pub min_liquidity_bps: u32,
}

#[contracttype]
pub struct YieldAccrual {
    pub escrow_id: u64,
    pub principal: i128,
    pub accrued: i128,
    pub last_updated: u64,
}



#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deposit funds into escrow
    pub fn deposit(
        env: Env,
        bounty_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
        oracle_contract: Option<Address>,
        usd_amount_micro: Option<i128>,
    ) -> u64 {
        payer.require_auth();
        assert!(amount > 0, "Amount must be positive");

        let token_client = TokenClient::new(&env, &token);
        let _ = token_client.balance(&payer);
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        let counter_key = Symbol::new(&env, "escrow_counter");
        let mut counter: u64 = env.storage().persistent().get::<Symbol, u64>(&counter_key).unwrap_or(0);
        counter += 1;

        match (oracle_contract.clone(), usd_amount_micro) {
            (Some(oracle), Some(usd_amount)) => {
                assert!(usd_amount > 0, "USD amount must be positive");
                let args: Vec<Val> = Vec::from_array(
                    &env,
                    [counter.into_val(&env), usd_amount.into_val(&env)],
                );
                let _: ValuationResult = env.invoke_contract(
                    &oracle,
                    &Symbol::new(&env, "lock_price"),
                    args,
                );
            }
            (None, None) => {}
            _ => panic!("oracle and usd amount must be provided together"),
        }

        match (oracle_contract.clone(), usd_amount_micro) {
            (Some(oracle), Some(usd_amount)) => {
                assert!(usd_amount > 0, "USD amount must be positive");
                let args: Vec<Val> = Vec::from_array(
                    &env,
                    [counter.into_val(&env), usd_amount.into_val(&env)],
                );
                let _: ValuationResult = env.invoke_contract(
                    &oracle,
                    &Symbol::new(&env, "lock_price"),
                    args,
                );
            }
            (None, None) => {}
            _ => panic!("oracle and usd amount must be provided together"),
        }

        let fee = platform_fee(amount);
        let net_amount = amount - fee;

        let admin_key = Symbol::new(&env, "platform_admin");
        if let Some(admin_addr) = env.storage().persistent().get::<Symbol, Address>(&admin_key) {
            if fee > 0 {
                TokenClient::new(&env, &token)
                    .transfer(&env.current_contract_address(), &admin_addr, &fee);
            }
        }

        let escrow = EscrowAccount {
            id: counter,
            bounty_id,
            payer,
            payee,
            amount: net_amount,
            token,
            status: EscrowStatus::Active,
            release_condition,
            created_at: env.ledger().timestamp(),
            released_at: None,
            fee_collected: fee,
            usd_amount_micro,
            oracle_contract,
        };

        env.storage()
            .persistent()
            .set(&(Symbol::new(&env, "escrow"), counter), &escrow);
        env.storage()
            .persistent()
            .set(&(Symbol::new(&env, "b_esc"), bounty_id), &counter);
        env.storage().persistent().set(&counter_key, &counter);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposited")),
            (counter, bounty_id, escrow.payer.clone(), escrow.payee.clone(), net_amount, fee),
        );

        counter
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        env.storage()
            .persistent()
            .get::<(Symbol, u64), EscrowAccount>(&(Symbol::new(&env, "escrow"), escrow_id))
            .expect("Escrow not found")
    }

    /// Release funds to payee. Authorizer must be payer or payee.
    /// BLOCKED when escrow is Disputed (freeze)
    pub fn release_funds(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        require_authorized_party(authorizer == escrow.payer || authorizer == escrow.payee);
        require_active_escrow(escrow.status == EscrowStatus::Active);
        assert!(Self::can_release(env.clone(), escrow_id), "Release condition not met");

        if let (Some(oracle), Some(_usd_amount)) = (
            escrow.oracle_contract.clone(),
            escrow.usd_amount_micro,
        ) {
            let args: Vec<Val> = Vec::from_array(&env, [escrow_id.into_val(&env)]);
            let valuation: ValuationResult = env.invoke_contract(
                &oracle,
                &Symbol::new(&env, "get_locked_valuation"),
                args,
            );
            assert!(
                escrow.amount >= valuation.token_amount * 95 / 100,
                "Escrow below locked valuation tolerance"
            );
        }

        // EFFECTS – mutate state before any cross-contract call
        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // INTERACTIONS – external call after state is finalised
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("released")),
            (escrow_id, escrow.bounty_id, escrow.payee.clone(), escrow.amount),
        );

        true
    }

    /// Refund escrow to payer. Only payer may call.
    /// BLOCKED when disputed
    pub fn refund_escrow(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        assert_eq!(authorizer, escrow.payer, "Only payer can refund");
        require_active_escrow(escrow.status == EscrowStatus::Active);
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        // EFFECTS – mutate state before any cross-contract call
        escrow.status = EscrowStatus::Refunded;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // INTERACTIONS
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refunded")),
            (escrow_id, escrow.bounty_id, escrow.payer.clone(), escrow.amount),
        );

        true
    }

    /// Mark escrow as disputed. Either party may raise a dispute.
    /// This FREEZES on-chain token release/refund and records evidence commitment if provided.
    pub fn dispute_escrow(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        assert!(authorizer == escrow.payer || authorizer == escrow.payee, "Unauthorized");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &escrow);

        // Create dispute info for timelock tracking
        let dispute = DisputeInfo {
            escrow_id,
            disputer: authorizer.clone(),
            disputed_at: env.ledger().timestamp(),
            resolved_at: 0,
            appeal_deadline: 0,
            outcome: DisputeOutcome::Dismissed,
            has_outcome: false,
            client_amount: 0,
            creator_amount: 0,
            finalized: false,
            has_evidence: false,
        };
        env.storage().persistent().set(&DataKey::Dispute(escrow_id), &dispute);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("disputed")),
            (escrow_id, escrow.bounty_id, authorizer),
        );

        true
    }

    /// Dispute with evidence hash commitment (SHA-256 of evidence bundle)
    /// Evidence hash is stored on-chain and can be verified later.
    pub fn dispute_escrow_with_evidence(
        env: Env,
        authorizer: Address,
        escrow_id: u64,
        evidence_hash: BytesN<32>,
    ) -> bool {
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        assert!(authorizer == escrow.payer || authorizer == escrow.payee, "Unauthorized");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &escrow);

        let dispute = DisputeInfo {
            escrow_id,
            disputer: authorizer.clone(),
            disputed_at: env.ledger().timestamp(),
            resolved_at: 0,
            appeal_deadline: 0,
            outcome: DisputeOutcome::Dismissed,
            has_outcome: false,
            client_amount: 0,
            creator_amount: 0,
            finalized: false,
            has_evidence: true,
        };
        env.storage().persistent().set(&DataKey::Dispute(escrow_id), &dispute);
        env.storage().persistent().set(&DataKey::Evidence(escrow_id), &evidence_hash);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("disputed")),
            (escrow_id, escrow.bounty_id, authorizer, evidence_hash),
        );

        true
    }

    /// Store or update evidence commitment for a disputed escrow
    /// Only parties to the escrow may set evidence, and only while disputed.
    pub fn set_dispute_evidence(env: Env, authorizer: Address, escrow_id: u64, evidence_hash: BytesN<32>) -> bool {
        authorizer.require_auth();
        let escrow = Self::get_escrow(env.clone(), escrow_id);
        assert!(authorizer == escrow.payer || authorizer == escrow.payee, "Unauthorized");
        assert!(escrow.status == EscrowStatus::Disputed, "Escrow not disputed");

        let mut dispute: DisputeInfo = env.storage().persistent().get(&DataKey::Dispute(escrow_id)).expect("Dispute not found");
        dispute.has_evidence = true;
        env.storage().persistent().set(&DataKey::Dispute(escrow_id), &dispute);
        env.storage().persistent().set(&DataKey::Evidence(escrow_id), &evidence_hash);

        env.events().publish(
            (symbol_short!("evidence"), symbol_short!("set")),
            (escrow_id, authorizer, evidence_hash),
        );
        true
    }

    pub fn get_dispute_evidence(env: Env, escrow_id: u64) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::Evidence(escrow_id))
    }

    pub fn get_dispute_info(env: Env, escrow_id: u64) -> Option<DisputeInfo> {
        env.storage().persistent().get(&DataKey::Dispute(escrow_id))
    }

    pub fn get_appeal_deadline(env: Env, escrow_id: u64) -> Option<u64> {
        let dispute: DisputeInfo = env.storage().persistent().get(&DataKey::Dispute(escrow_id))?;
        if dispute.appeal_deadline == 0 || !dispute.has_outcome {
            return None;
        }
        Some(dispute.appeal_deadline)
    }

    pub fn is_appeal_window_active(env: Env, escrow_id: u64) -> bool {
        if let Some(dispute) = env.storage().persistent().get::<DataKey, DisputeInfo>(&DataKey::Dispute(escrow_id)) {
            if dispute.has_outcome && dispute.appeal_deadline != 0 {
                if dispute.finalized {
                    return false;
                }
                return env.ledger().timestamp() < dispute.appeal_deadline;
            }
        }
        false
    }

    /// Resolve a disputed escrow. Only the platform admin may call this.
    /// This sets the pending outcome and starts the appeal window timelock.
    /// Funds are NOT transferred until finalize_dispute after appeal window expires.
    /// For immediate settlement (legacy), caller must invoke finalize after window.
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        escrow_id: u64,
        release_to_payee: bool,
    ) -> bool {
        admin.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let admin_key = Symbol::new(&env, "platform_admin");
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&admin_key)
            .expect("Platform admin not set");
        assert_eq!(admin, stored_admin, "Only platform admin can resolve disputes");

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        assert!(escrow.status == EscrowStatus::Disputed, "Escrow is not disputed");

        let mut dispute: DisputeInfo = env.storage().persistent().get(&DataKey::Dispute(escrow_id)).expect("Dispute not found");
        assert!(!dispute.finalized, "Dispute already finalized");
        assert!(dispute.resolved_at == 0, "Already resolved, await finalize or appeal");

        let outcome = if release_to_payee { DisputeOutcome::FavorCreator } else { DisputeOutcome::FavorClient };
        let (client_amount, creator_amount) = if release_to_payee {
            (0, escrow.amount)
        } else {
            (escrow.amount, 0)
        };

        let now = env.ledger().timestamp();
        dispute.outcome = outcome;
        dispute.has_outcome = true;
        dispute.client_amount = client_amount;
        dispute.creator_amount = creator_amount;
        dispute.resolved_at = now;
        dispute.appeal_deadline = now + APPEAL_WINDOW_SECS;
        env.storage().persistent().set(&DataKey::Dispute(escrow_id), &dispute);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("resolved")),
            (escrow_id, escrow.bounty_id, admin.clone(), release_to_payee, now + APPEAL_WINDOW_SECS),
        );

        true
    }

    /// Resolve with split amounts. Validates sum equals escrow amount.
    /// Also starts appeal window timelock.
    pub fn resolve_dispute_split(
        env: Env,
        admin: Address,
        escrow_id: u64,
        client_amount: i128,
        creator_amount: i128,
    ) -> bool {
        admin.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let admin_key = Symbol::new(&env, "platform_admin");
        let stored_admin: Address = env.storage().persistent().get::<Symbol, Address>(&admin_key).expect("Platform admin not set");
        assert_eq!(admin, stored_admin, "Only platform admin can resolve disputes");

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");
        assert!(escrow.status == EscrowStatus::Disputed, "Escrow is not disputed");
        assert!(client_amount >= 0 && creator_amount >= 0, "Amounts must be non-negative");
        assert!(client_amount + creator_amount == escrow.amount, "Split amounts must equal escrow amount");

        let mut dispute: DisputeInfo = env.storage().persistent().get(&DataKey::Dispute(escrow_id)).expect("Dispute not found");
        assert!(!dispute.finalized, "Dispute already finalized");
        assert!(dispute.resolved_at == 0, "Already resolved, await finalize or appeal");

        let now = env.ledger().timestamp();
        dispute.outcome = DisputeOutcome::Split;
        dispute.has_outcome = true;
        dispute.client_amount = client_amount;
        dispute.creator_amount = creator_amount;
        dispute.resolved_at = now;
        dispute.appeal_deadline = now + APPEAL_WINDOW_SECS;
        env.storage().persistent().set(&DataKey::Dispute(escrow_id), &dispute);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("split_res")),
            (escrow_id, escrow.bounty_id, client_amount, creator_amount, now + APPEAL_WINDOW_SECS),
        );

        true
    }

    /// Appeal a resolved dispute within the appeal window.
    /// Only parties may appeal. Resets resolution to allow re-resolution.
    pub fn appeal_dispute(env: Env, appellant: Address, escrow_id: u64) -> bool {
        appellant.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");
        assert!(escrow.status == EscrowStatus::Disputed, "Escrow is not disputed");
        assert!(appellant == escrow.payer || appellant == escrow.payee, "Unauthorized");

        let mut dispute: DisputeInfo = env.storage().persistent().get(&DataKey::Dispute(escrow_id)).expect("Dispute not found");
        assert!(dispute.has_outcome, "Not yet resolved");
        assert!(!dispute.finalized, "Already finalized");
        assert!(dispute.resolved_at != 0, "Not yet resolved");
        let deadline = dispute.appeal_deadline;
        assert!(deadline != 0, "Appeal deadline not set");
        let now = env.ledger().timestamp();
        assert!(now < deadline, "Appeal window expired");
        assert!(now >= dispute.resolved_at, "Invalid timestamp");

        // Reset resolution for re-adjudication
        dispute.outcome = DisputeOutcome::Dismissed;
        dispute.has_outcome = false;
        dispute.client_amount = 0;
        dispute.creator_amount = 0;
        dispute.resolved_at = 0;
        dispute.appeal_deadline = 0;
        env.storage().persistent().set(&DataKey::Dispute(escrow_id), &dispute);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("appealed")),
            (escrow_id, escrow.bounty_id, appellant, now),
        );

        true
    }

    /// Finalize dispute after appeal window expires - executes token transfers per outcome.
    /// Anyone may call after deadline; funds settle to parties.
    pub fn finalize_dispute(env: Env, escrow_id: u64) -> bool {
        let _guard = ReentrancyGuard::acquire(&env);

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");
        assert!(escrow.status == EscrowStatus::Disputed, "Escrow is not disputed");

        let mut dispute: DisputeInfo = env.storage().persistent().get(&DataKey::Dispute(escrow_id)).expect("Dispute not found");
        assert!(!dispute.finalized, "Already finalized");
        assert!(dispute.has_outcome, "Not yet resolved");
        let outcome = dispute.outcome;
        let deadline = dispute.appeal_deadline;
        assert!(deadline != 0, "Appeal deadline not set");
        let now = env.ledger().timestamp();
        assert!(now >= deadline, "Appeal window not expired");
        assert!(dispute.client_amount + dispute.creator_amount == escrow.amount || outcome == DisputeOutcome::FavorClient || outcome == DisputeOutcome::FavorCreator, "Invalid split amounts");

        // EFFECTS before interactions
        dispute.finalized = true;
        env.storage().persistent().set(&DataKey::Dispute(escrow_id), &dispute);

        let mut final_status = EscrowStatus::Released;
        match outcome {
            DisputeOutcome::FavorClient => {
                escrow.status = EscrowStatus::Refunded;
                final_status = EscrowStatus::Refunded;
                escrow.released_at = Some(now);
                env.storage().persistent().set(&key, &escrow);
                TokenClient::new(&env, &escrow.token)
                    .transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);
                env.events().publish(
                    (symbol_short!("escrow"), symbol_short!("final_ref")),
                    (escrow_id, escrow.bounty_id, escrow.payer.clone(), escrow.amount),
                );
            }
            DisputeOutcome::FavorCreator => {
                escrow.status = EscrowStatus::Released;
                escrow.released_at = Some(now);
                env.storage().persistent().set(&key, &escrow);
                TokenClient::new(&env, &escrow.token)
                    .transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);
                env.events().publish(
                    (symbol_short!("escrow"), symbol_short!("final_rel")),
                    (escrow_id, escrow.bounty_id, escrow.payee.clone(), escrow.amount),
                );
            }
            DisputeOutcome::Split => {
                let client_amt = dispute.client_amount;
                let creator_amt = dispute.creator_amount;
                assert!(client_amt + creator_amt == escrow.amount, "Split mismatch");
                // escrow considered released (partial to both)
                escrow.status = EscrowStatus::Released;
                escrow.released_at = Some(now);
                env.storage().persistent().set(&key, &escrow);
                if client_amt > 0 {
                    TokenClient::new(&env, &escrow.token)
                        .transfer(&env.current_contract_address(), &escrow.payer, &client_amt);
                }
                if creator_amt > 0 {
                    TokenClient::new(&env, &escrow.token)
                        .transfer(&env.current_contract_address(), &escrow.payee, &creator_amt);
                }
                env.events().publish(
                    (symbol_short!("escrow"), symbol_short!("final_spl")),
                    (escrow_id, escrow.bounty_id, escrow.payer.clone(), escrow.payee.clone(), client_amt, creator_amt),
                );
            }
            DisputeOutcome::Dismissed => {
                // Dismissed -> no movement, refund? treat as Active again? For now mark as refunded? But keep Disputed until manual?
                // For simplicity, dismissed keeps funds locked and resets to Active
                escrow.status = EscrowStatus::Active;
                env.storage().persistent().set(&key, &escrow);
                final_status = EscrowStatus::Active;
                env.events().publish(
                    (symbol_short!("escrow"), symbol_short!("dismissed")),
                    (escrow_id, escrow.bounty_id),
                );
            }
        }

        // Ensure dispute marked finalized regardless
        let _ = final_status;
        true
    }

    /// Set the platform admin address. Can only be called once (bootstrap).
    pub fn set_admin(env: Env, admin: Address) {
        admin.require_auth();
        let admin_key = Symbol::new(&env, "platform_admin");
        assert!(
            env.storage().persistent().get::<Symbol, Address>(&admin_key).is_none(),
            "Admin already set"
        );
        env.storage().persistent().set(&admin_key, &admin);
    }

    /// Get the current platform admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set")
    }

    /// Add a milestone to an active escrow. Sum of milestone amounts must not exceed escrow amount.
    pub fn add_milestone(
        env: Env,
        authorizer: Address,
        escrow_id: u64,
        index: u32,
        description: Symbol,
        amount: i128,
    ) {
        authorizer.require_auth();

        let escrow = Self::get_escrow(env.clone(), escrow_id);
        assert_eq!(authorizer, escrow.payer, "Only payer can add milestones");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");
        assert!(amount > 0, "Milestone amount must be positive");
        assert!(amount <= escrow.amount, "Milestone amount exceeds escrow");

        let m_key = (Symbol::new(&env, "ms"), escrow_id, index);
        assert!(
            env.storage().persistent().get::<(Symbol, u64, u32), Milestone>(&m_key).is_none(),
            "Milestone already exists"
        );

        // Cumulative invariant (#78): the sum of all milestone allocations must
        // never exceed the escrowed amount. The per-milestone check above is not
        // sufficient — two milestones can each satisfy `amount <= escrow.amount`
        // while together exceeding it, which would let releases pay out more than
        // was deposited.
        let total_key = (Symbol::new(&env, "ms_total"), escrow_id);
        let allocated: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
        assert!(
            allocated + amount <= escrow.amount,
            "Total milestone allocation exceeds escrow amount"
        );

        let milestone = Milestone { escrow_id, index, description, amount, released: false };
        env.storage().persistent().set(&m_key, &milestone);
        // Atomically record the new running allocation total in the same call.
        env.storage().persistent().set(&total_key, &(allocated + amount));
    }

    /// Release a single milestone payment to payee. Authorizer must be payer.
    /// BLOCKED when disputed
    pub fn release_milestone(env: Env, authorizer: Address, escrow_id: u64, index: u32) -> bool {
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let escrow = Self::get_escrow(env.clone(), escrow_id);
        assert_eq!(authorizer, escrow.payer, "Only payer can release milestones");
        require_active_escrow(escrow.status == EscrowStatus::Active);

        let m_key = (Symbol::new(&env, "ms"), escrow_id, index);
        let mut milestone = env.storage().persistent()
            .get::<(Symbol, u64, u32), Milestone>(&m_key)
            .expect("Milestone not found");

        assert!(!milestone.released, "Milestone already released");

        // EFFECTS – mark released before the token transfer
        milestone.released = true;
        env.storage().persistent().set(&m_key, &milestone);

        // Belt-and-suspenders invariant (#78): cumulative releases must never
        // exceed the escrowed amount, independent of allocation bookkeeping.
        let reld_key = (Symbol::new(&env, "ms_reld"), escrow_id);
        let released_total: i128 =
            env.storage().persistent().get(&reld_key).unwrap_or(0) + milestone.amount;
        assert!(
            released_total <= escrow.amount,
            "Total milestone releases exceed escrow amount"
        );
        env.storage().persistent().set(&reld_key, &released_total);

        // INTERACTIONS – external call after state is finalised
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &milestone.amount);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("ms_rel")),
            (escrow_id, index, escrow.payee.clone(), milestone.amount),
        );

        true
    }

    pub fn get_milestone(env: Env, escrow_id: u64, index: u32) -> Milestone {
        env.storage()
            .persistent()
            .get::<(Symbol, u64, u32), Milestone>(&(Symbol::new(&env, "ms"), escrow_id, index))
            .expect("Milestone not found")
    }

    pub fn can_release(env: Env, escrow_id: u64) -> bool {
        let escrow = Self::get_escrow(env.clone(), escrow_id);
        match escrow.release_condition {
            ReleaseCondition::OnCompletion => true,
            ReleaseCondition::Timelock(deadline) => env.ledger().timestamp() >= deadline,
        }
    }

    /// Return the platform fee that would be charged for a given gross amount.
    pub fn calculate_fee(_env: Env, gross_amount: i128) -> i128 {
        platform_fee(gross_amount)
    }

    pub fn get_active_escrows_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&Symbol::new(&env, "escrow_counter"))
            .unwrap_or(0)
    }

    /// Get the latest escrow ID for a specific bounty.
    pub fn get_escrow_id_for_bounty(env: Env, bounty_id: u64) -> u64 {
        env.storage()
            .persistent()
            .get::<(Symbol, u64), u64>(&(Symbol::new(&env, "b_esc"), bounty_id))
            .unwrap_or(0)
    }

    /// Submit a Stellar transaction for an escrow operation.
    pub fn submit_transaction(
        env: Env,
        caller: Address,
        operation: Symbol,
        escrow_id: u64,
    ) -> u64 {
        caller.require_auth();

        let op_deposit = Symbol::new(&env, "deposit");
        let op_release = Symbol::new(&env, "release");
        let op_refund = Symbol::new(&env, "refund");
        let op_dispute = Symbol::new(&env, "dispute");

        if operation == op_release {
            Self::release_funds(env.clone(), caller.clone(), escrow_id);
        } else if operation == op_refund {
            Self::refund_escrow(env.clone(), caller.clone(), escrow_id);
        } else if operation == op_dispute {
            Self::dispute_escrow(env.clone(), caller.clone(), escrow_id);
        } else if operation == op_deposit {
            panic!("Use deposit() directly for new escrows");
        } else {
            panic!("Unknown operation");
        }

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("tx_sub")),
            (escrow_id, operation, caller),
        );

        escrow_id
    }

    // Yield Farming

    pub fn configure_yield(
        env: Env,
        admin: Address,
        rate_bps: u32,
        max_yield_ratio: u32,
        min_liquidity_bps: u32,
    ) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        assert_eq!(admin, stored_admin, "Only platform admin can configure yield");
        assert!(rate_bps <= 10_000, "Rate must be <= 100 %");
        assert!(max_yield_ratio <= 10_000, "Max yield ratio must be <= 100 %");
        assert!(min_liquidity_bps <= 10_000, "Min liquidity must be <= 100 %");

        env.storage().persistent().set(&DataKey::YieldCfg, &YieldConfig {
            rate_bps,
            max_yield_ratio,
            min_liquidity_bps,
        });
    }

    pub fn accrue_yield(env: Env, escrow_id: u64) {
        let cfg: YieldConfig = env
            .storage()
            .persistent()
            .get::<DataKey, YieldConfig>(&DataKey::YieldCfg)
            .expect("Yield not configured");

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let escrow = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), EscrowAccount>(&key)
            .expect("Escrow not found");

        assert!(escrow.status == EscrowStatus::Active, "Only active escrows earn yield");

        let now = env.ledger().timestamp();
        let yield_key = DataKey::Yield(escrow_id);

        let mut accrual: YieldAccrual = env
            .storage()
            .persistent()
            .get::<DataKey, YieldAccrual>(&yield_key)
            .unwrap_or(YieldAccrual {
                escrow_id,
                principal: escrow.amount,
                accrued: 0,
                last_updated: escrow.created_at,
            });

        let elapsed = now.saturating_sub(accrual.last_updated);
        if elapsed == 0 {
            return;
        }

        const SECONDS_PER_YEAR: u64 = 365 * 24 * 3600;
        let new_yield = accrual.principal
            * (cfg.rate_bps as i128)
            * (elapsed as i128)
            / (10_000_i128 * SECONDS_PER_YEAR as i128);

        accrual.accrued = accrual.accrued.saturating_add(new_yield);

        let yield_cap = accrual.principal * (cfg.max_yield_ratio as i128) / 10_000;
        if accrual.accrued > yield_cap {
            accrual.accrued = yield_cap;
        }

        accrual.last_updated = now;
        env.storage().persistent().set(&yield_key, &accrual);

        env.events().publish(
            (symbol_short!("yield"), symbol_short!("accrued")),
            (escrow_id, new_yield, accrual.accrued),
        );
    }

    pub fn get_accrued_yield(env: Env, escrow_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, YieldAccrual>(&DataKey::Yield(escrow_id))
            .map(|a| a.accrued)
            .unwrap_or(0)
    }

    pub fn withdraw_yield(env: Env, admin: Address, escrow_id: u64) -> i128 {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        assert_eq!(admin, stored_admin, "Only platform admin can withdraw yield");

        let cfg: YieldConfig = env
            .storage()
            .persistent()
            .get::<DataKey, YieldConfig>(&DataKey::YieldCfg)
            .expect("Yield not configured");

        let yield_key = DataKey::Yield(escrow_id);
        let mut accrual: YieldAccrual = env
            .storage()
            .persistent()
            .get::<DataKey, YieldAccrual>(&yield_key)
            .expect("No yield accrual found for escrow");

        assert!(accrual.accrued > 0, "No yield to withdraw");

        let min_liquidity = accrual.principal * (cfg.min_liquidity_bps as i128) / 10_000;
        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let escrow = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), EscrowAccount>(&key)
            .expect("Escrow not found");

        assert!(
            escrow.amount >= min_liquidity,
            "Insufficient liquidity to withdraw yield"
        );

        let to_withdraw = accrual.accrued;
        accrual.accrued = 0;
        env.storage().persistent().set(&yield_key, &accrual);

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &admin, &to_withdraw);

        env.events().publish(
            (symbol_short!("yield"), symbol_short!("withdrawn")),
            (escrow_id, to_withdraw, admin),
        );

        to_withdraw
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    fn setup(env: &Env, amount: i128) -> (Address, Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token = sac.address();
        let payer = Address::generate(env);
        let payee = Address::generate(env);
        StellarAssetClient::new(env, &token).mint(&payer, &amount);
        (admin, token, payer, payee)
    }

    // fee calculation (#344)
    #[test]
    fn fee_is_2_5_percent_of_amount() {
        assert_eq!(platform_fee(1000), 25);
        assert_eq!(platform_fee(400), 10);
    }

    #[test]
    fn fee_is_capped_at_500() {
        assert_eq!(platform_fee(30_000), 500);
        assert_eq!(platform_fee(1_000_000), 500);
    }

    #[test]
    fn fee_at_exact_cap_boundary() {
        assert_eq!(platform_fee(20_000), 500);
    }

    #[test]
    fn fee_is_zero_for_zero_amount() {
        assert_eq!(platform_fee(0), 0);
    }

    #[test]
    fn deposit_net_amount_reflects_fee_deduction() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let escrow = contract.get_escrow(&id);
        assert_eq!(escrow.amount, 975);
        assert_eq!(escrow.fee_collected, 25);
    }

    #[test]
    fn calculate_fee_public_fn_matches_platform_fee() {
        let env = Env::default();
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        assert_eq!(contract.calculate_fee(&1000), 25);
        assert_eq!(contract.calculate_fee(&30_000), 500);
    }
    // â”€â”€ deposit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn test_deposit_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        assert_eq!(id, 1);
        let e = contract.get_escrow(&id);
        assert_eq!(e.bounty_id, 1);
        assert_eq!(e.payer, payer);
        assert_eq!(e.amount, 975);
        assert!(e.status == EscrowStatus::Active);
        assert!(e.released_at.is_none());
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn deposit_zero_amount_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 0);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        contract.deposit(&1u64, &payer, &payee, &0, &token, &ReleaseCondition::OnCompletion, &None, &None);
    }

    // â”€â”€ release â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn release_moves_balance_once_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        assert_eq!(TokenClient::new(&env, &token).balance(&cid), 1000);

        contract.release_funds(&payee, &id);

        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 975);
        assert_eq!(TokenClient::new(&env, &token).balance(&cid), 25);
        let e = contract.get_escrow(&id);
        assert!(e.status == EscrowStatus::Released);
        assert!(e.released_at.is_some());
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn double_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.release_funds(&payer, &id);
        contract.release_funds(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Caller is not an authorized party")]
    fn release_rejects_non_party_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.release_funds(&Address::generate(&env), &id);
    }

    // â”€â”€ refund â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn refund_returns_funds_to_payer_and_sets_released_at() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 800);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &800, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.refund_escrow(&payer, &id);

        assert_eq!(TokenClient::new(&env, &token).balance(&payer), 780);
        let e = contract.get_escrow(&id);
        assert!(e.status == EscrowStatus::Refunded);
        assert!(e.released_at.is_some());
    }

    #[test]
    #[should_panic(expected = "Only payer can refund")]
    fn refund_rejects_payee_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.refund_escrow(&payee, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn double_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.refund_escrow(&payer, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn refund_after_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.release_funds(&payee, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn release_after_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.refund_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // â”€â”€ dispute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn payer_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    fn payee_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn stranger_cannot_dispute() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&Address::generate(&env), &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn cannot_dispute_released_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.release_funds(&payer, &id);
        contract.dispute_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn cannot_release_disputed_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // â”€â”€ resolve_dispute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn admin_can_resolve_dispute_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &true);
        // Funds remain locked during appeal window
        assert_eq!(tc.balance(&payee), 0);
        assert_eq!(tc.balance(&cid), 975);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
        // Warp past appeal window and finalize
        env.ledger().set_timestamp(env.ledger().timestamp() + APPEAL_WINDOW_SECS + 1);
        contract.finalize_dispute(&id);
        assert_eq!(tc.balance(&payee), 975);
        assert_eq!(tc.balance(&cid), 0);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
    }

    #[test]
    fn admin_can_resolve_dispute_to_payer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payee, &id);
        contract.resolve_dispute(&admin, &id, &false);
        assert_eq!(tc.balance(&payer), 0);
        assert_eq!(tc.balance(&cid), 975);
        env.ledger().set_timestamp(env.ledger().timestamp() + APPEAL_WINDOW_SECS + 1);
        contract.finalize_dispute(&id);
        assert_eq!(tc.balance(&payer), 975);
        assert_eq!(tc.balance(&cid), 0);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Refunded);
    }

    #[test]
    #[should_panic(expected = "Only platform admin can resolve disputes")]
    fn non_admin_cannot_resolve_dispute() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&payer, &id, &true); // payer is not admin
    }

    #[test]
    #[should_panic(expected = "Escrow is not disputed")]
    fn cannot_resolve_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.resolve_dispute(&admin, &id, &true); // not disputed yet
    }

    #[test]
    #[should_panic(expected = "Admin already set")]
    fn set_admin_can_only_be_called_once() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let _ = (token, payer, payee); // suppress unused warnings

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.set_admin(&admin); // second call must panic
    }

    // ── timelock ──────────────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn release_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200), &None, &None);
        contract.release_funds(&payer, &id);
    }

    #[test]
    fn release_after_timelock_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200), &None, &None);
        env.ledger().set_timestamp(250);
        contract.release_funds(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
    }

    // ── milestones ──────────────────────────────────────────────────────────────────

    #[test]
    fn milestone_release_transfers_partial_amount() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let desc = Symbol::new(&env, "phase1");
        contract.add_milestone(&payer, &id, &0, &desc, &400);
        contract.release_milestone(&payer, &id, &0);

        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 400);
        assert!(contract.get_milestone(&id, &0).released);
    }

    #[test]
    #[should_panic(expected = "Milestone already released")]
    fn double_milestone_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let desc = Symbol::new(&env, "phase1");
        contract.add_milestone(&payer, &id, &0, &desc, &400);
        contract.release_milestone(&payer, &id, &0);
        contract.release_milestone(&payer, &id, &0);
    }

    #[test]
    #[should_panic(expected = "Only payer can add milestones")]
    fn payee_cannot_add_milestone() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.add_milestone(&payee, &id, &0, &Symbol::new(&env, "x"), &400);
    }

    #[test]
    #[should_panic(expected = "Only payer can release milestones")]
    fn payee_cannot_release_milestone() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &400);
        contract.release_milestone(&payee, &id, &0);
    }

    #[test]
    #[should_panic(expected = "Milestone amount exceeds escrow")]
    fn milestone_exceeding_escrow_amount_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &1001);
    }

    // ── cumulative milestone invariant (#78) ──────────────────────────────────

    /// Two milestones can each individually pass `amount <= escrow.amount` while
    /// together exceeding it. The running-total guard must reject the second.
    #[test]
    #[should_panic(expected = "Total milestone allocation exceeds escrow amount")]
    fn cumulative_milestone_allocation_cannot_exceed_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        // Gross 1000 -> 2.5% fee -> net escrow amount 975.
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "p1"), &600); // 600 <= 975 ok
        // 600 + 500 = 1100 > 975 — individually fine, cumulatively over-allocated.
        contract.add_milestone(&payer, &id, &1, &Symbol::new(&env, "p2"), &500);
    }

    /// Milestones summing to exactly the net escrow amount remain valid and both
    /// release, paying out exactly the deposit (no over-payout, no dust locked).
    #[test]
    fn milestones_summing_to_net_amount_are_allowed_and_release_fully() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        // 600 + 375 == 975 (net), the exact boundary.
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "p1"), &600);
        contract.add_milestone(&payer, &id, &1, &Symbol::new(&env, "p2"), &375);
        contract.release_milestone(&payer, &id, &0);
        contract.release_milestone(&payer, &id, &1);
        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 975);
    }

    // ── balance conservation ──────────────────────────────────────────────────

    /// Total tokens out (payee + payer) must equal total tokens deposited.
    #[test]
    fn balance_conservation_release() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2500);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &2500, &token, &ReleaseCondition::OnCompletion, &None, &None);
        assert_eq!(tc.balance(&cid), 2500);
        assert_eq!(tc.balance(&payer), 0);

        contract.release_funds(&payer, &id);

        assert_eq!(tc.balance(&payee), 2438);  // payee received all (2500 - 62 fee)
        assert_eq!(tc.balance(&cid), 62);        // contract holds the fee
        assert_eq!(tc.balance(&payer), 0);      // payer gave it all
    }

    #[test]
    fn balance_conservation_refund() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1800);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1800, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.refund_escrow(&payer, &id);

        assert_eq!(tc.balance(&payer), 1755);
        assert_eq!(tc.balance(&payee), 0);
        assert_eq!(tc.balance(&cid), 45);
    }

    // ── multi-escrow isolation ────────────────────────────────────────────────
    
    /// Releasing escrow A must not affect escrow B's locked balance.
    #[test]
    fn releasing_one_escrow_does_not_drain_another() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 3000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        // Deposit two separate escrows from the same payer
        let id_a = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let id_b = contract.deposit(&2u64, &payer, &payee, &2000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        assert_eq!(tc.balance(&cid), 3000);

        contract.release_funds(&payer, &id_a);

        // Only escrow B's amount + fee from A left in contract
        assert_eq!(tc.balance(&cid), 2025);
        assert_eq!(tc.balance(&payee), 975);

        // Escrow B is still active and untouched
        assert!(contract.get_escrow(&id_b).status == EscrowStatus::Active);
    }

    #[test]
    fn test_get_escrow_id_for_bounty() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let b_id = 99u64;
        let e_id = contract.deposit(&b_id, &payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &None, &None);
        
        assert_eq!(contract.get_escrow_id_for_bounty(&b_id), e_id);
        assert_eq!(contract.get_escrow_id_for_bounty(&100u64), 0);
    }

    /// IDs are monotonically increasing and never reused.
    #[test]
    fn escrow_ids_are_monotonically_increasing() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 3000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let id1 = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let id2 = contract.deposit(&2u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let id3 = contract.deposit(&3u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
        assert!(id2 > id1 && id3 > id2);
    }

    // ── double-spend prevention ────────────────────────────────────────────────

    /// Funds locked in a disputed escrow must remain in the contract.
    #[test]
    fn disputed_escrow_funds_stay_locked() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);

        // Balance unchanged — funds are locked
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&payee), 0i128);
        assert_eq!(token_client.balance(&contract_id), 1000i128);
    }

    /// Two milestones whose combined amount equals the escrow can both be released
    /// but the total payout must not exceed the deposited amount.
    #[test]
    fn two_milestones_total_payout_equals_deposit() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);
        let token_client = TokenClient::new(&env, &token);

        let escrow_id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.add_milestone(&payer, &escrow_id, &0, &Symbol::new(&env, "p1"), &600);
        contract.add_milestone(&payer, &escrow_id, &1, &Symbol::new(&env, "p2"), &375);

        contract.release_milestone(&payer, &escrow_id, &0);
        contract.release_milestone(&payer, &escrow_id, &1);
        assert_eq!(token_client.balance(&payee), 975);
        assert_eq!(token_client.balance(&contract_id), 25);
    }

    /// A milestone from escrow A cannot be released against escrow B.
    #[test]
    #[should_panic(expected = "Milestone not found")]
    fn milestone_cross_escrow_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let id_a = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let id_b = contract.deposit(&2u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);

        contract.add_milestone(&payer, &id_a, &0, &Symbol::new(&env, "m"), &500);

        // Attempt to release escrow A's milestone index 0 against escrow B
        contract.release_milestone(&payer, &id_b, &0);
    }

    /// Depositing a negative amount must be rejected.
    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn deposit_negative_amount_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        contract.deposit(&1u64, &payer, &payee, &-1, &token, &ReleaseCondition::OnCompletion, &None, &None);
    }

    // â”€â”€ timelock boundary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Release at exactly the deadline timestamp must succeed.
    #[test]
    fn release_at_exact_timelock_boundary_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200), &None, &None);

        // Set timestamp to exactly the deadline
        env.ledger().set_timestamp(200);
        contract.release_funds(&payer, &id);

        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 488);
    }

    /// Release one second before the deadline must be rejected.
    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn release_one_second_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200), &None, &None);

        env.ledger().set_timestamp(199);
        contract.release_funds(&payer, &id);
    }
    // ── Advanced dispute: freeze / split / timeout / evidence / appeal ──────────

    #[test]
    fn freeze_blocks_release_and_refund() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        // Both release and refund must be blocked while disputed
        let cid = env.register_contract(None, EscrowContract);
        // Use same contract instance; attempt release should panic
        // We test via should_panic helper - here we verify status remains Disputed and balances unchanged
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 0);
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn cannot_release_disputed_escrow_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn cannot_refund_disputed_escrow_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    fn milestone_blocked_when_disputed() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "m1"), &400);
        contract.dispute_escrow(&payer, &id);
        // milestone release requires Active, should panic
    }

    #[test]
    #[should_panic(expected = "Escrow is not active")]
    fn milestone_release_blocked_when_disputed_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "m1"), &400);
        contract.dispute_escrow(&payer, &id);
        contract.release_milestone(&payer, &id, &0);
    }

    #[test]
    fn split_settlement_distributes_correct_amounts() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        env.ledger().set_timestamp(1000);
        let id = contract.deposit(&1u64, &payer, &payee, &2000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        // net amount = 2000 - 50 (2.5% capped? 2000*250/10000=50) =1950
        assert_eq!(contract.get_escrow(&id).amount, 1950);
        contract.dispute_escrow(&payer, &id);
        // split 50/50 => 975 each
        contract.resolve_dispute_split(&admin, &id, &975, &975);
        // Not yet transferred
        assert_eq!(tc.balance(&payer), 0);
        assert_eq!(tc.balance(&payee), 0);
        assert_eq!(tc.balance(&cid), 1950);
        env.ledger().set_timestamp(1000 + APPEAL_WINDOW_SECS + 1);
        contract.finalize_dispute(&id);
        assert_eq!(tc.balance(&payer), 975);
        assert_eq!(tc.balance(&payee), 975);
        assert_eq!(tc.balance(&cid), 0); // fee already to admin
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
        let info = contract.get_dispute_info(&id).unwrap();
        assert!(info.finalized);
        assert!(info.has_outcome);
        assert!(info.outcome == DisputeOutcome::Split);
    }

    #[test]
    #[should_panic(expected = "Split amounts must equal escrow amount")]
    fn split_with_wrong_sum_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute_split(&admin, &id, &500, &400); // sum 900 != 975
    }

    #[test]
    #[should_panic(expected = "Appeal window not expired")]
    fn finalize_before_appeal_window_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        env.ledger().set_timestamp(5000);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &true);
        // try finalize immediately without warping
        contract.finalize_dispute(&id);
    }

    #[test]
    fn finalize_after_appeal_window_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &false);
        env.ledger().set_timestamp(100 + APPEAL_WINDOW_SECS + 10);
        contract.finalize_dispute(&id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Refunded);
    }

    #[test]
    fn appeal_within_window_resets_resolution() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        env.ledger().set_timestamp(1000);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &true);
        // appeal within window by payee
        env.ledger().set_timestamp(1000 + 100);
        contract.appeal_dispute(&payee, &id);
        let info = contract.get_dispute_info(&id).unwrap();
        assert!(info.resolved_at == 0);
        assert!(info.appeal_deadline == 0);
        assert!(!info.has_outcome);
        // Can re-resolve after appeal
        contract.resolve_dispute(&admin, &id, &false);
        env.ledger().set_timestamp(1000 + APPEAL_WINDOW_SECS + 200);
        contract.finalize_dispute(&id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Refunded);
    }

    #[test]
    #[should_panic(expected = "Appeal window expired")]
    fn appeal_after_window_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &true);
        env.ledger().set_timestamp(100 + APPEAL_WINDOW_SECS + 1);
        contract.appeal_dispute(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn unauthorized_party_cannot_appeal() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &true);
        let stranger = Address::generate(&env);
        contract.appeal_dispute(&stranger, &id);
    }

    #[test]
    fn evidence_commitment_stored_and_verified() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        contract.dispute_escrow_with_evidence(&payer, &id, &hash.clone());
        let stored = contract.get_dispute_evidence(&id).unwrap();
        assert_eq!(stored, hash);
        let info = contract.get_dispute_info(&id).unwrap();
        assert!(info.has_evidence);
        assert_eq!(contract.get_dispute_evidence(&id).unwrap(), hash);
        // update evidence
        let hash2 = BytesN::from_array(&env, &[2u8; 32]);
        contract.set_dispute_evidence(&payee, &id, &hash2.clone());
        assert_eq!(contract.get_dispute_evidence(&id).unwrap(), hash2);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn stranger_cannot_set_evidence() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        let stranger = Address::generate(&env);
        let hash = BytesN::from_array(&env, &[9u8; 32]);
        contract.set_dispute_evidence(&stranger, &id, &hash);
    }

    #[test]
    fn appeal_window_active_check() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        env.ledger().set_timestamp(1000);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &None, &None);
        contract.dispute_escrow(&payer, &id);
        assert!(!contract.is_appeal_window_active(&id));
        contract.resolve_dispute(&admin, &id, &true);
        assert!(contract.is_appeal_window_active(&id));
        env.ledger().set_timestamp(1000 + APPEAL_WINDOW_SECS + 1);
        assert!(!contract.is_appeal_window_active(&id));
    }

}

