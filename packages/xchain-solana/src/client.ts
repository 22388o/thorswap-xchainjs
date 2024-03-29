import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedInstruction,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  Address,
  Balance,
  BaseXChainClient,
  FeeType,
  Fees,
  Network,
  PrivateKeyCache,
  Tx,
  TxHash,
  TxHistoryParams,
  TxParams,
  TxType,
  TxsPage,
  XChainClient,
  XChainClientParams,
  singleFee,
} from '@thorswap-lib/xchain-client'
import { getSeed } from '@thorswap-lib/xchain-crypto'
import {
  AssetSolana,
  Chain,
  USDC_SPL_MINT_ADDRESS,
  USDC_SPL_TESTNET_MINT_ADDRESS,
  baseAmount,
  deepEqual,
} from '@thorswap-lib/xchain-util'
import { derivePath } from 'ed25519-hd-key'

import { SOLANA_DECIMAL, USDC_SPL_DECIMAL } from './const'
import { SPLTokenTransferParams } from './types'
import { getSOLBalance, getUSDCSPLBalance, isSOLAsset, isUSDCSPLAsset } from './utils'

const EXPLORER_URL = 'https://explorer.solana.com'

export type SolanaClientParams = XChainClientParams & {
  nodeUrl?: string
  privateKeyInit?: PrivateKeyCache<Keypair>
}

/**
 * Solana Client
 */
class Client extends BaseXChainClient implements XChainClient {
  public nodeUrl: string
  private privateKeyCache: PrivateKeyCache<Keypair> | undefined

  constructor({
    nodeUrl,
    network = Network.Testnet,
    phrase,
    rootDerivationPaths = {
      [Network.Mainnet]: `m/44'/501'/0'/1'/`,
      [Network.Testnet]: `m/44'/501'/0'/1'/`,
    },
    privateKeyInit,
  }: SolanaClientParams) {
    super(Chain.Solana, { network, phrase, rootDerivationPaths })
    this.nodeUrl =
      nodeUrl ??
      (() => {
        switch (network) {
          case Network.Mainnet:
            return 'https://ssc-dao.genesysgo.net'
          case Network.Testnet:
            return clusterApiUrl('testnet')
        }
      })()
    this.privateKeyCache = privateKeyInit
  }

