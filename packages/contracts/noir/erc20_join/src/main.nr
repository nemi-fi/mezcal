// Note: keep in sync with other languages
global MAX_NOTES_TO_JOIN: u32 = 2;

fn main(
    tree_roots: pub common::TreeRoots,
    // params
    from_secret_key: Field,
    notes: [common::NoteConsumptionInputs; MAX_NOTES_TO_JOIN],
    to: common::WaAddress,
    join_randomness: Field,
) -> pub common::Result<1, MAX_NOTES_TO_JOIN> {
    let mut context = common::Context::from(tree_roots);

    for note in notes {
        note.consume(&mut context, from_secret_key);
    }

    let mut joined_amount = common::TokenAmount::zero(notes[0].note.amount.token);
    for i in 0..MAX_NOTES_TO_JOIN {
        assert(notes[i].note.is_set(), "invalid note");
        joined_amount += notes[i].note.amount;
    }

    let to_note =
        common::Erc20Note { owner: to, amount: joined_amount, randomness: join_randomness };
    context.push_note_hash(to_note.hash());

    context.finish()
}
