import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { logError } from "@/lib/log";
import { openFile, openItem, sealFile, sealItem, type VaultSection } from "@/lib/vault-crypto";
import { fetchKeyring, hasMasterKey, keyForSection, subscribeVaultKeys, type Keyring } from "@/lib/vault-keys";
import { remindOnFor, type VaultPayload } from "@/lib/vault-templates";
import { useVaultLock, useVaultUnlocked } from "@/lib/use-vault-lock";

/**
 * AVORA-68 · the three encrypted compartments as the screens see them. Rows come back as ciphertext and
 * are opened here, on the device. The decrypted list lives in React Query only while Két sắt is open
 * (use-vault-lock drops `vault-items` on lock) and is never persisted.
 */

export type VaultFileRow = { id: string; pageNo: number; storagePath: string; wrappedFileKey: string; bytes: number; mimeClass: "image" | "pdf" };
export type VaultItem = {
  id: string;
  section: VaultSection;
  payload: VaultPayload;
  remindOn: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  files: VaultFileRow[];
};

type ItemRow = {
  id: string;
  section: VaultSection;
  ciphertext: string;
  wrapped_item_key: string;
  remind_on: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  vault_files: { id: string; page_no: number; storage_path: string; wrapped_file_key: string; bytes: number; mime_class: "image" | "pdf" }[] | null;
};

export const vaultE2eeKeys = {
  keyring: (userId: string | undefined) => ["vault-keyring", userId ?? "none"] as const,
  items: (section: VaultSection) => ["vault-items", section] as const,
};

/** Whether the master key is in memory right now. */
export function useHasMasterKey(): boolean {
  return useSyncExternalStore(subscribeVaultKeys, hasMasterKey, () => false);
}

export function useKeyring(): { ring: Keyring | null | undefined; isPending: boolean } {
  const { user } = useAuth();
  const isUnlocked = useVaultUnlocked();
  const query = useQuery({ queryKey: vaultE2eeKeys.keyring(user?.id), queryFn: fetchKeyring, enabled: Boolean(user?.id) && isUnlocked, staleTime: 60_000 });
  return { ring: query.data, isPending: query.isPending };
}

const TABLE = "vault_items" as never;
const FILES = "vault_files" as never;

export function useVaultItems(section: VaultSection, ring: Keyring | null | undefined): { items: VaultItem[]; isPending: boolean; error: Error | null } {
  const { user } = useAuth();
  const hasKey = useHasMasterKey();
  const query = useQuery<VaultItem[], Error>({
    queryKey: vaultE2eeKeys.items(section),
    enabled: Boolean(user?.id) && hasKey && ring != null,
    gcTime: 0,
    queryFn: async () => {
      const userId = user?.id as string;
      const { data, error } = await supabase
        .from(TABLE)
        .select("id, section, ciphertext, wrapped_item_key, remind_on, deleted_at, created_at, updated_at, vault_files(id, page_no, storage_path, wrapped_file_key, bytes, mime_class)")
        .eq("section" as never, section as never)
        .order("created_at" as never, { ascending: true });
      if (error) throw new Error("Không tải được Két sắt.");
      const sk = await keyForSection(userId, ring as Keyring, section);
      const rows = (data ?? []) as unknown as ItemRow[];
      const out: VaultItem[] = [];
      for (const row of rows) {
        try {
          const payload = await openItem<VaultPayload>(userId, sk, row.id, { ciphertext: row.ciphertext, wrappedItemKey: row.wrapped_item_key });
          out.push({
            id: row.id,
            section: row.section,
            payload,
            remindOn: row.remind_on,
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            files: (row.vault_files ?? [])
              .map((f) => ({ id: f.id, pageNo: f.page_no, storagePath: f.storage_path, wrappedFileKey: f.wrapped_file_key, bytes: f.bytes, mimeClass: f.mime_class }))
              .sort((a, b) => a.pageNo - b.pageNo),
          });
        } catch {
          logError("vault-e2ee", { code: "item_open_failed" });
        }
      }
      return out;
    },
  });
  return { items: query.data ?? [], isPending: query.isPending && hasKey, error: query.error };
}

