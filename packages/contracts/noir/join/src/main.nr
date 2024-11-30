// Note: keep in sync with other languages
global MAX_NOTES_TO_JOIN: u32 = 2;

struct Result {
    nullifiers: [Field; MAX_NOTES_TO_JOIN],
    join_note_hash: Field,
}

fn main(
    // trees
    note_hash_tree_root: pub Field,
    nullifier_tree_root: pub Field,
    // params
    from_secret_key: Field,
    notes: [common::NoteConsumptionInputs; MAX_NOTES_TO_JOIN],
    join_randomness: Field,
) -> pub Result {
    let nullifiers = notes.map(|note| {
        common::consume_owned_note(
            note_hash_tree_root,
            nullifier_tree_root,
            from_secret_key,
            note,
        )
    });

    let token = notes[0].note.token;
    let mut joined_value = 0;
    for i in 0..MAX_NOTES_TO_JOIN {
        assert(notes[i].note.is_set(), "invalid note");
        assert_eq(notes[i].note.token, token, "invalid token");
        joined_value += notes[i].note.value;
    }

    let join_note_hash = common::ValueNote {
        owner: notes[0].note.owner,
        token,
        value: joined_value,
        randomness: join_randomness,
    }
        .hash();

    Result { nullifiers, join_note_hash }
}
