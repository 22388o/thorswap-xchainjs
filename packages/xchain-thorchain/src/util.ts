import { fromBase64, toBase64 } from '@cosmjs/encoding'
import { cosmosclient, proto } from '@cosmos-client/core'
import { Address, Balance, FeeType, Fees, Network, TxHash, TxType, singleFee } from '@thorswap-lib/xchain-client'
import { CosmosSDKClient, TxLog } from '@thorswap-lib/xchain-cosmos'
import {
  Asset,
  AssetRuneNative,
  BaseAmount,
  Chain,
  assetAmount,
  assetFromString,
  assetToBase,
  assetToString,
  baseAmount,
} from '@thorswap-lib/xchain-util'
import axios from 'axios'
import * as bech32Buffer from 'bech32-buffer'
import Long from 'long'

import { ChainId, ChainIds, ClientUrl, ExplorerUrl, ExplorerUrls, NodeInfoResponse, TxData } from './types'
import { MsgNativeTx, THORNameResultEntry } from './types/messages'
import types from './types/proto/MsgCompiled'

export const DECIMAL = 8
export const DEFAULT_GAS_VALUE = '5000000000'
export const DEPOSIT_GAS_VALUE = '5000000000'
export const MAX_TX_COUNT = 100

export const THORCHAIN_MAINNET_CHAIN_ID = 'thorchain-mainnet-v1'
export const THORCHAIN_STAGENET_CHAIN_ID = 'thorchain-stagenet-v2'
export const THORCHAIN_TESTNET_CHAIN_ID = 'thorchain-testnet-v2'

export const STAGENET_MIDGARD_API_BASE = 'https://stagenet-midgard.thorswap.net/v2'
export const MAINNET_MIDGARD_API_BASE = 'https://midgard.thorswap.net/v2'
/**
 * Get denomination from Asset
 *
 * @param {Asset} asset
 * @returns {string} The denomination of the given asset.
 */
export const getDenom = (asset: Asset): string => {
  // 'rune' for native RUNE
  if (assetToString(asset) === assetToString(AssetRuneNative)) return 'rune'

  // 'btc/btc' for synth btc
  return asset.symbol.toLowerCase()
}

/**
 * Get denomination with chainname from Asset
 *
 * @param {Asset} asset
 * @returns {string} The denomination with chainname of the given asset.
 */
export const getDenomWithChain = (asset: Asset): string => {
  // for synth
  if (asset.symbol.toUpperCase() !== 'RUNE') {
    return asset.symbol.toLowerCase()
  }

  // for normal rune tx
  return `${Chain.THORChain}.${asset.symbol.toUpperCase()}`
}

/**
 * Get Asset from denomination
 *
 * @param {string} denom
 * @returns {Asset|null} The asset of the given denomination.
 */
export const getAsset = (denom: string): Asset | null => {
  if (denom === getDenom(AssetRuneNative)) return AssetRuneNative

  // use lowercase symbol for synth
  if (denom.includes('/')) {
    return assetFromString(`${Chain.THORChain}.${denom.toLowerCase()}`)
  }
  return assetFromString(`${Chain.THORChain}.${denom.toUpperCase()}`)
}

/**
 * Response guard for transaction broadcast
 *
 * @param {any} response The response from the node.
 * @returns {boolean} `true` or `false`.
 */
export const isBroadcastSuccess = (response: unknown): boolean =>
  typeof response === 'object' &&
  response !== null &&
  'logs' in response &&
  (response as Record<string, unknown>).logs !== undefined &&
  (response as Record<string, unknown>).logs !== null &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  !(response as any)?.raw_log?.includes('failed')

/**
 * Get address prefix based on the network.
 *
 * @param {Network} network
 * @returns {string} The address prefix based on the network.
 *
 **/
export const getPrefix = (network: Network, isStagenet = false) => {
  if (isStagenet) {
    return 'sthor'
  }

  switch (network) {
    case Network.Mainnet:
      return 'thor'
    case Network.Testnet:
      return 'tthor'
  }
}

export const registerDespositCodecs = async (): Promise<void> => {
  cosmosclient.codec.register('/types.MsgDeposit', types.types.MsgDeposit)
}

/**
 * Register Codecs based on the prefix.
 *
 * @param {string} prefix
 */
export const registerSendCodecs = async (): Promise<void> => {
  cosmosclient.codec.register('/types.MsgSend', types.types.MsgSend)
}

