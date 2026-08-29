#![no_std]

//! Fail-closed oracle valuation for fiat-denominated escrow.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Symbol,
};

pub const MAX_PRICE_AGE_SECS: u64 = 300;
pub const LOCK_TTL_SECS: u64 = 60;
pub const MAX_PRICE_DEVIATION_BPS: i128 = 1_000;
pub const STROOPS_PER_XLM: i128 = 10_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleError {
    NotConfigured = 1,
    Unauthorized = 2,
    InvalidPrice = 3,
    NoSources = 4,
    StalePrice = 5,
    ExcessiveDeviation = 6,
    InvalidAmount = 7,
    ArithmeticOverflow = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price_micro_usd: i128,
    pub timestamp: u64,
    pub sources: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValuationResult {
    pub usd_amount_micro: i128,
    /// Minimum XLM amount in stroops, rounded up to prevent underpayment.
    pub token_amount: i128,
    pub price_used: i128,
    pub sources: u32,
    pub locked_at: u64,
    pub expires_at: u64,
}

#[contracttype]
enum DataKey {
    OracleAddress,
    LastPrice,
}

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    pub fn set_oracle(env: Env, admin: Address, oracle: Address) {
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::OracleAddress, &oracle);
    }

    /// Accept an authenticated, live, multi-source observation.
    pub fn update_price(
        env: Env,
        caller: Address,
        price_data: PriceData,
    ) -> Result<(), OracleError> {
        caller.require_auth();
        let configured = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::OracleAddress)
            .ok_or(OracleError::NotConfigured)?;
        if caller != configured {
            return Err(OracleError::Unauthorized);
        }
        if price_data.price_micro_usd <= 0 {
            return Err(OracleError::InvalidPrice);
        }
        if price_data.sources == 0 {
            return Err(OracleError::NoSources);
        }

        let now = env.ledger().timestamp();
        if price_data.timestamp > now
            || now.saturating_sub(price_data.timestamp) > MAX_PRICE_AGE_SECS
        {
            return Err(OracleError::StalePrice);
        }

        if let Some(last) = env
            .storage()
            .persistent()
            .get::<DataKey, PriceData>(&DataKey::LastPrice)
        {
            if deviation_bps(last.price_micro_usd, price_data.price_micro_usd)
                > MAX_PRICE_DEVIATION_BPS
            {
                return Err(OracleError::ExcessiveDeviation);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::LastPrice, &price_data);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "price_updated")),
            (
                price_data.price_micro_usd,
                price_data.timestamp,
                price_data.sources,
            ),
        );
        Ok(())
    }

    /// Return only a live multi-source price. There is intentionally no fallback.
    pub fn get_price(env: Env) -> Result<PriceData, OracleError> {
        let data = env
            .storage()
            .persistent()
            .get::<DataKey, PriceData>(&DataKey::LastPrice)
            .ok_or(OracleError::NotConfigured)?;
        if data.sources == 0 {
            return Err(OracleError::NoSources);
        }
        let now = env.ledger().timestamp();
        if data.timestamp > now || now.saturating_sub(data.timestamp) > MAX_PRICE_AGE_SECS {
            return Err(OracleError::StalePrice);
        }
        Ok(data)
    }

    /// Lock a short-lived, execution-time valuation for server settlement.
    pub fn lock_price(
        env: Env,
        usd_amount_micro: i128,
    ) -> Result<ValuationResult, OracleError> {
        Self::value_in_tokens(env, usd_amount_micro)
    }

    /// Convert micro-USD to stroops and round upward so escrow cannot be underpaid.
    pub fn value_in_tokens(
        env: Env,
        usd_amount_micro: i128,
    ) -> Result<ValuationResult, OracleError> {
        if usd_amount_micro <= 0 {
            return Err(OracleError::InvalidAmount);
        }
        let price = Self::get_price(env.clone())?;
        let numerator = usd_amount_micro
            .checked_mul(STROOPS_PER_XLM)
            .ok_or(OracleError::ArithmeticOverflow)?;
        let rounded = numerator
            .checked_add(price.price_micro_usd - 1)
            .ok_or(OracleError::ArithmeticOverflow)?;
        let token_amount = rounded
            .checked_div(price.price_micro_usd)
            .ok_or(OracleError::InvalidPrice)?;
        let now = env.ledger().timestamp();
        let feed_expires_at = price.timestamp.saturating_add(MAX_PRICE_AGE_SECS);

        Ok(ValuationResult {
            usd_amount_micro,
            token_amount,
            price_used: price.price_micro_usd,
            sources: price.sources,
            locked_at: now,
            expires_at: core::cmp::min(now.saturating_add(LOCK_TTL_SECS), feed_expires_at),
        })
    }
}

fn deviation_bps(old: i128, new: i128) -> i128 {
    if old <= 0 {
        return i128::MAX;
    }
    let diff = if new > old { new - old } else { old - new };
    diff.saturating_mul(10_000) / old
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
        let contract_id = env.register_contract(None, OracleContract);
        let oracle = Address::generate(&env);
        OracleContractClient::new(&env, &contract_id).set_oracle(
            &Address::generate(&env),
            &oracle,
        );
        (env, contract_id, oracle)
    }

    fn observation(price: i128, timestamp: u64, sources: u32) -> PriceData {
        PriceData {
            price_micro_usd: price,
            timestamp,
            sources,
        }
    }

    #[test]
    fn missing_price_fails_closed() {
        let (env, id, _) = setup();
        assert!(OracleContractClient::new(&env, &id)
            .try_get_price()
            .is_err());
    }

    #[test]
    fn zero_source_observation_is_rejected() {
        let (env, id, oracle) = setup();
        assert!(OracleContractClient::new(&env, &id)
            .try_update_price(&oracle, &observation(120_000, 1_000, 0))
            .is_err());
    }

    #[test]
    fn stale_price_cannot_be_valued() {
        let (env, id, oracle) = setup();
        let client = OracleContractClient::new(&env, &id);
        client.update_price(&oracle, &observation(120_000, 1_000, 3));
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_301);
        assert!(client.try_value_in_tokens(&1_000_000).is_err());
    }

    #[test]
    fn excessive_deviation_is_rejected() {
        let (env, id, oracle) = setup();
        let client = OracleContractClient::new(&env, &id);
        client.update_price(&oracle, &observation(120_000, 1_000, 3));
        assert!(client
            .try_update_price(&oracle, &observation(150_000, 1_000, 3))
            .is_err());
    }

    #[test]
    fn valuation_rounds_up_to_prevent_underpayment() {
        let (env, id, oracle) = setup();
        let client = OracleContractClient::new(&env, &id);
        client.update_price(&oracle, &observation(300_000, 1_000, 4));
        let valuation = client.lock_price(&1_000_000);
        assert_eq!(valuation.token_amount, 33_333_334);
        assert_eq!(valuation.sources, 4);
        assert_eq!(valuation.expires_at, 1_060);
    }
}
