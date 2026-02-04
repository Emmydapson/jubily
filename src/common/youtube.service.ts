/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

@Injectable()
export class YoutubeService {
  private oauth;

  constructor() {
    this.oauth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT
    );

    // 1) Print runtime locations (so we stop guessing)
    const cwd = process.cwd();
    const dir = __dirname;

    console.log("[YouTube] CWD:", cwd);
    console.log("[YouTube] __dirname:", dir);

    // 2) Candidate locations (covers dev + prod)
    const candidates = [
      path.resolve(cwd, "credentials", "youtube-token.json"),
      path.resolve(dir, "..", "..", "credentials", "youtube-token.json"),
      path.resolve(dir, "..", "credentials", "youtube-token.json"),
    ];

    console.log("[YouTube] Token candidates:\n" + candidates.join("\n"));

    const tokenPath = candidates.find((p) => fs.existsSync(p));

    // 3) If not found, list what IS inside the credentials folder(s)
    if (!tokenPath) {
      const credsDirs = [
        path.resolve(cwd, "credentials"),
        path.resolve(dir, "..", "..", "credentials"),
      ];

      const listings = credsDirs.map((d) => {
        try {
          const exists = fs.existsSync(d);
          const files = exists ? fs.readdirSync(d) : [];
          return `- ${d} (exists=${exists}) files=[${files.join(", ")}]`;
        } catch (e: any) {
          return `- ${d} (error=${e?.message || e})`;
        }
      });

      throw new Error(
        `Missing YouTube token file. Tried:\n${candidates.join("\n")}\n\nCredentials dir listings:\n${listings.join(
          "\n"
        )}`
      );
    }

    console.log("[YouTube] ✅ Using token file:", tokenPath);

    const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    this.oauth.setCredentials(tokens);

    // auto-save refreshed tokens
    this.oauth.on("tokens", (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2));
    });
  }

  async upload(title: string, description: string, videoUrl: string) {
    if (!videoUrl) throw new Error('Missing videoUrl for upload');

    const youtube = google.youtube({ version: 'v3', auth: this.oauth });

    // Download the mp4 file as a stream
    console.log("VIDEO URL:", videoUrl);

let videoStreamRes;
try {
  videoStreamRes = await axios.get(videoUrl, {
    responseType: "stream",
    maxRedirects: 5,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*",
    },
  });
} catch (e: any) {
  console.log("DOWNLOAD FAILED STATUS:", e?.response?.status);
  console.log("DOWNLOAD FAILED HEADERS:", e?.response?.headers);
  console.log("DOWNLOAD FAILED DATA:", e?.response?.data);
  throw new Error(`Download failed (${e?.response?.status}) for ${videoUrl}`);
}

    // Optional: ensure it’s a video (helpful for debugging)
    const contentType = String(videoStreamRes.headers['content-type'] || '');
    if (!contentType.includes('video') && !contentType.includes('octet-stream')) {
      // Shotstack S3 usually returns video/mp4 — if not, still try upload
      // but log it so you can see weird cases
      // throw new Error(`Expected video stream. Got content-type: ${contentType}`);
    }

    const safeTitle = (title || 'Untitled').slice(0, 95);
    const safeDesc = (description || '').slice(0, 4500);

    console.log(">>> ABOUT TO UPLOAD TO YOUTUBE", { title: safeTitle, hasUrl: !!videoUrl });
    try {
      console.log(">>> CALLING youtube.videos.insert()");
      const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: safeTitle,
          description: safeDesc,
          // optional
          categoryId: '22', // People & Blogs
        },
        status: {
          privacyStatus: process.env.YOUTUBE_PRIVACY || 'unlisted', // set to public when ready
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: videoStreamRes.data, // ✅ STREAM, not URL string
      },
    });
    console.log(">>> UPLOAD OK", res.data.id);

    return res.data.id;
} catch (e: any) {
  console.log(">>> UPLOAD FAILED (CATCH HIT)");
  console.log("YOUTUBE ERROR STATUS:", e?.code);
  console.log("YOUTUBE ERROR DATA:", JSON.stringify(e?.response?.data, null, 2));
  console.log("YOUTUBE ERROR MESSAGE:", e?.message);
  throw e;
}

  }
}
