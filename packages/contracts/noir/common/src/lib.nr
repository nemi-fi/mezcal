use protocol_types::hash::poseidon2_hash_with_separator;

mod note;
mod owned_note;
mod value_note;

pub use note::Note;
pub use owned_note::{consume_owned_note, NoteConsumptionInputs, OwnedNote};
pub use value_note::ValueNote;

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
pub global MAX_NULLIFIERS_PER_ROLLUP: u32 = 64; // 2^NULLIFIER_TREE_HEIGHT
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

pub type EthAddress = Field;

/// Walmart Aztec address
pub type WaAddress = Field;

pub fn compute_wa_address(secret_key: Field) -> WaAddress {
    // TODO(security): wtf is this? Use an actual private/public key cryptography
    poseidon2_hash_with_separator([secret_key], GENERATOR_INDEX__WA_ADDRESS)
}
