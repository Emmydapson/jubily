/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ShotstackServeService {
  // ✅ Serve API (stage). This returns CDN-hosted assets (NOT the private S3 stage-output url)
  private baseUrl = 'https://api.shotstack.io/serve/stage';

  private apiKey() {
    const k = process.env.SHOTSTACK_API_KEY;
    if (!k) throw new Error('Missing SHOTSTACK_API_KEY');
    return k;
  }

  /**
   * Returns { url, status } for the render asset.
   * status is typically "ready" when the CDN URL is usable.
   */
  async getRenderAsset(renderId: string): Promise<{ url: string | null; status: string }> {
  if (!renderId) throw new Error('Missing renderId');

  // ✅ MOCK: immediately return a playable URL
  if (renderId.startsWith('mock-')) {
    const url = process.env.MOCK_VIDEO_URL || null;
    if (!url) return { url: null, status: 'missing' };
    return { url, status: 'ready' };
  }

  const res = await axios.get(`${this.baseUrl}/assets/render/${renderId}`, {
    headers: {
      'x-api-key': this.apiKey(),
      'Content-Type': 'application/json',
    },
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
  });

  if (res.status === 404) return { url: null, status: 'missing' };

  const items = res.data?.data || [];
  const first = items[0];
  const url = first?.attributes?.url || null;
  const status = String(first?.attributes?.status || 'unknown');

  return { url, status };
}


async getReadyUrl(renderId: string): Promise<string> {
  const { url, status } = await this.getRenderAsset(renderId);

  if (!url) throw new Error(`Serve asset missing (status=${status})`);
  if (status.toLowerCase() !== 'ready') throw new Error(`Serve asset not ready (status=${status})`);

  return url;
}

}
