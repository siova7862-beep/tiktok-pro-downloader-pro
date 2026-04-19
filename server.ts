import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import AdmZip from "adm-zip";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- TIKTOK SCRAPER ENDPOINT ---
  app.get("/api/tiktok", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      console.log(`[*] Analisando link: ${url}`);
      
      // Mirroring start_download session headers
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        },
        maxRedirects: 10,
        validateStatus: () => true,
      });

      // Capture cookies to mimic session
      const cookies = response.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ') || "";

      const html = response.data;
      const $ = cheerio.load(html);
      
      // Mirroring re.search patterns EXACTLY
      let scriptData = "";
      const dataPattern = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/;
      const sigiPattern = /<script id="SIGI_STATE" type="application\/json">(.*?)<\/script>/;
      
      const match = html.match(dataPattern) || html.match(sigiPattern);
      if (match) {
        scriptData = match[1];
      } else {
        scriptData = $("#__UNIVERSAL_DATA_FOR_REHYDRATION__").text() || $("#SIGI_STATE").text();
      }

      if (!scriptData) {
        return res.status(404).json({ error: "[-] Erro: JSON não encontrado." });
      }

      const fullData = JSON.parse(scriptData);
      
      // Mirroring item_data extraction logic exactly
      let itemData: any = null;
      try {
        // Caminho Mobile/Reflow
        itemData = fullData?.__DEFAULT_SCOPE__?.["webapp.reflow.video.detail"]?.itemInfo?.itemStruct;
        if (!itemData) {
          // Caminho alternativo (ItemModule)
          const itemModules = fullData?.ItemModule;
          if (itemModules) {
            itemData = itemModules[Object.keys(itemModules)[0]];
          }
        }
      } catch (e) {}

      if (!itemData) {
        return res.status(404).json({ error: "[-] Dados do vídeo não encontrados no JSON." });
      }

      const videoId = itemData.id || "video";
      const videoUrl = itemData.video?.playAddr || itemData.video?.downloadAddr;
      const musicUrl = itemData.music?.playUrl;
      const images = itemData.imagePost?.images?.map((img: any) => img.imageURL?.urlList?.[0]);
      
      console.log(`[+] Vídeo detectado! ID: ${videoId}`);

      res.json({
        id: videoId,
        desc: itemData.desc,
        author: itemData.author?.nickname || itemData.author?.uniqueId,
        avatar: itemData.author?.avatarLarger || itemData.author?.avatarThumb,
        stats: itemData.stats,
        video: videoUrl,
        duration: itemData.video?.duration,
        cover: itemData.video?.cover || itemData.video?.originCover,
        music: musicUrl,
        images: images || [],
        isCarousel: !!images?.length,
        cookies: cookies // Return cookies for session mimicry
      });

    } catch (error: any) {
      console.error("[-] Erro fatal:", error.message);
      res.status(500).json({ error: "Erro ao processar o link do TikTok." });
    }
  });

  // --- PROXY FOR VIDEO/MEDIA (Fixes CORS and 403) ---
  app.get("/api/proxy-media", async (req, res) => {
    const { url, cookies } = req.query;
    if (!url || typeof url !== "string") return res.status(400).send("URL required");

    // Clean URL
    const targetUrl = url.replace(/\\u002f/g, '/').replace(/\\u0026/g, '&');

    try {
      const response = await axios({
        method: 'get',
        url: targetUrl,
        responseType: 'stream',
        timeout: 30000,
        maxRedirects: 10,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.tiktok.com/',
          'Accept': 'video/webapp,video/*,*/*',
          'Accept-Encoding': 'identity;q=1, *;q=0',
          'Range': 'bytes=0-',
          'Connection': 'keep-alive',
          'Cookie': typeof cookies === 'string' ? cookies : ""
        }
      });

      // Pass through headers
      if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
      res.setHeader('Accept-Ranges', 'bytes');
      if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
      
      response.data.pipe(res);
    } catch (e: any) {
      console.error("[!] Erro no Proxy Media:", e.response?.status || e.message);
      res.status(e.response?.status || 500).send("Failed to proxy media");
    }
  });

  // --- DOWNLOAD ENDPOINT (Forces Attachment) ---
  app.get("/api/download", async (req, res) => {
    const { url, filename, cookies } = req.query;
    if (!url || typeof url !== "string") return res.status(400).send("URL required");

    // Clean URL
    const targetUrl = url.replace(/\\u002f/g, '/').replace(/\\u0026/g, '&');

    try {
      console.log(`[*] Iniciando download: ${filename}`);
      const response = await axios({
        method: 'get',
        url: targetUrl,
        responseType: 'stream',
        timeout: 30000,
        maxRedirects: 10,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.tiktok.com/',
          'Accept': 'video/webapp,video/*,*/*',
          'Accept-Encoding': 'identity;q=1, *;q=0',
          'Range': 'bytes=0-',
          'Connection': 'keep-alive',
          'Cookie': typeof cookies === 'string' ? cookies : ""
        }
      });

      res.setHeader('Content-Disposition', `attachment; filename="${filename || 'tiktok_download.mp4'}"`);
      if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
      if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
      
      response.data.pipe(res);
    } catch (e: any) {
      console.error("[!] Erro no Download:", e.response?.status || e.message);
      res.status(e.response?.status || 500).send(`Failed to stream download: ${e.response?.status || e.message}`);
    }
  });

  // --- GITHUB PUBLISHER ENDPOINT ---
  app.post("/api/publish-github", async (req, res) => {
    const GITHUB_USER = process.env.GITHUB_USER;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

    if (!GITHUB_USER || !GITHUB_TOKEN) {
      return res.status(400).json({ error: "Missing GITHUB_USER or GITHUB_TOKEN in environment." });
    }

    const repoName = `tiktok-downloader-${Math.random().toString(36).substring(7)}`;

    try {
      // 1. Create Repo
      const createRes = await axios.post(
        "https://api.github.com/user/repos",
        { name: repoName, private: false },
        { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
      );

      // 2. Upload files (Simplified: just upload basic files)
      const filesToUpload = [
        "package.json", "server.ts", "src/App.tsx", "src/main.tsx", "src/index.css", "index.html", "vite.config.ts", "tsconfig.json", ".gitignore"
      ];

      for (const file of filesToUpload) {
        if (fs.existsSync(path.join(process.cwd(), file))) {
          const content = fs.readFileSync(path.join(process.cwd(), file));
          const base64Content = content.toString("base64");
          
          await axios.put(
            `https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/${file}`,
            {
              message: `Initial upload: ${file}`,
              content: base64Content
            },
            { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
          );
        }
      }

      res.json({ success: true, url: `https://github.com/${GITHUB_USER}/${repoName}` });
    } catch (error: any) {
      console.error("GitHub Error:", error.response?.data || error.message);
      res.status(500).json({ error: "Erro ao publicar no GitHub." });
    }
  });

  // --- VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
