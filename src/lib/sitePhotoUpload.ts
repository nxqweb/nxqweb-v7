// Uploads one photo with the same protected sequence the Files card uses (ticketed, quota-checked, scanned before anyone can open it), then registers it.
// Only functions that already exist in real migrations are called here: nxq_authorize_storage_upload (246) and current_client_register_uploaded_file (185).
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeStorageUpload, cancelStorageUpload, completeStorageUpload } from "./storageUploadAuthorization";
import type { PhotoUploader } from "./sitePhotos";

export function createPhotoUploader(client: SupabaseClient, clientId: string): PhotoUploader {
  return async (file) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${clientId}/${Date.now()}-${safeName}`;
    let ticket: string;
    try {
      ticket = await authorizeStorageUpload(client, "client-files", path, file);
    } catch {
      return { ok: false, message: "Photo uploads are not available for your account yet. If you have paid and this keeps showing, message support." };
    }
    const stored = await client.storage.from("client-files").upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
    if (stored.error) {
      await cancelStorageUpload(client, ticket);
      return { ok: false, message: "The photo could not be uploaded. Nothing was saved." };
    }
    try {
      await completeStorageUpload(client, ticket);
    } catch {
      await client.storage.from("client-files").remove([path]);
      await cancelStorageUpload(client, ticket);
      return { ok: false, message: "The photo upload could not be finished. The temporary copy was removed." };
    }
    const registered = await client.rpc("current_client_register_uploaded_file", {
      target_storage_path: path,
      target_file_name: file.name,
      target_file_type: file.type,
      target_file_size: file.size,
    });
    const fileId = (registered.data as { file?: { id?: string } } | null)?.file?.id;
    if (registered.error || typeof fileId !== "string") {
      await client.storage.from("client-files").remove([path]);
      await cancelStorageUpload(client, ticket);
      return { ok: false, message: "The photo could not be registered, so the uploaded copy was removed. Nothing was added." };
    }
    return { ok: true, fileId };
  };
}
