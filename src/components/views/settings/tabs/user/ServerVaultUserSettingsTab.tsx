/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ChangeEvent, type JSX, useMemo, useRef, useState } from "react";
import { ClientEvent } from "matrix-js-sdk/src/matrix";
import { MsgType, type TimelineEvents } from "matrix-js-sdk/src/types";
import { secureRandomString } from "matrix-js-sdk/src/randomstring";
import classNames from "classnames";
import { CopyIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection, SettingsSubsectionText } from "../../shared/SettingsSubsection";
import { _t } from "../../../../../languageHandler";
import Field from "../../../elements/Field";
import AccessibleButton from "../../../elements/AccessibleButton";
import { CopyTextButton } from "../../../elements/CopyableText";
import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";
import { FileDownloader } from "../../../../../utils/FileDownloader";
import {
    decryptServerVault,
    encryptServerVault,
    type EncryptedServerVaultPayload,
    SERVER_VAULT_VERSION,
    type ServerVaultData,
    type ServerVaultDatabase,
    type ServerVaultEntry,
    type ServerVaultHoster,
} from "../../../../../utils/serverVaultCrypto";
import { mergeServerVaults, normalizeServerVault } from "../../../../../utils/serverVaultSync";

const ACCOUNT_DATA_TYPE = "com.element-web-plus.server_vault.v1";
const LOCAL_STORAGE_KEY = "mx_server_vault_encrypted_v1";
const SHARED_DB_EVENT_TYPE = "com.element-web-plus.server_vault.shared_db.v1";
const SHARED_DB_LOCK_EVENT_TYPE = "com.element-web-plus.server_vault.shared_db_lock.v1";
const DEFAULT_COUNTRIES = ["Germany", "Netherlands", "France", "United States", "United Kingdom"];
const DEFAULT_CURRENCIES = ["USD", "EUR", "GBP", "RUB"];

const addMonths = (date: Date, months: number): Date => {
    const next = new Date(date.getTime());
    next.setMonth(next.getMonth() + months);
    return next;
};

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const createEmptyEntry = (): ServerVaultEntry => {
    const now = new Date();
    const nowTimestamp = Date.now();
    return {
        id: secureRandomString(8),
        serverName: "",
        ipAddress: "",
        country: "",
        hosterName: "",
        sshPort: "22",
        sshKey: "",
        rootPassword: "",
        additionalUsers: "",
        quickCommands: "",
        dropbearPort: "",
        dropbearKey: "",
        dropbearLuksPassword: "",
        luksDiskPasswords: "",
        purchaseDate: formatDate(now),
        renewalDate: formatDate(addMonths(now, 1)),
        price: "",
        currency: "",
        hosterLogin: "",
        hosterPassword: "",
        emailLogin: "",
        emailPassword: "",
        notes: "",
        updatedAt: nowTimestamp,
    };
};

const createDefaultDatabase = (): ServerVaultDatabase => ({
    id: secureRandomString(8),
    name: _t("settings|server_vault|default_db"),
    entries: [createEmptyEntry()],
    updatedAt: Date.now(),
    sharedRoomId: "",
});

const createDefaultVault = (): ServerVaultData => ({
    version: SERVER_VAULT_VERSION,
    databases: [createDefaultDatabase()],
    hosters: [],
    countries: [...DEFAULT_COUNTRIES],
    currencies: [...DEFAULT_CURRENCIES],
    reminderRoomId: "",
    updatedAt: Date.now(),
});

const normalizeVault = (data: ServerVaultData): ServerVaultData => {
    const normalized = normalizeServerVault(data);
    return {
        ...normalized,
        databases: normalized.databases.length ? normalized.databases : [createDefaultDatabase()],
    };
};

const formatSummary = (entry: ServerVaultEntry): string => {
    const summaryParts = [entry.ipAddress, entry.serverName, entry.renewalDate, entry.price];
    return summaryParts.filter(Boolean).join(" · ");
};

const downloadFile = async (name: string, content: string): Promise<void> => {
    const downloader = new FileDownloader();
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    await downloader.download({ blob, name });
};

