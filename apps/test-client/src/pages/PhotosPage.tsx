import { useCallback, useEffect, useState } from "react";
import type { Photo, PhotoListResponse } from "@job/shared";
import { api, errorText } from "../api";

export function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await api<PhotoListResponse>("GET", "/api/photos");
    if (result.ok) setPhotos(result.data.results);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function after(result: Awaited<ReturnType<typeof api>>) {
    setMessage(errorText(result));
    load();
  }

  // The body is the image itself (see POST /api/photos).
  async function upload(file: File) {
    const response = await fetch(`/api/photos?name=${encodeURIComponent(file.name.replace(/\.\w+$/, ""))}`, { method: "POST", body: file });
    const json = await response.json();
    setMessage(response.ok ? "" : `${response.status} ${json.error?.code}: ${json.error?.message}`);
    load();
  }

  return (
    <div>
      <p>
        Upload JPEG/PNG/WEBP: <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />{" "}
        <button onClick={async () => after(await api("DELETE", "/api/photos/selection"))}>No photo</button>
      </p>
      {message && <p className="error">{message}</p>}
      <table>
        <tbody>
          {photos.map((photo) => (
            <tr key={photo.id}>
              <td><img src={`/api/photos/${photo.id}/file`} alt="" style={{ width: 80, height: 80, objectFit: "cover" }} /></td>
              <td>
                {photo.name} {photo.isSelected && <strong>(selected)</strong>}
                <div className="muted">{Math.round(photo.sizeBytes / 1024)} KB · {new Date(photo.createdAt).toLocaleString()}</div>
              </td>
              <td>
                {!photo.isSelected && <button onClick={async () => after(await api("POST", `/api/photos/${photo.id}/select`))}>Select</button>}{" "}
                <button
                  onClick={async () => {
                    const name = prompt("New name", photo.name);
                    if (name) after(await api("PATCH", `/api/photos/${photo.id}`, { name }));
                  }}
                >
                  Rename
                </button>{" "}
                <button onClick={async () => confirm("Delete this photo?") && after(await api("DELETE", `/api/photos/${photo.id}`))}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
