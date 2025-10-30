// Jalankan: node check_and_reserve_min_patch.mjs

import axios from "axios";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs/promises";
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

// =================== KONFIG ===================
const DATA_FILE = "data.json";
const USERNAME_FILE = "uname.txt";
const USED_USERNAME_FILE = "used_usernames.txt"; // log username yg terpakai/invalid/failed
const DELAY_BETWEEN_FID = 1500;   // jeda antar FID (ms)
const DELAY_BETWEEN_CHECKS = 400; // jeda antar cek username (ms)

// EIP-712 (FName) domain & types
const EIP712_DOMAIN = {
  name: "Farcaster name verification",
  version: "1",
  chainId: 1,
  verifyingContract: "0xe3be01d99baa8db9905b33a3ca391238234b79d1",
};

const EIP712_TYPES = {
  UserNameProof: [
    { name: "name", type: "string" },
    { name: "timestamp", type: "uint256" },
    { name: "owner", type: "address" },
  ],
};

const nowSec = () => Math.floor(Date.now() / 1000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const THREADS = Number(process.env.THREADS || 5);
const IS_WORKER = !isMainThread;

// Worker-local collections (only used when IS_WORKER)
let workerRemovedUsernames = [];
let workerUsedLogs = [];

// =================== I/O HELPERS ===================
async function readAccounts() {
  if (IS_WORKER) {
    // worker receives accounts via workerData
    return workerData.accounts || [];
  }
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  const json = JSON.parse(raw);
  if (!Array.isArray(json)) throw new Error("data.json harus berupa array");
  return json;
}

async function writeAccounts(accounts) {
  if (IS_WORKER) {
    // workers should not write directly; store updates to send to main
    parentPort.postMessage({ type: 'partial_accounts', data: accounts });
    return;
  }
  // Tulis langsung; hanya field username yg kita patch di memori sebelum save
  await fs.writeFile(DATA_FILE, JSON.stringify(accounts, null, 2));
}

async function readUsernames() {
  if (IS_WORKER) {
    return workerData.usernames || [];
  }
  const raw = await fs.readFile(USERNAME_FILE, "utf-8").catch(() => "");
  return raw.split("\n").map((l) => l.trim()).filter(Boolean);
}

async function writeUsernames(usernames) {
  if (IS_WORKER) {
    parentPort.postMessage({ type: 'partial_usernames', data: usernames });
    return;
  }
  await fs.writeFile(USERNAME_FILE, usernames.join("\n") + (usernames.length ? "\n" : ""));
}

function removeUsernameInMemory(usernames, username) {
  const idx = usernames.indexOf(username);
  if (idx >= 0) usernames.splice(idx, 1);
  return idx >= 0;
}

async function logUsedUsername(username, reason = "", owner = "") {
  const line = `${new Date().toISOString()} | ${username} | ${reason}${owner ? " | owner=" + owner : ""}\n`;
  if (IS_WORKER) {
    // accumulate and send to main
    workerUsedLogs.push(line);
    parentPort.postMessage({ type: 'used_log', data: line });
    return;
  }
  await fs.appendFile(USED_USERNAME_FILE, line).catch(() => {});
}

// =================== API HELPERS ===================
async function checkExistingUsernameByFid(fid) {
  try {
    const url = `https://fnames.farcaster.xyz/transfers?fid=${fid}`;
    const res = await axios.get(url, {
      headers: { accept: "application/json, text/plain, */*" },
      timeout: 10000,
    });
    const transfers = res.data?.transfers ?? [];
    if (transfers.length === 0) return { found: false };
    const latest = transfers[transfers.length - 1];
    return { found: true, username: latest.username };
  } catch (e) {
    if (e.response?.status === 404) return { found: false };
    return { found: false, error: e.message };
  }
}

async function checkUsernameAvailability(username) {
  try {
    const url = `https://fnames.farcaster.xyz/transfers?name=${encodeURIComponent(username)}`;
    const res = await axios.get(url, {
      headers: { accept: "application/json, text/plain, */*" },
      timeout: 10000,
    });
    const transfers = res.data?.transfers ?? [];
    const available = transfers.length === 0;
    const owner = available ? null : transfers[0]?.owner ?? null;
    return { available, owner };
  } catch (e) {
    // Jika gagal cek, asumsikan tidak available agar tidak spam
    return { available: false, error: e.message };
  }
}

function validateUsernameFormat(username) {
  // Validasi ringan agar hindari 400 (opsional tapi membantu)
  if (!username || username.length < 1 || username.length > 16) {
    return { ok: false, reason: "length" };
  }
  if (!/^[a-z0-9-]+$/.test(username)) {
    return { ok: false, reason: "charset" };
  }
  if (/^[0-9-]/.test(username)) {
    return { ok: false, reason: "start" };
  }
  if (username.endsWith("-")) {
    return { ok: false, reason: "end" };
  }
  if (username.includes("--")) {
    return { ok: false, reason: "double-hyphen" };
  }
  return { ok: true };
}

async function reserveFname({ name, fid, privateKey }) {
  const acct = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : "0x" + privateKey);
  const owner = acct.address;
  const timestamp = nowSec();

  const signature = await acct.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "UserNameProof",
    message: { name, timestamp, owner },
  });

  const body = { name, from: 0, to: Number(fid), fid: Number(fid), owner, timestamp, signature };

  try {
    const res = await axios.post("https://fnames.farcaster.xyz/transfers", body, {
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      timeout: 15000,
    });
    return { success: res.status === 200 || res.status === 201, status: res.status };
  } catch (e) {
    const msg = e.response
      ? `${e.response.status}: ${e.response.data?.error || e.response.data?.message || e.response.statusText}`
      : e.message;
    return { success: false, error: msg };
  }
}

