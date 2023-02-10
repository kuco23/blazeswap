// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './interfaces/flare/IFlareAssetRegistry.sol';
import './interfaces/flare/IFtsoRewardManager.sol';
import './interfaces/IBlazeSwapManager.sol';
import './interfaces/IBlazeSwapPlugin.sol';
import './interfaces/Enumerations.sol';
import './libraries/BlazeSwapFlareLibrary.sol';
import './BlazeSwapBaseManager.sol';
import './BlazeSwapExecutorManager.sol';

contract BlazeSwapManager is IBlazeSwapManager, BlazeSwapBaseManager {
    address public rewardsFeeTo;

    uint256 public ftsoRewardsFeeBips;
    uint256 public flareAssetRewardsFeeBips;
    uint256 public airdropFeeBips;

    address public immutable wNat;
    address public immutable executorManager;

    IFtsoRewardManager[] private ftsoRewardManagers;

    address public flareAssetRegistry;

    bool public allowFlareAssetPairsWithoutPlugin;

    address public delegationPlugin;
    address public ftsoRewardPlugin;
    address public flareAssetRewardPlugin;
    address public airdropPlugin;

    constructor(address _configSetter) BlazeSwapBaseManager(_configSetter) {
        executorManager = address(new BlazeSwapExecutorManager());
        IFtsoRewardManager ftsoRewardManager = BlazeSwapFlareLibrary.getFtsoRewardManager(
            BlazeSwapFlareLibrary.getFtsoManager()
        );
        wNat = ftsoRewardManager.wNat();
        ftsoRewardManagers.push(ftsoRewardManager);
        emit AddFtsoRewardManager(address(ftsoRewardManager));
    }

    function getMissingFtsoRewardManagersUpTo(
        IFtsoRewardManager current,
        IFtsoRewardManager lastSaved,
        uint256 upTo
    ) private view returns (IFtsoRewardManager[] memory extra) {
        extra = new IFtsoRewardManager[](upTo + 1);
        uint256 count;
        extra[count] = current;
        do {
            count++;
            require(count <= upTo, 'BlazeSwap: FTSO_REWARD_MANAGERS');
            extra[count] = IFtsoRewardManager(extra[count - 1].oldFtsoRewardManager());
        } while (extra[count] != lastSaved && address(extra[count]) != address(0));
        uint256 toDrop = extra.length - count;
        if (toDrop > 0) {
            assembly {
                // reduce array length
                mstore(extra, sub(mload(extra), toDrop))
            }
        }
    }

    function updateFtsoRewardManagers(uint256 upTo) external {
        IFtsoRewardManager lastSaved = ftsoRewardManagers[ftsoRewardManagers.length - 1];
        IFtsoRewardManager current = BlazeSwapFlareLibrary.getFtsoRewardManager(BlazeSwapFlareLibrary.getFtsoManager());
        if (current != lastSaved) {
            IFtsoRewardManager[] memory extra = getMissingFtsoRewardManagersUpTo(current, lastSaved, upTo);
            for (uint256 i = extra.length; i > 0; i--) {
                IFtsoRewardManager ftsoRewardManager = extra[i - 1];
                ftsoRewardManagers.push(ftsoRewardManager);
                emit AddFtsoRewardManager(address(ftsoRewardManager));
            }
        }
    }

    function getFtsoRewardManagers() public view returns (IFtsoRewardManager[] memory managers) {
        IFtsoRewardManager lastSaved = ftsoRewardManagers[ftsoRewardManagers.length - 1];
        IFtsoRewardManager current = BlazeSwapFlareLibrary.getFtsoRewardManager(BlazeSwapFlareLibrary.getFtsoManager());
        if (current == lastSaved) {
            // no changes
            managers = ftsoRewardManagers;
        } else {
            // new ftso reward manager(s), handle up to 2 new
            IFtsoRewardManager[] memory extra = getMissingFtsoRewardManagersUpTo(current, lastSaved, 2);
            uint256 previousLen = ftsoRewardManagers.length;
            uint256 extraLen = extra.length;
            managers = new IFtsoRewardManager[](previousLen + extraLen);
            for (uint256 i; i < previousLen; i++) {
                managers[i] = ftsoRewardManagers[i];
            }
            for (uint256 i; i < extraLen; i++) {
                managers[previousLen + i] = extra[extraLen - i - 1];
            }
        }
    }

    function getActiveFtsoRewardManagers() external view returns (IFtsoRewardManager[] memory managers) {
        IFtsoRewardManager[] memory allManagers = getFtsoRewardManagers();
        bool[] memory enabledStatus = new bool[](allManagers.length);
        uint256 disabledCount;
        for (uint256 i; i < allManagers.length; i++) {
            bool active = allManagers[i].active();
            if (active) {
                enabledStatus[i] = true;
            } else {
                disabledCount++;
            }
        }
        if (disabledCount == 0) {
            managers = allManagers;
        } else {
            managers = new IFtsoRewardManager[](allManagers.length - disabledCount);
            uint256 j;
            for (uint256 i; i < allManagers.length; i++) {
                if (enabledStatus[i]) {
                    managers[j++] = allManagers[i];
                }
            }
        }
    }

    function setRewardsFeeTo(address _rewardsFeeTo) external onlyConfigSetter {
        rewardsFeeTo = _rewardsFeeTo;
    }

    function setFtsoRewardsFeeBips(uint256 _bips) external onlyConfigSetter {
        require(_bips <= 5_00, 'BlazeSwap: INVALID_FEE');
        ftsoRewardsFeeBips = _bips;
    }

    function setFlareAssetRewardsFeeBips(uint256 _bips) external onlyConfigSetter {
        require(_bips <= 5_00, 'BlazeSwap: INVALID_FEE');
        flareAssetRewardsFeeBips = _bips;
    }

    function setAirdropFeeBips(uint256 _bips) external onlyConfigSetter {
        require(_bips <= 5_00, 'BlazeSwap: INVALID_FEE');
        airdropFeeBips = _bips;
    }

    function revertAlreadySet() internal pure {
        revert('BlazeSwap: ALREADY_SET');
    }

    function setDelegationPlugin(address _delegationPlugin) external onlyConfigSetter {
        if (delegationPlugin != address(0)) revertAlreadySet();
        address impl = IBlazeSwapPlugin(_delegationPlugin).implementation();
        require(impl != address(0), 'BlazeSwap: INVALID_PLUGIN');
        delegationPlugin = _delegationPlugin;
    }

    function setFtsoRewardPlugin(address _ftsoRewardPlugin) external onlyConfigSetter {
        if (ftsoRewardPlugin != address(0)) revertAlreadySet();
        address impl = IBlazeSwapPlugin(_ftsoRewardPlugin).implementation();
        require(impl != address(0), 'BlazeSwap: INVALID_PLUGIN');
        ftsoRewardPlugin = _ftsoRewardPlugin;
    }

    function setAirdropPlugin(address _airdropPlugin) external onlyConfigSetter {
        if (airdropPlugin != address(0)) revertAlreadySet();
        address impl = IBlazeSwapPlugin(_airdropPlugin).implementation();
        require(impl != address(0), 'BlazeSwap: INVALID_PLUGIN');
        airdropPlugin = _airdropPlugin;
    }

    function isFlareAsset(address token) private view returns (bool) {
        return flareAssetRegistry != address(0) && IFlareAssetRegistry(flareAssetRegistry).isFlareAsset(token);
    }

    function isWNat(address token) private view returns (bool) {
        return token == wNat;
    }

    function getTokenType(address token) external view returns (TokenType tokenType) {
        if (isWNat(token)) tokenType = TokenType.WNat;
        else if (isFlareAsset(token)) tokenType = TokenType.FlareAsset;
        else tokenType = TokenType.Generic;
    }

    function setFlareAssetRegistry(address _flareAssetRegistry) external onlyConfigSetter {
        flareAssetRegistry = _flareAssetRegistry;
    }

    function setAllowFlareAssetPairsWithoutPlugin(bool _allowFlareAssetPairsWithoutPlugin) external onlyConfigSetter {
        allowFlareAssetPairsWithoutPlugin = _allowFlareAssetPairsWithoutPlugin;
    }

    function setFlareAssetsRewardPlugin(address _flareAssetRewardPlugin) external onlyConfigSetter {
        if (flareAssetRewardPlugin != address(0)) revertAlreadySet();
        address impl = IBlazeSwapPlugin(_flareAssetRewardPlugin).implementation();
        require(impl != address(0), 'BlazeSwap: INVALID_PLUGIN');
        flareAssetRewardPlugin = _flareAssetRewardPlugin;
        allowFlareAssetPairsWithoutPlugin = false;
    }

    function flareAssetSupport() external view returns (FlareAssetSupport) {
        if (flareAssetRegistry == address(0)) return FlareAssetSupport.None;
        if (flareAssetRewardPlugin != address(0)) return FlareAssetSupport.Full;
        return allowFlareAssetPairsWithoutPlugin ? FlareAssetSupport.Minimal : FlareAssetSupport.None;
    }
}
