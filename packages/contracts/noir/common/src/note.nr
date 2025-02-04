pub trait Note {
    fn hash(self) -> Field;
}

pub trait Serialize<let N: u32> {
    fn serialize(self) -> [Field; N];
}