const toVaultText = (vault: ServerVaultData): string => {
    const lines: string[] = [];
    vault.databases.forEach((database) => {
        lines.push(`# ${database.name}`);
        database.entries.forEach((entry) => {
            lines.push(`- ${formatSummary(entry)}`);
            lines.push(`  Server name: ${entry.serverName}`);
            lines.push(`  IP: ${entry.ipAddress}`);
            lines.push(`  Country: ${entry.country}`);
            lines.push(`  Hoster: ${entry.hosterName}`);
            lines.push(`  SSH port: ${entry.sshPort}`);
            lines.push(`  SSH key: ${entry.sshKey}`);
            lines.push(`  Root password: ${entry.rootPassword}`);
            lines.push(`  Additional users: ${entry.additionalUsers}`);
            lines.push(`  Quick commands: ${entry.quickCommands}`);
            lines.push(`  Dropbear port: ${entry.dropbearPort}`);
            lines.push(`  Dropbear key: ${entry.dropbearKey}`);
            lines.push(`  Dropbear LUKS password: ${entry.dropbearLuksPassword}`);
            lines.push(`  LUKS disks: ${entry.luksDiskPasswords}`);
            lines.push(`  Purchase date: ${entry.purchaseDate}`);
            lines.push(`  Renewal date: ${entry.renewalDate}`);
            lines.push(`  Price: ${entry.price}`);
            lines.push(`  Currency: ${entry.currency}`);
            lines.push(`  Hoster login: ${entry.hosterLogin}`);
            lines.push(`  Hoster password: ${entry.hosterPassword}`);
            lines.push(`  Email login: ${entry.emailLogin}`);
            lines.push(`  Email password: ${entry.emailPassword}`);
            lines.push(`  Notes: ${entry.notes}`);
        });
        lines.push("");
    });
    return lines.join("\n");
};

