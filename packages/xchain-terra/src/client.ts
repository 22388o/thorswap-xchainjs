/* eslint-disable ordered-imports/ordered-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AccAddress,
  Coin,
  Coins,
  Fee,
  LCDClient,
  MnemonicKey,
  MsgMultiSend,
  MsgSend,
  TxInfo,
} from '@terra-money/terra.js'
import {
  Balance,
  BaseXChainClient,
  Fees,
  Network,
  Tx,
  TxFrom,
  TxHistoryParams,
  TxParams,
  TxTo,
  TxType,
  TxsPage,
  XChainClient,
  XChainClientParams,
  PrivateKeyCache,
} from '@thorswap-lib/xchain-client'
import { Asset, AssetLUNA, Chain, baseAmount, deepEqual } from '@thorswap-lib/xchain-util'
import axios from 'axios'
import { Denom } from './const'
import { isLunaAsset, isUSTAsset } from './utils'

const DEFAULT_CONFIG = {
  [Network.Mainnet]: {
    explorerURL: 'https://finder.terra.money/classic',
    explorerAddressURL: 'https://finder.terra.money/classic/address',
    explorerTxURL: 'https://finder.terra.money/classic/tx',
    cosmosAPIURL: 'https://fcd.terra.dev',
    ChainID: 'columbus-5',
  },
  [Network.Testnet]: {
    explorerURL: 'https://finder.terra.money/testnet',
    explorerAddressURL: 'https://finder.terra.money/testnet/address',
    explorerTxURL: 'https://finder.terra.money/testnet/tx',
    cosmosAPIURL: 'https://bombay-fcd.terra.dev',
    ChainID: 'bombay-12',
  },
}

export type SearchTxParams = {
  messageAction?: string
  messageSender?: string
  transferSender?: string
  transferRecipient?: string
  page?: number
  limit?: number
  txMinHeight?: number
  txMaxHeight?: number
}

export type TerraClientParams = XChainClientParams & {
  privateKeyInit?: PrivateKeyCache<MnemonicKey>
}

/**
 * Terra Client
 */
class Client extends BaseXChainClient implements XChainClient {
  private lcdClient: LCDClient
  private privateKeyCache: PrivateKeyCache<MnemonicKey> | undefined
  constructor({
    network = Network.Testnet,

    phrase,
    rootDerivationPaths = {
      [Network.Mainnet]: "44'/330'/0'/0/",
      [Network.Testnet]: "44'/330'/0'/0/",
    },
    privateKeyInit,
  }: TerraClientParams) {
    super(Chain.Terra, { network, rootDerivationPaths, phrase })

    //TODO add client variables to ctor to override DEFAULT_CONFIG
    this.lcdClient = new LCDClient({
      URL: DEFAULT_CONFIG[this.network].cosmosAPIURL,
      chainID: DEFAULT_CONFIG[this.network].ChainID,
    })

    this.privateKeyCache = privateKeyInit
  }

  async getFees(): Promise<Fees> {
    // this function is not supported for terra/luna chain
    throw new Error('Not supported.')
  }

  async getTerraFees(denom: Denom = 'uluna'): Promise<Coin> {
    const gasPrices = (await axios(DEFAULT_CONFIG[this.network].cosmosAPIURL + '/v1/txs/gas_prices')).data
    const gasPricesCoins = new Coins(gasPrices)

    const coin = gasPricesCoins.get(denom)

    if (!coin) throw new Error('Invalid Denomination')
    return coin
  }

  async calculateTxFees({
    walletIndex = 0,
    asset = AssetLUNA,
    amount,
    recipient,
    rates,
  }: TxParams & { rates: Coin }): Promise<Fee> {
    const mnemonicKey = this.getMnemonicKey(walletIndex)
    const wallet = this.lcdClient.wallet(mnemonicKey)

    let amountToSend: Coins.Input = {}

    if (isLunaAsset(asset)) {
      amountToSend = {
        uluna: `${amount.amount().toFixed()}`,
      }
      //TODO we have to make sure that UST is supported by Thorchain
    } else if (isUSTAsset(asset)) {
      amountToSend = {
        uusd: `${amount.amount().toFixed()}`,
      }
    } else {
      throw new Error('Only LUNA or UST transfers are currently supported on terra')
    }
    const send = new MsgSend(wallet.key.accAddress, recipient, amountToSend)

    const gasPriceCoins = new Coins([rates])

    // Create tx
    // This also estimates the initial fees
    const tx = await wallet.createTx({
      msgs: [send],
      gasPrices: gasPriceCoins,
    })
    // Extract estimated fee
    return tx.auth_info.fee
  }