// =================== MAIN FLOW ===================
async function mainWorker(accounts, usernames) {
  // This function contains the original per-account flow but operates on given arrays
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log(`[WORKER] [${i + 1}/${accounts.length}] FID ${acc.fid}`);

    if (acc.username) continue;

    const exist = await checkExistingUsernameByFid(acc.fid);
    if (exist.found) {
      accounts[i] = { ...acc, username: exist.username };
      removeUsernameInMemory(usernames, exist.username);
      await logUsedUsername(exist.username, "already-owned-by-this-fid", acc.wallet_address || "");
      // notify main thread immediately so it can persist this change
      if (IS_WORKER && parentPort) {
        parentPort.postMessage({ type: 'found', data: { fid: acc.fid, username: exist.username, owner: acc.wallet_address || '' } });
      }
      continue;
    }

    let reserved = false;
    while (usernames.length > 0) {
      const candidate = usernames[0];
      const v = validateUsernameFormat(candidate);
      if (!v.ok) {
        removeUsernameInMemory(usernames, candidate);
        await logUsedUsername(candidate, `invalid-format:${v.reason}`);
        await delay(DELAY_BETWEEN_CHECKS);
        continue;
      }

      const avail = await checkUsernameAvailability(candidate);
      if (!avail.available) {
        removeUsernameInMemory(usernames, candidate);
        await logUsedUsername(candidate, "taken", avail.owner || "");
        await delay(DELAY_BETWEEN_CHECKS);
        continue;
      }

      const res = await reserveFname({ name: candidate, fid: acc.fid, privateKey: acc.private_key });
      if (res.success) {
        accounts[i] = { ...acc, username: candidate };
        removeUsernameInMemory(usernames, candidate);
        await logUsedUsername(candidate, "reserved-success", acc.wallet_address || "");
        // notify main thread immediately so it can persist this change
        if (IS_WORKER && parentPort) {
          parentPort.postMessage({ type: 'reserved', data: { fid: acc.fid, username: candidate, owner: acc.wallet_address || '' } });
        }
        reserved = true;
        break;
      } else {
        removeUsernameInMemory(usernames, candidate);
        await logUsedUsername(candidate, `reserve-failed:${res.error}`);
        await delay(DELAY_BETWEEN_CHECKS);
      }
    }

    await delay(DELAY_BETWEEN_FID);
  }

  return { accounts, usernames };
}

