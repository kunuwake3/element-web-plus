/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { webcrypto } from "crypto";

import {
    decryptServerVault,
    encryptServerVault,
    SERVER_VAULT_VERSION,
    type ServerVaultData,
} from "../../../src/utils/serverVaultCrypto";

describe("serverVaultCrypto", () => {
    beforeAll(() => {
        Object.defineProperty(globalThis, "crypto", {
            value: webcrypto,
            configurable: true,
        });
    });

    const sampleVault: ServerVaultData = {
        version: SERVER_VAULT_VERSION,
        updatedAt: 1,
        databases: [
            {
                id: "db-1",
                name: "Main",
                updatedAt: 1,
                entries: [
                    {
                        id: "entry-1",
                        serverName: "Test server",
                        ipAddress: "10.0.0.1",
                        country: "DE",
                        hosterName: "Hoster",
                        sshPort: "22",
                        sshKey: "ssh-ed25519 AAA",
                        rootPassword: "root-secret",
                        additionalUsers: "user:pass",
                        quickCommands: "uptime",
                        dropbearPort: "",
                        dropbearKey: "",
                        dropbearLuksPassword: "",
                        luksDiskPasswords: "",
                        purchaseDate: "2024-01-01",
                        renewalDate: "2024-02-01",
                        price: "10",
                        currency: "EUR",
                        hosterLogin: "login",
                        hosterPassword: "pass",
                        emailLogin: "email",
                        emailPassword: "mailpass",
                        notes: "notes",
                        updatedAt: 1,
                    },
                ],
            },
        ],
        hosters: [],
        countries: ["DE"],
        currencies: ["EUR"],
        reminderRoomId: "",
    };

    it("encrypts and decrypts data", async () => {
        const encrypted = await encryptServerVault(sampleVault, "strong-password");
        expect(encrypted.version).toBe(SERVER_VAULT_VERSION);
        const decrypted = await decryptServerVault(encrypted, "strong-password");
        expect(decrypted).toEqual(sampleVault);
    });

    it("fails to decrypt with a wrong password", async () => {
        const encrypted = await encryptServerVault(sampleVault, "correct-horse");
        await expect(decryptServerVault(encrypted, "wrong-password")).rejects.toThrow();
    });
});
