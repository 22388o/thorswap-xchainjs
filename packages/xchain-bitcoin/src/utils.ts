import {
  Address,
  Balance,
  FeeOption,
  FeeRate,
  Fees,
  FeesWithRates,
  Network,
  TxHash,
  TxParams,
  calcFees,
  standardFeeRates,
} from '@thorswap-lib/xchain-client'
import { AssetBTC, BaseAmount, assetAmount, assetToBase, baseAmount } from '@thorswap-lib/xchain-util'
import {
  Network as BitcoinNetwork,
  Psbt,
  PsbtTxOutput,
  address as bitcoinAddress,
  networks,
  opcodes,
  script,
} from 'bitcoinjs-lib'
import accumulative from 'coinselect/accumulative'

import * as blockStream from './blockstream-api'
import { BTC_DECIMAL, MIN_TX_FEE } from './const'
import * as haskoinApi from './haskoin-api'
import * as sochain from './sochain-api'
import { BroadcastTxParams, UTXO } from './types/common'
import { AddressParams, BtcAddressUTXO, ScanUTXOParam } from './types/sochain-api-types'

const TX_EMPTY_SIZE = 4 + 1 + 1 + 4 //10
const TX_INPUT_BASE = 32 + 4 + 1 + 4 // 41
const TX_INPUT_PUBKEYHASH = 107
const TX_OUTPUT_BASE = 8 + 1 //9
const TX_OUTPUT_PUBKEYHASH = 25

const inputBytes = (input: UTXO): number => {
  return TX_INPUT_BASE + (input.witnessUtxo.script ? input.witnessUtxo.script.length : TX_INPUT_PUBKEYHASH)
}

/**
 * Compile memo.
 *
 * @param {string} memo The memo to be compiled.
 * @returns {Buffer} The compiled memo.
 */
export const compileMemo = (memo: string): Buffer => {
  const data = Buffer.from(memo, 'utf8') // converts MEMO to buffer
  return script.compile([opcodes.OP_RETURN, data]) // Compile OP_RETURN script
}

/**
 * Get the transaction fee.
 *
 * @param {UTXO[]} inputs The UTXOs.
 * @param {FeeRate} feeRate The fee rate.
 * @param {Buffer} data The compiled memo (Optional).
 * @returns {number} The fee amount.
 */
export const getFee = (inputs: UTXO[], feeRate: FeeRate, data: Buffer | null = null): number => {
  let sum =
    TX_EMPTY_SIZE +
    inputs.reduce((a, x) => a + inputBytes(x), 0) +
    inputs.length + // +1 byte for each input signature
    TX_OUTPUT_BASE +
    TX_OUTPUT_PUBKEYHASH +
    TX_OUTPUT_BASE +
    TX_OUTPUT_PUBKEYHASH

  if (data) {
    sum += TX_OUTPUT_BASE + data.length
  }
  const fee = sum * feeRate
  return fee > MIN_TX_FEE ? fee : MIN_TX_FEE
}

/**
 * Get the average value of an array.
 *
 * @param {number[]} array
 * @returns {number} The average value.
 */
export const arrayAverage = (array: number[]): number => {
  let sum = 0
  array.forEach((value) => (sum += value))
  return sum / array.length
}

/**
 * Get Bitcoin network to be used with bitcoinjs.
 *
 * @param {Network} network
 * @returns {BitcoinNetwork} The BTC network.
 */
export const btcNetwork = (network: Network): BitcoinNetwork => {
  switch (network) {
    case Network.Mainnet:
      return networks.bitcoin
    case Network.Testnet:
      return networks.testnet
  }
}

/**
 * Get the balances of an address.
 *
 * @param {string} sochainUrl sochain Node URL.
 * @param {Network} network
 * @param {Address} address
 * @returns {Balance[]} The balances of the given address.
 */
export const getBalance = async (params: AddressParams, haskoinUrl: string): Promise<Balance[]> => {
  switch (params.network) {
    case Network.Mainnet:
      return [
        {
          asset: AssetBTC,
          amount: await haskoinApi.getBalance({ haskoinUrl, address: params.address }),
        },
      ]
    case Network.Testnet:
      return [
        {
          asset: AssetBTC,
          amount: await sochain.getBalance(params),
        },
      ]
  }
}

/**
 * Validate the BTC address.
 *
 * @param {Address} address
 * @param {Network} network
 * @returns {boolean} `true` or `false`.
 */
export const validateAddress = (address: Address, network: Network): boolean => {
  try {
    bitcoinAddress.toOutputScript(address, btcNetwork(network))
    return true
  } catch (error) {
    return false
  }
}

/**
 * Scan UTXOs from sochain.
 *
 * @param {string} sochainUrl sochain Node URL.
 * @param {Network} network
 * @param {Address} address
 * @returns {UTXO[]} The UTXOs of the given address.
 */
