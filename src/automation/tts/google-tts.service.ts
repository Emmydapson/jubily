/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { v2 as cloudinary } from 'cloudinary';

type Timepoint = { markName?: string; timeSeconds?: number };

@Injectable()
export class GoogleTtsService {
  private client?: TextToSpeechClient;
  private readonly ttsMode = (process.env.TTS_MODE || 'live').toLowerCase();

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

  private toSsmlWithMarks(lines: string[]) {
    const body = lines
      .map((t, i) => {
        const safe = String(t || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<mark name="s${i + 1}"/>${safe}<break time="250ms"/>`;
      })
      .join('\n');

    return `<speak>${body}<mark name="end"/></speak>`;
  }

  async synthesizeWithMarksToCloudinaryMp3(narrations: string[], publicId: string) {
    if (!narrations?.length) throw new Error('No narrations provided');

    if (this.ttsMode === 'mock' || !this.client) {
      const fallback = process.env.MOCK_VOICEOVER_URL;
      if (!fallback) throw new Error('TTS_MODE=mock but MOCK_VOICEOVER_URL is missing.');
      return { url: fallback, timepoints: [] as Timepoint[] };
    }

    const ssml = this.toSsmlWithMarks(narrations);

    // ✅ IMPORTANT: no tuple destructuring
    const request: any = {
  input: { ssml },
  voice: {
    languageCode: process.env.GOOGLE_TTS_LANG || 'en-US',
    name: process.env.GOOGLE_TTS_VOICE || 'en-US-Studio-O',
  },
  audioConfig: {
    audioEncoding: 'MP3',
    speakingRate: Number(process.env.GOOGLE_TTS_RATE || 1.0),
    pitch: Number(process.env.GOOGLE_TTS_PITCH || 0),
  },
  enableTimePointing: ['SSML_MARK'],
};

const resp: any = await this.client.synthesizeSpeech(request);
const response = Array.isArray(resp) ? resp[0] : resp;

    const audioContent = response?.audioContent as Buffer | string | undefined;
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

    const timepoints: Timepoint[] = (response?.timepoints || []).map((tp: any) => ({
      markName: tp?.markName,
      timeSeconds: Number(tp?.timeSeconds || 0),
    }));

    return { url: upload.secure_url as string, timepoints };
  }
}