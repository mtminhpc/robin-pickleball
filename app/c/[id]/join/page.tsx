"use client";

/**
 * Vào câu lạc bộ — đích của mã QR.
 *
 * `id` ở đây là **mã mời**, không phải mã câu lạc bộ. Đó là chủ ý: mã mời đọc to
 * cho nhau được và đổi được khi cần khoá cửa lại, còn mã câu lạc bộ thì dài và
 * theo suốt đời.
 *
 * Người quay lại bằng máy cũ được nhận ra ngay và cho vào thẳng, không phải gõ
 * lại tên — đúng mục 13 trong yêu cầu.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { loadProfile, saveProfile } from "@/lib/identity/device";
import { useClub } from "@/hooks/useClub";
import { AvatarPicker } from "@/components/AvatarPicker";
import { Button, Card, Empty, Field, inputClass } from "@/components/ui";

export default function ClubJoinPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useClub(id);

  const [name, setName] = useState("");
  const [avatarId, setAvatarId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Máy này đã dùng lần trước thì tự điền lại.
  useEffect(() => {
    const profile = loadProfile();
    if (profile) {
      setName(profile.name);
      setAvatarId(profile.avatarId);
    }
  }, []);

  // Đã là thành viên rồi thì không việc gì phải hỏi lại, vào thẳng.
  useEffect(() => {
    if (data?.me) router.replace(`/c/${data.club.id}`);
  }, [data, router]);

  if (isLoading) return <Empty>Đang tải…</Empty>;
  if (error) return <Empty>{error.message}</Empty>;
  if (!data || data.me) return null;

  async function submit() {
    if (!data) return;
    setPending(true);
    setFailed(null);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(data.club.id)}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name, avatarId }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không vào được câu lạc bộ.");
      saveProfile({ name: name.trim(), avatarId: avatarId ?? "" });
      router.push(`/c/${data.club.id}`);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Không vào được câu lạc bộ.");
      setPending(false);
    }
  }

  const taken = data.members.some(
    (m) => m.displayName.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 px-4 py-8">
      <header className="space-y-1">
        <p className="text-sm text-mute-700">Vào câu lạc bộ</p>
        <h1 className="text-2xl font-bold">{data.club.name}</h1>
        <p className="text-sm text-mute-600">{data.members.length} người đã có tên</p>
      </header>

      <Field label="Tên của bạn" hint="Tên mọi người ở sân gọi bạn.">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Nguyễn Văn Nam"
        />
      </Field>

      {taken && name.trim() !== "" && (
        <Card className="border-accent-300 bg-accent-100 p-3 text-sm text-accent-800">
          Câu lạc bộ đã có người tên này. Vẫn vào được, nhưng thêm họ hoặc biệt danh
          sẽ đỡ nhầm lúc nhập điểm giữa sân.
        </Card>
      )}

      <AvatarPicker name={name} value={avatarId} onChange={setAvatarId} />

      {failed && (
        <p className="rounded-xl bg-accent-100 p-3 text-sm text-paper">{failed}</p>
      )}

      <Button
        tone="primary"
        full
        disabled={pending || name.trim().length < 1}
        onClick={submit}
      >
        {pending ? "Đang vào…" : "Vào câu lạc bộ"}
      </Button>
    </main>
  );
}
