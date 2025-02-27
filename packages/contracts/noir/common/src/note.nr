use protocol_types::hash::poseidon2_hash_with_separator;

/// A marker trait to mark structs as notes
pub trait Note: crate::Serialize<_> {

    fn emit(self, context: &mut crate::Context) {
        context.push_note_hash(crate::compute_note_hash(self));
    }
}

pub fn compute_note_hash<T>(note: T) -> Field
where
    T: Note,
{
    let serialized = note.serialize();
    // TODO(security): add note type to the hash (erc20, erc721, etc.)
    poseidon2_hash_with_separator(serialized, crate::GENERATOR_INDEX__NOTE_HASH)
}