  async getFees(): Promise<Fees> {
    const connection = new Connection(this.nodeUrl, 'confirmed')
    const fromKeypair = this.getKeyPair()
    const to = this.getAddress(1)
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: new PublicKey(to),
        lamports: LAMPORTS_PER_SOL,
      }),
    )

    const blockHash = await connection.getLatestBlockhash()

    transaction.recentBlockhash = blockHash.blockhash
    transaction.feePayer = fromKeypair.publicKey

    const estimatedFee = await transaction.getEstimatedFee(connection)

    const fee = baseAmount(estimatedFee, SOLANA_DECIMAL)
    return singleFee(FeeType.FlatFee, fee)
  }

  getAddress(index = 0): string {
    const keypair = this.getKeyPair(index)
    return keypair.publicKey.toBase58()
  }

  getExplorerUrl(): string {
    return this.isTestnet() ? this.appendTestnetClusterParam(EXPLORER_URL) : EXPLORER_URL
  }

  getExplorerAddressUrl(address: string): string {
    const explorerAddressURL = `${EXPLORER_URL}/address/${address}`
    return this.isTestnet() ? this.appendTestnetClusterParam(explorerAddressURL) : explorerAddressURL
  }

  getExplorerTxUrl(txID: string): string {
    const explorerTxURL = `${EXPLORER_URL}/tx/${txID}`
    return this.isTestnet() ? this.appendTestnetClusterParam(explorerTxURL) : explorerTxURL
  }

  validateAddress(address: string): boolean {
    try {
      const pubkey = new PublicKey(address)
      const isSolana = PublicKey.isOnCurve(pubkey.toBuffer())
      return isSolana
    } catch (error) {
      return false
    }
  }

  async getBalance(address: Address): Promise<Balance[]> {
    const connection = new Connection(this.nodeUrl, 'confirmed')
    // SOL balance
    const SOLBalance = await getSOLBalance(connection, address)
    // USDC balance
    const USDCSPLBalance = await getUSDCSPLBalance(this.network, connection, address)
    return [SOLBalance].concat(USDCSPLBalance || [])
  }

  async getTransactions(params?: TxHistoryParams): Promise<TxsPage> {
    if (!params?.address) throw new Error('Address not provided')
    const connection = new Connection(this.nodeUrl, 'confirmed')

    const signatures = await connection.getSignaturesForAddress(new PublicKey(params.address), { limit: params.limit })
    const parsedTransactions = await connection.getParsedTransactions(
      signatures.map((signature) => signature.signature),
    )

    const transactions: Tx[] = []
    parsedTransactions
      .filter((parsedTransaction) => parsedTransaction !== null)
      .forEach((parsedTransaction, i) => {
        const date = parsedTransaction?.blockTime ? new Date(parsedTransaction.blockTime * 1000) : new Date()
        parsedTransaction?.transaction.message.instructions
          .filter((instruction) => (instruction as ParsedInstruction).parsed.type === 'transfer')
          .forEach((instruction) => {
            const parsedInstructionInformation = (instruction as ParsedInstruction).parsed.info
            transactions.push({
              asset: AssetSolana,
              from: [
                {
                  from: parsedInstructionInformation.source,
                  amount: baseAmount(parsedInstructionInformation.lamports, SOLANA_DECIMAL),
                },
              ],
              to: [
                {
                  to: parsedInstructionInformation.destination,
                  amount: baseAmount(parsedInstructionInformation.lamports, SOLANA_DECIMAL),
                },
              ],
              date,
              type: TxType.Transfer,
              hash: signatures[i].signature,
            })
          })
      })
    return { total: transactions.length, txs: transactions }
  }

  async getTransactionData(hash: string): Promise<Tx> {
    const connection = new Connection(this.nodeUrl, 'confirmed')

    const parsedTransaction = await connection.getParsedTransaction(hash)

    if (!parsedTransaction) throw new Error(`Failed to get transaction ${hash}`)

    const date = parsedTransaction?.blockTime ? new Date(parsedTransaction.blockTime * 1000) : new Date()

    const instruction = (parsedTransaction?.transaction.message.instructions[0] as ParsedInstruction).parsed

    return {
      hash,
      asset: AssetSolana,
      date,
      from: instruction.info.source,
      to: instruction.info.destination,
      type: instruction.type,
    }
  }

  async transfer({ walletIndex = 0, amount, recipient, asset = AssetSolana }: TxParams): Promise<TxHash> {
    if (!this.validateAddress(recipient)) throw new Error(`${recipient} is not a valid Solana address`)

    const fromKeypair = this.getKeyPair(walletIndex)

    const connection = new Connection(this.nodeUrl, 'confirmed')
    let transaction: Transaction

    if (isSOLAsset(asset)) {
      const lamportsToSend = amount.amount().toNumber()
      transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromKeypair.publicKey,
          toPubkey: new PublicKey(recipient),
          lamports: lamportsToSend,
        }),
      )
    } else if (isUSDCSPLAsset(asset)) {
      transaction = await this.createSPLTokenTransferTransaction({
        connection,
        tokenMintAddress: this.network === Network.Mainnet ? USDC_SPL_MINT_ADDRESS : USDC_SPL_TESTNET_MINT_ADDRESS,
        decimals: USDC_SPL_DECIMAL,
        amount,
        from: fromKeypair.publicKey,
        recipient,
      })
    } else {
      throw new Error(`Asset ${asset.ticker} is currently unsupported`)
    }

    const blockHash = await connection.getLatestBlockhash()

    transaction.recentBlockhash = blockHash.blockhash
    transaction.feePayer = fromKeypair.publicKey

    return sendAndConfirmTransaction(connection, transaction, [fromKeypair])
  }

  async createSPLTokenTransferTransaction({
    tokenMintAddress,
    from,
    recipient,
    connection,
    amount,
    decimals,
  }: SPLTokenTransferParams): Promise<Transaction> {
    const tokenPublicKey = new PublicKey(tokenMintAddress)
    const fromSPLAddress = await getAssociatedTokenAddress(tokenPublicKey, from)

    const recipientPublicKey = new PublicKey(recipient)
    const recipientSPLAddress = await getAssociatedTokenAddress(tokenPublicKey, recipientPublicKey)
    let tokenAccountCreated = false
    try {
      await getAccount(connection, recipientSPLAddress)
      tokenAccountCreated = true
    } catch (e) {
      console.warn('Token account does not exist for recipient address. Creating one')
    }

    const transaction = new Transaction()

    if (!tokenAccountCreated) {
      transaction.add(
        createAssociatedTokenAccountInstruction(from, recipientSPLAddress, recipientPublicKey, tokenPublicKey),
      )
    }
    transaction.add(
      createTransferCheckedInstruction(
        fromSPLAddress,
        tokenPublicKey,
        recipientSPLAddress,
        from,
        amount.amount().toNumber(),
        decimals,
      ),
    )

    return transaction
  }

  async requestAirdrop(address: Address) {
    if (this.network !== Network.Testnet) {
      throw Error('Airdrops are only available in Testnet')
    }
    const connection = new Connection(this.nodeUrl, 'confirmed')
    const airdropSignature = await connection.requestAirdrop(new PublicKey(address), 1 * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(airdropSignature)
  }

  protected getFullDerivationPath(walletIndex: number): string {
    return `${super.getFullDerivationPath(walletIndex)}'`
  }

  private appendTestnetClusterParam(url: string) {
    return `${url}?cluster=testnet`
  }

  private isTestnet() {
    return this.network === Network.Testnet
  }

  private getKeyPair(index = 0) {
    if (index < 0) {
      throw new Error('index must be equal or greater than zero')
    }

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

    const privateKey = this.createKeyPair(index)

    this.privateKeyCache = {
      phrase: this.phrase,
      network: this.network,
      index,
      privateKey,
    }

    return privateKey
  }

  createKeyPair(index = 0) {
    if (index < 0) {
      throw new Error('index must be equal or greater than zero')
    }

    const seed = getSeed(this.phrase)
    return Keypair.fromSeed(derivePath(this.getFullDerivationPath(index), seed.toString('hex')).key)
  }
}

export { Client }
