import { FeeOption, Fees, Network } from '@thorswap-lib/xchain-client'
import { BaseAmount } from '@thorswap-lib/xchain-util'
import { BigNumber, ethers } from 'ethers'

export type Address = string

export enum EthNetwork {
  Test = 'ropsten',
  Main = 'homestead',
}

export type ClientUrl = Record<Network, string>
export type ExplorerUrl = Record<Network, string>

export type TxOverrides = {
  nonce?: ethers.BigNumberish

  // mandatory: https://github.com/ethers-io/ethers.js/issues/469#issuecomment-475926538
  gasLimit: ethers.BigNumberish
  gasPrice?: ethers.BigNumberish
  data?: ethers.BytesLike
  value?: ethers.BigNumberish

  // EIP-1559
  maxPriorityFeePerGas?: ethers.BigNumberish
  maxFeePerGas?: ethers.BigNumberish
}

export type InfuraCreds = {
  projectId: string
  projectSecret?: string
}

export type GasPrices = Record<FeeOption, BaseAmount>

export type FeesWithGasPricesAndLimits = { fees: Fees; gasPrices: GasPrices; gasLimit: BigNumber }

export type ApproveParams = {
  walletIndex?: number
  contractAddress: Address
  spenderAddress: Address
  feeOptionKey?: FeeOption
  amount?: BaseAmount
  // Optional fallback in case estimation for gas limit fails
  gasLimitFallback?: ethers.BigNumberish
}

export type EstimateApproveParams = Omit<ApproveParams, 'feeOptionKey' | 'gasLimitFallback'>

export type IsApprovedParams = {
  walletIndex?: number
  contractAddress: Address
  spenderAddress: Address
  amount?: BaseAmount
}

export type CallParams = {
  walletIndex?: number
  contractAddress: Address
  abi: ethers.ContractInterface
  funcName: string
  funcParams?: unknown[]
}

export type EstimateCallParams = Pick<CallParams, 'contractAddress' | 'abi' | 'funcName' | 'funcParams' | 'walletIndex'>
