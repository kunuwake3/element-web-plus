/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { mergeServerVaults } from "../../../src/utils/serverVaultSync";
import { SERVER_VAULT_VERSION, type ServerVaultData } from "../../../src/utils/serverVaultCrypto";

describe("serverVaultSync", () => {
    it("prefers newer updates and reports conflicts", () => {
        const baseVault: ServerVaultData = {
            version: SERVER_VAULT_VERSION,
            updatedAt: 1,
            databases: [
                {
                    id: "db-1",
                    name: "Primary",
                    updatedAt: 1,
                    entries: [
                        {
                            id: "entry-1",
                            serverName: "Old",
                            ipAddress: "10.0.0.1",
                            country: "DE",
                            hosterName: "Hoster",
                            sshPort: "22",
                            sshKey: "ssh-old",
                            rootPassword: "root",
                            additionalUsers: "",
                            quickCommands: "",
                            dropbearPort: "",
                            dropbearKey: "",
                            dropbearLuksPassword: "",
                            luksDiskPasswords: "",
                            purchaseDate: "2024-01-01",
                            renewalDate: "2024-02-01",
                            price: "10",
                            currency: "EUR",
                            hosterLogin: "",
                            hosterPassword: "",
                            emailLogin: "",
                            emailPassword: "",
                            notes: "",
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

        const remoteVault: ServerVaultData = {
            ...baseVault,
            updatedAt: 2,
            databases: [
                {
                    ...baseVault.databases[0],
                    updatedAt: 2,
                    entries: [
                        {
                            ...baseVault.databases[0].entries[0],
                            serverName: "New",
                            sshKey: "ssh-new",
                            updatedAt: 2,
                        },
                    ],
                },
            ],
        };

        const result = mergeServerVaults(baseVault, remoteVault);
        expect(result.hasConflicts).toBe(true);
        expect(result.merged.databases[0].entries[0].serverName).toBe("New");
        expect(result.merged.databases[0].entries[0].sshKey).toBe("ssh-new");
    });
});
