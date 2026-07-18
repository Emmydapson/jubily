/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { shotstackHeaders, shotstackRenderAssetUrl } from './shotstack.config';

@Injectable()
export class ShotstackServeService {
  /**
   * Returns { url, status } for the render asset.
   * status is typically "ready" when the CDN URL is usable.
   */
  async getRenderAsset(
    renderId: string,
  ): Promise<{ url: string | null; status: string }> {
    if (!renderId) throw new Error('Missing renderId');

    const res = await axios.get(shotstackRenderAssetUrl(renderId), {
      headers: shotstackHeaders(),
      timeout: 20000,
      maxRedirects: 5,
      // allow 404 so we can treat it as "not ready / missing"
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
    if (String(status).toLowerCase() !== 'ready') {
      throw new Error(`Serve asset not ready (status=${status})`);
    }

    return url;
  }
}
