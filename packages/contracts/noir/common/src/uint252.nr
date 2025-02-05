// Copyright (c) 2025 Clarified Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use std::cmp::{Eq, Ord, Ordering};
use std::ops::{Add, Div, Mul, Rem, Sub};

// Maximum value for U252 (2^252 - 1), chosen to fit within Aztec's field arithmetic bounds
pub global MAX_U252: Field = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

pub global U252_PACKED_LEN: u32 = 1;

pub struct U252 {
    value: Field,
}

impl U252 {
    pub fn new(value: Field) -> Self {
        value.assert_max_bit_size::<252>();
        Self { value }
    }

    pub fn new_unchecked(value: Field) -> Self {
        Self { value }
    }

    pub fn from_integer(value: Field) -> Self {
        value.assert_max_bit_size::<252>();
        Self { value }
    }

    pub fn to_integer(self) -> Field {
        self.value
    }

    pub fn zero() -> Self {
        Self { value: 0 }
    }

    pub fn one() -> Self {
        Self { value: 1 }
    }

    pub fn max() -> Self {
        Self { value: MAX_U252 }
    }

    pub fn is_zero(self) -> bool {
        self.value == 0
    }

    // Performs division with remainder using binary long division algorithm
    // Returns (quotient, remainder) tuple
    pub unconstrained fn div_rem_unconstrained(self, other: Self) -> (Self, Self) {
        assert(!(other.value == 0), "Division by zero");

        self.value.assert_max_bit_size::<252>();
        other.value.assert_max_bit_size::<252>();

        let bits: [u1; 252] = self.value.to_be_bits();
        let divisor = other.value;

        let mut quotient: Field = 0;
        let mut remainder: Field = 0;

        // Process each bit from MSB to LSB, similar to paper-and-pencil division
        for i in 0..252 {
            // Shift remainder left by 1 bit and add next bit
            remainder = remainder * 2 + (bits[i] as Field);

            // Single comparison to determine if we should subtract divisor
            // Changed to just !remainder.lt(divisor) which means remainder >= divisor
            if !remainder.lt(divisor) {
                remainder = remainder - divisor;
                quotient = quotient * 2 + 1;
            } else {
                quotient = quotient * 2;
            }
        }
        (Self { value: quotient }, Self { value: remainder })
    }

    // Performs division with remainder using unconstrained binary long division algorithm, then
    // constrains the result via multiplicative properties
    // Returns (quotient, remainder) tuple
    pub fn div_rem(self, other: Self) -> (Self, Self) {
        assert(!(other.value == 0), "Division by zero");

        if self.value == other.value {
            (Self::one(), Self::zero())
        } else if self.is_zero() {
            (Self::zero(), Self::zero())
        } else if other.value == 1 {
            (self, Self::zero())
        } else if self.value.lt(other.value) {
            (Self::zero(), self)
        } else {
            //Safety: constraining this immediately after by checking the division property
            let (quotient, remainder) = unsafe { self.div_rem_unconstrained(other) };

            // Verify quotient * other + remainder == self
            assert(
                quotient * other + remainder == self,
                "Unconstrained division result is incorrect",
            );

            (quotient, remainder)
        }
    }

    // Adds two U252 values without overflow checks - use with caution
    pub fn add_unchecked(self, other: Self) -> Self {
        Self { value: self.value + other.value }
    }

    // Subtracts two U252 values without underflow checks - use with caution
    pub fn sub_unchecked(self, other: Self) -> Self {
        Self { value: self.value - other.value }
    }
}


impl Add for U252 {
    fn add(self, other: Self) -> Self {
        let result = self.value + other.value;
        result.assert_max_bit_size::<252>();

        assert(!MAX_U252.lt(result), "U252 addition overflow");
        assert(!result.lt(self.value), "U252 addition overflow");
        assert(!result.lt(other.value), "U252 addition overflow");
        Self { value: result }
    }
}

impl Sub for U252 {
    fn sub(self, other: Self) -> Self {
        assert(
            other.value.lt(self.value) | other.value.eq(self.value),
            "U252 subtraction underflow",
        );
        let result = self.value - other.value;
        result.assert_max_bit_size::<252>();
        Self { value: result }
    }
}

impl Mul for U252 {
    fn mul(self, other: Self) -> Self {
        let result = self.value * other.value;

        result.assert_max_bit_size::<252>();
        // Allow multiplication by 1 without additional checks, otherwise check for overflow
        assert(
            (self.value == 1)
                | (other.value == 1)
                | (result.lt(MAX_U252 + 1) & !result.lt(self.value) & !result.lt(other.value)),
            "U252 multiplication overflow",
        );
        Self { value: result }
    }
}

impl Div for U252 {
    fn div(self, other: Self) -> Self {
        let (quotient, _) = self.div_rem(other);
        quotient
    }
}

impl Rem for U252 {
    fn rem(self, other: Self) -> Self {
        let (_, remainder) = self.div_rem(other);
        remainder
    }
}

impl Ord for U252 {
    fn cmp(self, other: Self) -> Ordering {
        if self.value.lt(other.value) {
            Ordering::less()
        } else if self.value.eq(other.value) {
            Ordering::equal()
        } else {
            Ordering::greater()
        }
    }
}

impl Eq for U252 {
    fn eq(self, other: Self) -> bool {
        self.value.eq(other.value)
    }
}
