import { waffle } from 'hardhat'
import { expect } from 'chai'
import { Contract } from 'ethers'

const { deployContract } = waffle

import DelegatorTest from '../../artifacts/contracts/shared/test/DelegatedCallsTest.sol/DelegatorTest.json'

describe('DelegatedCalls', () => {
  const provider = waffle.provider
  const [wallet] = provider.getWallets()

  let delegator: Contract
  before('deploy Delegator and DelegatedCalls', async () => {
    delegator = await deployContract(wallet, DelegatorTest)
  })

  it('standard call to onlyStandardCall', async () => {
    await expect(delegator.testStandard(false)).not.to.be.reverted
  })

  it('standard call to onlyDelegatedCall', async () => {
    await expect(delegator.testStandard(true)).to.be.revertedWith('DelegatedCalls: standard call')
  })

  it('delegated call to onlyStandardCall', async () => {
    await expect(delegator.testDelegated(false)).to.be.revertedWith('DelegatedCalls: delegated call')
  })

  it('delegated call to onlyDelegatedCall', async () => {
    await expect(delegator.testDelegated(true)).not.to.be.reverted
  })
})
