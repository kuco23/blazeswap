import { waffle } from 'hardhat'
import { expect } from 'chai'
import { BigNumber, constants } from 'ethers'

import { getCreate2Address } from './shared/utilities'
import { factoryFixture } from './shared/fixtures'

import BlazeSwapPair from '../../artifacts/contracts/core/BlazeSwapPair.sol/BlazeSwapPair.json'
import FlareAssetRegistry from '../../artifacts/contracts/core/test/FlareAssetRegistry.sol/FlareAssetRegistry.json'
import FlareAssetTest from '../../artifacts/contracts/core/test/FlareAssetTest.sol/FlareAssetTest.json'
import BlazeSwapFlareAssetRewardPlugin from '../../artifacts/contracts/core/BlazeSwapFlareAssetRewardPlugin.sol/BlazeSwapFlareAssetRewardPlugin.json'
import {
  IBlazeSwapFactory,
  IBlazeSwapFlareAssetReward__factory,
  IBlazeSwapManager,
  IBlazeSwapPair__factory,
} from '../../typechain-types'

const { createFixtureLoader, deployContract } = waffle

describe('BlazeSwapFactory', () => {
  const provider = waffle.provider
  const [wallet, other] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet, other], provider)

  let manager: IBlazeSwapManager
  let factory: IBlazeSwapFactory
  let TEST_ADDRESSES: [string, string]
  beforeEach(async () => {
    const fixture = await loadFixture(factoryFixture)
    manager = fixture.manager
    factory = fixture.factory
    TEST_ADDRESSES = ['0x1000000000000000000000000000000000000000', await manager.wNat()]
  })

  it('manager, configSetter, allPairsLength', async () => {
    expect(await factory.manager()).not.to.eq(constants.AddressZero)
    expect(await factory.allPairsLength()).to.eq(0)
  })

  async function createPair(tokens: [string, string]) {
    const bytecode = BlazeSwapPair.bytecode
    const create2Address = getCreate2Address(factory.address, tokens, bytecode)
    await expect(factory.createPair(...tokens))
      .to.emit(factory, 'PairCreated')
      .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, BigNumber.from(1))

    await expect(factory.createPair(tokens[0], tokens[1])).to.be.reverted // BlazeSwap: PAIR_EXISTS
    await expect(factory.createPair(tokens[1], tokens[0])).to.be.reverted // BlazeSwap: PAIR_EXISTS
    expect(await factory.getPair(tokens[0], tokens[1])).to.eq(create2Address)
    expect(await factory.getPair(tokens[1], tokens[0])).to.eq(create2Address)
    expect(await factory.allPairs(0)).to.eq(create2Address)
    expect(await factory.allPairsLength()).to.eq(1)

    const pair = IBlazeSwapPair__factory.connect(create2Address, wallet)
    expect(await pair.factory()).to.eq(factory.address)
    expect(await pair.token0()).to.eq(TEST_ADDRESSES[0])
    expect(await pair.token1()).to.eq(TEST_ADDRESSES[1])
  }

  it('createPair', async () => {
    await createPair(TEST_ADDRESSES)
  })

  it('createPair:reverse', async () => {
    await createPair(TEST_ADDRESSES.slice().reverse() as [string, string])
  })

  it('createPairGeneric:gas', async () => {
    const tokens: [string, string] = [
      '0x1000000000000000000000000000000000000001',
      '0x1000000000000000000000000000000000000002',
    ]
    const tx = await factory.createPair(...tokens)
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(4322425)
  })

  it('createPairWithWNat:gas', async () => {
    const tx = await factory.createPair(...TEST_ADDRESSES)
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(6873616)
  })

  it('createPairWithFlareAsset:upgradeFlareAssetPair', async () => {
    const flareAsset = await deployContract(wallet, FlareAssetTest, [0])
    const tokens = ['0x1000000000000000000000000000000000000000', flareAsset.address]
    const registry = await deployContract(wallet, FlareAssetRegistry)
    await manager.setFlareAssetRegistry(registry.address)
    await registry.addFlareAsset(tokens[1], 2)
    await expect(factory.createPair(tokens[0], tokens[1])).to.be.revertedWith('BlazeSwap: FASSET_UNSUPPORTED')
    await manager.setAllowFlareAssetPairsWithoutPlugin(true)
    await expect(factory.createPair(tokens[0], tokens[1])).not.to.be.reverted

    const bytecode = BlazeSwapPair.bytecode
    const create2Address = getCreate2Address(factory.address, tokens as [string, string], bytecode)
    expect(await factory.isFlareAssetPairWithoutPlugin(create2Address)).to.eq(true)

    const flareAssetReward = await deployContract(wallet, BlazeSwapFlareAssetRewardPlugin, [
      5,
      'FlareAsset Reward Plugin',
    ])
    await manager.setFlareAssetsRewardPlugin(flareAssetReward.address)

    await expect(factory.upgradeFlareAssetPair(create2Address)).not.to.be.reverted

    expect(await manager.allowFlareAssetPairsWithoutPlugin()).to.eq(false)
    expect(await factory.isFlareAssetPairWithoutPlugin(create2Address)).to.eq(false)
    await expect(factory.upgradeFlareAssetPair(create2Address)).to.be.revertedWith('BlazeSwap: UPGRADE_NOT_NEEDED')

    const flareAssetPair = IBlazeSwapFlareAssetReward__factory.connect(create2Address, wallet)
    expect(await flareAssetPair.flareAssets()).to.deep.eq([flareAsset.address])
    expect(await flareAssetPair.flareAssetConfigParams()).to.deep.eq([BigNumber.from(10), 'FlareAsset Reward Plugin'])
  })

  it('createPairWithFlareAsset:full', async () => {
    const flareAsset = await deployContract(wallet, FlareAssetTest, [0])
    const tokens = ['0x1000000000000000000000000000000000000000', flareAsset.address]
    const registry = await deployContract(wallet, FlareAssetRegistry)
    await manager.setFlareAssetRegistry(registry.address)
    await registry.addFlareAsset(tokens[1], 2)

    const bytecode = BlazeSwapPair.bytecode
    const create2Address = getCreate2Address(factory.address, tokens as [string, string], bytecode)

    const flareAssetReward = await deployContract(wallet, BlazeSwapFlareAssetRewardPlugin, [
      5,
      'FlareAsset Reward Plugin',
    ])
    await manager.setFlareAssetsRewardPlugin(flareAssetReward.address)

    await expect(factory.createPair(tokens[0], tokens[1])).not.to.be.reverted

    const flareAssetPair = IBlazeSwapFlareAssetReward__factory.connect(create2Address, wallet)
    expect(await flareAssetPair.flareAssets()).to.deep.eq([flareAsset.address])
    expect(await flareAssetPair.flareAssetConfigParams()).to.deep.eq([BigNumber.from(10), 'FlareAsset Reward Plugin'])

    expect(await factory.isFlareAssetPairWithoutPlugin(create2Address)).to.eq(false)
    await expect(factory.upgradeFlareAssetPair(create2Address)).to.be.revertedWith('BlazeSwap: UPGRADE_NOT_NEEDED')
  })
})