if (isMainThread) {
  (async () => {
    try {
      const accountsAll = await readAccounts();
      const usernamesAll = await readUsernames();
      console.log(`📊 Akun: ${accountsAll.length} | Username dalam list: ${usernamesAll.length}`);

      // distribute accounts and usernames round-robin
      const buckets = Array.from({ length: THREADS }, () => ({ accounts: [], usernames: [] }));
      for (let i = 0; i < accountsAll.length; i++) buckets[i % THREADS].accounts.push(accountsAll[i]);
      for (let i = 0; i < usernamesAll.length; i++) buckets[i % THREADS].usernames.push(usernamesAll[i]);

      const workers = [];
      const partials = [];

      for (let t = 0; t < THREADS; t++) {
        const w = new Worker(__filename, { workerData: { accounts: buckets[t].accounts, usernames: buckets[t].usernames } });
        w.on('message', (msg) => {
          if (msg.type === 'partial_accounts') partials.push(msg.data);
          if (msg.type === 'partial_usernames') {
            // collect but do nothing: main will rebuild final username list from remaining
          }
          if (msg.type === 'used_log') {
            // append directly
            fs.appendFile(USED_USERNAME_FILE, msg.data).catch(() => {});
          }
          if (msg.type === 'found') {
            // Immediately persist found username to data.json
            (async () => {
              const { fid, username, owner } = msg.data || {};
              if (fid == null) return;
              try {
                const allRaw = await fs.readFile(DATA_FILE, 'utf-8');
                const all = JSON.parse(allRaw);
                const idx = all.findIndex(a => a && a.fid === fid);
                if (idx !== -1) {
                  all[idx] = { ...all[idx], username };
                }
                await fs.writeFile(DATA_FILE, JSON.stringify(all, null, 2));
                await logUsedUsername(username, 'already-owned-by-this-fid', owner || '');
              } catch (e) {
                console.error('Error persisting found username:', e.message);
              }
            })();
          }
          if (msg.type === 'reserved') {
            (async () => {
              const { fid, username, owner } = msg.data || {};
              if (fid == null) return;
              try {
                const allRaw = await fs.readFile(DATA_FILE, 'utf-8');
                const all = JSON.parse(allRaw);
                const idx = all.findIndex(a => a && a.fid === fid);
                if (idx !== -1) {
                  all[idx] = { ...all[idx], username };
                }
                await fs.writeFile(DATA_FILE, JSON.stringify(all, null, 2));
                await logUsedUsername(username, 'reserved-success', owner || '');
              } catch (e) {
                console.error('Error persisting reserved username:', e.message);
              }
            })();
          }
        });
        w.on('error', (err) => console.error('Worker error', err));
        w.on('exit', (code) => console.log('Worker exit', code));
        workers.push(w);
      }

      await Promise.all(workers.map(w => new Promise(res => w.on('exit', res))));

      // Merge partial accounts back into accountsAll
      const byFid = new Map();
      for (const p of partials) for (const a of p) if (a && a.fid != null) byFid.set(a.fid, a);
      for (let i = 0; i < accountsAll.length; i++) if (byFid.has(accountsAll[i].fid)) accountsAll[i] = byFid.get(accountsAll[i].fid);

      // Write final results
      await writeAccounts(accountsAll);
      // Rebuild username file: keep usernames not used
      const used = await fs.readFile(USED_USERNAME_FILE, 'utf-8').catch(() => '');
      const usedNames = new Set(used.split('\n').map(l => l.split('|')[1]?.trim()).filter(Boolean));
      const remaining = usernamesAll.filter(u => !usedNames.has(u));
      await writeUsernames(remaining);

      console.log('✅ All workers finished. data.json and uname.txt updated.');
    } catch (e) {
      console.error('Fatal orchestration error:', e);
      process.exit(1);
    }
  })();

} else {
  // worker
  (async () => {
    try {
      const myAccounts = workerData.accounts || [];
      const myUsernames = workerData.usernames || [];
      const result = await mainWorker(myAccounts, myUsernames);
      // send back partial accounts and any used logs accumulated
      parentPort.postMessage({ type: 'partial_accounts', data: result.accounts });
      process.exit(0);
    } catch (err) {
      parentPort.postMessage({ type: 'worker_error', data: String(err.message) });
      process.exit(1);
    }
  })();
}