export type NewPage = { bytes: Uint8Array; mimeClass: "image" | "pdf" };

export function useVaultItemActions(section: VaultSection, ring: Keyring | null | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: vaultE2eeKeys.items(section) });

  const save = useMutation({
    mutationFn: async (input: { id: string | null; payload: VaultPayload; pages: NewPage[]; startPage: number }): Promise<string> => {
      const userId = user?.id as string;
      const sk = await keyForSection(userId, ring as Keyring, section);
      const id = input.id ?? crypto.randomUUID();
      const sealed = await sealItem(userId, sk, id, input.payload);
      const remindOn = remindOnFor(section, input.payload);
      // The name goes into the reminder only when the owner turned it on (stated next to the switch).
      const reminderTitle = input.payload.show_name_in_reminder ? `${input.payload.title} sắp tới hạn`.slice(0, 120) : null;
      const row = { ciphertext: sealed.ciphertext, wrapped_item_key: sealed.wrappedItemKey, remind_on: remindOn, reminder_title: reminderTitle };
      const { error } =
        input.id === null
          ? await supabase.from(TABLE).insert({ id, owner_user_id: userId, section, ...row } as never)
          : await supabase.from(TABLE).update(row as never).eq("id" as never, id as never);
      if (error) throw new Error("Không lưu được.");
      let page = input.startPage;
      for (const p of input.pages) {
        const fileId = crypto.randomUUID();
        const { blob, wrappedFileKey } = await sealFile(userId, sk, fileId, p.bytes);
        const path = `${userId}/${id}/${fileId}`;
        const up = await supabase.storage.from("vault-files").upload(path, new Blob([blob.slice().buffer as ArrayBuffer], { type: "application/octet-stream" }), { contentType: "application/octet-stream", upsert: false });
        if (up.error) throw new Error("Không tải tệp lên được.");
        const { error: fileError } = await supabase.from(FILES).insert({ id: fileId, item_id: id, owner_user_id: userId, page_no: page, storage_path: path, wrapped_file_key: wrappedFileKey, bytes: blob.length, mime_class: p.mimeClass } as never);
        if (fileError) throw new Error("Không lưu được tệp.");
        page += 1;
      }
      return id;
    },
    onSuccess: refresh,
  });

  const trash = useMutation({
    mutationFn: async (input: { id: string; restore: boolean }) => {
      const { error } = await supabase.from(TABLE).update({ deleted_at: input.restore ? null : new Date().toISOString() } as never).eq("id" as never, input.id as never);
      if (error) throw new Error("Chưa làm được.");
    },
    onSuccess: refresh,
  });

  const purge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("vault_purge_item" as never, { p_id: id } as never);
      if (error) throw new Error("Chưa xoá được.");
    },
    onSuccess: refresh,
  });

  return { save, trash, purge };
}

/** Decrypts one page into a `blob:` URL; the caller revokes it when leaving or locking. */
export async function openPage(userId: string, ring: Keyring, section: VaultSection, file: VaultFileRow): Promise<{ url: string; blob: Blob }> {
  const { data, error } = await supabase.storage.from("vault-files").download(file.storagePath);
  if (error || data === null) throw new Error("Không tải được tệp.");
  const sk = await keyForSection(userId, ring, section);
  const plain = await openFile(userId, sk, file.id, new Uint8Array(await data.arrayBuffer()), file.wrappedFileKey);
  const blob = new Blob([plain.slice().buffer as ArrayBuffer], { type: file.mimeClass === "pdf" ? "application/pdf" : "image/jpeg" });
  plain.fill(0);
  return { url: URL.createObjectURL(blob), blob };
}