/**
 * Parse transaction data from event logs
 *
 * @param {TxLog[]} logs List of tx logs
 * @param {Address} address - Address to get transaction data for
 * @returns {TxData} Parsed transaction data
 */
export const getDepositTxDataFromLogs = (logs: TxLog[], address: Address): TxData => {
  const events = logs[0]?.events

  if (!events) {
    throw Error('No events in logs available')
  }

  type TransferData = { sender: string; recipient: string; amount: BaseAmount }
  type TransferDataList = TransferData[]
  const transferDataList: TransferDataList = events.reduce((acc: TransferDataList, { type, attributes }) => {
    if (type === 'transfer') {
      return attributes.reduce((acc2, { key, value }, index) => {
        if (index % 3 === 0) acc2.push({ sender: '', recipient: '', amount: baseAmount(0, DECIMAL) })
        const newData = acc2[acc2.length - 1]
        if (key === 'sender') newData.sender = value
        if (key === 'recipient') newData.recipient = value
        if (key === 'amount') newData.amount = baseAmount(value.replace(/rune/, ''), DECIMAL)
        return acc2
      }, acc)
    }
    return acc
  }, [])

  const txData: TxData = transferDataList
    // filter out txs which are not based on given address
    .filter(({ sender, recipient }) => sender === address || recipient === address)
    // transform `TransferData` -> `TxData`
    .reduce(
      (acc: TxData, { sender, recipient, amount }) => ({
        ...acc,
        from: [...acc.from, { amount, from: sender }],
        to: [...acc.to, { amount, to: recipient }],
      }),
      { from: [], to: [], type: TxType.Transfer },
    )

  return txData
}

/**
 * Get the default fee.
 *
 * @returns {Fees} The default fee.
 */
export const getDefaultFees = (): Fees => {
  const fee = assetToBase(assetAmount(0.02 /* 0.02 RUNE */, DECIMAL))
  return singleFee(FeeType.FlatFee, fee)
}

/**
 * Get transaction type.
 *
 * @param {string} txData the transaction input data
 * @param {string} encoding `base64` or `hex`
 * @returns {string} the transaction type.
 */
export const getTxType = (txData: string, encoding: 'base64' | 'hex'): string => {
  return Buffer.from(txData, encoding).toString().slice(4)
}

/**
 * Helper to get THORChain's chain id
 * @param {string} nodeUrl THORNode url
 */
export const getChainId = async (nodeUrl: string): Promise<string> => {
  const { data } = await axios.get<NodeInfoResponse>(`${nodeUrl}/cosmos/base/tendermint/v1beta1/node_info`)
  return data?.default_node_info?.network || Promise.reject('Could not parse chain id')
}

/**
 * Helper to get all THORChain's chain id
 * @param {ClientUrl} client urls (use `getDefaultClientUrl()` if you don't need to use custom urls)
 */
export const getChainIds = async (client: ClientUrl): Promise<ChainIds> => {
  return Promise.all([getChainId(client[Network.Testnet].node), getChainId(client[Network.Mainnet].node)]).then(
    ([testnetId, mainnetId]) => ({
      testnet: testnetId,
      mainnet: mainnetId,
    }),
  )
}

/**
 * Structure StdTx from MsgNativeTx.
 *
 * @param {MsgNativeTx} msgNativeTx Msg of type `MsgNativeTx`.
 * @param {string} nodeUrl Node url
 * @param {chainId} ChainId Chain id of the network
 *
 * @returns {Tx} The transaction details of the given transaction id.
 *
 * @throws {"Invalid client url"} Thrown if the client url is an invalid one.
 */
export const buildDepositTx = async ({
  msgNativeTx,
  nodeUrl,
  chainId,
}: {
  msgNativeTx: MsgNativeTx
  nodeUrl: string
  chainId: ChainId
}): Promise<proto.cosmos.tx.v1beta1.TxBody> => {
  const networkChainId = await getChainId(nodeUrl)
  if (!networkChainId || chainId !== networkChainId) {
    throw new Error(`Invalid network (asked: ${chainId} / returned: ${networkChainId}`)
  }

  const signerAddr = msgNativeTx.signer.toString()
  const signerDecoded = bech32Buffer.decode(signerAddr)

  const msgDepositObj = {
    coins: msgNativeTx.coins,
    memo: msgNativeTx.memo,
    signer: signerDecoded.data,
  }

  const depositMsg = types.types.MsgDeposit.fromObject(msgDepositObj)

  return new proto.cosmos.tx.v1beta1.TxBody({
    messages: [cosmosclient.codec.instanceToProtoAny(depositMsg)],
    memo: msgNativeTx.memo,
  })
}

