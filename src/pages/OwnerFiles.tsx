import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  RefreshCcw,
  Rocket,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientRow = {
  id: string;
  business_name: string;
};

type ClientFileRow = {
  id: string;
  client_id: string;
  bucket_id: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: string;
  uploaded_at: string;
  expires_at: string | null;
};

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function OwnerFiles() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [files, setFiles] = useState<ClientFileRow[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadFiles() {
    setIsLoading(true);
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet.");
      setIsLoading(false);
      return;
    }

    const [clientResult, fileResult] = await Promise.all([
      supabase.from("clients").select("id, business_name").order("business_name"),
      supabase
        .from("client_files")
        .select(
          "id, client_id, bucket_id, storage_path, file_name, file_type, file_size, status, uploaded_at, expires_at"
        )
        .order("uploaded_at", { ascending: false }),
    ]);

    if (clientResult.error || fileResult.error) {
      setErrorMessage(
        clientResult.error?.message || fileResult.error?.message || "Unable to load client files."
      );
      setIsLoading(false);
      return;
    }

    setClients((clientResult.data || []) as ClientRow[]);
    setFiles((fileResult.data || []) as ClientFileRow[]);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadFiles();
  }, []);

  const clientNameById = useMemo(
    () => new Map(clients.map((client) => [client.id, client.business_name])),
    [clients]
  );

  const visibleFiles = files.filter(
    (file) => file.status !== "deleted" && (!selectedClientId || file.client_id === selectedClientId)
  );

  async function createSecureUrl(file: ClientFileRow, download = false) {
    if (!supabase) return null;

    const signedUrlResult = await supabase.storage
      .from(file.bucket_id || "client-files")
      .createSignedUrl(file.storage_path, 60, download ? { download: file.file_name } : undefined);

    if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
      setErrorMessage(signedUrlResult.error?.message || "Unable to create a secure file link.");
      return null;
    }

    return signedUrlResult.data.signedUrl;
  }

  async function openFile(file: ClientFileRow) {
    setOpeningFileId(file.id);
    setErrorMessage("");
    setActionMessage("");

    const signedUrl = await createSecureUrl(file);
    setOpeningFileId(null);

    if (!signedUrl) return;
    window.open(signedUrl, "_blank", "noopener,noreferrer");
  }

  async function downloadFile(file: ClientFileRow) {
    setDownloadingFileId(file.id);
    setErrorMessage("");
    setActionMessage("");

    const signedUrl = await createSecureUrl(file, true);
    setDownloadingFileId(null);

    if (!signedUrl) return;

    const downloadLink = document.createElement("a");
    downloadLink.href = signedUrl;
    downloadLink.download = file.file_name;
    downloadLink.rel = "noopener noreferrer";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    setActionMessage(`Secure download started for ${file.file_name}.`);
  }

  async function deleteFile(file: ClientFileRow) {
    if (!supabase) return;

    const clientName = clientNameById.get(file.client_id) || "this client";
    const confirmed = window.confirm(
      `Permanently delete “${file.file_name}” from ${clientName}?\n\nThis removes the private Storage object and its file record. This cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingFileId(file.id);
    setErrorMessage("");
    setActionMessage("");

    const bucketId = file.bucket_id || "client-files";
    const storageResult = await supabase.storage.from(bucketId).remove([file.storage_path]);

    if (storageResult.error) {
      setDeletingFileId(null);
      setErrorMessage(`File was not deleted: ${storageResult.error.message}`);
      return;
    }

    const metadataResult = await supabase.rpc("owner_finalize_client_file_delete", {
      target_file_id: file.id,
    });

    if (metadataResult.error) {
      setDeletingFileId(null);
      setErrorMessage(
        `The private file was removed, but its record still needs cleanup: ${metadataResult.error.message}. Press Delete again to retry safely.`
      );
      return;
    }

    setFiles((current) => current.filter((item) => item.id !== file.id));
    setDeletingFileId(null);
    setActionMessage(`${file.file_name} was permanently deleted.`);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <FileText size={22} />
            <div>
              <h1>Client files</h1>
              <p className="subtle">Secure owner access to files uploaded through the Client Portal.</p>
            </div>
          </div>

          <div className="client-control-row">
            <a className="icon-btn" href="/owner">
              <ArrowLeft size={16} />
              Owner portal
            </a>
            <a className="icon-btn" href="/owner/deployments">
              <Rocket size={16} />
              Deployments
            </a>
            <a className="icon-btn" href="/owner/preview-requests">
              <ShieldCheck size={16} />
              Preview requests
            </a>
            <button className="icon-btn" onClick={() => void loadFiles()} type="button">
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
        </div>

        {errorMessage ? <div className="auth-error" role="alert">{errorMessage}</div> : null}
        {actionMessage ? <div className="auth-success">{actionMessage}</div> : null}

        <section className="panel">
          <div className="message-filter-row">
            <select
              className="message-filter-select"
              value={selectedClientId}
              onChange={(event) => {
                setSelectedClientId(event.target.value);
                setErrorMessage("");
                setActionMessage("");
              }}
            >
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.business_name}
                </option>
              ))}
            </select>
          </div>

          {isLoading ? <div className="empty-state">Loading client files...</div> : null}

          {!isLoading && visibleFiles.length === 0 ? (
            <div className="empty-state">No uploaded client files found.</div>
          ) : null}

          <div className="owner-message-list">
            {visibleFiles.map((file) => {
              const isBusy =
                openingFileId === file.id ||
                downloadingFileId === file.id ||
                deletingFileId === file.id;

              return (
                <article className="owner-message-card" key={file.id}>
                  <div className="owner-message-top">
                    <strong>{file.file_name}</strong>
                    <span>{formatDateTime(file.uploaded_at)}</span>
                  </div>

                  <p>{clientNameById.get(file.client_id) || "Unknown client"}</p>
                  <small>
                    {file.file_type || "Unknown file type"} · {formatFileSize(file.file_size)} · {file.status}
                  </small>

                  <div className="client-control-row" style={{ marginTop: "0.85rem" }}>
                    <button
                      className="icon-btn"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void openFile(file)}
                    >
                      <ExternalLink size={16} />
                      {openingFileId === file.id ? "Opening..." : "Open"}
                    </button>

                    <button
                      className="icon-btn"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void downloadFile(file)}
                    >
                      <Download size={16} />
                      {downloadingFileId === file.id ? "Preparing..." : "Download"}
                    </button>

                    <button
                      className="icon-btn danger-btn"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void deleteFile(file)}
                    >
                      <Trash2 size={16} />
                      {deletingFileId === file.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
