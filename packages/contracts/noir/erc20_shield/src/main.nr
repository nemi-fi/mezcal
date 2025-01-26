use common::WaAddress;

fn main(
    owner: WaAddress,
    amount: pub common::TokenAmount,
    randomness: Field,
    inner_note_hash: pub Field,
) {
    let note = common::Erc20Note { owner, amount, randomness };
    assert(note.inner_hash() == inner_note_hash, "invalid inner note hash");
}
