use bignum::{BigNum, fields::U256::U256Params};
use protocol_types::hash::poseidon2_hash_with_separator;

mod note;
mod owned_note;
mod value_note;

pub use note::{Note, Serialize};
pub use owned_note::{NoteConsumptionInputs, OwnedNote};
pub use value_note::Erc20Note;

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
pub global U256_LIMBS: u32 = 3;

pub type U256 = BigNum<U256_LIMBS, 257, U256Params>;

// TODO(security): use a struct that checks the address
pub type EthAddress = Field;

/// Walmart Aztec address
// TODO(security): use a struct that checks the address
pub type WaAddress = Field;

pub fn compute_wa_address(secret_key: Field) -> WaAddress {
    // TODO(security): wtf is this? Use an actual private/public key cryptography
    poseidon2_hash_with_separator([secret_key], GENERATOR_INDEX__WA_ADDRESS)
}

#[derive(Eq)]
pub struct TokenAmount {
    pub token: crate::EthAddress,
    pub amount: crate::U256,
}

impl TokenAmount {
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

pub struct TreeRoots {
    pub note_hash_root: Field,
    pub nullifier_root: Field,
}

pub struct Context {
    tree_roots: TreeRoots,
    note_hashes: [Field],
    nullifiers: [Field],
}

impl std::convert::From<TreeRoots> for Context {
    fn from(tree_roots: TreeRoots) -> Self {
        Self { tree_roots, note_hashes: [], nullifiers: [] }
    }
}

impl Context {
    pub fn push_note_hash(&mut self, note_hash: Field) {
        self.note_hashes = self.note_hashes.push_back(note_hash);
    }

    pub fn push_nullifier(&mut self, nullifier: Field) {
        self.nullifiers = self.nullifiers.push_back(nullifier);
    }

    pub fn finish<let NH_LEN: u32, let N_LEN: u32>(self) -> Result<NH_LEN, N_LEN> {
        Result {
            note_hashes: slice_to_exact_array(self.note_hashes),
            nullifiers: slice_to_exact_array(self.nullifiers),
        }
    }
}

pub struct Result<let NH_LEN: u32, let N_LEN: u32> {
    pub note_hashes: [Field; NH_LEN],
    pub nullifiers: [Field; N_LEN],
}

fn slice_to_exact_array<T, let N: u32>(x: [T]) -> [T; N] {
    if x.len() != N {
        let l = x.len();
        panic(
            f"failed to convert slice of length {l} to exact array of length {N}",
        );
    }
    x.as_array()
}
