use crate::WaAddress;
use protocol_types::{
    abis::nullifier_leaf_preimage::NullifierLeafPreimage, hash::poseidon2_hash_with_separator,
    merkle_tree,
};

pub trait OwnedNote {
    fn owner(self) -> WaAddress;
}

pub fn compute_nullifier_of_owned_note<T, let N: u32>(note: T, secret_key: Field) -> Field
where
    T: OwnedNote + crate::Note<N>,
{
    assert_eq(note.owner(), crate::compute_wa_address(secret_key), "invalid secret key");
    poseidon2_hash_with_separator(
        [note.hash(), secret_key],
        crate::GENERATOR_INDEX__NOTE_NULLIFIER,
    )
}

pub struct NoteConsumptionInputs {
    pub note: crate::ValueNote,
    pub note_index: Field,
    pub note_sibling_path: [Field; crate::NOTE_HASH_TREE_HEIGHT],
    pub nullifier_low_leaf_preimage: NullifierLeafPreimage,
    pub nullifier_low_leaf_membership_witness: merkle_tree::MembershipWitness<crate::NOTE_HASH_TREE_HEIGHT>,
}

// TODO: generalize for any Note/OwnedNote
pub fn consume_owned_note(
    note_hash_tree_root: Field,
    nullifier_tree_root: Field,
    secret_key: Field,
    inputs: NoteConsumptionInputs,
) -> Field {
    merkle_tree::assert_check_membership(
        inputs.note.hash(),
        inputs.note_index,
        inputs.note_sibling_path,
        note_hash_tree_root,
    );
    let nullifier = compute_nullifier_of_owned_note(inputs.note, secret_key);
    merkle_tree::assert_check_non_membership(
        nullifier,
        inputs.nullifier_low_leaf_preimage,
        inputs.nullifier_low_leaf_membership_witness,
        nullifier_tree_root,
    );
    nullifier
}
