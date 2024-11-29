use crate::{EthAddress, WaAddress};

pub struct ValueNote {
    pub owner: WaAddress,
    pub token: EthAddress,
    // TODO(security): use U128 for value? Requires changing serialization logic
    pub value: u64,
    pub randomness: Field,
}

impl ValueNote {
    // TODO: move to OwnedNote?
    pub fn is_set(self) -> bool {
        self.owner != 0
    }
}

impl crate::Note<4> for ValueNote {
    fn serialize(self) -> [Field; 4] {
        [self.owner, self.token, self.value as Field, self.randomness]
    }

    fn hash(self) -> Field {
        let serialized = self.serialize();
        std::hash::poseidon2::Poseidon2::hash(serialized, serialized.len())
    }
}

impl crate::OwnedNote for ValueNote {
    fn owner(self) -> WaAddress {
        self.owner
    }
}