/**
 * Structure a MsgSend
 *
 * @param fromAddress - required, from address string
 * @param toAddress - required, to address string
 * @param assetAmount - required, asset amount string (e.g. "10000")
 * @param assetDenom - required, asset denom string (e.g. "rune")
 * @param memo - optional, memo string
 *
 * @returns
 */
export const buildTransferTx = async ({
  fromAddress,
  toAddress,
  assetAmount,
  assetDenom,
  memo = '',
  nodeUrl,
  chainId,
}: {
  fromAddress: Address
  toAddress: Address
  assetAmount: BaseAmount
  assetDenom: string
  memo?: string
  nodeUrl: string
  chainId: ChainId
}): Promise<proto.cosmos.tx.v1beta1.TxBody> => {
  const networkChainId = await getChainId(nodeUrl)
  if (!networkChainId || chainId !== networkChainId) {
    throw new Error(`Invalid network (asked: ${chainId} / returned: ${networkChainId}`)
  }

  const fromDecoded = bech32Buffer.decode(fromAddress)
  const toDecoded = bech32Buffer.decode(toAddress)

  const transferObj = {
    fromAddress: fromDecoded.data,
    toAddress: toDecoded.data,
    amount: [
      {
        amount: assetAmount.amount().toString(),
        denom: assetDenom,
      },
    ],
  }

  const transferMsg = types.types.MsgSend.fromObject(transferObj)

  return new proto.cosmos.tx.v1beta1.TxBody({
    messages: [cosmosclient.codec.instanceToProtoAny(transferMsg)],
    memo,
  })
}

/**
 * Builds auth info
 *
 * @param signerPubkey - signerPubkey string
 * @param sequence - account sequence
 * @param gasLimit - transaction gas limit
 * @param signers - boolean array of the signers
 * @returns
 */
export const buildAuthInfo = ({
  signerPubkey,
  sequence,
  gasLimit,
  signers = [],
}: {
  signerPubkey: proto.google.protobuf.Any
  sequence: Long
  gasLimit: string
  signers?: boolean[]
}) => {
  const isMultisig = signers.length > 0
  return new proto.cosmos.tx.v1beta1.AuthInfo({
    signer_infos: [
      {
        public_key: signerPubkey,
        mode_info: isMultisig
          ? {
              multi: {
                bitarray: proto.cosmos.crypto.multisig.v1beta1.CompactBitArray.from(signers),
                mode_infos: signers
                  .filter((signer) => signer)
                  .map(() => ({
                    single: {
                      mode: proto.cosmos.tx.signing.v1beta1.SignMode.SIGN_MODE_DIRECT,
                    },
                  })),
              },
            }
          : {
              single: {
                mode: proto.cosmos.tx.signing.v1beta1.SignMode.SIGN_MODE_DIRECT,
              },
            },
        sequence: sequence,
      },
    ],
    fee: {
      amount: null,
      gas_limit: Long.fromString(gasLimit),
    },
  })
}

/**
 * Builds final unsigned TX
 *
 * @param cosmosSdk - CosmosSDK
 * @param txBody - txBody with encoded Msgs
 * @param signerPubkey - signerPubkey string
 * @param sequence - account sequence
 * @param gasLimit - transaction gas limit
 * @param signers - boolean array of the signers
 * @returns
 */
export const buildUnsignedTx = ({
  cosmosSdk,
  txBody,
  signerPubkey,
  sequence,
  gasLimit,
  signers = [],
}: {
  cosmosSdk: cosmosclient.CosmosSDK
  txBody: proto.cosmos.tx.v1beta1.TxBody
  signerPubkey: proto.google.protobuf.Any
  sequence: Long
  gasLimit: string
  signers?: boolean[]
}): cosmosclient.TxBuilder => {
  const authInfo = buildAuthInfo({
    signerPubkey,
    sequence,
    gasLimit,
    signers,
  })

  return new cosmosclient.TxBuilder(cosmosSdk, txBody, authInfo)
}

