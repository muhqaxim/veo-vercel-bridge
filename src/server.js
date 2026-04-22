import express from 'express';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Init ────────────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve imageUrl (https link, data URI, or raw base64) → { imageBytes, mimeType }
 */
async function resolveImage(imageUrl) {
  if (!imageUrl) return null;

  // Remote URL — download and convert to base64
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { imageBytes: buffer.toString('base64'), mimeType };
  }

  // Data URI  →  data:image/png;base64,AAAA...
  if (imageUrl.startsWith('data:')) {
    const [header, imageBytes] = imageUrl.split(',');
    const mimeType = header.match(/data:([^;]+);/)?.[1] ?? 'image/png';
    return { imageBytes, mimeType };
  }

  // Raw base64 string
  return { imageBytes: imageUrl, mimeType: 'image/png' };
}

/**
 * Poll the operation until Veo finishes generating the video.
 */
async function pollUntilDone(operation, pollIntervalMs = 10_000) {
  while (!operation.done) {
    console.log('  ⏳ Still generating… checking again in 10s');
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    operation = await ai.operations.getVideosOperation({ operation });
  }
  return operation;
}

// ─── Route ───────────────────────────────────────────────────────────────────

app.post('/generate', async (req, res) => {
  const {
    prompt,
    imageUrl,                  // optional — triggers image-to-video mode
    aspectRatio = '16:9',      // '16:9' | '9:16'
  } = req.body;

  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Missing required field: prompt' });
  }

  console.log(`\n🎬 [/generate] prompt="${prompt.slice(0, 80)}…"  aspectRatio=${aspectRatio}`);

  // Build the generateVideos config (mirrors the reference template)
  const videoConfig = {
    model: 'veo-3.1-generate-preview',
    prompt,
    config: {
      aspectRatio,
    },
  };

  // Attach image when provided (image-to-video mode)
  if (imageUrl) {
    try {
      const resolved = await resolveImage(imageUrl);
      videoConfig.image = resolved;
      console.log(`🖼️  Image attached (${resolved.mimeType})`);
    } catch (err) {
      return res.status(400).json({ success: false, error: `Could not load image: ${err.message}` });
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  let tmpFile;

  try {
    // 1. Start the long-running operation
    let operation = await ai.models.generateVideos(videoConfig);
    console.log('🚀 Operation started:', operation.name);

    // 2. Poll until done
    operation = await pollUntilDone(operation);
    console.log('✅ Generation complete');

    // 3. Download the generated video to a temp file
    const generatedVideo = operation.response?.generatedVideos?.[0]?.video;
    if (!generatedVideo) {
      throw new Error('No generated video in the operation response');
    }

    tmpFile = path.join(os.tmpdir(), `veo-${Date.now()}.mp4`);
    await ai.files.download({ file: generatedVideo, downloadPath: tmpFile });
    console.log(`💾 Video saved to temp: ${tmpFile}`);

    // 4. Read back as base64 and clean up
    const videoBase64 = fs.readFileSync(tmpFile).toString('base64');
    fs.unlinkSync(tmpFile);

    // 5. Respond — n8n can decode the base64 directly
    return res.status(200).json({
      success: true,
      videoBase64,
      mimeType: 'video/mp4',
    });

  } catch (err) {
    console.error('❌ Video generation failed:', err);
    // Clean up temp file if something went wrong after download
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    return res.status(500).json({ success: false, error: err.message ?? 'Unknown error' });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'veo-bridge' }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 veo-bridge running on http://localhost:${PORT}`);
  console.log(`   POST http://localhost:${PORT}/generate`);
});