  getAddress(walletIndex = 0): string {
    const mnemonicKey = this.getMnemonicKey(walletIndex)
    return mnemonicKey.accAddress
  }
  getExplorerUrl(): string {
    return DEFAULT_CONFIG[this.network].explorerURL
  }
  getExplorerAddressUrl(address: string): string {
    return DEFAULT_CONFIG[this.network].explorerAddressURL + '/' + address?.toLowerCase()
  }
  getExplorerTxUrl(txID: string): string {
    return DEFAULT_CONFIG[this.network].explorerTxURL + '/' + txID?.toLowerCase()
  }
  validateAddress(address: string): boolean {
    return AccAddress.validate(address)
  }
  async getBalance(address: string, assets?: Asset[]): Promise<Balance[]> {
    let balances: Balance[] = []
    let [coins, pagination] = await this.lcdClient.bank.balance(address)
    balances = balances.concat(this.coinsToBalances(coins))
    while (pagination.next_key) {
      ;[coins, pagination] = await this.lcdClient.bank.balance(address, { 'pagination.offset': pagination.next_key })
      balances = balances.concat(this.coinsToBalances(coins))
    }

    if (assets) {
      //filter out only the assets the user wants to see
      return balances.filter((bal: Balance) => {
        const exists = assets.find((asset) => asset.symbol === bal.asset.symbol)
        return exists !== undefined
      })
    } else {
      return balances
    }
  }
  setNetwork(network: Network): void {
    super.setNetwork(network)
    this.lcdClient = new LCDClient({
      URL: DEFAULT_CONFIG[this.network].cosmosAPIURL,
      chainID: DEFAULT_CONFIG[this.network].ChainID,
    })
  }
  async getTransactions(params?: TxHistoryParams): Promise<TxsPage> {
    //TODO filter by start time?
    //TODO filter by asset
    const address = params?.address || this.getAddress()
    const offset = params?.offset ? `${params?.offset}` : '0'
    const limit = params?.limit ? `${params?.limit}` : '100'
    const results = (
      await axios.get(
        `${DEFAULT_CONFIG[this.network].cosmosAPIURL}/v1/txs?offset=${offset}&limit=${limit}&account=${address}`,
      )
    ).data

    const txs: Tx[] = results.txs.map((tx: unknown) => this.convertSearchResultTxToTx(tx))
    return {
      total: results.txs.length,
      txs,
    }
  }

  async getTransactionData(txId: string): Promise<Tx> {
    const txInfo = await this.lcdClient.tx.txInfo(txId?.toUpperCase())
    return this.convertTxInfoToTx(txInfo)
  }

