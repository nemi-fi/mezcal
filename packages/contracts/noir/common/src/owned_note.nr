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
        // TODO(security): should this inner_nullifier nullify the inner_note_hash or siloed_note_hash?
        [note.inner_hash(), secret_key],
        crate::GENERATOR_INDEX__NOTE_NULLIFIER,
    )
}

pub struct NoteConsumptionInputs {
    pub note: crate::Erc20Note,
    pub note_index: Field,
    pub note_sibling_path: [Field; crate::NOTE_HASH_TREE_HEIGHT],
    pub nullifier_low_leaf_preimage: NullifierLeafPreimage,
    pub nullifier_low_leaf_membership_witness: merkle_tree::MembershipWitness<crate::NOTE_HASH_TREE_HEIGHT>,
}

// TODO: generalize for any Note/OwnedNote
pub fn consume_owned_note(
    context: crate::Context,
    secret_key: Field,
    inputs: NoteConsumptionInputs,
) -> Field {
    merkle_tree::assert_check_membership(
        inputs.note.siloed_hash(context),
        inputs.note_index,
        inputs.note_sibling_path,
        context.note_hash_root,
    );
    let nullifier = compute_nullifier_of_owned_note(inputs.note, secret_key);
    merkle_tree::assert_check_non_membership(
        crate::NullifierToSilo {
            silo_contract_address: context.this_address(),
            inner_nullifier: nullifier,
        }
            .siloed(),
        inputs.nullifier_low_leaf_preimage,
        inputs.nullifier_low_leaf_membership_witness,
        context.nullifier_root,
    );
    nullifier
}
