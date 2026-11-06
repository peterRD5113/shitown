import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface KvNamespaceLike {
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
}

async function loadAudioBytes(id: string): Promise<Uint8Array | null> {
  // 1. Check permanent Cloudflare KV storage first
  try {
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx?.env as Record<string, unknown> | undefined;
    const kv = env?.SHITOWN_KV as KvNamespaceLike | undefined;
    if (kv) {
      const kvAudio = await kv.get(`audio:${id}`, "arrayBuffer");
      if (kvAudio && kvAudio.byteLength > 0) {
        return new Uint8Array(kvAudio);
      }
    }
  } catch {
    // Fallback to memory/local disk below
  }

  // 2. Check in-memory audio store
  const memAudio = globalThis.__SHITOWN_AUDIO__?.[id];
  if (memAudio && memAudio.byteLength > 0) {
    return new Uint8Array(memAudio);
  }

  // 3. Check local disk fallback
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(
      process.cwd(),
      "public",
      "uploads",
      "keepsakes",
      `${id}.wav`
    );
    const buf = await fs.readFile(filePath);
    if (buf && buf.byteLength > 0) {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  } catch {
    // Not found on disk
  }

  return null;
}

function buildAudioResponse(req: NextRequest, bytes: Uint8Array, headOnly = false): NextResponse {
  const total = bytes.byteLength;
  const rangeHeader = req.headers.get("range") || req.headers.get("Range");

  const baseHeaders: Record<string, string> = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
  };

  if (rangeHeader && rangeHeader.startsWith("bytes=")) {
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const rawStart = parseInt(parts[0], 10);
    const start = Number.isNaN(rawStart) ? 0 : Math.max(0, rawStart);
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const end = Number.isNaN(rawEnd)
      ? total - 1
      : Math.min(total - 1, Math.max(start, rawEnd));

    if (start >= total) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${total}`,
        },
      });
    }

    const chunk = bytes.subarray(start, end + 1);
    const chunkBuffer = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength
    ) as ArrayBuffer;

    return new NextResponse(headOnly ? null : chunkBuffer, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunk.byteLength),
      },
    });
  }

  const fullBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;

  return new NextResponse(headOnly ? null : fullBuffer, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(total),
    },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const bytes = await loadAudioBytes(id);
  if (!bytes) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  return buildAudioResponse(req, bytes, false);
}

export async function HEAD(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return new NextResponse(null, { status: 400 });
  }

  const bytes = await loadAudioBytes(id);
  if (!bytes) {
    return new NextResponse(null, { status: 404 });
  }

  return buildAudioResponse(req, bytes, true);
}

