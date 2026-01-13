// 1. Load Environment Variables (Local Support)
require('dotenv').config(); 

const { addonBuilder, serveHTTP, getRouter } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const manifest = {
    id: "community.vidking.hybrid",
    version: "1.0.4",
    name: "VidKing Private (Hybrid)",
    description: "Works Locally & on Vercel",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

async function getStreamDetails(embedUrl) {
    console.log("🕵️ Analyzing:", embedUrl);
    let browser = null;
    
    try {
        // Detect if running on Vercel or Local
        const isVercel = process.env.VERCEL === '1';

        // Setup Chromium
        if (isVercel) {
            chromium.setGraphicsMode = false;
        }

        browser = await puppeteer.launch({
            args: isVercel ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: isVercel 
                ? await chromium.executablePath() 
                : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", // <--- UPDATE THIS if needed for local!
            headless: isVercel ? chromium.headless : true,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        let videoUrl = null;

        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                const url = req.url();
                if ((url.includes('.m3u8') || url.includes('.mp4')) && !videoUrl) {
                    console.log("✅ Found:", url);
                    videoUrl = url;
                }
                req.continue();
            }
        });

        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");
        await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        
        const startTime = Date.now();
        while (!videoUrl && Date.now() - startTime < 5000) {
            await new Promise(r => setTimeout(r, 500));
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
    // Gets Key from .env (Local) OR Vercel Settings (Cloud)
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
        if (args.type === "movie" && data.movie_results?.[0]) tmdbId = data.movie_results[0].id;
        else if (args.type === "series" && data.tv_results?.[0]) tmdbId = data.tv_results[0].id;

        if (!tmdbId) return { streams: [] };

        const embedUrl = args.type === "movie" 
            ? `https://www.vidking.net/embed/movie/${tmdbId}`
            : `https://www.vidking.net/embed/tv/${tmdbId}/${args.id.split(":")[1]}/${args.id.split(":")[2]}`;

        const streamUrl = await getStreamDetails(embedUrl);

        if (!streamUrl) return { streams: [] };

        return {
            streams: [{
                title: "▶️ Play VidKing (Secure)",
                url: streamUrl,
                behaviorHints: {
                    notWebReady: true,
                    proxyHeaders: {
                        request: {
                            "Referer": "https://www.vidking.net/",
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
                        }
                    }
                }
            }]
        };

    } catch (e) {
        return { streams: [] };
    }
});

// --- HYBRID STARTUP LOGIC ---
// If running on Vercel, export the handler
if (process.env.VERCEL) {
    const router = getRouter(builder.getInterface());
    module.exports = (req, res) => {
        if (req.url === '/') {
            res.redirect('/manifest.json');
            return;
        }
        router(req, res, () => {
            res.statusCode = 404;
            res.end();
        });
    };
} 
// If running Locally, start the server
else {
    serveHTTP(builder.getInterface(), { port: 7000 });
    console.log("🚀 Local Server Running on http://127.0.0.1:7000/manifest.json");
    console.log("🔑 API Key Loaded:", process.env.TMDB_API_KEY ? "Yes" : "No");
}