/**
 * Get the balance of a given address.
 *
 * @param {Address} address By default, it will return the balance of the current wallet. (optional)
 * @param {Asset} asset If not set, it will return all assets available. (optional)
 * @param {cosmosClient} CosmosSDKClient
 *
 * @returns {Balance[]} The balance of the address.
 */
export const getBalance = async ({
  address,
  assets,
  cosmosClient,
}: {
  address: Address
  assets?: Asset[]
  cosmosClient: CosmosSDKClient
}): Promise<Balance[]> => {
  const balances = await cosmosClient.getBalance(address)

  return balances
    .map((balance) => {
      return {
        asset: (balance.denom && getAsset(balance.denom)) || AssetRuneNative,
        amount: baseAmount(balance.amount, DECIMAL),
      }
    })
    .filter(
      (balance) => !assets || assets.filter((asset) => assetToString(balance.asset) === assetToString(asset)).length,
    )
}

/**
 * Get the client url.
 *
 * @returns {ClientUrl} The client url (both mainnet and testnet) for thorchain.
 */
export const getDefaultClientUrl = (isStagenet = false): ClientUrl => {
  if (isStagenet) {
    return {
      [Network.Testnet]: {
        node: 'https://testnet.thornode.thorchain.info',
        rpc: 'https://testnet-rpc.ninerealms.com',
      },
      [Network.Mainnet]: {
        node: 'https://stagenet-thornode.ninerealms.com',
        rpc: 'https://stagenet-rpc.ninerealms.com',
      },
    }
  }

  return {
    [Network.Testnet]: {
      node: 'https://testnet.thornode.thorchain.info',
      rpc: 'https://testnet-rpc.ninerealms.com',
    },
    [Network.Mainnet]: {
      node: 'https://thornode.ninerealms.com',
      rpc: 'https://rpc.ninerealms.com',
    },
  }
}

const DEFAULT_EXPLORER_URL = 'https://viewblock.io/thorchain'

/**
 * Get default explorer urls.
 *
 * @returns {ExplorerUrls} Default explorer urls (both mainnet and testnet) for thorchain.
 */
export const getDefaultExplorerUrls = (): ExplorerUrls => {
  const root: ExplorerUrl = {
    [Network.Testnet]: `${DEFAULT_EXPLORER_URL}?network=testnet`,
    [Network.Mainnet]: DEFAULT_EXPLORER_URL,
  }
  const txUrl = `${DEFAULT_EXPLORER_URL}/tx`
  const tx: ExplorerUrl = {
    [Network.Testnet]: txUrl,
    [Network.Mainnet]: txUrl,
  }
  const addressUrl = `${DEFAULT_EXPLORER_URL}/address`
  const address: ExplorerUrl = {
    [Network.Testnet]: addressUrl,
    [Network.Mainnet]: addressUrl,
  }

  return {
    root,
    tx,
    address,
  }
}

/**
 * Get the explorer url.
 *
 * @param {Network} network
 * @param {ExplorerUrls} Explorer urls
 * @returns {string} The explorer url for thorchain based on the given network.
 */
export const getExplorerUrl = ({ root }: ExplorerUrls, network: Network): string => root[network]

/**
 * Get explorer address url.
 *
 * @param {ExplorerUrls} Explorer urls
 * @param {Network} network
 * @param {Address} address
 * @returns {string} The explorer url for the given address.
 */
export const getExplorerAddressUrl = ({
  urls,
  network,
  address,
  isStagenet = false,
}: {
  urls: ExplorerUrls
  network: Network
  address: Address
  isStagenet?: boolean
}): string => {
  const url = `${urls.address[network]}/${address}`

  if (isStagenet) {
    return `${url}?network=stagenet`
  }

  switch (network) {
    case Network.Mainnet:
      return url
    case Network.Testnet:
      return `${url}?network=testnet`
  }
}

/**
 * Get transaction url.
 *
 * @param {ExplorerUrls} Explorer urls
 * @param {Network} network
 * @param {TxHash} txID
 * @returns {string} The explorer url for the given transaction id.
 */
export const getExplorerTxUrl = ({
  urls,
  network,
  txID,
  isStagenet = false,
}: {
  urls: ExplorerUrls
  network: Network
  txID: TxHash
  isStagenet?: boolean
}): string => {
  const url = `${urls.tx[network]}/${txID}`

  if (isStagenet) {
    return `${url}?network=stagenet`
  }

  switch (network) {
    case Network.Mainnet:
      return url
    case Network.Testnet:
      return `${url}?network=testnet`
  }
}

