use protocol_types::{
    abis::nullifier_leaf_preimage::NullifierLeafPreimage, hash::poseidon2_hash_with_separator,
    merkle_tree,
};

pub trait OwnedNote {
    fn owner(self) -> crate::WaAddress;
}

fn compute_nullifier_of_owned_note<T>(note: T, secret_key: Field) -> Field
where
    T: OwnedNote + crate::Note,
{
    assert_eq(note.owner(), crate::compute_wa_address(secret_key), "invalid secret key");
    poseidon2_hash_with_separator(
        [note.hash(), secret_key],
        crate::GENERATOR_INDEX__NOTE_NULLIFIER,
    )
}

pub struct NoteConsumptionInputs {
    // TODO: generalize for any Note/OwnedNote
    pub note: crate::Erc20Note,
    pub note_index: Field,
    pub note_sibling_path: [Field; crate::NOTE_HASH_TREE_HEIGHT],
    pub nullifier_low_leaf_preimage: NullifierLeafPreimage,
    pub nullifier_low_leaf_membership_witness: merkle_tree::MembershipWitness<crate::NOTE_HASH_TREE_HEIGHT>,
}

impl NoteConsumptionInputs {
    pub fn consume(self, context: &mut crate::Context, secret_key: Field) {
        merkle_tree::assert_check_membership(
            self.note.hash(),
            self.note_index,
            self.note_sibling_path,
            context.tree_roots.note_hash_root,
        );
        let nullifier = compute_nullifier_of_owned_note(self.note, secret_key);
        merkle_tree::assert_check_non_membership(
            nullifier,
            self.nullifier_low_leaf_preimage,
            self.nullifier_low_leaf_membership_witness,
            context.tree_roots.nullifier_root,
        );
        context.push_nullifier(nullifier);
    }
}
