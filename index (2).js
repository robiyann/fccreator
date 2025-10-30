const { Keypair } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const fs = require('fs');
const axios = require('axios');

async function readPrivateKeys() {
  try {
    const data = await fs.promises.readFile('privkey.txt', 'utf8');
    return data.split('\n').filter(key => key.trim() !== '');
  } catch (error) {
    console.error('Error reading private keys file:', error);
    return [];
  }
}

async function connectWallet(privateKeyString) {
  try {
    const privateKey = bs58.decode(privateKeyString.trim());
    const keypair = Keypair.fromSecretKey(privateKey);
    const publicKey = keypair.publicKey.toString();

    const message = "PAWS requires you to sign this message to complete the verification process. This is a READ_ONLY interaction and will not affect any of your funds or trigger any transactions.";
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
    const signatureBase58 = bs58.encode(signature);

    const payload = {
      signature: signatureBase58,
      publicKey: publicKey,
      token: message,
      authToken: ""
    };

    const response = await axios.post('https://api.paws.community/v1/wallet/solana/og', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://paws.community',
        'Referer': 'https://paws.community/',
        'Secure-Check': 'paws',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      }
    });

    console.log(`\x1b[33m${publicKey}\x1b[0m » \x1b[32m${JSON.stringify(response.data)}\x1b[0m`);
    return { 
      publicKey, 
      privateKey: privateKeyString.trim(),
      success: true, 
      data: response.data,
      isOG: response.data.success && response.data.data !== null,
      hasNoOGError: response.data.error === "No OG drop"
    };

  } catch (error) {
    const errorData = error.response?.data || error.message;
    
    let publicKey;
    try {
      const privateKey = bs58.decode(privateKeyString.trim());
      const keypair = Keypair.fromSecretKey(privateKey);
      publicKey = keypair.publicKey.toString();
    } catch {
      publicKey = "Invalid key";
    }

    console.log(`\x1b[33m${publicKey}\x1b[0m » \x1b[31m${JSON.stringify(errorData)}\x1b[0m`);
    return { 
      publicKey, 
      privateKey: privateKeyString.trim(),
      success: false, 
      error: errorData,
      isOG: false,
      hasNoOGError: typeof errorData === 'object' && errorData.error === "No OG drop"
    };
  }
}

async function main() {
  const privateKeys = await readPrivateKeys();

  if (privateKeys.length === 0) {
    console.error('No private keys found in privkey.txt');
    return;
  }

  console.log('');

  const results = [];

  for (const privateKey of privateKeys) {
    if (privateKey.trim() !== '') {
      const result = await connectWallet(privateKey);
      results.push(result);

      await new Promise(resolve => setTimeout(resolve, 3000)); // Delay 3 detik antar request
    }
  }

  console.log('');

  const totalWallets = results.length;
  const noOGWallets = results.filter(wallet => {
    return wallet.success && wallet.data && wallet.data.error === "No OG drop";
  }).length;
  const ogWallets = results.filter(r => r.isOG).length;

  console.log('===================');
  console.log(`\x1b[37mTotal Wallet  : ${totalWallets}\x1b[0m`);
  console.log(`\x1b[31mNo OG drop    : ${noOGWallets}\x1b[0m`);
  console.log(`\x1b[32mOG Eligible   : ${ogWallets}\x1b[0m`);
  console.log('===================');

  if (ogWallets > 0) {
    const ogWalletsList = results
      .filter(r => r.isOG)
      .map(r => `${r.publicKey}:${r.privateKey}`)
      .join('\n');

    fs.writeFileSync('og.txt', ogWalletsList);
    console.log('\x1b[32mOG wallet details saved to og.txt\x1b[0m');
  }

  console.log('');
}

main().catch(console.error);
