"""Shim for pysodium using PyNaCl's bundled libsodium on Windows."""
import nacl.bindings

def crypto_aead_xchacha20poly1305_ietf_decrypt(ciphertext, ad, nonce, key):
    return nacl.bindings.crypto_aead_xchacha20poly1305_ietf_decrypt(ciphertext, ad, nonce, key)
