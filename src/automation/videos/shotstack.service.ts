/* eslint-disable prettier/prettier */
import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { Scene } from './interfaces/scene.interface';

@Injectable()
export class ShotstackService {
  private baseUrl = 'https://api.shotstack.io/stage';

  async renderVideo(scenes: Scene[]): Promise<string> {
  let currentTime = 0;

  const clips = scenes.map(scene => {
    const clip = {
      asset: {
        type: 'html',
        html: `
          <div style="
            background:black;
            color:white;
            width:100%;
            height:100%;
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:48px;
            font-family:Arial;
            text-align:center;">
            ${scene.text}
          </div>
        `,
      },
      start: currentTime,
      length: scene.duration,
    };

    currentTime += scene.duration;
    return clip;
  });

  const payload = {
    timeline: {
      soundtrack: {
        src: 'https://s3-ap-southeast-2.amazonaws.com/shotstack-assets/music/freepd/drive.mp3',
        effect: 'fadeInFadeOut',
      },
      tracks: [
        {
          clips,
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