const ServerVaultUserSettingsTab: React.FC = (): JSX.Element => {
    const cli = useMatrixClientContext();
    const [vault, setVault] = useState<ServerVaultData>(() => createDefaultVault());
    const [activeDatabaseId, setActiveDatabaseId] = useState<string>(() => vault.databases[0].id);
    const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set());
    const [password, setPassword] = useState<string>("");
    const [statusMessage, setStatusMessage] = useState<string>("");
    const [isBusy, setIsBusy] = useState<boolean>(false);
    const [hasRemoteVault, setHasRemoteVault] = useState<boolean>(false);
    const [hasLocalVault, setHasLocalVault] = useState<boolean>(false);
    const [newCountry, setNewCountry] = useState<string>("");
    const [newCurrency, setNewCurrency] = useState<string>("");
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [sharedLocks, setSharedLocks] = useState<Record<string, { userId: string } | null>>({});

    const refreshSharedLock = React.useCallback(
        async (database: ServerVaultDatabase): Promise<void> => {
            if (!database.sharedRoomId) return;
            try {
                const content = await cli.getStateEvent(database.sharedRoomId, SHARED_DB_LOCK_EVENT_TYPE, database.id);
                const userId = typeof content?.userId === "string" ? content.userId : "";
                setSharedLocks((prev) => ({ ...prev, [database.id]: userId ? { userId } : null }));
            } catch {
                setSharedLocks((prev) => ({ ...prev, [database.id]: null }));
            }
        },
        [cli],
    );

    React.useEffect(() => {
        const accountData = cli.getAccountData(ACCOUNT_DATA_TYPE);
        setHasRemoteVault(Boolean(accountData?.getContent()?.ciphertext));
        setHasLocalVault(Boolean(localStorage.getItem(LOCAL_STORAGE_KEY)));
        const onAccountData = (): void => {
            const updated = cli.getAccountData(ACCOUNT_DATA_TYPE);
            setHasRemoteVault(Boolean(updated?.getContent()?.ciphertext));
        };
        cli.on(ClientEvent.AccountData, onAccountData);
        return () => {
            cli.off(ClientEvent.AccountData, onAccountData);
        };
    }, [cli]);

    const activeDatabase = useMemo(
        () => vault.databases.find((database) => database.id === activeDatabaseId) ?? vault.databases[0],
        [vault, activeDatabaseId],
    );
    const activeLockOwner = sharedLocks[activeDatabase.id]?.userId;
    const isReadOnly = Boolean(activeDatabase.sharedRoomId) && activeLockOwner !== cli.getUserId();

    React.useEffect(() => {
        if (activeDatabase.sharedRoomId) {
            refreshSharedLock(activeDatabase);
        }
    }, [activeDatabase, refreshSharedLock]);

    const updateDatabase = (
        databaseId: string,
        updater: (database: ServerVaultDatabase) => ServerVaultDatabase,
    ): void => {
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            databases: prev.databases.map((database) =>
                database.id === databaseId ? updater({ ...database, updatedAt: Date.now() }) : database,
            ),
        }));
    };

    const updateEntry = (entryId: string, updater: (entry: ServerVaultEntry) => ServerVaultEntry): void => {
        updateDatabase(activeDatabase.id, (database) => ({
            ...database,
            entries: database.entries.map((entry) =>
                entry.id === entryId ? updater({ ...entry, updatedAt: Date.now() }) : entry,
            ),
        }));
    };

    const addDatabase = (): void => {
        const newDatabase = {
            id: secureRandomString(8),
            name: _t("settings|server_vault|new_db"),
            entries: [],
            updatedAt: Date.now(),
            sharedRoomId: "",
        };
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            databases: [...prev.databases, newDatabase],
        }));
        setActiveDatabaseId(newDatabase.id);
    };

    const removeDatabase = (databaseId: string): void => {
        const remaining = vault.databases.filter((database) => database.id !== databaseId);
        const nextDatabases = remaining.length ? remaining : [createDefaultDatabase()];
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            databases: nextDatabases,
        }));
        setActiveDatabaseId(nextDatabases[0].id);
    };

    const addEntry = (): void => {
        updateDatabase(activeDatabase.id, (database) => ({
            ...database,
            entries: [...database.entries, createEmptyEntry()],
        }));
    };

    const toggleEntry = (entryId: string): void => {
        setExpandedEntries((prev) => {
            const next = new Set(prev);
            if (next.has(entryId)) {
                next.delete(entryId);
            } else {
                next.add(entryId);
            }
            return next;
        });
    };

    const updateListValue = (key: "countries" | "currencies", value: string): void => {
        if (!value.trim()) return;
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            [key]: Array.from(new Set([...prev[key], value.trim()])).sort(),
        }));
    };

    const removeListValue = (key: "countries" | "currencies", value: string): void => {
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            [key]: prev[key].filter((entry) => entry !== value),
        }));
    };

    const updateHoster = (hosterId: string, updater: (hoster: ServerVaultHoster) => ServerVaultHoster): void => {
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            hosters: prev.hosters.map((hoster) =>
                hoster.id === hosterId ? updater({ ...hoster, updatedAt: Date.now() }) : hoster,
            ),
        }));
    };

    const handleTakeEditLock = async (): Promise<void> => {
        if (!activeDatabase.sharedRoomId) return;
        setIsBusy(true);
        try {
            const userId = cli.getUserId() ?? "";
            await cli.sendStateEvent(
                activeDatabase.sharedRoomId,
                SHARED_DB_LOCK_EVENT_TYPE,
                { userId },
                activeDatabase.id,
            );
            setSharedLocks((prev) => ({ ...prev, [activeDatabase.id]: { userId } }));
            setStatusMessage(_t("settings|server_vault|lock_acquired"));
        } catch {
            setStatusMessage(_t("settings|server_vault|lock_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleReleaseEditLock = async (): Promise<void> => {
        if (!activeDatabase.sharedRoomId) return;
        setIsBusy(true);
        try {
            await cli.sendStateEvent(
                activeDatabase.sharedRoomId,
                SHARED_DB_LOCK_EVENT_TYPE,
                { userId: "" },
                activeDatabase.id,
            );
            setSharedLocks((prev) => ({ ...prev, [activeDatabase.id]: null }));
            setStatusMessage(_t("settings|server_vault|lock_released"));
        } catch {
            setStatusMessage(_t("settings|server_vault|lock_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleSyncSharedDatabase = async (): Promise<void> => {
        if (!activeDatabase.sharedRoomId) return;
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        if (isReadOnly) {
            setStatusMessage(_t("settings|server_vault|read_only"));
            return;
        }
        setIsBusy(true);
        try {
            const sharedVault = normalizeVault({
                ...vault,
                databases: [activeDatabase],
            });
            const encrypted = await encryptServerVault(sharedVault, password);
            await cli.sendStateEvent(activeDatabase.sharedRoomId, SHARED_DB_EVENT_TYPE, encrypted, activeDatabase.id);
            setStatusMessage(_t("settings|server_vault|shared_sync_success"));
        } catch {
            setStatusMessage(_t("settings|server_vault|shared_sync_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleLoadSharedDatabase = async (): Promise<void> => {
        if (!activeDatabase.sharedRoomId) return;
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        setIsBusy(true);
        try {
            const encrypted = (await cli.getStateEvent(
                activeDatabase.sharedRoomId,
                SHARED_DB_EVENT_TYPE,
                activeDatabase.id,
            )) as EncryptedServerVaultPayload;
            const decrypted = normalizeVault(await decryptServerVault(encrypted, password));
            const mergeResult = mergeServerVaults(normalizeVault(vault), decrypted);
            setVault(mergeResult.merged);
            setActiveDatabaseId(mergeResult.merged.databases[0].id);
            setStatusMessage(
                mergeResult.hasConflicts
                    ? _t("settings|server_vault|sync_conflict_resolved")
                    : _t("settings|server_vault|shared_load_success"),
            );
        } catch {
            setStatusMessage(_t("settings|server_vault|shared_load_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const saveLocalPayload = (payload: EncryptedServerVaultPayload): void => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
        setHasLocalVault(true);
    };

    const loadLocalPayload = (): EncryptedServerVaultPayload | null => {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as EncryptedServerVaultPayload;
    };

    const addHoster = (): void => {
        const hoster: ServerVaultHoster = {
            id: secureRandomString(8),
            name: "",
            url: "",
            notes: "",
            updatedAt: Date.now(),
        };
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            hosters: [...prev.hosters, hoster],
        }));
    };

    const removeHoster = (hosterId: string): void => {
        setVault((prev) => ({
            ...prev,
            updatedAt: Date.now(),
            hosters: prev.hosters.filter((hoster) => hoster.id !== hosterId),
        }));
    };

    const handleExportText = async (): Promise<void> => {
        await downloadFile("server-vault.txt", toVaultText(vault));
    };

    const handleExportEncrypted = async (): Promise<void> => {
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        setIsBusy(true);
        try {
            const encrypted = await encryptServerVault(normalizeVault(vault), password);
            saveLocalPayload(encrypted);
            await downloadFile("server-vault.encrypted.json", JSON.stringify(encrypted, null, 2));
            setStatusMessage(_t("settings|server_vault|export_success"));
        } catch {
            setStatusMessage(_t("settings|server_vault|export_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleImportEncrypted = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        setIsBusy(true);
        try {
            const text = await file.text();
            const payload = JSON.parse(text) as EncryptedServerVaultPayload;
            const decrypted = normalizeVault(await decryptServerVault(payload, password));
            const mergeResult = mergeServerVaults(normalizeVault(vault), decrypted);
            setVault(mergeResult.merged);
            setActiveDatabaseId(mergeResult.merged.databases[0].id);
            const encryptedMerged = await encryptServerVault(mergeResult.merged, password);
            saveLocalPayload(encryptedMerged);
            setStatusMessage(_t("settings|server_vault|import_success"));
        } catch {
            setStatusMessage(_t("settings|server_vault|import_failed"));
        } finally {
            setIsBusy(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    const handleSaveToMatrix = async (): Promise<void> => {
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        setIsBusy(true);
        try {
            const encrypted = await encryptServerVault(normalizeVault(vault), password);
            await cli.setAccountData(ACCOUNT_DATA_TYPE, encrypted);
            saveLocalPayload(encrypted);
            setStatusMessage(_t("settings|server_vault|sync_success"));
        } catch {
            setStatusMessage(_t("settings|server_vault|sync_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleLoadFromMatrix = async (): Promise<void> => {
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        setIsBusy(true);
        try {
            const data = cli.getAccountData(ACCOUNT_DATA_TYPE)?.getContent() as EncryptedServerVaultPayload | undefined;
            if (!data?.ciphertext) {
                setStatusMessage(_t("settings|server_vault|no_remote_data"));
            } else {
                const remoteVault = normalizeVault(await decryptServerVault(data, password));
                const localVault = normalizeVault(vault);
                const mergeResult = mergeServerVaults(localVault, remoteVault);
                setVault(mergeResult.merged);
                setActiveDatabaseId(mergeResult.merged.databases[0].id);
                const encryptedMerged = await encryptServerVault(mergeResult.merged, password);
                await cli.setAccountData(ACCOUNT_DATA_TYPE, encryptedMerged);
                saveLocalPayload(encryptedMerged);
                setStatusMessage(
                    mergeResult.hasConflicts
                        ? _t("settings|server_vault|sync_conflict_resolved")
                        : _t("settings|server_vault|import_success"),
                );
            }
        } catch {
            setStatusMessage(_t("settings|server_vault|import_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleSaveLocal = async (): Promise<void> => {
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        setIsBusy(true);
        try {
            const encrypted = await encryptServerVault(normalizeVault(vault), password);
            saveLocalPayload(encrypted);
            setStatusMessage(_t("settings|server_vault|local_save_success"));
        } catch {
            setStatusMessage(_t("settings|server_vault|local_save_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleLoadLocal = async (): Promise<void> => {
        if (!password) {
            setStatusMessage(_t("settings|server_vault|password_required"));
            return;
        }
        setIsBusy(true);
        try {
            const payload = loadLocalPayload();
            if (!payload?.ciphertext) {
                setStatusMessage(_t("settings|server_vault|no_local_data"));
            } else {
                const decrypted = normalizeVault(await decryptServerVault(payload, password));
                const mergeResult = mergeServerVaults(normalizeVault(vault), decrypted);
                setVault(mergeResult.merged);
                setActiveDatabaseId(mergeResult.merged.databases[0].id);
                setStatusMessage(_t("settings|server_vault|local_load_success"));
            }
        } catch {
            setStatusMessage(_t("settings|server_vault|local_load_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const handleSendReminders = async (): Promise<void> => {
        const roomId = vault.reminderRoomId.trim();
        if (!roomId) {
            setStatusMessage(_t("settings|server_vault|reminder_room_required"));
            return;
        }
        const today = new Date();
        const reminders = vault.databases.flatMap((database) =>
            database.entries.filter((entry) => {
                if (!entry.renewalDate) return false;
                const renewal = new Date(entry.renewalDate);
                const diff = renewal.getTime() - today.getTime();
                const days = diff / (1000 * 60 * 60 * 24);
                return days <= 7;
            }),
        );
        if (!reminders.length) {
            setStatusMessage(_t("settings|server_vault|reminder_none"));
            return;
        }
        setIsBusy(true);
        try {
            const lines = reminders.map(
                (entry) =>
                    `• ${entry.serverName || entry.ipAddress || _t("settings|server_vault|unnamed")} – ${
                        entry.renewalDate
                    } (${entry.price} ${entry.currency})`,
            );
            await cli.sendEvent(roomId, "m.room.message" as keyof TimelineEvents, {
                msgtype: MsgType.Text,
                body: `${_t("settings|server_vault|reminder_message")}\n${lines.join("\n")}`,
            });
            setStatusMessage(_t("settings|server_vault|reminder_sent"));
        } catch {
            setStatusMessage(_t("settings|server_vault|reminder_failed"));
        } finally {
            setIsBusy(false);
        }
    };

    const datalistId = `mx_ServerVaultUserSettingsTab_countries_${activeDatabase.id}`;
    const currenciesListId = `mx_ServerVaultUserSettingsTab_currencies_${activeDatabase.id}`;
    const hostersListId = `mx_ServerVaultUserSettingsTab_hosters_${activeDatabase.id}`;

    return (
        <SettingsTab className="mx_ServerVaultUserSettingsTab" data-testid="mx_ServerVaultUserSettingsTab">
            <SettingsSection heading={_t("settings|server_vault|title")}>
                <SettingsSubsectionText>{_t("settings|server_vault|description")}</SettingsSubsectionText>
                <SettingsSubsection heading={_t("settings|server_vault|storage_title")} stretchContent>
                    <SettingsSubsectionText>{_t("settings|server_vault|storage_help")}</SettingsSubsectionText>
                    <div className="mx_ServerVaultUserSettingsTab_storageControls">
                        <Field
                            element="input"
                            type="password"
                            label={_t("settings|server_vault|password")}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="new-password"
                        />
                        <div className="mx_ServerVaultUserSettingsTab_storageButtons">
                            <AccessibleButton kind="primary" onClick={handleSaveToMatrix} disabled={isBusy}>
                                {_t("settings|server_vault|save_sync")}
                            </AccessibleButton>
                            <AccessibleButton
                                kind="primary"
                                onClick={handleLoadFromMatrix}
                                disabled={isBusy || !hasRemoteVault}
                            >
                                {_t("settings|server_vault|load_sync")}
                            </AccessibleButton>
                            <AccessibleButton kind="secondary" onClick={handleSaveLocal} disabled={isBusy}>
                                {_t("settings|server_vault|save_local")}
                            </AccessibleButton>
                            <AccessibleButton
                                kind="secondary"
                                onClick={handleLoadLocal}
                                disabled={isBusy || !hasLocalVault}
                            >
                                {_t("settings|server_vault|load_local")}
                            </AccessibleButton>
                        </div>
                        <div className="mx_ServerVaultUserSettingsTab_storageButtons">
                            <AccessibleButton kind="secondary" onClick={handleExportText} disabled={isBusy}>
                                {_t("settings|server_vault|export_text")}
                            </AccessibleButton>
                            <AccessibleButton kind="secondary" onClick={handleExportEncrypted} disabled={isBusy}>
                                {_t("settings|server_vault|export_encrypted")}
                            </AccessibleButton>
                            <label className="mx_ServerVaultUserSettingsTab_fileInput">
                                <span className="mx_ServerVaultUserSettingsTab_fileInputLabel">
                                    {_t("settings|server_vault|import_encrypted")}
                                </span>
                                <input
                                    type="file"
                                    accept="application/json"
                                    ref={fileInputRef}
                                    onChange={handleImportEncrypted}
                                    disabled={isBusy}
                                />
                            </label>
                        </div>
                        <SettingsSubsectionText>
                            {_t("settings|server_vault|local_storage_help")}
                        </SettingsSubsectionText>
                        {statusMessage && (
                            <div className="mx_ServerVaultUserSettingsTab_status" role="status">
                                {statusMessage}
                            </div>
                        )}
                    </div>
                </SettingsSubsection>
            </SettingsSection>

            <SettingsSection heading={_t("settings|server_vault|databases_title")}>
                <div className="mx_ServerVaultUserSettingsTab_databases">
                    <div className="mx_ServerVaultUserSettingsTab_databaseTabs">
                        {vault.databases.map((database) => (
                            <div key={database.id} className="mx_ServerVaultUserSettingsTab_databaseTab">
                                <AccessibleButton
                                    kind="primary"
                                    onClick={() => setActiveDatabaseId(database.id)}
                                    className={classNames({
                                        "mx_ServerVaultUserSettingsTab_databaseTab--active":
                                            database.id === activeDatabase.id,
                                    })}
                                >
                                    {database.name}
                                </AccessibleButton>
                                <AccessibleButton
                                    kind="danger"
                                    onClick={() => removeDatabase(database.id)}
                                    className="mx_ServerVaultUserSettingsTab_databaseRemove"
                                >
                                    {_t("settings|server_vault|remove")}
                                </AccessibleButton>
                            </div>
                        ))}
                        <AccessibleButton kind="secondary" onClick={addDatabase} disabled={isReadOnly}>
                            {_t("settings|server_vault|add_db")}
                        </AccessibleButton>
                    </div>
                    <div className="mx_ServerVaultUserSettingsTab_databaseContent">
                        <Field
                            element="input"
                            label={_t("settings|server_vault|db_name")}
                            value={activeDatabase.name}
                            disabled={isReadOnly}
                            onChange={(event) =>
                                updateDatabase(activeDatabase.id, (database) => ({
                                    ...database,
                                    name: event.target.value,
                                }))
                            }
                        />
                        <div className="mx_ServerVaultUserSettingsTab_sharedControls">
                            <Field
                                element="input"
                                label={_t("settings|server_vault|shared_room_id")}
                                value={activeDatabase.sharedRoomId}
                                disabled={isReadOnly}
                                onChange={(event) =>
                                    updateDatabase(activeDatabase.id, (database) => ({
                                        ...database,
                                        sharedRoomId: event.target.value,
                                    }))
                                }
                            />
                            <div className="mx_ServerVaultUserSettingsTab_storageButtons">
                                <AccessibleButton
                                    kind="secondary"
                                    onClick={() => refreshSharedLock(activeDatabase)}
                                    disabled={!activeDatabase.sharedRoomId || isBusy}
                                >
                                    {_t("settings|server_vault|check_lock")}
                                </AccessibleButton>
                                <AccessibleButton
                                    kind="secondary"
                                    onClick={handleTakeEditLock}
                                    disabled={!activeDatabase.sharedRoomId || isBusy}
                                >
                                    {_t("settings|server_vault|take_lock")}
                                </AccessibleButton>
                                <AccessibleButton
                                    kind="secondary"
                                    onClick={handleReleaseEditLock}
                                    disabled={!activeDatabase.sharedRoomId || isBusy || !activeLockOwner}
                                >
                                    {_t("settings|server_vault|release_lock")}
                                </AccessibleButton>
                                <AccessibleButton
                                    kind="primary"
                                    onClick={handleLoadSharedDatabase}
                                    disabled={!activeDatabase.sharedRoomId || isBusy}
                                >
                                    {_t("settings|server_vault|load_shared")}
                                </AccessibleButton>
                                <AccessibleButton
                                    kind="primary"
                                    onClick={handleSyncSharedDatabase}
                                    disabled={!activeDatabase.sharedRoomId || isBusy || isReadOnly}
                                >
                                    {_t("settings|server_vault|sync_shared")}
                                </AccessibleButton>
                            </div>
                            {activeDatabase.sharedRoomId && (
                                <div className="mx_ServerVaultUserSettingsTab_status">
                                    {activeLockOwner
                                        ? _t("settings|server_vault|lock_owned", { userId: activeLockOwner })
                                        : _t("settings|server_vault|lock_unclaimed")}
                                </div>
                            )}
                        </div>
                        <div className="mx_ServerVaultUserSettingsTab_records">
                            <div className="mx_ServerVaultUserSettingsTab_recordsHeader">
                                <span>{_t("settings|server_vault|table_ip")}</span>
                                <span>{_t("settings|server_vault|table_name")}</span>
                                <span>{_t("settings|server_vault|table_renewal")}</span>
                                <span>{_t("settings|server_vault|table_price")}</span>
                            </div>
                            {activeDatabase.entries.map((entry) => {
                                const isExpanded = expandedEntries.has(entry.id);
                                return (
                                    <div key={entry.id} className="mx_ServerVaultUserSettingsTab_record">
                                        <AccessibleButton
                                            kind="link"
                                            onClick={() => toggleEntry(entry.id)}
                                            className="mx_ServerVaultUserSettingsTab_recordSummary"
                                        >
                                            <span>{entry.ipAddress || "—"}</span>
                                            <span>{entry.serverName || "—"}</span>
                                            <span>{entry.renewalDate || "—"}</span>
                                            <span>{entry.price ? `${entry.price} ${entry.currency}` : "—"}</span>
                                        </AccessibleButton>
                                        {isExpanded && (
                                            <div className="mx_ServerVaultUserSettingsTab_recordDetails">
                                                <div className="mx_ServerVaultUserSettingsTab_fieldGrid">
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_server_name")}
                                                        value={entry.serverName}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                serverName: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.serverName}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_ip")}
                                                        value={entry.ipAddress}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                ipAddress: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.ipAddress}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_country")}
                                                        value={entry.country}
                                                        list={datalistId}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                country: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.country}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_hoster")}
                                                        value={entry.hosterName}
                                                        list={hostersListId}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                hosterName: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.hosterName}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_ssh_port")}
                                                        value={entry.sshPort}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                sshPort: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.sshPort}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="textarea"
                                                        label={_t("settings|server_vault|field_ssh_key")}
                                                        value={entry.sshKey}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                sshKey: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.sshKey}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        type="password"
                                                        label={_t("settings|server_vault|field_root_password")}
                                                        value={entry.rootPassword}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                rootPassword: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.rootPassword}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="textarea"
                                                        label={_t("settings|server_vault|field_additional_users")}
                                                        value={entry.additionalUsers}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                additionalUsers: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.additionalUsers}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="textarea"
                                                        label={_t("settings|server_vault|field_quick_commands")}
                                                        value={entry.quickCommands}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                quickCommands: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.quickCommands}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_dropbear_port")}
                                                        value={entry.dropbearPort}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                dropbearPort: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.dropbearPort}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="textarea"
                                                        label={_t("settings|server_vault|field_dropbear_key")}
                                                        value={entry.dropbearKey}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                dropbearKey: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.dropbearKey}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        type="password"
                                                        label={_t("settings|server_vault|field_dropbear_luks")}
                                                        value={entry.dropbearLuksPassword}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                dropbearLuksPassword: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.dropbearLuksPassword}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="textarea"
                                                        label={_t("settings|server_vault|field_luks_disks")}
                                                        value={entry.luksDiskPasswords}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                luksDiskPasswords: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.luksDiskPasswords}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        type="date"
                                                        label={_t("settings|server_vault|field_purchase_date")}
                                                        value={entry.purchaseDate}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                purchaseDate: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.purchaseDate}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        type="date"
                                                        label={_t("settings|server_vault|field_renewal_date")}
                                                        value={entry.renewalDate}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                renewalDate: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.renewalDate}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_price")}
                                                        value={entry.price}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                price: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.price}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_currency")}
                                                        value={entry.currency}
                                                        list={currenciesListId}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                currency: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.currency}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_hoster_login")}
                                                        value={entry.hosterLogin}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                hosterLogin: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.hosterLogin}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        type="password"
                                                        label={_t("settings|server_vault|field_hoster_password")}
                                                        value={entry.hosterPassword}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                hosterPassword: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.hosterPassword}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        label={_t("settings|server_vault|field_email_login")}
                                                        value={entry.emailLogin}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                emailLogin: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.emailLogin}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="input"
                                                        type="password"
                                                        label={_t("settings|server_vault|field_email_password")}
                                                        value={entry.emailPassword}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                emailPassword: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.emailPassword}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                    <Field
                                                        element="textarea"
                                                        label={_t("settings|server_vault|field_notes")}
                                                        value={entry.notes}
                                                        disabled={isReadOnly}
                                                        onChange={(event) =>
                                                            updateEntry(entry.id, (item) => ({
                                                                ...item,
                                                                notes: event.target.value,
                                                            }))
                                                        }
                                                        postfixComponent={
                                                            <CopyTextButton
                                                                getTextToCopy={() => entry.notes}
                                                                className="mx_ServerVaultUserSettingsTab_copyButton"
                                                            >
                                                                <CopyIcon />
                                                            </CopyTextButton>
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <AccessibleButton kind="primary" onClick={addEntry} disabled={isReadOnly}>
                                {_t("settings|server_vault|add_entry")}
                            </AccessibleButton>
                        </div>
                    </div>
                </div>
                <datalist id={datalistId}>
                    {vault.countries.map((country) => (
                        <option key={country} value={country} />
                    ))}
                </datalist>
                <datalist id={currenciesListId}>
                    {vault.currencies.map((currency) => (
                        <option key={currency} value={currency} />
                    ))}
                </datalist>
                <datalist id={hostersListId}>
                    {vault.hosters.map((hoster) => (
                        <option key={hoster.id} value={hoster.name} />
                    ))}
                </datalist>
            </SettingsSection>

            <SettingsSection heading={_t("settings|server_vault|lists_title")}>
                <SettingsSubsectionText>{_t("settings|server_vault|lists_description")}</SettingsSubsectionText>
                <SettingsSubsection
                    heading={_t("settings|server_vault|countries_title")}
                    description={_t("settings|server_vault|countries_description")}
                >
                    <div className="mx_ServerVaultUserSettingsTab_listEditor">
                        <div className="mx_ServerVaultUserSettingsTab_listItems">
                            {vault.countries.map((country) => (
                                <span key={country} className="mx_ServerVaultUserSettingsTab_listChip">
                                    {country}
                                    <AccessibleButton
                                        kind="link"
                                        onClick={() => removeListValue("countries", country)}
                                        disabled={isReadOnly}
                                    >
                                        {_t("settings|server_vault|remove")}
                                    </AccessibleButton>
                                </span>
                            ))}
                        </div>
                        <div className="mx_ServerVaultUserSettingsTab_listAdd">
                            <Field
                                element="input"
                                label={_t("settings|server_vault|add_country")}
                                value={newCountry}
                                disabled={isReadOnly}
                                onChange={(event) => setNewCountry(event.target.value)}
                                onBlur={() => {
                                    updateListValue("countries", newCountry);
                                    setNewCountry("");
                                }}
                            />
                            <AccessibleButton
                                kind="secondary"
                                disabled={isReadOnly}
                                onClick={() => {
                                    updateListValue("countries", newCountry);
                                    setNewCountry("");
                                }}
                            >
                                {_t("settings|server_vault|add")}
                            </AccessibleButton>
                        </div>
                    </div>
                </SettingsSubsection>
                <SettingsSubsection
                    heading={_t("settings|server_vault|currencies_title")}
                    description={_t("settings|server_vault|currencies_description")}
                >
                    <div className="mx_ServerVaultUserSettingsTab_listEditor">
                        <div className="mx_ServerVaultUserSettingsTab_listItems">
                            {vault.currencies.map((currency) => (
                                <span key={currency} className="mx_ServerVaultUserSettingsTab_listChip">
                                    {currency}
                                    <AccessibleButton
                                        kind="link"
                                        onClick={() => removeListValue("currencies", currency)}
                                        disabled={isReadOnly}
                                    >
                                        {_t("settings|server_vault|remove")}
                                    </AccessibleButton>
                                </span>
                            ))}
                        </div>
                        <div className="mx_ServerVaultUserSettingsTab_listAdd">
                            <Field
                                element="input"
                                label={_t("settings|server_vault|add_currency")}
                                value={newCurrency}
                                disabled={isReadOnly}
                                onChange={(event) => setNewCurrency(event.target.value)}
                                onBlur={() => {
                                    updateListValue("currencies", newCurrency);
                                    setNewCurrency("");
                                }}
                            />
                            <AccessibleButton
                                kind="secondary"
                                disabled={isReadOnly}
                                onClick={() => {
                                    updateListValue("currencies", newCurrency);
                                    setNewCurrency("");
                                }}
                            >
                                {_t("settings|server_vault|add")}
                            </AccessibleButton>
                        </div>
                    </div>
                </SettingsSubsection>
                <SettingsSubsection
                    heading={_t("settings|server_vault|hosters_title")}
                    description={_t("settings|server_vault|hosters_description")}
                >
                    <div className="mx_ServerVaultUserSettingsTab_hosters">
                        {vault.hosters.map((hoster) => (
                            <div key={hoster.id} className="mx_ServerVaultUserSettingsTab_hoster">
                                <Field
                                    element="input"
                                    label={_t("settings|server_vault|hoster_name")}
                                    value={hoster.name}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                        updateHoster(hoster.id, (item) => ({
                                            ...item,
                                            name: event.target.value,
                                        }))
                                    }
                                />
                                <Field
                                    element="input"
                                    label={_t("settings|server_vault|hoster_url")}
                                    value={hoster.url}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                        updateHoster(hoster.id, (item) => ({
                                            ...item,
                                            url: event.target.value,
                                        }))
                                    }
                                />
                                <Field
                                    element="textarea"
                                    label={_t("settings|server_vault|hoster_notes")}
                                    value={hoster.notes}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                        updateHoster(hoster.id, (item) => ({
                                            ...item,
                                            notes: event.target.value,
                                        }))
                                    }
                                />
                                <AccessibleButton
                                    kind="danger"
                                    onClick={() => removeHoster(hoster.id)}
                                    disabled={isReadOnly}
                                >
                                    {_t("settings|server_vault|remove")}
                                </AccessibleButton>
                            </div>
                        ))}
                        <AccessibleButton kind="secondary" onClick={addHoster} disabled={isReadOnly}>
                            {_t("settings|server_vault|add_hoster")}
                        </AccessibleButton>
                    </div>
                </SettingsSubsection>
            </SettingsSection>

            <SettingsSection heading={_t("settings|server_vault|reminders_title")}>
                <SettingsSubsectionText>{_t("settings|server_vault|reminders_description")}</SettingsSubsectionText>
                <SettingsSubsection heading={_t("settings|server_vault|reminders_room_title")}>
                    <Field
                        element="input"
                        label={_t("settings|server_vault|reminder_room_label")}
                        value={vault.reminderRoomId}
                        onChange={(event) =>
                            setVault((prev) => ({
                                ...prev,
                                updatedAt: Date.now(),
                                reminderRoomId: event.target.value,
                            }))
                        }
                    />
                    <AccessibleButton kind="primary" onClick={handleSendReminders} disabled={isBusy}>
                        {_t("settings|server_vault|reminder_send")}
                    </AccessibleButton>
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
};

export default ServerVaultUserSettingsTab;
