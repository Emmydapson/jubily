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
  async getRenderAsset(renderId: string): Promise<{ url: string; status: string }> {
    if (!renderId) throw new Error('Missing renderId');

    const res = await axios.get(`${this.baseUrl}/assets/render/${renderId}`, {
      headers: {
        'x-api-key': this.apiKey(),
        'Content-Type': 'application/json',
      },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const items = res.data?.data || [];
    const first = items[0];
    const url = first?.attributes?.url;
    const status = String(first?.attributes?.status || 'unknown');

    if (!url) {
      throw new Error(`Serve API returned no url for renderId=${renderId}`);
    }

    return { url, status };
  }

  /**
   * Convenience: only returns URL when Serve status is ready.
   * If not ready, throws an error you can treat as "keep waiting".
   */
  async getReadyUrl(renderId: string): Promise<string> {
    const { url, status } = await this.getRenderAsset(renderId);
    if (status.toLowerCase() !== 'ready') {
      throw new Error(`Serve asset not ready (status=${status})`);
    }
    return url;
  }
}
