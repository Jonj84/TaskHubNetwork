import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";

// Contract interfaces
interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  total_supply: string;
}

interface TokenBalance {
  balance: string;
}

export class CosmosTokenClient {
  private client: SigningCosmWasmClient | null = null;
  private wallet: DirectSecp256k1HdWallet | null = null;
  
  // Initialize the Cosmos client with the contract
  async connect(mnemonic: string, contractAddress: string) {
    try {
      this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic);
      const [account] = await this.wallet.getAccounts();
      
      this.client = await SigningCosmWasmClient.connectWithSigner(
        process.env.VITE_COSMOS_RPC_URL || "",
        this.wallet,
        { gasPrice: GasPrice.fromString("0.025stake") }
      );
      
      return account.address;
    } catch (error) {
      console.error("Failed to connect to Cosmos:", error);
      throw error;
    }
  }

  // Purchase tokens with native currency
  async purchaseTokens(amount: number) {
    if (!this.client) throw new Error("Client not initialized");
    
    try {
      const result = await this.client.execute(
        process.env.VITE_CONTRACT_ADDRESS || "",
        { purchase_tokens: { amount: amount.toString() } },
        "auto"
      );
      return result;
    } catch (error) {
      console.error("Failed to purchase tokens:", error);
      throw error;
    }
  }

  // Create a work request with tokens
  async createWorkRequest(title: string, description: string, reward: number) {
    if (!this.client) throw new Error("Client not initialized");
    
    try {
      const result = await this.client.execute(
        process.env.VITE_CONTRACT_ADDRESS || "",
        { 
          create_work_request: { 
            title,
            description,
            reward: reward.toString()
          } 
        },
        "auto"
      );
      return result;
    } catch (error) {
      console.error("Failed to create work request:", error);
      throw error;
    }
  }

  // Get token balance for an address
  async getBalance(address: string): Promise<TokenBalance> {
    if (!this.client) throw new Error("Client not initialized");
    
    try {
      const result = await this.client.queryContractSmart(
        process.env.VITE_CONTRACT_ADDRESS || "",
        { balance: { address } }
      );
      return result;
    } catch (error) {
      console.error("Failed to get balance:", error);
      throw error;
    }
  }

  // Get token information
  async getTokenInfo(): Promise<TokenInfo> {
    if (!this.client) throw new Error("Client not initialized");
    
    try {
      const result = await this.client.queryContractSmart(
        process.env.VITE_CONTRACT_ADDRESS || "",
        { token_info: {} }
      );
      return result;
    } catch (error) {
      console.error("Failed to get token info:", error);
      throw error;
    }
  }
}

// Create a singleton instance
export const cosmosClient = new CosmosTokenClient();
