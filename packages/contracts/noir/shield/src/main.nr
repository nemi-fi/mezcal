use common::{EthAddress, WaAddress};

fn main(
    owner: WaAddress,
    token: pub EthAddress,
    value: pub u64,
    randomness: Field,
    note_hash: pub Field,
) {
    let note = common::ValueNote { owner, token, value, randomness };
    assert(note.hash() == note_hash, "invalid note hash");
}
