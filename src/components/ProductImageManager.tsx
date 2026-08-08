import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

type ProductImageManagerProps = {
  productId: string;
};

type ProductImageResult = {
  client_id: string;
  product_id: string;
  image_urls: string[];
};

const bucketName = "commerce-product-images";
const maxImages = 8;
const maxFileSize = 8 * 1024 * 1024;

function getStoragePath(url: string) {
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const markerIndex = url.indexOf(marker);
  return markerIndex >= 0 ? decodeURIComponent(url.slice(markerIndex + marker.length)) : null;
}

export function ProductImageManager({ productId }: ProductImageManagerProps) {
  const [clientId, setClientId] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadImages() {
    if (!supabase) return;
    setError("");
    const result = await supabase.rpc("get_my_commerce_product_images", {
      product_uuid: productId,
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    const data = result.data as ProductImageResult;
    setClientId(data.client_id);
    setImages(Array.isArray(data.image_urls) ? data.image_urls : []);
  }

  useEffect(() => {
    void loadImages();
  }, [productId]);

  async function persist(nextImages: string[]) {
    if (!supabase) return false;
    const result = await supabase.rpc("save_my_commerce_product_images", {
      product_uuid: productId,
      image_urls_payload: nextImages,
    });

    if (result.error) {
      setError(result.error.message);
      return false;
    }

    setImages(nextImages);
    return true;
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!supabase || !fileList || !clientId) return;
    const selectedFiles = Array.from(fileList);

    if (images.length + selectedFiles.length > maxImages) {
      setError(`A product can have up to ${maxImages} images.`);
      return;
    }

    const invalidFile = selectedFiles.find(
      (file) => !file.type.startsWith("image/") || file.size > maxFileSize
    );
    if (invalidFile) {
      setError("Use JPG, PNG, WEBP, or GIF images up to 8 MB each.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    const uploadedUrls: string[] = [];
    const uploadedPaths: string[] = [];

    try {
      for (const file of selectedFiles) {
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const filePath = `${clientId}/${productId}/${crypto.randomUUID()}.${extension}`;
        const upload = await supabase.storage.from(bucketName).upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

        if (upload.error) throw upload.error;
        uploadedPaths.push(filePath);
        const publicUrl = supabase.storage.from(bucketName).getPublicUrl(filePath).data.publicUrl;
        uploadedUrls.push(publicUrl);
      }

      const nextImages = [...images, ...uploadedUrls];
      const saved = await persist(nextImages);
      if (!saved) {
        await supabase.storage.from(bucketName).remove(uploadedPaths);
        return;
      }

      setMessage(`${uploadedUrls.length} image${uploadedUrls.length === 1 ? "" : "s"} uploaded.`);
    } catch (uploadError) {
      if (uploadedPaths.length) await supabase.storage.from(bucketName).remove(uploadedPaths);
      setError(uploadError instanceof Error ? uploadError.message : "Images could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(index: number) {
    if (!supabase) return;
    const imageUrl = images[index];
    const nextImages = images.filter((_, imageIndex) => imageIndex !== index);

    setBusy(true);
    setError("");
    setMessage("");
    const saved = await persist(nextImages);
    if (saved) {
      const storagePath = getStoragePath(imageUrl);
      if (storagePath) await supabase.storage.from(bucketName).remove([storagePath]);
      setMessage("Image removed.");
    }
    setBusy(false);
  }

  async function moveImage(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= images.length) return;
    const nextImages = [...images];
    [nextImages[index], nextImages[destination]] = [nextImages[destination], nextImages[index]];

    setBusy(true);
    setError("");
    setMessage("");
    if (await persist(nextImages)) setMessage("Image order saved.");
    setBusy(false);
  }

  return (
    <section className="settings-card">
      <div className="panel-title panel-title-row">
        <div className="panel-title">
          <ImagePlus size={19} />
          <div>
            <strong>Product photos</strong>
            <p className="subtle">Upload up to 8 images. The first image is the main storefront photo.</p>
          </div>
        </div>
        <label className="icon-btn" aria-disabled={busy || images.length >= maxImages}>
          <ImagePlus size={15} /> {busy ? "Uploading..." : "Upload photos"}
          <input
            hidden
            multiple
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={busy || images.length >= maxImages}
            onChange={(event) => {
              void uploadFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}

      {images.length === 0 ? (
        <div className="empty-state">No photos uploaded yet.</div>
      ) : (
        <div className="settings-grid">
          {images.map((imageUrl, index) => (
            <article className="settings-card" key={imageUrl}>
              <img
                src={imageUrl}
                alt={`Product photo ${index + 1}`}
                style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: "18px" }}
              />
              <strong>{index === 0 ? "Main image" : `Image ${index + 1}`}</strong>
              <div className="panel-actions">
                <button className="icon-btn" type="button" disabled={busy || index === 0} onClick={() => void moveImage(index, -1)}><ArrowUp size={14} /> Move up</button>
                <button className="icon-btn" type="button" disabled={busy || index === images.length - 1} onClick={() => void moveImage(index, 1)}><ArrowDown size={14} /> Move down</button>
                <button className="icon-btn" type="button" disabled={busy} onClick={() => void removeImage(index)}><Trash2 size={14} /> Remove</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
