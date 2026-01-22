/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const getCrypto = (): Crypto => {
    if (!globalThis.crypto) {
        throw new Error("WebCrypto is not available");
    }
    return globalThis.crypto;
};

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 200_000;

export const SERVER_VAULT_VERSION = 1 as const;

export interface ServerVaultDatabase {
    id: string;
    name: string;
    entries: ServerVaultEntry[];
    updatedAt: number;
    sharedRoomId: string;
}

export interface ServerVaultEntry {
    id: string;
    serverName: string;
    ipAddress: string;
    country: string;
    hosterName: string;
    sshPort: string;
    sshKey: string;
    rootPassword: string;
    additionalUsers: string;
    quickCommands: string;
    dropbearPort: string;
    dropbearKey: string;
    dropbearLuksPassword: string;
    luksDiskPasswords: string;
    purchaseDate: string;
    renewalDate: string;
    price: string;
    currency: string;
    hosterLogin: string;
    hosterPassword: string;
    emailLogin: string;
    emailPassword: string;
    notes: string;
    updatedAt: number;
}

export interface ServerVaultHoster {
    id: string;
    name: string;
    url: string;
    notes: string;
    updatedAt: number;
}

export interface ServerVaultData {
    version: typeof SERVER_VAULT_VERSION;
    databases: ServerVaultDatabase[];
    hosters: ServerVaultHoster[];
    countries: string[];
    currencies: string[];
    reminderRoomId: string;
    updatedAt: number;
}

export interface EncryptedServerVaultPayload {
    version: typeof SERVER_VAULT_VERSION;
    salt: string;
    iv: string;
    ciphertext: string;
}

const encodeBase64 = (data: ArrayBuffer): string => {
    return btoa(String.fromCharCode(...new Uint8Array(data)));
};

const decodeBase64 = (value: string): ArrayBuffer => {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.buffer;
};

const deriveKey = async (password: string, salt: ArrayBuffer): Promise<CryptoKey> => {
    const crypto = getCrypto();
    const keyMaterial = await crypto.subtle.importKey("raw", TEXT_ENCODER.encode(password), "PBKDF2", false, [
        "deriveKey",
    ]);
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        {
            name: "AES-GCM",
            length: KEY_LENGTH,
        },
        false,
        ["encrypt", "decrypt"],
    );
};

export const encryptServerVault = async (
    data: ServerVaultData,
    password: string,
): Promise<EncryptedServerVaultPayload> => {
    const crypto = getCrypto();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(password, salt.buffer);
    const plaintext = TEXT_ENCODER.encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return {
        version: SERVER_VAULT_VERSION,
        salt: encodeBase64(salt.buffer),
        iv: encodeBase64(iv.buffer),
        ciphertext: encodeBase64(ciphertext),
    };
};

export const decryptServerVault = async (
    payload: EncryptedServerVaultPayload,
    password: string,
): Promise<ServerVaultData> => {
    const salt = decodeBase64(payload.salt);
    const iv = decodeBase64(payload.iv);
    const ciphertext = decodeBase64(payload.ciphertext);
    const crypto = getCrypto();
    const key = await deriveKey(password, salt);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, ciphertext);
    const parsed = JSON.parse(TEXT_DECODER.decode(plaintext)) as ServerVaultData;
    if (parsed.version !== SERVER_VAULT_VERSION) {
        throw new Error(`Unsupported vault version ${parsed.version}`);
    }
    return parsed;
};
