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
        (self.owner != 0) & (self.token != 0)
    }

    pub fn consume_and_sub(
        note_consumption: crate::NoteConsumptionInputs,
        amount: crate::TokenAmount,
        randomness: Field,
        tree_roots: crate::TreeRoots,
        secret_key: Field,
    ) -> (Field, Self) {
        assert_eq(note_consumption.note.token, amount.token, "invalid token");
        let nullifier = crate::consume_owned_note(tree_roots, secret_key, note_consumption);
        let change_note = Self {
            owner: note_consumption.note.owner,
            token: note_consumption.note.token,
            value: note_consumption.note.value - amount.amount,
            randomness,
        };
        (nullifier, change_note)
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
