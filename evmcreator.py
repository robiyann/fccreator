import os
from eth_account import Account

# Enable HD Wallet features
Account.enable_unaudited_hdwallet_features()

# --- Constants ---
MNEMONIC_FILE = "mnec.txt"
PRIVATE_KEY_FILE = "pk.txt"
ADDRESS_FILE = "addr.txt"  # File baru untuk alamat

def create_evm_wallet():
    """
    Generates a new EVM wallet, returning its mnemonic, private key, and address.
    """
    acct, mnemonic = Account.create_with_mnemonic()
    private_key = acct.key.hex()
    address = acct.address
    return mnemonic, private_key, address

def save_to_file(filename, data):
    """
    Appends a line of data to the specified file.
    """
    with open(filename, 'a') as f:
        f.write(data + '\n')

def main():
    """
    Main function to run the EVM wallet creator bot.
    """
    print("🚀 Selamat datang di EVM Wallet Creator Bot!")
    
    while True:
        try:
            num_wallets_str = input("Berapa banyak wallet yang ingin Anda buat? ")
            num_wallets = int(num_wallets_str)
            if num_wallets <= 0:
                print("❌ Jumlah harus lebih dari nol.")
                continue
            break
        except ValueError:
            print("❌ Input tidak valid. Masukkan angka.")

    print(f"⚙️ Membuat {num_wallets} wallet...")

    for i in range(num_wallets):
        mnemonic, private_key, address = create_evm_wallet()
        
        # Save the mnemonic, private key, and address
        save_to_file(MNEMONIC_FILE, mnemonic)
        save_to_file(PRIVATE_KEY_FILE, private_key)
        save_to_file(ADDRESS_FILE, address) # Simpan alamat
        
        print(f"✅ Wallet ke-{i+1} dibuat: Alamat {address}")
        print(f"   - Mnemonic disimpan di {MNEMONIC_FILE}")
        print(f"   - Private Key disimpan di {PRIVATE_KEY_FILE}")
        print(f"   - Address disimpan di {ADDRESS_FILE}") # Pesan konfirmasi baru

    print(f"\n🎉 Selesai! Total {num_wallets} wallet baru telah dibuat.")
    print(f"   - Semua mnemonic ada di: {os.path.abspath(MNEMONIC_FILE)}")
    print(f"   - Semua private key ada di: {os.path.abspath(PRIVATE_KEY_FILE)}")
    print(f"   - Semua alamat ada di: {os.path.abspath(ADDRESS_FILE)}") # Pesan konfirmasi baru

if __name__ == "__main__":
    main()
