pub struct Context {
    this_address: crate::EthAddress,
    pub note_hash_root: Field,
    pub nullifier_root: Field,
}

impl Context {
    pub fn this_address(self) -> crate::EthAddress {
        self.this_address
    }
}