  async transfer({
    walletIndex = 0,
    asset = AssetLUNA,
    amount,
    recipient,
    memo,
    fee,
  }: TxParams & { fee?: Fee }): Promise<string> {
    if (!this.validateAddress(recipient)) throw new Error(`${recipient} is not a valid terra address`)

    const mnemonicKey = this.getMnemonicKey(walletIndex)
    const wallet = this.lcdClient.wallet(mnemonicKey)

    let amountToSend: Coins.Input = {}

    if (isLunaAsset(asset)) {
      amountToSend = {
        uluna: `${amount.amount().toFixed()}`,
      }
    } else if (isUSTAsset(asset)) {
      amountToSend = {
        uusd: `${amount.amount().toFixed()}`,
      }
    } else {
      throw new Error('Only LUNA or UST transfers are currently supported on terra')
    }
    const send = new MsgSend(wallet.key.accAddress, recipient, amountToSend)
    const tx = await wallet.createAndSignTx({ msgs: [send], memo, fee })
    const result = await this.lcdClient.tx.broadcast(tx)
    return result.txhash
  }
  private getTerraNativeAsset(denom: string): Asset | undefined {
    if (denom.includes('luna')) {
      return AssetLUNA
    } else {
      // native coins other than luna, UST, KRT, etc
      // NOTE: https://docs.terra.money/Reference/Terra-core/Overview.html#currency-denominations
      const standardDenom = denom.toUpperCase().slice(1, 3) + 'T'
      return {
        chain: Chain.Terra,
        symbol: standardDenom,
        ticker: standardDenom,
        synth: false,
      }
    }
  }
  private coinsToBalances(coins: Coins): Balance[] {
    return coins.toArray().map((c: Coin) => {
      return {
        asset: this.getTerraNativeAsset(c.denom),
        amount: baseAmount(c.amount.toFixed(), 6),
      }
    }) as unknown as Balance[]
  }
  private convertSearchResultTxToTx(tx: any): Tx {
    let from: TxFrom[] = []
    let to: TxTo[] = []
    // console.log(tx)
    tx.tx.value.msg.forEach((msg: any) => {
      if (msg.type === 'bank/MsgSend') {
        const xfers = this.convertMsgSend(MsgSend.fromAmino(msg))
        from = from.concat(xfers.from)
        to = to.concat(xfers.to)
      } else if (msg.type === 'bank/MsgMultiSend') {
        const xfers = this.convertMsgMultiSend(MsgMultiSend.fromAmino(msg))
        from = from.concat(xfers.from)
        to = to.concat(xfers.to)
      } else {
        // we ignore every other type of msg
        //TODO remove this log after testing
        console.log(msg.type)
      }
    })
    return {
      // NOTE: since multiple assettypes can be xfered in one tx, this asset should not really exist
      // TODO we shoudl consider refactoring xchain-client.Tx to remove the top level Asset...
      asset: {
        chain: Chain.Terra,
        symbol: '',
        ticker: '',
        synth: false,
      },
      from,
      to,
      date: new Date(tx.timestamp),
      type: TxType.Transfer,
      hash: tx.txhash,
    }
  }
  private convertTxInfoToTx(txInfo: TxInfo): Tx {
    let from: TxFrom[] = []
    let to: TxTo[] = []
    txInfo.tx.body.messages.forEach((msg) => {
      const msgObject = JSON.parse(msg.toJSON())
      if (msgObject['@type'] === '/cosmos.bank.v1beta1.MsgSend') {
        const xfers = this.convertMsgSend(msg as MsgSend)
        from = from.concat(xfers.from)
        to = to.concat(xfers.to)
      } else if (msgObject['@type'] === '/cosmos.bank.v1beta1.MsgMultiSend') {
        const xfers = this.convertMsgMultiSend(msg as MsgMultiSend)
        from = from.concat(xfers.from)
        to = to.concat(xfers.to)
      } else {
        //we ignore every other type of msg
        console.log(msgObject['@type'])
      }
    })
    return {
      // NOTE: since multiple assettypes can be xfered in one tx, this asset should not really exist
      // TODO we shoudl consider refactoring xchain-client.Tx to remove the top level Asset...
      asset: {
        chain: Chain.Terra,
        symbol: '',
        ticker: '',
        synth: false,
      },
      from,
      to,
      date: new Date(txInfo.timestamp),
      type: TxType.Transfer,
      hash: txInfo.txhash,
    }
  }
  private convertMsgSend(msgSend: MsgSend): { from: TxFrom[]; to: TxTo[] } {
    const from: TxFrom[] = []
    const to: TxTo[] = []
    msgSend.amount.toArray().forEach((coin) => {
      //ensure this is in base units ex uluna, uusd
      const baseCoin = coin.toIntCoin()
      const asset = this.getTerraNativeAsset(baseCoin.denom)
      const amount = baseAmount(baseCoin.amount.toFixed(), 6)
      if (asset) {
        // NOTE: this will only populate native terra Assets
        from.push({
          from: msgSend.from_address,
          amount,
          asset,
        })
        to.push({
          to: msgSend.to_address,
          amount,
          asset,
        })
      }
    })

    return { from, to }
  }
  private convertMsgMultiSend(msgMultiSend: MsgMultiSend): { from: TxFrom[]; to: TxTo[] } {
    const from: TxFrom[] = []
    const to: TxTo[] = []
    msgMultiSend.inputs.forEach((input) => {
      input.coins.toArray().forEach((coin) => {
        //ensure this is in base units ex uluna, uusd
        const baseCoin = coin.toIntCoin()
        const asset = this.getTerraNativeAsset(baseCoin.denom)
        const amount = baseAmount(baseCoin.amount.toFixed(), 6)
        if (asset) {
          // NOTE: this will only populate native terra Assets
          from.push({
            from: input.address,
            amount,
            asset,
          })
        }
      })
    })
    msgMultiSend.outputs.forEach((output) => {
      output.coins.toArray().forEach((coin) => {
        //ensure this is in base units ex uluna, uusd
        const baseCoin = coin.toIntCoin()
        const asset = this.getTerraNativeAsset(baseCoin.denom)
        const amount = baseAmount(baseCoin.amount.toFixed(), 6)
        if (asset) {
          // NOTE: this will only populate native terra Assets
          to.push({
            to: output.address,
            amount,
            asset,
          })
        }
      })
    })

    return { from, to }
  }

  /**
   * @private
   * Gets MnemonicKey for wallet index
   *
   * @param {number} walletIndex
   * @returns {MnemonicKey}
   */
  private getMnemonicKey(walletIndex = 0): MnemonicKey {
    if (
      this.privateKeyCache &&
      deepEqual(this.privateKeyCache, {
        index: walletIndex,
        phrase: this.phrase,
        network: this.network,
        privateKey: this.privateKeyCache.privateKey,
      })
    )
      return this.privateKeyCache?.privateKey

    const privateKey = this.createMnemonicKey(walletIndex)

    this.privateKeyCache = {
      index: walletIndex,
      phrase: this.phrase,
      network: this.network,
      privateKey,
    }
    return privateKey
  }

  /**
   * Creates MnemonicKey for wallet index
   *
   * @param {number} walletIndex
   * @returns {MnemonicKey}
   */
  createMnemonicKey(walletIndex = 0): MnemonicKey {
    return new MnemonicKey({ mnemonic: this.phrase, index: walletIndex })
  }
}

export { Client }
