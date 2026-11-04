import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface KvNamespaceLike {
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // 1. Check permanent Cloudflare KV storage first
  try {
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx?.env as Record<string, unknown> | undefined;
    const kv = env?.SHITOWN_KV as KvNamespaceLike | undefined;
    if (kv) {
      const kvAudio = await kv.get(`audio:${id}`, "arrayBuffer");
      if (kvAudio) {
        return new NextResponse(kvAudio, {
          status: 200,
          headers: {
            "Content-Type": "audio/wav",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }
  } catch {
    // Fallback to memory/local disk below
  }

  // 2. Check in-memory audio store
  const memAudio = globalThis.__SHITOWN_AUDIO__?.[id];
  if (memAudio) {
    return new NextResponse(memAudio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
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
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }
}
