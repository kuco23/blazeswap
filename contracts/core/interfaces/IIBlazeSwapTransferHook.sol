// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.7.5;
pragma abicoder v2;

interface IIBlazeSwapTransferHook {
    function transferCallback(address from, address to, uint256 amount) external;
}
