import { Injectable } from '@nestjs/common';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class GoogleTtsService {
  private client?: TextToSpeechClient;
  private readonly ttsMode = (process.env.TTS_MODE || 'live').toLowerCase(); // live | mock

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    if (this.ttsMode !== 'mock') {
      this.client = new TextToSpeechClient({
        keyFilename: process.env.GOOGLE_TTS_KEY_FILE,
      });
    }
  }

  async synthesizeToCloudinaryMp3(text: string, publicId: string): Promise<string> {
    if (!text?.trim()) throw new Error('TTS text is empty');

    if (this.ttsMode === 'mock' || !this.client) {
      const fallback = process.env.MOCK_VOICEOVER_URL;
      if (!fallback) throw new Error('TTS_MODE=mock but MOCK_VOICEOVER_URL is missing.');
      return fallback;
    }

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: process.env.GOOGLE_TTS_LANG || 'en-US',
        name: process.env.GOOGLE_TTS_VOICE || 'en-US-Studio-O',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Number(process.env.GOOGLE_TTS_RATE || 1.0),
        pitch: Number(process.env.GOOGLE_TTS_PITCH || 0),
      },
    });

    const audioContent = response.audioContent as Buffer | string | undefined;
    if (!audioContent) throw new Error('Google TTS returned empty audio');

    const base64 =
      typeof audioContent === 'string'
        ? audioContent
        : Buffer.from(audioContent).toString('base64');

    const folder = process.env.CLOUDINARY_FOLDER || 'automation';
    const upload = await cloudinary.uploader.upload(`data:audio/mp3;base64,${base64}`, {
      resource_type: 'video',
      folder,
      public_id: `${publicId}-voiceover`,
      overwrite: true,
      format: 'mp3',
    });

    if (!upload?.secure_url) throw new Error('Cloudinary upload missing secure_url');
    return upload.secure_url as string;
  }
}
