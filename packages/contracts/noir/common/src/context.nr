pub struct Context {
    this_address: crate::EthAddress,
}

impl Context {
    pub fn this_address(self) -> crate::EthAddress {
        self.this_address
    }
}
