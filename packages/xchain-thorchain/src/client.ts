import { cosmosclient, proto } from '@cosmos-client/core'
import {
  Address,
  Balance,
  BaseXChainClient,
  FeeType,
  Fees,
  Network,
  PrivateKeyCache,
  Tx,
  TxFrom,
  TxHash,
  TxHistoryParams,
  TxParams,
  TxTo,
  TxType,
  TxsPage,
  XChainClient,
  XChainClientParams,
  singleFee,
} from '@thorswap-lib/xchain-client'
import { CosmosSDKClient, RPCTxResult } from '@thorswap-lib/xchain-cosmos'
import {
  Asset,
  AssetRuneNative,
  BaseAmount,
  Chain,
  assetFromString,
  assetToString,
  baseAmount,
  deepEqual,
} from '@thorswap-lib/xchain-util'
import axios from 'axios'
import Long from 'long'

import {
  ChainId,
  ChainIds,
  ClientUrl,
  DepositParam,
  ExplorerUrls,
  NodeUrl,
  ThorchainClientParams,
  ThorchainConstantsResponse,
  TxData,
  TxOfflineParams,
} from './types'
import { TxResult } from './types/messages'
import {
  DECIMAL,
  DEFAULT_GAS_VALUE,
  MAX_TX_COUNT,
  THORCHAIN_MAINNET_CHAIN_ID,
  THORCHAIN_STAGENET_CHAIN_ID,
  THORCHAIN_TESTNET_CHAIN_ID,
  buildDepositTx,
  buildTransferTx,
  buildUnsignedTx,
  getBalance,
  getDefaultClientUrl,
  getDefaultExplorerUrls,
  getDefaultFees,
  getDenom,
  getDepositTxDataFromLogs,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getPrefix,
  isAssetRuneNative,
  registerDespositCodecs,
  registerSendCodecs,
  validateTHORNameAddress,
} from './util'

/**
 * Interface for custom Thorchain client
 */
export interface ThorchainClient {
  setClientUrl(clientUrl: ClientUrl): void
  getClientUrl(): NodeUrl
  setExplorerUrls(explorerUrls: ExplorerUrls): void
  getCosmosClient(): CosmosSDKClient
  getChainId(): string

  deposit(params: DepositParam): Promise<TxHash>
}

/**
 * Custom Thorchain Client
 */
class Client extends BaseXChainClient implements ThorchainClient, XChainClient {
  private clientUrl: ClientUrl
  private explorerUrls: ExplorerUrls
  private cosmosClient: CosmosSDKClient
  private isStagenet = false
  private chainIds: ChainIds = {
    [Network.Mainnet]: THORCHAIN_MAINNET_CHAIN_ID,
    [Network.Testnet]: THORCHAIN_TESTNET_CHAIN_ID,
  }
  private privateKeyCache: PrivateKeyCache<proto.cosmos.crypto.secp256k1.PrivKey> | undefined

  /**
   * Constructor
   *
   * Client has to be initialised with network type and phrase.
   * It will throw an error if an invalid phrase has been passed.
   *
   * @param {XChainClientParams} params
   *
   * @throws {"Invalid phrase"} Thrown if the given phase is invalid.
   */
  constructor({
    network = Network.Testnet,
    phrase,
    clientUrl,
    explorerUrls,
    rootDerivationPaths = {
      [Network.Mainnet]: "44'/931'/0'/0/",
      [Network.Testnet]: "44'/931'/0'/0/",
    },
    isStagenet = false,
    privateKeyInit,
  }: XChainClientParams & ThorchainClientParams) {
    super(Chain.THORChain, { network, rootDerivationPaths, phrase })

    this.network = network
    this.clientUrl = clientUrl || getDefaultClientUrl(isStagenet)
    this.explorerUrls = explorerUrls || getDefaultExplorerUrls()

    this.isStagenet = isStagenet

    this.setChainId()

    this.cosmosClient = new CosmosSDKClient({
      server: this.getClientUrl().node,
      chainId: this.getChainId(),
      prefix: getPrefix(this.network, this.isStagenet),
    })
    this.privateKeyCache = privateKeyInit
  }

  setChainId(chainIds?: ChainIds) {
    if (chainIds) {
      this.chainIds = chainIds
    } else if (this.isStagenet) {
      this.chainIds = {
        [Network.Mainnet]: THORCHAIN_STAGENET_CHAIN_ID,
        [Network.Testnet]: THORCHAIN_TESTNET_CHAIN_ID,
      }
    } else {
      this.chainIds = {
        [Network.Mainnet]: THORCHAIN_MAINNET_CHAIN_ID,
        [Network.Testnet]: THORCHAIN_TESTNET_CHAIN_ID,
      }
    }
  }

