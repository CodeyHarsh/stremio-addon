// 1. Load Environment Variables
require("dotenv").config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const puppeteer = require("puppeteer");

const manifest = {
  id: "community.vidking.fix",
  version: "1.1.0",
  name: "VidKing Fix (Clicker)",
  description: "Auto-clicks play button to grab links",
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
        "--mute-audio" // Good for saving resources
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    });

    const page = await browser.newPage();
    let videoUrl = null;

    // --- 1. NETWORK INTERCEPTION (The Ear) ---
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const rUrl = req.url();
      const rType = req.resourceType();

      // Check if this request is the video file
      if (rUrl.includes(".m3u8") || (rUrl.includes(".mp4") && !rUrl.includes("loader"))) {
        console.log("✅ Found Stream:", rUrl);
        videoUrl = rUrl;
        req.abort(); // Stop loading, we have what we need
        return;
      }

      // Block heavy stuff to speed up scraping
      // Note: We ALLOW scripts so the player works
      if (["image", "font", "stylesheet"].includes(rType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    );

    // --- 2. LOAD PAGE ---
    try {
      await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      console.log("📄 Page DOM Loaded");
    } catch (e) {
      console.log("⚠️ Page load timeout (proceeding anyway)");
    }

    // --- 3. THE FIX: AUTO-CLICKER ---
    
    // Give site 1 second to initialize iframes
    await new Promise(r => setTimeout(r, 1000));

    console.log("🖱️ Searching for Play Button in all frames...");
    
    // Get all frames (The main page + all iframes)
    const frames = page.frames();
    
    // Loop through every frame to find the button
    for (const frame of frames) {
      try {
        const clicked = await frame.evaluate(() => {
          // List of common play button names
          const selectors = [
            ".vjs-big-play-button", 
            ".jw-display-icon-container", 
            ".play-button", 
            "button[class*='play']", 
            "div[class*='play']",
            "video"
          ];
          
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) {
              el.click(); // CLICK IT!
              return true;
            }
          }
          return false;
        });

        if (clicked) {
          console.log("▶️ Clicked a play button!");
          break; // Stop looking if we found one
        }
      } catch (e) {
        // Ignore errors from cross-origin frames
      }
    }

    // --- 4. WAIT FOR REACTION ---
    // Now that we clicked, wait 3 seconds for the network request to fly out
    console.log("⏳ Waiting 3s for network...");
    await new Promise(r => setTimeout(r, 3000));

    // Final check loop (Just in case it's slow)
    if (!videoUrl) {
        console.log("⚠️ Still waiting...");
        const start = Date.now();
        while (!videoUrl && Date.now() - start < 3000) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    return videoUrl;

  } catch (error) {
    console.log("❌ Browser Error:", error.message);
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

    // VIDKING URL STRUCTURE
    const embedUrl =
      args.type === "movie"
        ? `https://www.vidking.net/embed/movie/${tmdbId}`
        : `https://www.vidking.net/embed/tv/${tmdbId}/${args.id.split(":")[1]}/${args.id.split(":")[2]}`;

    const streamUrl = await getStreamDetails(embedUrl);

    if (!streamUrl) {
        console.log("❌ Failed to grab link for:", embedUrl);
        return { streams: [] };
    }

    return {
      streams: [
        {
          title: "▶️ VidKing 4K",
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
