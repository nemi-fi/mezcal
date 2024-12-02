use common::{EthAddress, WaAddress};

fn main(
    owner: WaAddress,
    token: pub EthAddress,
    value: pub common::U256,
    randomness: Field,
    note_hash: pub Field,
) {
    let note = common::Erc20Note { owner, token, value, randomness };
    assert(note.hash() == note_hash, "invalid note hash");
}
