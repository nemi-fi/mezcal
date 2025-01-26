// Note: keep in sync with other languages
global MAX_NOTES_TO_JOIN: u32 = 2;

struct Result {
    nullifiers: [Field; MAX_NOTES_TO_JOIN],
    join_note_hash: Field,
}

fn main(
    context: pub common::Context,
    // params
    from_secret_key: Field,
    notes: [common::NoteConsumptionInputs; MAX_NOTES_TO_JOIN],
    join_randomness: Field,
) -> pub Result {
    let nullifiers = notes.map(|note| common::consume_owned_note(context, from_secret_key, note));

    let token = notes[0].note.amount.token;
    let mut joined_amount = common::TokenAmount { token, amount: common::U256::new() };
    for i in 0..MAX_NOTES_TO_JOIN {
        assert(notes[i].note.is_set(), "invalid note");
        joined_amount += notes[i].note.amount;
    }

    let join_note_hash = common::Erc20Note {
        owner: notes[0].note.owner,
        amount: joined_amount,
        randomness: join_randomness,
    }
        .inner_hash();

    Result { nullifiers, join_note_hash }
}
