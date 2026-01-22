/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    SERVER_VAULT_VERSION,
    type ServerVaultData,
    type ServerVaultDatabase,
    type ServerVaultEntry,
    type ServerVaultHoster,
} from "./serverVaultCrypto";

const ensureEntryTimestamp = (entry: ServerVaultEntry, fallback: number): ServerVaultEntry => ({
    ...entry,
    updatedAt: entry.updatedAt ?? fallback,
});

const ensureDatabaseTimestamp = (database: ServerVaultDatabase, fallback: number): ServerVaultDatabase => ({
    ...database,
    updatedAt: database.updatedAt ?? fallback,
    entries: database.entries.map((entry) => ensureEntryTimestamp(entry, fallback)),
    sharedRoomId: database.sharedRoomId ?? "",
});

const ensureHosterTimestamp = (hoster: ServerVaultHoster, fallback: number): ServerVaultHoster => ({
    ...hoster,
    updatedAt: hoster.updatedAt ?? fallback,
});

export const normalizeServerVault = (data: ServerVaultData): ServerVaultData => {
    const fallback = Date.now();
    return {
        ...data,
        version: data.version ?? SERVER_VAULT_VERSION,
        updatedAt: data.updatedAt ?? fallback,
        databases: (data.databases ?? []).map((database) => ensureDatabaseTimestamp(database, fallback)),
        hosters: (data.hosters ?? []).map((hoster) => ensureHosterTimestamp(hoster, fallback)),
        countries: data.countries ?? [],
        currencies: data.currencies ?? [],
        reminderRoomId: data.reminderRoomId ?? "",
    };
};

export interface MergeResult {
    merged: ServerVaultData;
    hasConflicts: boolean;
}

const mergeEntries = (local: ServerVaultEntry, remote: ServerVaultEntry): { merged: ServerVaultEntry; conflict: boolean } => {
    if (local.updatedAt === remote.updatedAt) {
        return { merged: local, conflict: false };
    }
    return {
        merged: local.updatedAt >= remote.updatedAt ? local : remote,
        conflict: true,
    };
};

const mergeDatabases = (
    local: ServerVaultDatabase,
    remote: ServerVaultDatabase,
): { merged: ServerVaultDatabase; conflict: boolean } => {
    const entryMap = new Map<string, ServerVaultEntry>();
    let conflict = local.updatedAt !== remote.updatedAt;

    local.entries.forEach((entry) => entryMap.set(entry.id, entry));
    remote.entries.forEach((entry) => {
        const existing = entryMap.get(entry.id);
        if (!existing) {
            entryMap.set(entry.id, entry);
        } else {
            const result = mergeEntries(existing, entry);
            entryMap.set(entry.id, result.merged);
            conflict = conflict || result.conflict;
        }
    });

    const mergedEntries = Array.from(entryMap.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    const merged = local.updatedAt >= remote.updatedAt ? local : remote;

    return {
        merged: {
            ...merged,
            entries: mergedEntries,
            updatedAt: Math.max(local.updatedAt, remote.updatedAt),
        },
        conflict,
    };
};

const mergeHosters = (local: ServerVaultHoster, remote: ServerVaultHoster): { merged: ServerVaultHoster; conflict: boolean } => {
    if (local.updatedAt === remote.updatedAt) {
        return { merged: local, conflict: false };
    }
    return {
        merged: local.updatedAt >= remote.updatedAt ? local : remote,
        conflict: true,
    };
};

export const mergeServerVaults = (local: ServerVaultData, remote: ServerVaultData): MergeResult => {
    const normalizedLocal = normalizeServerVault(local);
    const normalizedRemote = normalizeServerVault(remote);
    const databaseMap = new Map<string, ServerVaultDatabase>();
    let hasConflicts = false;

    normalizedLocal.databases.forEach((database) => databaseMap.set(database.id, database));
    normalizedRemote.databases.forEach((database) => {
        const existing = databaseMap.get(database.id);
        if (!existing) {
            databaseMap.set(database.id, database);
        } else {
            const result = mergeDatabases(existing, database);
            databaseMap.set(database.id, result.merged);
            hasConflicts = hasConflicts || result.conflict;
        }
    });

    const hosterMap = new Map<string, ServerVaultHoster>();
    normalizedLocal.hosters.forEach((hoster) => hosterMap.set(hoster.id, hoster));
    normalizedRemote.hosters.forEach((hoster) => {
        const existing = hosterMap.get(hoster.id);
        if (!existing) {
            hosterMap.set(hoster.id, hoster);
        } else {
            const result = mergeHosters(existing, hoster);
            hosterMap.set(hoster.id, result.merged);
            hasConflicts = hasConflicts || result.conflict;
        }
    });

    const mergedDatabases = Array.from(databaseMap.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    const mergedHosters = Array.from(hosterMap.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    const countries = Array.from(new Set([...normalizedLocal.countries, ...normalizedRemote.countries])).sort();
    const currencies = Array.from(new Set([...normalizedLocal.currencies, ...normalizedRemote.currencies])).sort();

    return {
        merged: {
            version: SERVER_VAULT_VERSION,
            updatedAt: Math.max(normalizedLocal.updatedAt, normalizedRemote.updatedAt),
            databases: mergedDatabases,
            hosters: mergedHosters,
            countries,
            currencies,
            reminderRoomId: normalizedLocal.updatedAt >= normalizedRemote.updatedAt
                ? normalizedLocal.reminderRoomId
                : normalizedRemote.reminderRoomId,
        },
        hasConflicts,
    };
};
