use protocol_types::hash::poseidon2_hash_with_separator;

mod context;
mod uint253;
mod erc20_note;
pub(crate) mod note;
mod owned_note;

pub use context::{Context, Result};
pub use note::{compute_note_hash, Note};
pub use owned_note::{NoteConsumptionInputs, OwnedNote};
pub use protocol_types::{address::EthAddress, traits::Serialize};

// Note: keep in sync with other languages
pub global NOTE_HASH_TREE_HEIGHT: u32 = 40;
// Note: keep in sync with other languages
pub global NOTE_HASH_SUBTREE_HEIGHT: u32 = 6;
// Note: keep in sync with other languages
pub global NOTE_HASH_SUBTREE_SIBLING_PATH_LENGTH: u32 =
    NOTE_HASH_TREE_HEIGHT - NOTE_HASH_SUBTREE_HEIGHT;
// Note: keep in sync with other languages
pub global MAX_NOTES_PER_ROLLUP: u32 = 64; // 2^NOTE_HASH_SUBTREE_HEIGHT

// Note: keep in sync with other languages
pub global NULLIFIER_TREE_HEIGHT: u32 = 40;
// Note: keep in sync with other languages
pub global NULLIFIER_SUBTREE_HEIGHT: u32 = 6;
// Note: keep in sync with other languages
pub global MAX_NULLIFIERS_PER_ROLLUP: u32 = 64; // 2^NULLIFIER_SUBTREE_HEIGHT
// Note: keep in sync with other languages
pub global NULLIFIER_SUBTREE_SIBLING_PATH_LENGTH: u32 =
    NULLIFIER_TREE_HEIGHT - NULLIFIER_SUBTREE_HEIGHT;

// Note: keep in sync with other languages
pub global MAX_TOKENS_IN_PER_EXECUTION: u32 = 4;
// Note: keep in sync with other languages
pub global MAX_TOKENS_OUT_PER_EXECUTION: u32 = 4;

// Note: keep in sync with other languages
pub global GENERATOR_INDEX__WA_ADDRESS: Field = 1;
// Note: keep in sync with other languages
pub global GENERATOR_INDEX__NOTE_NULLIFIER: Field = 2;
// Note: keep in sync with other languages
pub global GENERATOR_INDEX__NOTE_HASH: Field = 3;

// Note: keep in sync with other languages
pub global U256_LIMBS: u32 = 3;

pub type U256 = uint253::U253;

/// User address within the rollup
#[derive(Eq, Serialize)]
pub struct WaAddress {
    inner: Field,
}

impl WaAddress {
    pub fn zero() -> Self {
        Self { inner: 0 }
    }

    pub fn from_secret_key(secret_key: Field) -> Self {
        // TODO(security): wtf is this? Use an actual private/public key cryptography
        let inner = poseidon2_hash_with_separator([secret_key], GENERATOR_INDEX__WA_ADDRESS);
        Self { inner }
    }
}

#[derive(Eq)]
pub struct TokenAmount {
    pub token: crate::EthAddress,
    pub amount: crate::U256,
}

impl TokenAmount {
    pub fn zero(token: crate::EthAddress) -> Self {
        Self { token, amount: U256::zero() }
    }

    fn _check(self, other: Self) {
        assert_eq(self.token, other.token, "invalid token");
    }
}

impl std::ops::Add for TokenAmount {
    fn add(self, other: Self) -> Self {
        self._check(other);
        Self { token: self.token, amount: self.amount + other.amount }
    }
}

impl std::ops::Sub for TokenAmount {
    fn sub(self, other: Self) -> Self {
        self._check(other);
        Self { token: self.token, amount: self.amount - other.amount }
    }
}

impl std::cmp::Ord for TokenAmount {
    fn cmp(self, other: Self) -> std::cmp::Ordering {
        self._check(other);
        self.amount.cmp(other.amount)
    }
}

pub struct TreeRoots {
    pub note_hash_root: Field,
}
