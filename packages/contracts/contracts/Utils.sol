// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Note: keep in sync with other languages
uint32 constant MAX_TOKENS_IN_PER_EXECUTION = 4;
// Note: keep in sync with other languages
uint32 constant MAX_TOKENS_OUT_PER_EXECUTION = 4;

function castAddressToBytes32(address x) pure returns (bytes32) {
    return bytes32(uint256(uint160(address(x))));
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
    // // TODO: use an auction for the fee amount
    // TokenAmount fee;
}
