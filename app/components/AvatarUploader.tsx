"use client";

import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function AvatarUploader({
  userId,
  currentAvatarUrl,
  onUploaded,
  onMessage,
}: {
  userId: string;
  currentAvatarUrl: string | null;
  onUploaded: (newUrl: string) => void;
  onMessage: (msg: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const preview = useMemo(() => currentAvatarUrl, [currentAvatarUrl]);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      onMessage("Please upload an image file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      onMessage("Image too large (max 4MB).");
      return;
    }

    setUploading(true);
    onMessage("");

    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${userId}/avatar.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" });

      if (upErr) throw upErr;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = data.publicUrl;

      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);

      if (dbErr) throw dbErr;

      onUploaded(publicUrl);
      onMessage("Avatar updated!");
    } catch (err: any) {
      onMessage(err?.message ?? "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
        {preview ? (
          <img src={preview} alt="avatar" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-600">
            ?
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input
          type="file"
          accept="image/*"
          onChange={onFileChange}
          disabled={uploading}
          className="text-sm"
        />
        <div className="text-xs text-slate-500">
          {uploading ? "Uploading…" : "PNG/JPG up to 4MB"}
        </div>
      </div>
    </div>
  );
}
