// Note: keep in sync with other languages
global MAX_NOTES_TO_JOIN: u32 = 2;

fn main(
    tree_roots: pub common::TreeRoots,
    // params
    from_secret_key: Field,
    notes: [common::NoteConsumptionInputs; MAX_NOTES_TO_JOIN],
    join_randomness: Field,
    // TODO(security): add `to` address
) -> pub common::Result<1, MAX_NOTES_TO_JOIN> {
    let mut context = common::Context::from(tree_roots);

    for note in notes {
        note.consume(&mut context, from_secret_key);
    }

    let token = notes[0].note.amount.token;
    let mut joined_amount = common::TokenAmount { token, amount: common::U256::new() };
    for i in 0..MAX_NOTES_TO_JOIN {
        assert(notes[i].note.is_set(), "invalid note");
        joined_amount += notes[i].note.amount;
    }

    context.push_note_hash(common::Erc20Note {
        owner: notes[0].note.owner,
        amount: joined_amount,
        randomness: join_randomness,
    }
        .hash());

    context.finish()
}
