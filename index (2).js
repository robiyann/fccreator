import fs from "node:fs";
import "dotenv/config";
import { JsonRpcProvider, Wallet, Contract } from "ethers";

// Load ABI from file
const abi = JSON.parse(fs.readFileSync("./abi.json", "utf8"));

// === CONFIG ===
const provider = new JsonRpcProvider(process.env.RPC_URL);
const contractAddress = "0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69";
const recovery = process.env.RECOVERY_ADDRESS;
const privateKeys = fs.readFileSync("pk.txt", "utf8").trim().split("\n");

async function registerFid(rawPk) {
  try {
    // PK WAJIB 0X suuuuu
    const pk = rawPk.trim().startsWith("0x") ? rawPk.trim() : `0x${rawPk.trim()}`;
    const wallet = new Wallet(pk, provider);
    const contract = new Contract(contractAddress, abi, wallet);

    const price = await contract.price();
    const tx = await contract.register(recovery, { value: price });

    console.log(`🟡 TX sent from ${wallet.address}: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Success: ${receipt.transactionHash}`);
  } catch (err) {
    console.error(`❌ Error for ${rawPk.trim()}:`, err?.shortMessage || err.message || err);
  }
}

async function main() {
  for (const rawPk of privateKeys) {
    await registerFid(rawPk);
    await new Promise((res) => setTimeout(res, 5000)); // delay antar tx
  }
}

main();
