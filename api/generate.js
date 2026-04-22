import { experimental_generateVideo as generateVideo } from 'ai';
import { google } from '@ai-sdk/google';

// Vercel serverless function config — 5 min timeout for Veo generation
export const config = {
  maxDuration: 300,
};

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { prompt, imageUrl, aspectRatio = '16:9', durationSeconds = 8 } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  // Build the prompt object — support optional image-to-video
  const videoPrompt = imageUrl
    ? { text: prompt, image: imageUrl }  // imageUrl can be a URL or base64 data URI
    : prompt;

  try {
    const result = await generateVideo({
      model: google('veo-2-generate-001'),
      prompt: videoPrompt,
      aspectRatio,
      durationSeconds,
      abortSignal: AbortSignal.timeout(290_000), // stay under the 300s Vercel limit
    });

    const video = result.videos?.[0];

    if (!video) {
      return res.status(500).json({ success: false, error: 'No video returned from Veo' });
    }

    return res.status(200).json({
      success: true,
      // Return base64 so n8n can handle it directly without binary streams
      videoBase64: video.base64,
      mimeType: 'video/mp4',
    });

  } catch (error) {
    console.error('Veo generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message ?? 'Unknown error during video generation',
    });
  }
}