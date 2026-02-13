/* eslint-disable prettier/prettier */
import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';
import { GoogleTtsService } from '../tts/google-tts.service';

@Injectable()
export class ShotstackService {
  private baseUrl = 'https://api.shotstack.io/stage';

  constructor(private readonly tts: GoogleTtsService) {}

  private unsplashImage(visualPrompt: string) {
    const q = encodeURIComponent((visualPrompt || 'healthy lifestyle').slice(0, 120));
    // 1080x1920 vertical
    return `https://source.unsplash.com/1080x1920/?${q}`;
  }

  async renderVideo(scenes: Scene[]): Promise<string> {
    let currentTime = 0;

    // 1) generate ONE voiceover mp3 for the whole script
    const fullNarration = scenes.map(s => s.narration).join(' ');
    const voiceoverUrl = await this.tts.synthesizeToCloudinaryMp3(fullNarration, `job-${Date.now()}`);

    // 2) build tracks
    const bgClips: any[] = [];
    const captionClips: any[] = [];

    for (const scene of scenes) {
      const start = currentTime;
      const length = scene.duration;
      currentTime += length;

      bgClips.push({
        asset: {
          type: 'image',
          src: this.unsplashImage(scene.visualPrompt),
        },
        start,
        length,
        // optional Ken Burns-like zoom
        effect: 'zoomIn',
      });

      captionClips.push({
        asset: {
          type: 'html',
          html: `
            <div style="
              width:100%; height:100%;
              display:flex; align-items:flex-end; justify-content:center;
              padding:90px;
              font-family:Arial; font-size:56px; font-weight:800;
              color:white; text-shadow: 0 2px 14px rgba(0,0,0,.9);
              text-align:center;">
              <div style="background: rgba(0,0,0,.45); padding:24px 30px; border-radius:18px;">
                ${scene.caption}
              </div>
            </div>
          `,
        },
        start,
        length,
      });
    }

    const payload: any = {
      timeline: {
        soundtrack: {
          src: 'https://s3-ap-southeast-2.amazonaws.com/shotstack-assets/music/freepd/drive.mp3',
          effect: 'fadeInFadeOut',
          volume: 0.12, // keep under voice
        },
        tracks: [
          { clips: bgClips },
          { clips: captionClips },
          {
            clips: [
              {
                asset: { type: 'audio', src: voiceoverUrl },
                start: 0,
                length: Math.max(1, Math.ceil(currentTime)),
              },
            ],
          },
        ],
      },
      output: {
        format: 'mp4',
        resolution: 'hd',
      },
    };

    const res = await axios.post(`${this.baseUrl}/render`, payload, {
      headers: {
        'x-api-key': process.env.SHOTSTACK_API_KEY,
        'x-shotstack-stage': 'true',
        'Content-Type': 'application/json',
      },
    });

    const renderId = res.data?.response?.id;
    if (!renderId) throw new Error('Shotstack did not return render id');
    return renderId;
  }
}
