pub trait Note<let N: u32> {
    fn serialize(self) -> [Field; N];

    fn hash(self) -> Field;
}