export const scanUTXOs = async ({
  sochainUrl,
  network,
  address,
  confirmedOnly = true, // default: scan only confirmed UTXOs
  fetchTxHex,
}: ScanUTXOParam): Promise<UTXO[]> => {
  // STEP #1 - scan utxo from sochain api

  try {
    let utxos: BtcAddressUTXO[] = []

    const addressParam: AddressParams = {
      sochainUrl,
      network,
      address,
    }

    if (confirmedOnly) {
      utxos = await sochain.getConfirmedUnspentTxs(addressParam)
    } else {
      utxos = await sochain.getUnspentTxs(addressParam)
    }

    const results: UTXO[] = []

    for (const utxo of utxos) {
      let txHex
      if (fetchTxHex) {
        txHex = (await sochain.getTx({ hash: utxo.txid, sochainUrl, network })).tx_hex
      }

      results.push({
        hash: utxo.txid,
        index: utxo.output_no,
        value: assetToBase(assetAmount(utxo.value, BTC_DECIMAL)).amount().toNumber(),
        witnessUtxo: {
          value: assetToBase(assetAmount(utxo.value, BTC_DECIMAL)).amount().toNumber(),
          script: Buffer.from(utxo.script_hex, 'hex'),
        },
        txHex,
      })
    }

    return results
  } catch (error) {
    console.log('sochain api error', error)

    // STEP #2 - if sochain api fails, scan utxo from haskoin api

    let utxos: haskoinApi.UtxoData[] = []

    if (confirmedOnly) {
      utxos = await haskoinApi.getConfirmedUnspentTxs(address)
    } else {
      utxos = await haskoinApi.getUnspentTxs(address)
    }

    const results: UTXO[] = []

    for (const utxo of utxos) {
      let txHex
      if (fetchTxHex) {
        txHex = await haskoinApi.getRawTx(utxo.txid)
      }

      results.push({
        hash: utxo.txid,
        index: utxo.index,
        value: baseAmount(utxo.value, BTC_DECIMAL).amount().toNumber(),
        witnessUtxo: {
          value: baseAmount(utxo.value, BTC_DECIMAL).amount().toNumber(),
          script: Buffer.from(utxo.pkscript, 'hex'),
        },
        txHex,
      } as UTXO)
    }

    return results
  }
}
/**
 * Build transcation.
 *
 * @param {BuildParams} params The transaction build options.
 * @returns {Transaction}
 */
export const buildTx = async ({
  amount,
  recipient,
  memo,
  feeRate,
  sender,
  network,
  sochainUrl,
  haskoinUrl,
  spendPendingUTXO = false, // default: prevent spending uncomfirmed UTXOs
  fetchTxHex = false,
}: TxParams & {
  feeRate: FeeRate
  sender: Address
  network: Network
  sochainUrl: string
  haskoinUrl: string
  spendPendingUTXO?: boolean
  fetchTxHex?: boolean
}): Promise<{ psbt: Psbt; utxos: UTXO[]; inputs: UTXO[] }> => {
  // search only confirmed UTXOs if pending UTXO is not allowed
  const confirmedOnly = !spendPendingUTXO
  const utxos = await scanUTXOs({ sochainUrl, haskoinUrl, network, address: sender, confirmedOnly, fetchTxHex })

  if (utxos.length === 0) throw new Error('No utxos to send')
  if (!validateAddress(recipient, network)) throw new Error('Invalid address')

  const feeRateWhole = Number(feeRate.toFixed(0))
  const compiledMemo = memo ? compileMemo(memo) : null

  const targetOutputs = []

  //1. add output amount and recipient to targets
  targetOutputs.push({
    address: recipient,
    value: amount.amount().toNumber(),
  })
  //2. add output memo to targets (optional)
  if (compiledMemo) {
    targetOutputs.push({ script: compiledMemo, value: 0 })
  }
  const { inputs, outputs } = accumulative(utxos, targetOutputs, feeRateWhole)

  // .inputs and .outputs will be undefined if no solution was found
  if (!inputs || !outputs) throw new Error('Insufficient Balance for transaction')

  const psbt = new Psbt({ network: btcNetwork(network) }) // Network-specific

  // psbt add input from accumulative inputs
  inputs.forEach((utxo: UTXO) =>
    psbt.addInput({
      hash: utxo.hash,
      index: utxo.index,
      witnessUtxo: utxo.witnessUtxo,
    }),
  )

  // psbt add outputs from accumulative outputs
  outputs.forEach((output: PsbtTxOutput) => {
    if (!output.address) {
      //an empty address means this is the  change ddress
      output.address = sender
    }
    if (!output.script) {
      psbt.addOutput(output)
    } else {
      //we need to add the compiled memo this way to
      //avoid dust error tx when accumulating memo output with 0 value
      if (compiledMemo) {
        psbt.addOutput({ script: compiledMemo, value: 0 })
      }
    }
  })

  return { psbt, utxos, inputs }
}

/**
 * Broadcast the transaction.
 *
 * @param {BroadcastTxParams} params The transaction broadcast options.
 * @returns {TxHash} The transaction hash.
 */
export const broadcastTx = async ({ network, txHex, blockstreamUrl }: BroadcastTxParams): Promise<TxHash> => {
  return await blockStream.broadcastTx({ network, txHex, blockstreamUrl })
}

/**
 * Calculate fees based on fee rate and memo.
 *
 * @param {FeeRate} feeRate
 * @param {string} memo
 * @returns {BaseAmount} The calculated fees based on fee rate and the memo.
 */
export const calcFee = (feeRate: FeeRate, memo?: string): BaseAmount => {
  const compiledMemo = memo ? compileMemo(memo) : null
  const fee = getFee([], feeRate, compiledMemo)
  return baseAmount(fee)
}

/**
 * Get the default fees with rates.
 *
 * @returns {FeesWithRates} The default fees and rates.
 */
export const getDefaultFeesWithRates = (): FeesWithRates => {
  const rates = {
    ...standardFeeRates(20),
    [FeeOption.Fastest]: 50,
  }

  return {
    fees: calcFees(rates, calcFee),
    rates,
  }
}

/**
 * Get the default fees.
 *
 * @returns {Fees} The default fees.
 */
export const getDefaultFees = (): Fees => {
  const { fees } = getDefaultFeesWithRates()
  return fees
}

/**
 * Get address prefix based on the network.
 *
 * @param {Network} network
 * @returns {string} The address prefix based on the network.
 *
 **/
export const getPrefix = (network: Network) => {
  switch (network) {
    case Network.Mainnet:
      return 'bc1'
    case Network.Testnet:
      return 'tb1'
  }
}