  /**
   * get chain id per network
   * NOTE: Use hardcoded chain id
   */
  getChainId(network?: Network): ChainId {
    return this.chainIds[network || this.network]
  }

  /**
   * Set/update the current network.
   *
   * @param {Network} network
   * @returns {void}
   *
   * @throws {"Network must be provided"}
   * Thrown if network has not been set before.
   */
  setNetwork(network: Network): void {
    super.setNetwork(network)
    this.cosmosClient.updatePrefix(getPrefix(this.network, this.isStagenet))
  }

  /**
   * Set/update the client URL.
   *
   * @param {ClientUrl} clientUrl The client url to be set.
   * @returns {void}
   */
  setClientUrl(clientUrl: ClientUrl): void {
    this.clientUrl = clientUrl
  }

  /**
   * Get the client url.
   *
   * @returns {NodeUrl} The client url for thorchain based on the current network.
   */
  getClientUrl(): NodeUrl {
    return this.clientUrl[this.network]
  }

  /**
   * Set/update the explorer URLs.
   *
   * @param {ExplorerUrls} urls The explorer urls to be set.
   * @returns {void}
   */
  setExplorerUrls(urls: ExplorerUrls): void {
    this.explorerUrls = urls
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url for thorchain based on the current network.
   */
  getExplorerUrl(): string {
    if (this.isStagenet) {
      return `${this.explorerUrls.root[this.network]}?network=stagenet`
    }

    return this.explorerUrls.root[this.network]
  }

  /**
   * Get cosmos client
   * @returns {CosmosSDKClient} current cosmos client
   */
  getCosmosClient(): CosmosSDKClient {
    return this.cosmosClient
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address.
   */
  getExplorerAddressUrl(address: Address): string {
    return getExplorerAddressUrl({
      urls: this.explorerUrls,
      network: this.network,
      address,
      isStagenet: this.isStagenet,
    })
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID
   * @returns {string} The explorer url for the given transaction id.
   */
  getExplorerTxUrl(txID: string): string {
    return getExplorerTxUrl({ urls: this.explorerUrls, network: this.network, txID, isStagenet: this.isStagenet })
  }

  /**
   * Get private key
   *
   * @param {number} index the HD wallet index (optional)
   * @returns {PrivKey} The private key generated from the given phrase
   *
   * @throws {"Phrase not set"}
   * Throws an error if phrase has not been set before
   * */
  getPrivateKey(index = 0): proto.cosmos.crypto.secp256k1.PrivKey {
    if (
      this.privateKeyCache &&
      deepEqual(this.privateKeyCache, {
        index,
        phrase: this.phrase,
        network: this.network,
        privateKey: this.privateKeyCache.privateKey,
      })
    )
      return this.privateKeyCache.privateKey

    const privateKey = this.createPrivateKey(this.phrase, index)

    this.privateKeyCache = {
      network: this.network,
      phrase: this.phrase,
      index,
      privateKey,
    }

    return privateKey
  }

  /**
   * Create private key
   *
   * @param {string} phrase the seed phrase
   * @param {number} index the HD wallet index (optional)
   * @returns {PrivKey} The private key generated from the given phrase
   *
   * @throws {"Phrase not set"}
   * Throws an error if phrase has not been set before
   * */
  createPrivateKey(phrase: string, index = 0): proto.cosmos.crypto.secp256k1.PrivKey {
    return this.cosmosClient.getPrivKeyFromMnemonic(phrase, this.getFullDerivationPath(index))
  }

  /**
   * Get public key
   *
   * @param {number} index the HD wallet index (optional)
   *
   * @returns {PubKey} The public key generated from the given phrase
   *
   * @throws {"Phrase not set"}
   * Throws an error if phrase has not been set before
   **/
  getPubKey(index = 0): cosmosclient.PubKey {
    const privKey = this.getPrivateKey(index)
    return privKey.pubKey()
  }

  /**
   * Get the current address.
   *
   * @returns {Address} The current address.
   *
   * @throws {Error} Thrown if phrase has not been set before. A phrase is needed to create a wallet and to derive an address from it.
   */
  getAddress(index = 0): string {
    const address = this.cosmosClient.getAddressFromMnemonic(this.phrase, this.getFullDerivationPath(index))
    if (!address) {
      throw new Error('address not defined')
    }

    return address
  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress(address: Address): boolean {
    return this.cosmosClient.checkAddress(address)
  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {Promise<boolean>} `true` or `false`
   */
  async validateAddressAndThorname(address: Address): Promise<boolean> {
    return this.validateAddress(address) || validateTHORNameAddress(address, this.isStagenet, Chain.THORChain)
  }

  /**
   * Get the balance of a given address.
   *
   * @param {Address} address By default, it will return the balance of the current wallet. (optional)
   * @param {Asset} asset If not set, it will return all assets available. (optional)
   * @returns {Balance[]} The balance of the address.
   */
  async getBalance(address: Address, assets?: Asset[]): Promise<Balance[]> {
    return getBalance({ address, assets, cosmosClient: this.getCosmosClient() })
  }

  /**
   * Get transaction history of a given address with pagination options.
   * By default it will return the transaction history of the current wallet.
   *
   * @param {TxHistoryParams} params The options to get transaction history. (optional)
   * @returns {TxsPage} The transaction history.
   */
  getTransactions = async (
    params?: TxHistoryParams & { filterFn?: (tx: RPCTxResult) => boolean },
  ): Promise<TxsPage> => {
    const messageAction = undefined
    const offset = params?.offset || 0
    const limit = params?.limit || 10
    const address = params?.address || this.getAddress()
    const txMinHeight = undefined
    const txMaxHeight = undefined

    const txIncomingHistory = (
      await this.cosmosClient.searchTxFromRPC({
        rpcEndpoint: this.getClientUrl().rpc,
        messageAction,
        transferRecipient: address,
        limit: MAX_TX_COUNT,
        txMinHeight,
        txMaxHeight,
      })
    ).txs
    const txOutgoingHistory = (
      await this.cosmosClient.searchTxFromRPC({
        rpcEndpoint: this.getClientUrl().rpc,
        messageAction,
        transferSender: address,
        limit: MAX_TX_COUNT,
        txMinHeight,
        txMaxHeight,
      })
    ).txs

    let history: RPCTxResult[] = txIncomingHistory
      .concat(txOutgoingHistory)
      .sort((a, b) => {
        if (a.height !== b.height) return parseInt(b.height) > parseInt(a.height) ? 1 : -1
        if (a.hash !== b.hash) return a.hash > b.hash ? 1 : -1
        return 0
      })
      .reduce(
        (acc, tx) => [...acc, ...(acc.length === 0 || acc[acc.length - 1].hash !== tx.hash ? [tx] : [])],
        [] as RPCTxResult[],
      )
      .filter(params?.filterFn ? params.filterFn : (tx) => tx)
      .filter((_, index) => index < MAX_TX_COUNT)

    // get `total` before filtering txs out for pagination
    const total = history.length

    history = history.filter((_, index) => index >= offset && index < offset + limit)

    const txs = await Promise.all(history.map(({ hash }) => this.getTransactionData(hash, address)))

    return {
      total,
      txs,
    }
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   */
  async getTransactionData(txId: string, address: Address): Promise<Tx> {
    const txResult = await this.cosmosClient.txsHashGet(txId)

    const txData: TxData | null = txResult && txResult.logs ? getDepositTxDataFromLogs(txResult.logs, address) : null
    if (!txResult || !txData) throw new Error(`Failed to get transaction data (tx-hash: ${txId})`)

    const { from, to, type } = txData

    return {
      hash: txId,
      asset: AssetRuneNative,
      from,
      to,
      date: new Date(txResult.timestamp),
      type,
    }
  }

  /**
   * Get the transaction details of a given transaction id. (from /thorchain/txs/hash)
   *
   * Node: /thorchain/txs/hash response doesn't have timestamp field.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   */
  async getDepositTransaction(txId: string): Promise<Omit<Tx, 'date'>> {
    const result: TxResult = (await axios.get(`${this.getClientUrl().node}/thorchain/tx/${txId}`)).data

    if (!result || !result.observed_tx) throw new Error('transaction not found')

    const from: TxFrom[] = []
    const to: TxTo[] = []
    let asset
    result.observed_tx.tx.coins.forEach((coin) => {
      from.push({
        from: result.observed_tx.tx.from_address,
        amount: baseAmount(coin.amount, DECIMAL),
      })
      to.push({
        to: result.observed_tx.tx.to_address,
        amount: baseAmount(coin.amount, DECIMAL),
      })
      asset = assetFromString(coin.asset)
    })

    return {
      asset: asset || AssetRuneNative,
      from,
      to,
      type: TxType.Transfer,
      hash: txId,
    }
  }

  /**
   * Transaction with MsgNativeTx.
   *
   * @param {DepositParam} params The transaction options.
   * @returns {TxHash} The transaction hash.
   *
   * @throws {"insufficient funds"} Thrown if the wallet has insufficient funds.
   * @throws {"failed to broadcast transaction"} Thrown if failed to broadcast transaction.
   */
  async deposit({ walletIndex = 0, asset = AssetRuneNative, amount, memo }: DepositParam): Promise<TxHash> {
    await registerDespositCodecs()

    const balances = await this.getBalance(this.getAddress(walletIndex))
    const runeBalance: BaseAmount =
      balances.filter(({ asset }) => isAssetRuneNative(asset))[0]?.amount ?? baseAmount(0, DECIMAL)
    const assetBalance: BaseAmount =
      balances.filter(({ asset: assetInList }) => assetToString(assetInList) === assetToString(asset))[0]?.amount ??
      baseAmount(0, DECIMAL)
    /// Note: comment the balance check for synth integration
    // const assetBalance = await this.getBalance(this.getAddress(walletIndex), [asset])

    const { average: fee } = await this.getFees()

    if (isAssetRuneNative(asset)) {
      // amount + fee < runeBalance
      if (runeBalance.lt(amount.plus(fee))) {
        throw new Error('insufficient funds')
      }
    } else {
      // amount < assetBalances && runeBalance < fee
      if (assetBalance.lt(amount) || runeBalance.lt(fee)) {
        throw new Error('insufficient funds')
      }
    }

    const privKey = this.getPrivateKey(walletIndex)
    const signerPubkey = privKey.pubKey()

    const fromAddress = this.getAddress(walletIndex)
    const fromAddressAcc = cosmosclient.AccAddress.fromString(fromAddress)

    // patch if asset is synth
    const assetObj = asset.symbol.includes('/')
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chain: (asset.symbol.split('/')[0] as any).toLowerCase(),
          symbol: asset.symbol.split('/')[1].toLowerCase(),
          ticker: asset.symbol.split('/')[1].toLowerCase(),
          synth: true,
        }
      : asset

    const depositTxBody = await buildDepositTx({
      msgNativeTx: {
        memo: memo,
        signer: fromAddressAcc,
        coins: [
          {
            asset: assetObj,
            amount: amount.amount().toString(),
          },
        ],
      },
      nodeUrl: this.getClientUrl().node,
      chainId: this.getChainId(),
    })

    const account = await this.getCosmosClient().getAccount(fromAddressAcc)

    const txBuilder = buildUnsignedTx({
      cosmosSdk: this.getCosmosClient().sdk,
      txBody: depositTxBody,
      signerPubkey: cosmosclient.codec.instanceToProtoAny(signerPubkey),
      gasLimit: DEFAULT_GAS_VALUE,
      sequence: (account.sequence as Long) || Long.ZERO,
    })

    return (await this.getCosmosClient().signAndBroadcast(txBuilder, privKey, account)) || ''
  }

  /**
   * Builds final unsigned TX
   *
   * @param cosmosSdk - CosmosSDK
   * @param txBody - txBody with encoded Msgs
   * @param signerPubkey - signerPubkey string
   * @param sequence - account sequence
   * @param gasLimit - transaction gas limit
   * @returns
   */
  buildUnsignedTx = ({
    cosmosSdk,
    txBody,
    signerPubkey,
    sequence,
    gasLimit,
  }: {
    cosmosSdk: cosmosclient.CosmosSDK
    txBody: proto.cosmos.tx.v1beta1.TxBody
    signerPubkey: proto.google.protobuf.Any
    sequence: Long
    gasLimit: string
  }): cosmosclient.TxBuilder => {
    const authInfo = new proto.cosmos.tx.v1beta1.AuthInfo({
      signer_infos: [
        {
          public_key: signerPubkey,
          mode_info: {
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

    return new cosmosclient.TxBuilder(cosmosSdk, txBody, authInfo)
  }

  /**
   * Transfer balances with MsgSend
   *
   * @param {TxParams} params The transfer options.
   * @returns {TxHash} The transaction hash.
   */
  async transfer({ walletIndex = 0, asset = AssetRuneNative, amount, recipient, memo }: TxParams): Promise<TxHash> {
    await registerSendCodecs()

    const balances = await this.getBalance(this.getAddress(walletIndex))
    const runeBalance: BaseAmount =
      balances.filter(({ asset }) => isAssetRuneNative(asset))[0]?.amount ?? baseAmount(0, DECIMAL)
    const assetBalance: BaseAmount =
      balances.filter(({ asset: assetInList }) => assetToString(assetInList) === assetToString(asset))[0]?.amount ??
      baseAmount(0, DECIMAL)

    const fee = (await this.getFees()).average

    if (isAssetRuneNative(asset)) {
      // amount + fee < runeBalance
      if (runeBalance.lt(amount.plus(fee))) {
        throw new Error('insufficient funds')
      }
    } else {
      // amount < assetBalances && runeBalance < fee
      if (assetBalance.lt(amount) || runeBalance.lt(fee)) {
        throw new Error('insufficient funds')
      }
    }

    const privKey = this.getPrivateKey(walletIndex)
    const from = this.getAddress(walletIndex)
    const signerPubkey = privKey.pubKey()
    const accAddress = cosmosclient.AccAddress.fromString(from)

    const denom = getDenom(asset)

    const txBody = await buildTransferTx({
      fromAddress: from,
      toAddress: recipient,
      memo: memo,
      assetAmount: amount,
      assetDenom: denom,
      chainId: this.getChainId(),
      nodeUrl: this.getClientUrl().node,
    })

    const account = await this.getCosmosClient().getAccount(accAddress)

    const txBuilder = this.buildUnsignedTx({
      cosmosSdk: this.getCosmosClient().sdk,
      txBody: txBody,
      gasLimit: DEFAULT_GAS_VALUE,
      signerPubkey: cosmosclient.codec.instanceToProtoAny(signerPubkey),
      sequence: (account.sequence as Long) || Long.ZERO,
    })

    return (await this.getCosmosClient().signAndBroadcast(txBuilder, privKey, account)) || ''
  }

  /**
   * Transfer without broadcast balances with MsgSend
   *
   * @param {TxOfflineParams} params The transfer offline options.
   * @returns {string} The signed transaction bytes.
   */
  async transferOffline({
    walletIndex = 0,
    asset = AssetRuneNative,
    amount,
    recipient,
    memo,
    from_rune_balance,
    from_asset_balance = baseAmount(0, DECIMAL),
    from_account_number = '0',
    from_sequence = '0',
  }: TxOfflineParams): Promise<string> {
    const fee = (await this.getFees()).average

    if (isAssetRuneNative(asset)) {
      // amount + fee < runeBalance
      if (from_rune_balance.lt(amount.plus(fee))) {
        throw new Error('insufficient funds')
      }
    } else {
      // amount < assetBalances && runeBalance < fee
      if (from_asset_balance.lt(amount) || from_rune_balance.lt(fee)) {
        throw new Error('insufficient funds')
      }
    }

    const txBody = await buildTransferTx({
      fromAddress: this.getAddress(walletIndex),
      toAddress: recipient,
      memo,
      assetAmount: amount,
      assetDenom: getDenom(asset),
      chainId: this.getChainId(),
      nodeUrl: this.getClientUrl().node,
    })

    const privKey = this.getPrivateKey(walletIndex)

    const txBuilder = buildUnsignedTx({
      cosmosSdk: this.getCosmosClient().sdk,
      txBody: txBody,
      gasLimit: DEFAULT_GAS_VALUE,
      signerPubkey: cosmosclient.codec.instanceToProtoAny(privKey.pubKey()),
      sequence: Long.fromString(from_sequence) || Long.ZERO,
    })

    const signDocBytes = txBuilder.signDocBytes(Long.fromString(from_account_number))
    txBuilder.addSignature(privKey.sign(signDocBytes))
    return txBuilder.txBytes()
  }

  /**
   * Get the fees.
   *
   * @returns {Fees}
   */
  async getFees(): Promise<Fees> {
    try {
      const {
        data: {
          int_64_values: { NativeTransactionFee: fee },
        },
      } = await axios.get<ThorchainConstantsResponse>(`${this.getClientUrl().node}/thorchain/constants`)

      // validate data
      if (!fee || isNaN(fee) || fee < 0) throw Error(`Invalid fee: ${fee.toString()}`)

      return singleFee(FeeType.FlatFee, baseAmount(fee))
    } catch {
      return getDefaultFees()
    }
  }
}

export { Client }
