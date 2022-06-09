// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.7.5;
pragma abicoder v2;

import './IBlazeSwapPluginImpl.sol';

interface IIBlazeSwapPluginImpl is IBlazeSwapPluginImpl {
    function initialize(address plugin) external;
}
