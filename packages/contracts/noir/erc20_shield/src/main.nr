use common::WaAddress;

fn main(
    owner: WaAddress,
    amount: pub common::TokenAmount,
    randomness: Field,
    note_hash: pub Field,
) {
    let note = common::Erc20Note { owner, amount, randomness };
    assert(note.hash() == note_hash, "invalid note hash");
}
