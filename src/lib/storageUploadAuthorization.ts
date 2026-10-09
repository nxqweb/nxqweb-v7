import type { SupabaseClient } from "@supabase/supabase-js";

type UploadTicketResult = {
  ticket_id?: string;
};

export async function authorizeStorageUpload(
  client: SupabaseClient,
  bucketId: string,
  objectPath: string,
  file: File,
) {
  const result = await client.rpc("nxq_authorize_storage_upload", {
    target_bucket_id: bucketId,
    target_object_path: objectPath,
    target_file_size: file.size,
    target_mime_type: file.type || "application/octet-stream",
  });
  const ticketId = (result.data as UploadTicketResult | null)?.ticket_id?.trim();
  if (result.error || !ticketId) throw new Error("Storage upload authorization was denied.");
  return ticketId;
}

export async function completeStorageUpload(client: SupabaseClient, ticketId: string) {
  const result = await client.rpc("nxq_complete_storage_upload_ticket", {
    target_ticket_id: ticketId,
  });
  if (result.error) throw new Error("Storage upload reservation could not be completed.");
}

export async function cancelStorageUpload(client: SupabaseClient, ticketId: string | null) {
  if (!ticketId) return;
  await client.rpc("nxq_cancel_storage_upload_ticket", { target_ticket_id: ticketId });
}
