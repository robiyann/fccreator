import fs from "node:fs";
import "dotenv/config";
import { JsonRpcProvider, Wallet, Contract } from "ethers";

// --- Konfigurasi kontrak Farcaster ID Registry
const ID_REGISTRY_ADDRESS = "0x00000000fc6c5f01fc30151999387bb99a9f489b";
const ID_REGISTRY_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
    "name": "idOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

// --- Setup provider dan kontrak
const provider = new JsonRpcProvider(process.env.RPC_URL);
const idRegistry = new Contract(ID_REGISTRY_ADDRESS, ID_REGISTRY_ABI, provider);

// --- Baca semua private key dari pk.txt
const privateKeys = fs.readFileSync("pk.txt", "utf8").trim().split("\n");

// --- Tempat menyimpan hasil
const results = [];

async function processPrivateKey(pk) {
  try {
    const wallet = new Wallet(pk.trim());
    const address = await wallet.getAddress();
    const fid = await idRegistry.idOf(address);

    console.log(`✅ ${address} => FID: ${fid.toString()}`);

    results.push({
      private_key: pk.trim().startsWith("0x") ? pk.trim() : `0x${pk.trim()}`,
      wallet_address: address,
      fid: parseInt(fid.toString()),
    });
  } catch (err) {
    console.error(`❌ Error for PK: ${pk}`, err?.shortMessage || err.message || err);
    results.push({
      private_key: pk.trim(),
      wallet_address: "Invalid",
      fid: 0
    });
  }
}

async function main() {
  for (const pk of privateKeys) {
    await processPrivateKey(pk);
  }

  fs.writeFileSync("fids.json", JSON.stringify(results, null, 2));
  console.log("📁 File saved: fids.json");
}

main();
