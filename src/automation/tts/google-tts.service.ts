/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import textToSpeech from '@google-cloud/text-to-speech';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class GoogleTtsService {
  private client = new textToSpeech.TextToSpeechClient({
    // Option A: GOOGLE_APPLICATION_CREDENTIALS env points to json file
    // Option B: pass keyFilename here
    keyFilename: process.env.GOOGLE_TTS_KEY_FILE,
  });

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async synthesizeToCloudinaryMp3(text: string, publicId: string): Promise<string> {
    if (!text?.trim()) throw new Error('TTS text is empty');

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

    // Upload as base64 data URI
    const base64 =
      typeof audioContent === 'string'
        ? audioContent
        : Buffer.from(audioContent).toString('base64');

    const folder = process.env.CLOUDINARY_FOLDER || 'automation';
    const upload = await cloudinary.uploader.upload(`data:audio/mp3;base64,${base64}`, {
  resource_type: 'video',   // ✅ better compatibility for audio playback
  folder,
  public_id: `${publicId}-voiceover`,
  overwrite: true,
  format: 'mp3',
});


    if (!upload?.secure_url) throw new Error('Cloudinary upload missing secure_url');
    return upload.secure_url as string;
  }
}