export const isAssetRuneNative = (asset: Asset): boolean => assetToString(asset) === assetToString(AssetRuneNative)

export const createMultisig = (pubKeys: string[], threshold: number) => {
  const pubKeyInstances = pubKeys.map(
    (pubKey) =>
      new proto.cosmos.crypto.secp256k1.PubKey({
        key: fromBase64(pubKey),
      }),
  )
  return new proto.cosmos.crypto.multisig.LegacyAminoPubKey({
    public_keys: pubKeyInstances.map((pubKeyInstance) => ({
      ...cosmosclient.codec.instanceToProtoAny(pubKeyInstance),
    })),
    threshold,
  })
}

export const getMultisigAddress = (multisigPubKey: proto.cosmos.crypto.multisig.LegacyAminoPubKey) =>
  cosmosclient.AccAddress.fromPublicKey(multisigPubKey).toString()

export const mergeSignatures = (signatures: Uint8Array[]) => {
  const multisig = proto.cosmos.crypto.multisig.v1beta1.MultiSignature.fromObject({ signatures })
  return proto.cosmos.crypto.multisig.v1beta1.MultiSignature.encode(multisig).finish()
}

export const exportSignature = (signature: Uint8Array) => toBase64(signature)

export const importSignature = (signature: string) => fromBase64(signature)

export const exportMultisigTx = (txBuilder: cosmosclient.TxBuilder) => txBuilder.toProtoJSON()

export const importMultisigTx = (cosmosSdk: cosmosclient.CosmosSDK, tx: any) => {
  try {
    const messages = tx.body.messages.map((message: any) =>
      (message['@type'] as string).endsWith('MsgSend')
        ? types.types.MsgSend.fromObject(message)
        : types.types.MsgDeposit.fromObject(message),
    )

    const txBody = new proto.cosmos.tx.v1beta1.TxBody({
      messages: messages.map((message: any) => cosmosclient.codec.instanceToProtoAny(message)),
      memo: tx.body.memo,
    })

    const signerInfo = tx.auth_info.signer_infos[0]

    const multisig = new proto.cosmos.crypto.multisig.LegacyAminoPubKey({
      public_keys: signerInfo.public_key.public_keys.map((publicKey: any) =>
        cosmosclient.codec.instanceToProtoAny(
          new proto.cosmos.crypto.secp256k1.PubKey({
            key: fromBase64(publicKey.key),
          }),
        ),
      ),
      threshold: signerInfo.public_key.threshold,
    })

    const authInfo = new proto.cosmos.tx.v1beta1.AuthInfo({
      signer_infos: [
        {
          public_key: cosmosclient.codec.instanceToProtoAny(multisig),
          mode_info: {
            multi: {
              bitarray: proto.cosmos.crypto.multisig.v1beta1.CompactBitArray.fromObject({
                extra_bits_stored: signerInfo.mode_info.multi.bitarray.extra_bits_stored,
                elems: signerInfo.mode_info.multi.bitarray.elems,
              }),
              mode_infos: signerInfo.mode_info.multi.mode_infos.map(() => ({
                single: {
                  mode: proto.cosmos.tx.signing.v1beta1.SignMode.SIGN_MODE_DIRECT,
                },
              })),
            },
          },
          sequence: Long.fromString(signerInfo.sequence),
        },
      ],
      fee: {
        ...tx.auth_info.fee,
        gas_limit: Long.fromString(tx.auth_info.fee.gas_limit),
      },
    })

    return new cosmosclient.TxBuilder(cosmosSdk, txBody, authInfo)
  } catch (e) {
    throw new Error(`Invalid transaction object: ${e}`)
  }
}

export const validateTHORNameAddress = async (address: string, isStagenet: boolean, chain: Chain): Promise<boolean> => {
  const url = isStagenet ? STAGENET_MIDGARD_API_BASE : MAINNET_MIDGARD_API_BASE

  try {
    const { data } = await axios.get(`${url}/thorname/lookup/${address}`)

    return !!data.entries?.find((entry: THORNameResultEntry) => entry.chain === chain)
  } catch (error) {
    return false
  }
}
