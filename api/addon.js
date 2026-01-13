// 1. Load Environment Variables (Local Support)
require("dotenv").config();

const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const puppeteer = require("puppeteer");

const manifest = {
  id: "community.vidking.render",
  version: "1.1.0",
  name: "VidKing Render (Working)",
  description: "Hosted on Render Singapore",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [], 
  idPrefixes: ["tt"],
};

const builder = new addonBuilder(manifest);

async function getStreamDetails(embedUrl) {
  console.log("🕵️ Analyzing:", embedUrl);
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--single-process", 
        "--no-zygote",      
        "--renderer-process-limit=1" 
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
    });

    const page = await browser.newPage();
    let videoUrl = null;

    await page.setRequestInterception(true);
    
    // ✅ CRITICAL FIX: We are now allowing 'script' so the player can load
    page.on("request", (req) => {
      const rType = req.resourceType();
      const rUrl = req.url();

      // 1. Check if we found the video!
      if (rUrl.includes(".m3u8") || (rUrl.includes(".mp4") && !rUrl.includes("loader"))) {
        console.log("✅ Found stream:", rUrl);
        videoUrl = rUrl;
        req.abort(); // Stop downloading, we just need the link!
        return;
      }

      // 2. Block heavy assets (Images, Fonts, CSS) but ALLOW SCRIPTS
      if (["image", "font", "media", "stylesheet"].includes(rType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    );
    
    // Load the page
    try {
      await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
      // Ignore timeouts if the page is just slow
    }

    // Wait specifically for the videoUrl to be found
    const startTime = Date.now();
    while (!videoUrl && Date.now() - startTime < 10000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    return videoUrl;
  } catch (error) {
    console.log("Browser Error:", error.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

builder.defineStreamHandler(async (args) => {
  const API_KEY = process.env.TMDB_API_KEY;

  if (!API_KEY) {
    console.log("❌ Error: TMDB_API_KEY is missing!");
    return { streams: [] };
  }

  const imdbId = args.id.split(":")[0];

  try {
    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${API_KEY}&external_source=imdb_id`;
    const data = await (await fetch(findUrl)).json();

    let tmdbId = "";
    if (args.type === "movie" && data.movie_results?.[0])
      tmdbId = data.movie_results[0].id;
    else if (args.type === "series" && data.tv_results?.[0])
      tmdbId = data.tv_results[0].id;

    if (!tmdbId) return { streams: [] };

    const embedUrl =
      args.type === "movie"
        ? `https://www.vidking.net/embed/movie/${tmdbId}`
        : `https://www.vidking.net/embed/tv/${tmdbId}/${
            args.id.split(":")[1]
          }/${args.id.split(":")[2]}`;

    const streamUrl = await getStreamDetails(embedUrl);

    if (!streamUrl) {
        console.log("❌ No stream found for:", embedUrl);
        return { streams: [] };
    }

    return {
      streams: [
        {
          title: "▶️ VidKing (Render)",
          url: streamUrl,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              request: {
                Referer: "https://www.vidking.net/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
              },
            },
          },
        },
      ],
    };
  } catch (e) {
    console.log("Handler Error:", e.message);
    return { streams: [] };
  }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`🚀 Server running on port ${port}`);
