// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console} from "hardhat/console.sol";

// Note: keep in sync with other languages
uint32 constant MAX_TOKENS_IN_PER_EXECUTION = 4;
// Note: keep in sync with other languages
uint32 constant MAX_TOKENS_OUT_PER_EXECUTION = 4;

uint256 constant U256_LIMBS = 3;
uint256 constant U256_LIMB_SIZE = 120;

function toNoirU256(uint256 value) pure returns (uint256[U256_LIMBS] memory) {
    uint256[U256_LIMBS] memory limbs;
    uint256 mask = (1 << U256_LIMB_SIZE) - 1;
    for (uint256 i = 0; i < limbs.length; i++) {
        limbs[i] = (value / (1 << (i * U256_LIMB_SIZE))) & mask;
    }
    return limbs;
}

function castAddressToBytes32(address x) pure returns (bytes32) {
    return bytes32(uint256(uint160(address(x))));
}

struct NoteInput {
    bytes32 noteHash;
    bytes encryptedNote;
}

struct Call {
    address to;
    bytes data;
    // TODO: support ETH
    // uint256 value;
}

struct TokenAmount {
    IERC20 token;
    uint256 amount;
}

struct Execution {
    Call[] calls;
    TokenAmount[MAX_TOKENS_IN_PER_EXECUTION] amountsIn;
    TokenAmount[MAX_TOKENS_OUT_PER_EXECUTION] amountsOut;
}

library PublicInputs {
    struct Type {
        bytes32[] publicInputs;
        uint256 index;
    }

    function create(uint256 len) internal pure returns (Type memory) {
        Type memory publicInputs;
        publicInputs.publicInputs = new bytes32[](len);
        return publicInputs;
    }

    function push(Type memory publicInputs, bytes32 value) internal pure {
        publicInputs.publicInputs[publicInputs.index] = value;
        unchecked {
            publicInputs.index++;
        }
    }

    function push(Type memory publicInputs, uint256 value) internal pure {
        push(publicInputs, bytes32(value));
    }

    function push(Type memory publicInputs, address value) internal pure {
        push(publicInputs, castAddressToBytes32(value));
    }

    function pushUint256Limbs(
        Type memory publicInputs,
        uint256 value
    ) internal pure {
        uint256[U256_LIMBS] memory limbs = toNoirU256(value);
        for (uint256 i = 0; i < limbs.length; i++) {
            push(publicInputs, limbs[i]);
        }
    }

    function finish(
        Type memory publicInputs
    ) internal pure returns (bytes32[] memory) {
        require(
            publicInputs.index == publicInputs.publicInputs.length,
            "Did not fill all public inputs"
        );
        return publicInputs.publicInputs;
    }

    function print(Type memory pi) internal pure {
        bytes32[] memory publicInputs = PublicInputs.finish(pi);
        console.log("publicInputs sol", publicInputs.length);
        for (uint256 i = 0; i < publicInputs.length; i++) {
            console.logBytes32(publicInputs[i]);
        }
        console.log();
    }
}
