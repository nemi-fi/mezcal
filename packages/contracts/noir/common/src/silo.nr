use protocol_types::hash::poseidon2_hash_with_separator;

pub struct NoteHashToSilo {
    pub silo_contract_address: crate::EthAddress,
    pub inner_note_hash: Field,
}

impl NoteHashToSilo {
    pub fn siloed(self) -> Field {
        if self.silo_contract_address == 0 {
            0
        } else {
            poseidon2_hash_with_separator(
                [self.silo_contract_address, self.inner_note_hash],
                crate::GENERATOR_INDEX__NOTE_HASH_SILO,
            )
        }
    }
}

pub struct NullifierToSilo {
    pub silo_contract_address: crate::EthAddress,
    pub inner_nullifier: Field,
}

impl NullifierToSilo {
    pub fn siloed(self) -> Field {
        if self.silo_contract_address == 0 {
            0
        } else {
            poseidon2_hash_with_separator(
                [self.silo_contract_address, self.inner_nullifier],
                crate::GENERATOR_INDEX__NULLIFIER_SILO,
            )
        }
    }
}
