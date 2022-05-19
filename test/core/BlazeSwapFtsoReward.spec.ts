import { waffle } from 'hardhat'
import { expect } from 'chai'
import { BigNumber, constants, Wallet } from 'ethers'

import { pairWNatFixture } from './shared/fixtures'
import { expandTo18Decimals, getRewardManagerAddress, MINIMUM_LIQUIDITY } from './shared/utilities'

import BlazeSwapRewardManager from '../../artifacts/contracts/core/BlazeSwapRewardManager.sol/BlazeSwapRewardManager.json'
import BlazeSwapFtsoReward from '../../artifacts/contracts/core/BlazeSwapFtsoReward.sol/BlazeSwapFtsoReward.json'

import Coder from 'abi-coder'
import {
  IBlazeSwapDelegation,
  IBlazeSwapDelegation__factory,
  IBlazeSwapFtsoReward,
  IBlazeSwapFtsoReward__factory,
  IBlazeSwapManager,
  IBlazeSwapPair,
  IBlazeSwapPlugin__factory,
  IERC20,
  FtsoManager,
  FtsoRewardManager,
  IIBlazeSwapPluginImpl__factory,
  IWNat,
} from '../../typechain-types'

const { createFixtureLoader } = waffle

describe('BlazeSwapFtsoReward', () => {
  const provider = waffle.provider
  const [wallet, other] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let manager: IBlazeSwapManager
  let ftsoManager: FtsoManager
  let ftsoRewardManager: FtsoRewardManager
  let wNat: IWNat
  let token0: IERC20
  let token1: IERC20
  let pair: IBlazeSwapPair
  let delegation: IBlazeSwapDelegation
  let ftsoReward: IBlazeSwapFtsoReward
  beforeEach(async () => {
    const fixture = await loadFixture(pairWNatFixture)
    manager = fixture.manager
    ftsoManager = fixture.ftsoManager
    ftsoRewardManager = fixture.ftsoRewardManager
    wNat = fixture.wNat
    token0 = fixture.token0
    token1 = fixture.token1
    pair = fixture.pair
    delegation = IBlazeSwapDelegation__factory.connect(pair.address, wallet)
    ftsoReward = IBlazeSwapFtsoReward__factory.connect(pair.address, wallet)
  })

  async function addLiquidity(minter: Wallet, tokenAmount: BigNumber, wNatAmount: BigNumber) {
    await token0.transfer(pair.address, wNat.address == token0.address ? wNatAmount : tokenAmount)
    await token1.transfer(pair.address, wNat.address == token1.address ? wNatAmount : tokenAmount)
    const minterPair = pair.connect(minter)
    await minterPair.mint(minter.address)
  }

  async function removeLiquidity(minter: Wallet, amount: BigNumber) {
    const minterPair = pair.connect(minter)
    await minterPair.transfer(pair.address, amount)
    await minterPair.burn(minter.address)
  }

  function applyFee(amount: BigNumber) {
    return amount.mul(981).div(1000)
  }

  it('initialize:forbiddenDelegated', async () => {
    await expect(
      IIBlazeSwapPluginImpl__factory.connect(pair.address, wallet).initialize(constants.AddressZero)
    ).to.be.revertedWith('BlazeSwap: INVALID_FUNCTION')
  })

  it('initialize:forbiddenDirect', async () => {
    const plugin = IBlazeSwapPlugin__factory.connect(await manager.ftsoRewardPlugin(), wallet)
    const impl = await plugin.implementation()
    const directFtsoReward = IIBlazeSwapPluginImpl__factory.connect(impl, wallet)
    await expect(directFtsoReward.initialize(constants.AddressZero)).to.be.revertedWith('DelegatedCalls: standard call')
  })

  it('accruingFtsoRewards', async () => {
    await addLiquidity(wallet, expandTo18Decimals(2), expandTo18Decimals(8))
    await addLiquidity(other, expandTo18Decimals(1), expandTo18Decimals(4))
    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    expect(await ftsoReward.accruingFtsoRewards(constants.AddressZero)).to.eq(0)
    expect(await ftsoReward.accruingFtsoRewards(other.address)).to.eq(0)
    await ftsoRewardManager.addRewards(pair.address, 1, 1000)
    const expectedRewards = expandTo18Decimals(8 + 4).div(10)
    expect(await ftsoReward.accruingFtsoRewards(constants.AddressZero)).to.eq(expectedRewards)
    expect(await ftsoReward.accruingFtsoRewards(other.address)).to.eq(expectedRewards.div(3))
    await manager.setRewardsFeeOn(true)
    expect(await ftsoReward.accruingFtsoRewards(constants.AddressZero)).to.eq(applyFee(expectedRewards))
    expect(await ftsoReward.accruingFtsoRewards(other.address)).to.eq(applyFee(expectedRewards).div(3))
  })

  it('epochsWithUndistributedFtsoRewards', async () => {
    await addLiquidity(wallet, expandTo18Decimals(2), expandTo18Decimals(8))
    await addLiquidity(other, expandTo18Decimals(1), expandTo18Decimals(4))
    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 1000)
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 2, 500)
    await ftsoManager.addRewardEpoch(3, (await provider.getBlock('latest')).number)

    let [epochs, amounts] = await ftsoReward.epochsWithUndistributedFtsoRewards(constants.AddressZero)
    expect(epochs).to.deep.eq([BigNumber.from('1'), BigNumber.from('2')])
    expect(amounts).to.deep.eq([expandTo18Decimals(8 + 4).div(10), expandTo18Decimals(8 + 4).div(20)])
    ;[epochs, amounts] = await ftsoReward.epochsWithUndistributedFtsoRewards(other.address)
    expect(epochs).to.deep.eq([BigNumber.from('1'), BigNumber.from('2')])
    expect(amounts).to.deep.eq([
      expandTo18Decimals(8 + 4)
        .div(10)
        .div(3),
      expandTo18Decimals(8 + 4)
        .div(20)
        .div(3),
    ])

    await manager.setRewardsFeeOn(true)
    ;[epochs, amounts] = await ftsoReward.epochsWithUndistributedFtsoRewards(constants.AddressZero)
    expect(epochs).to.deep.eq([BigNumber.from('1'), BigNumber.from('2')])
    expect(amounts).to.deep.eq([
      applyFee(expandTo18Decimals(8 + 4).div(10)),
      applyFee(expandTo18Decimals(8 + 4).div(20)),
    ])
    ;[epochs, amounts] = await ftsoReward.epochsWithUndistributedFtsoRewards(other.address)
    expect(epochs).to.deep.eq([BigNumber.from('1'), BigNumber.from('2')])
    expect(amounts).to.deep.eq([
      applyFee(
        expandTo18Decimals(8 + 4)
          .div(10)
          .div(3)
      ),
      applyFee(
        expandTo18Decimals(8 + 4)
          .div(20)
          .div(3)
      ),
    ])
  })

  it('distributeFtsoRewards', async () => {
    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    const wNatAmount = expandTo18Decimals(1000)
    await wNat.transfer(pair.address, wNatAmount)
    await ftsoRewardManager.addRewards(pair.address, 1, 1000)

    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 2, 100)
    expect(await ftsoRewardManager.getEpochsWithUnclaimedRewards(pair.address)).to.deep.eq([])

    await ftsoManager.addRewardEpoch(3, (await provider.getBlock('latest')).number)
    expect(await ftsoRewardManager.getEpochsWithUnclaimedRewards(pair.address)).to.deep.eq([BigNumber.from('2')])

    const expectedRewards = expandTo18Decimals(1000 / 100) // 10

    const bytecode = BlazeSwapRewardManager.bytecode
    const rewardManagerAddress = getRewardManagerAddress(pair.address, bytecode)

    await expect(ftsoReward.distributeFtsoRewards([2]))
      .to.emit(ftsoReward, 'FtsoRewardsDistributed')
      .withArgs(BigNumber.from('2'), expectedRewards, wallet.address)

    expect(await wNat.balanceOf(rewardManagerAddress)).to.eq(expectedRewards)
  })

  it('claimFtsoRewards:native', async () => {
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(1))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 100)
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1])

    const expectedRewards = expandTo18Decimals(1).div(100)
    const expectedWalletRewards = expectedRewards
      .mul(expandTo18Decimals(1).sub(MINIMUM_LIQUIDITY))
      .div(expandTo18Decimals(1))

    await expect(() => ftsoReward.claimFtsoRewards([1], wallet.address, false)).to.changeEtherBalance(
      wallet,
      expectedWalletRewards
    )

    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 1)).to.eq(expectedWalletRewards)
  })

  it('claimFtsoRewards:wrapped', async () => {
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(1))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 100)
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1])

    const expectedRewards = expandTo18Decimals(1).div(100)
    const expectedWalletRewards = expectedRewards
      .mul(expandTo18Decimals(1).sub(MINIMUM_LIQUIDITY))
      .div(expandTo18Decimals(1))

    await expect(() => ftsoReward.claimFtsoRewards([1], wallet.address, true)).to.changeTokenBalance(
      wNat,
      wallet,
      expectedWalletRewards
    )

    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 1)).to.eq(expectedWalletRewards)
  })

  it('claimFtsoRewards:nativeTo', async () => {
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(1))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 100)
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1])

    const expectedRewards = expandTo18Decimals(1).div(100)
    const expectedWalletRewards = expectedRewards
      .mul(expandTo18Decimals(1).sub(MINIMUM_LIQUIDITY))
      .div(expandTo18Decimals(1))

    await expect(() => ftsoReward.claimFtsoRewards([1], other.address, false)).to.changeEtherBalance(
      other,
      expectedWalletRewards
    )

    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 1)).to.eq(expectedWalletRewards)
  })

  it('claimFtsoRewards:wrappedTo', async () => {
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(1))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 100)
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1])

    const expectedRewards = expandTo18Decimals(1).div(100)
    const expectedWalletRewards = expectedRewards
      .mul(expandTo18Decimals(1).sub(MINIMUM_LIQUIDITY))
      .div(expandTo18Decimals(1))

    await expect(() => ftsoReward.claimFtsoRewards([1], other.address, true)).to.changeTokenBalance(
      wNat,
      other,
      expectedWalletRewards
    )

    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 1)).to.eq(expectedWalletRewards)
  })

  it('claimFtsoRewards:shares', async () => {
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(1))
    await addLiquidity(other, expandTo18Decimals(3), expandTo18Decimals(3))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 100)
    await removeLiquidity(wallet, expandTo18Decimals(1).sub(MINIMUM_LIQUIDITY))
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 2, 100)
    await ftsoManager.addRewardEpoch(3, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1, 2])

    const expectedRewards1 = expandTo18Decimals(4).div(100)
    const expectedWalletRewards1 = expectedRewards1
      .mul(expandTo18Decimals(1).sub(MINIMUM_LIQUIDITY))
      .div(expandTo18Decimals(4))
    const expectedOtherRewards1 = expectedRewards1.mul(expandTo18Decimals(3)).div(expandTo18Decimals(4))

    const expectedRewards2 = expandTo18Decimals(3).add(MINIMUM_LIQUIDITY).div(100)
    const expectedOtherRewards2 = expectedRewards2
      .mul(expandTo18Decimals(3))
      .div(expandTo18Decimals(3).add(MINIMUM_LIQUIDITY))
    await expect(ftsoReward.connect(wallet).claimFtsoRewards([1], wallet.address, true))
      .to.emit(ftsoReward, 'FtsoRewardsClaimed')
      .withArgs(wallet.address, wallet.address, BigNumber.from('1'), expectedWalletRewards1)
    await expect(ftsoReward.connect(other).claimFtsoRewards([1, 2], other.address, true))
      .to.emit(ftsoReward, 'FtsoRewardsClaimed')
      .withArgs(other.address, other.address, BigNumber.from('1'), expectedOtherRewards1)
      .to.emit(ftsoReward, 'FtsoRewardsClaimed')
      .withArgs(other.address, other.address, BigNumber.from('2'), expectedOtherRewards2)
    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 1)).to.eq(expectedWalletRewards1)
    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 2)).to.eq(BigNumber.from(0))
    expect(await ftsoReward.claimedFtsoRewards(other.address, 1)).to.eq(expectedOtherRewards1)
    expect(await ftsoReward.claimedFtsoRewards(other.address, 2)).to.eq(expectedOtherRewards2)
  })

  it('epochsWithUnclaimedFtsoRewards', async () => {
    await addLiquidity(wallet, expandTo18Decimals(2), expandTo18Decimals(8))
    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 100)
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(4))
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 2, 100)
    await ftsoManager.addRewardEpoch(3, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1, 2])

    const expectedRewards1 = expandTo18Decimals(8).div(100)
    const expectedWalletRewards1 = expectedRewards1
      .mul(expandTo18Decimals(4).sub(MINIMUM_LIQUIDITY))
      .div(expandTo18Decimals(4))

    const expectedRewards2 = expandTo18Decimals(12).div(100)
    const expectedWalletRewards2 = expectedRewards2
      .mul(expandTo18Decimals(6).sub(MINIMUM_LIQUIDITY))
      .div(expandTo18Decimals(6))

    const { epochs, amounts } = await ftsoReward.epochsWithUnclaimedFtsoRewards(wallet.address)
    expect(epochs).to.deep.eq([BigNumber.from('1'), BigNumber.from('2')])
    expect(amounts).to.deep.eq([expectedWalletRewards1, expectedWalletRewards2])
  })

  it('claimFtsoRewards:expired', async () => {
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(4))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 100)
    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 2, 100)
    await ftsoManager.addRewardEpoch(3, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1, 2])

    await ftsoManager.setRewardEpochToExpireNext(2)

    const { epochs } = await ftsoReward.epochsWithUnclaimedFtsoRewards(wallet.address)
    expect(epochs).to.deep.eq([BigNumber.from('2')])

    await ftsoReward.claimFtsoRewards([1, 2], wallet.address, true)
    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 1)).to.eq(BigNumber.from(0))
    expect(await ftsoReward.claimedFtsoRewards(wallet.address, 2)).not.to.eq(BigNumber.from(0))
  })

  it('rewardsFeeOn', async () => {
    await manager.setRewardsFeeTo(other.address)
    await manager.setRewardsFeeOn(true)

    await wNat.transfer(pair.address, expandTo18Decimals(100))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 10000000) // 100000 NAT

    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    const expectedTotalRewards = expandTo18Decimals(100000)
    const expectedDistributedRewards = applyFee(expectedTotalRewards)

    const bytecode = BlazeSwapRewardManager.bytecode
    const rewardManagerAddress = getRewardManagerAddress(pair.address, bytecode)

    await expect(ftsoReward.distributeFtsoRewards([1]))
      .to.emit(ftsoReward, 'FtsoRewardsDistributed')
      .withArgs(BigNumber.from('1'), expectedDistributedRewards, wallet.address)

    expect(await wNat.balanceOf(rewardManagerAddress)).to.eq(expectedTotalRewards)
  })

  it('withdrawRewardFees', async () => {
    await manager.setRewardsFeeTo(other.address)
    await manager.setRewardsFeeOn(true)

    await wNat.transfer(pair.address, expandTo18Decimals(100))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 10000)

    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    const expectedTotalRewards = expandTo18Decimals(100)
    const expectedDistributedRewards = applyFee(expectedTotalRewards)
    const expectedRewardFees = expectedTotalRewards.sub(expectedDistributedRewards)

    await ftsoReward.distributeFtsoRewards([1])

    await expect(() => delegation.withdrawRewardFees()).to.changeTokenBalance(wNat, other, expectedRewardFees)

    const bytecode = BlazeSwapRewardManager.bytecode
    const rewardManagerAddress = getRewardManagerAddress(pair.address, bytecode)
    expect(await wNat.balanceOf(rewardManagerAddress)).to.eq(expectedDistributedRewards)
  })

  it('claimFtsoRewards:afterFee', async () => {
    await manager.setRewardsFeeTo(other.address)
    await manager.setRewardsFeeOn(true)

    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(1))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 10000)

    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    await ftsoReward.distributeFtsoRewards([1])

    const { epochs, amounts } = await ftsoReward.epochsWithUnclaimedFtsoRewards(wallet.address)

    await delegation.withdrawRewardFees()

    await expect(() => ftsoReward.claimFtsoRewards(epochs, wallet.address, true)).to.changeTokenBalance(
      wNat,
      wallet,
      amounts[0]
    )

    await ftsoManager.setRewardEpochToExpireNext(2)

    const bytecode = BlazeSwapRewardManager.bytecode
    const rewardManagerAddress = getRewardManagerAddress(pair.address, bytecode)

    expect(await wNat.balanceOf(rewardManagerAddress)).to.gt(BigNumber.from('0'))

    await delegation.withdrawRewardFees()

    expect(await wNat.balanceOf(rewardManagerAddress)).to.eq(BigNumber.from('0'))
  })

  it('multicall:distributeAndClaim', async () => {
    await addLiquidity(wallet, expandTo18Decimals(1), expandTo18Decimals(1))

    await ftsoManager.addRewardEpoch(1, (await provider.getBlock('latest')).number)
    await ftsoRewardManager.addRewards(pair.address, 1, 10000)

    await ftsoManager.addRewardEpoch(2, (await provider.getBlock('latest')).number)

    const [epochs, amounts] = await ftsoReward.epochsWithUndistributedFtsoRewards(wallet.address)
    const to = wallet.address
    const wrapped = true

    expect(epochs.length).to.eq(1)
    expect(amounts[0]).to.gt(BigNumber.from('0'))

    const coder = new Coder(BlazeSwapFtsoReward.abi)
    await expect(
      pair.multicall([
        coder.encodeFunction('distributeFtsoRewards', { epochs }),
        coder.encodeFunction('claimFtsoRewards', { epochs, to, wrapped }),
      ])
    ).not.to.be.reverted

    expect(await ftsoReward.claimedFtsoRewards(wallet.address, epochs[0])).to.eq(amounts[0])
  })
})
