import { Aes128Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256, X25519 } from "@hpke/dhkem-x25519";
import { utils } from "@repo/utils";
import { ethers } from "ethers";
import { assert } from "ts-essentials";

// TODO(security): Constrain encryption and nuke this service.
export class EncryptionService {
  #suite: CipherSuite;

  private constructor() {
    this.#suite = new CipherSuite({
      kem: new DhkemX25519HkdfSha256(),
      kdf: new HkdfSha256(),
      aead: new Aes128Gcm(),
    });
  }

  static getSingleton = utils.lazyValue(() => new EncryptionService());

  async encrypt(publicKey: ethers.BytesLike, messageBytes: ethers.BytesLike) {
    const importedPublicKey = await this.#importPublicKey(publicKey);
    const sender = await this.#suite.createSenderContext({
      recipientPublicKey: importedPublicKey,
    });
    const enc = new Uint8Array(sender.enc);
    assert(enc.length === ECC_LEN, "invalid encryption context length");

    const encrypted = new Uint8Array(
      await sender.seal(ethers.getBytes(messageBytes)),
    );
    return ethers.concat([enc, encrypted]);
  }

  async decrypt(privateKey: ethers.BytesLike, ciphertext: ethers.BytesLike) {
    const importedPrivateKey = await this.#importPrivateKey(privateKey);
    ciphertext = ethers.getBytes(ciphertext);
    const recipient = await this.#suite.createRecipientContext({
      recipientKey: importedPrivateKey,
      enc: ciphertext.subarray(0, ECC_LEN),
    });
    const plaintext = await recipient.open(ciphertext.subarray(ECC_LEN));
    return ethers.hexlify(new Uint8Array(plaintext));
  }

  async derivePublicKey(privateKey: ethers.BytesLike) {
    const importedPrivateKey = await this.#importPrivateKey(privateKey);
    const publicKey = await new X25519(this.#suite.kdf).derivePublicKey(
      importedPrivateKey,
    );
    return ethers.hexlify(
      new Uint8Array(await this.#suite.kem.serializePublicKey(publicKey)),
    );
  }

  async #importPrivateKey(privateKey: ethers.BytesLike) {
    return await this.#suite.kem.importKey(
      "raw",
      ethers.getBytes(privateKey),
      false, // isPublic
    );
  }

  async #importPublicKey(publicKey: ethers.BytesLike) {
    return await this.#suite.kem.importKey(
      "raw",
      ethers.getBytes(publicKey),
      true, // isPublic
    );
  }
}

const ECC_LEN = 32;
