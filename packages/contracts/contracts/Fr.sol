// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

// TODO(security): use Fr from generated solidity verifiers
type Fr is bytes32;

library FrLib {
    // TODO: rename to `from`
    function create(bytes32 value) internal pure returns (Fr ret) {
        require(
            value <
                0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001,
            "field value out of range"
        );

        assembly {
            ret := value
        }
    }

    function toBytes32(Fr self) internal pure returns (bytes32 ret) {
        assembly {
            ret := self
        }
    }
}

function keccak256ToFr(bytes memory data) pure returns (Fr) {
    return
        FrLib.create(
            bytes32(bytes.concat(bytes1(0), bytes31(keccak256(data))))
        );
}
