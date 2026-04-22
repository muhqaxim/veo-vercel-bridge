import { experimental_generateVideo as generateVideo } from 'ai';
import { google } from '@ai-sdk/google';

export const config = {
  maxDuration: 300, // Important: Veo takes time; this gives you 5 mins.
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, imageBase64 } = req.body;

  try {
    const result = await generateVideo({
      model: google('veo-3.1-generate-001'),
      prompt: {
        text: prompt,
        image: imageBase64, // Pass the base64 string directly here
      },
      // Optional settings for Veo 3
      // @ts-ignore
      aspectRatio: '16:9',
      duration: 8,
    });

    return res.status(200).json({
      success: true,
      videoUrl: result.videos[0], // Or result.video depending on SDK version
    });
  } catch (error) {
    console.error('Veo Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}