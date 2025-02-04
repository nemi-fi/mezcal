pub struct Context {
    tree_roots: crate::TreeRoots,
    note_hashes: [Field],
    nullifiers: [Field],
}

impl std::convert::From<crate::TreeRoots> for Context {
    fn from(tree_roots: crate::TreeRoots) -> Self {
        Self { tree_roots, note_hashes: [], nullifiers: [] }
    }
}

impl Context {
    pub fn push_note_hash(&mut self, note_hash: Field) {
        self.note_hashes = self.note_hashes.push_back(note_hash);
    }

    pub fn push_nullifier(&mut self, nullifier: Field) {
        self.nullifiers = self.nullifiers.push_back(nullifier);
    }

    pub fn tree_roots(self) -> crate::TreeRoots {
        self.tree_roots
    }

    pub fn finish<let NH_LEN: u32, let N_LEN: u32>(self) -> Result<NH_LEN, N_LEN> {
        Result {
            note_hashes: slice_to_exact_array(self.note_hashes),
            nullifiers: slice_to_exact_array(self.nullifiers),
        }
    }
}

pub struct Result<let NH_LEN: u32, let N_LEN: u32> {
    pub note_hashes: [Field; NH_LEN],
    pub nullifiers: [Field; N_LEN],
}

fn slice_to_exact_array<T, let N: u32>(x: [T]) -> [T; N] {
    if x.len() != N {
        let l = x.len();
        panic(
            f"failed to convert slice of length {l} to exact array of length {N}",
        );
    }
    x.as_array()
}
