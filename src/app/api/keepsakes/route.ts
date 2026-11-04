import { NextRequest, NextResponse } from "next/server";

export interface KeepsakeRecord {
  id: string;
  recipientTitle: string;
  senderName: string;
  transcript: string;
  moodLabel: string;
  presetId: string;
  presetTitle: string;
  durationSeconds: number;
  createdAt: string;
  audioUrl: string | null;
}

const DEFAULT_SAMPLE_RECORD: KeepsakeRecord = {
  id: "shitown-001",
  recipientTitle: "港町留聲・私人聲音明信片",
  senderName: "蒔町・拾光事務所",
  transcript: "讓值得記住的聲音，成為可以收藏的記憶。",
  moodLabel: "老屋午後暖陽與木吉他",
  presetId: "warm-guitar-piano",
  presetTitle: "老屋午後暖陽與木吉他",
  durationSeconds: 14,
  createdAt: "2026.11.04",
  audioUrl: null,
};

declare global {
  // eslint-disable-next-line no-var
  var __SHITOWN_RECORDS__: Record<string, KeepsakeRecord> | undefined;
  // eslint-disable-next-line no-var
  var __SHITOWN_AUDIO__: Record<string, ArrayBuffer> | undefined;
}

function getMemoryRecords(): Record<string, KeepsakeRecord> {
  if (!globalThis.__SHITOWN_RECORDS__) {
    globalThis.__SHITOWN_RECORDS__ = {
      "shitown-001": DEFAULT_SAMPLE_RECORD,
      "kissa-042": { ...DEFAULT_SAMPLE_RECORD, id: "kissa-042" },
    };
  }
  return globalThis.__SHITOWN_RECORDS__;
}

function getMemoryAudio(): Record<string, ArrayBuffer> {
  if (!globalThis.__SHITOWN_AUDIO__) {
    globalThis.__SHITOWN_AUDIO__ = {};
  }
  return globalThis.__SHITOWN_AUDIO__;
}

async function readLocalDiskIndex(): Promise<Record<string, KeepsakeRecord>> {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const indexFile = path.join(process.cwd(), "data", "keepsakes.json");
    const raw = await fs.readFile(indexFile, "utf-8");
    const parsed = JSON.parse(raw);
    return { "kissa-042": DEFAULT_SAMPLE_RECORD, ...parsed };
  } catch {
    return getMemoryRecords();
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  const diskIndex = await readLocalDiskIndex();
  const memIndex = getMemoryRecords();
  const merged = { ...diskIndex, ...memIndex };

  if (id) {
    const item = merged[id];
    if (!item) {
      return NextResponse.json(
        { error: "找不到這張聲音明信片，可能尚未生成或連結有誤。" },
        { status: 404 }
      );
    }
    return NextResponse.json(item);
  }

  return NextResponse.json(Object.values(merged));
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    const recipientTitle =
      (formData.get("recipientTitle") as string | null)?.trim() ||
      "港町留聲・私人聲音明信片";
    const senderName =
      (formData.get("senderName") as string | null)?.trim() ||
      "蒔町・拾光事務所";
    const transcript =
      (formData.get("transcript") as string | null)?.trim() ||
      "讓值得記住的聲音，成為可以收藏的記憶。";
    const moodLabel =
      (formData.get("moodLabel") as string | null)?.trim() ||
      "老屋午後暖陽與木吉他";
    const presetId =
      (formData.get("presetId") as string | null)?.trim() ||
      "warm-guitar-piano";
    const presetTitle =
      (formData.get("presetTitle") as string | null)?.trim() ||
      "老屋午後暖陽與木吉他";
    const durationSeconds = Number(formData.get("durationSeconds") || 14);

    const shortCode = Math.random().toString(36).substring(2, 7);
    const id = `shitown-${shortCode}`;
    let audioUrl: string | null = null;

    if (audioFile) {
      const arrayBuffer = await audioFile.arrayBuffer();
      getMemoryAudio()[id] = arrayBuffer;
      audioUrl = `/api/keepsakes/audio?id=${encodeURIComponent(id)}`;

      // Also persist to local disk when running in Node.js dev/server
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const uploadDir = path.join(
          process.cwd(),
          "public",
          "uploads",
          "keepsakes"
        );
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(
          path.join(uploadDir, `${id}.wav`),
          Buffer.from(arrayBuffer)
        );
      } catch {
        // Running in edge/serverless environment without writable local disk
      }
    }

    const now = new Date();
    const createdAt = `${now.getFullYear()}.${String(
      now.getMonth() + 1
    ).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;

    const record: KeepsakeRecord = {
      id,
      recipientTitle,
      senderName,
      transcript,
      moodLabel,
      presetId,
      presetTitle,
      durationSeconds: Math.round(durationSeconds),
      createdAt,
      audioUrl,
    };

    getMemoryRecords()[id] = record;

    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const dataDir = path.join(process.cwd(), "data");
      const indexFile = path.join(dataDir, "keepsakes.json");
      await fs.mkdir(dataDir, { recursive: true });
      const current = await readLocalDiskIndex();
      current[id] = record;
      await fs.writeFile(indexFile, JSON.stringify(current, null, 2), "utf-8");
    } catch {
      // Ignore on serverless/edge
    }

    return NextResponse.json(record);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "封存聲音明信片時發生錯誤",
      },
      { status: 500 }
    );
  }
}
