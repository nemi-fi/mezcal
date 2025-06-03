use protocol_types::{hash::poseidon2_hash_with_separator, merkle_tree};

pub trait OwnedNote: crate::Note {
    fn owner(self) -> crate::WaAddress;
}

fn compute_nullifier_of_owned_note<T>(note: T, secret_key: Field) -> Field
where
    T: OwnedNote,
{
    // TODO(perf): pass note hash as an argument to avoid hashing twice?
    assert_eq(note.owner(), crate::WaAddress::from_secret_key(secret_key), "invalid secret key");
    poseidon2_hash_with_separator(
        [crate::compute_note_hash(note), secret_key],
        crate::GENERATOR_INDEX__NOTE_NULLIFIER,
    )
}

pub struct NoteConsumptionInputs<T> {
    pub note: T,
    pub note_index: Field,
    pub note_sibling_path: [Field; crate::NOTE_HASH_TREE_HEIGHT],
}

impl<T> NoteConsumptionInputs<T>
where
    T: OwnedNote,
{
    pub fn consume(self, context: &mut crate::Context, secret_key: Field) {
        merkle_tree::assert_check_membership(
            crate::compute_note_hash(self.note),
            self.note_index,
            self.note_sibling_path,
            context.tree_roots().note_hash_root,
        );
        let nullifier = compute_nullifier_of_owned_note(self.note, secret_key);
        context.push_nullifier(nullifier);
    }
}
