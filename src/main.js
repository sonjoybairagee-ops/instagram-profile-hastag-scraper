import { Actor, log } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import {
    getYtInitialData, getYtPlayerResponse,
    extractSearchResults, extractChannelVideos,
    extractChannelInfo, extractVideoDetails, extractComments,
} from './extractor.js';

await Actor.init();

const input = await Actor.getInput();
const {
    searchQueries = [],
    channelUrls = [],
    videoUrls = [],
    maxVideosPerChannel = 30,
    maxResultsPerSearch = 20,
    scrapeComments = false,
    maxCommentsPerVideo = 20,
    scrapeChannel = true,
    proxyConfiguration: proxyConfig,
} = input || {};

if (!searchQueries.length && !channelUrls.length && !videoUrls.length) {
    throw new Error('No input! Provide searchQueries, channelUrls, or videoUrls.');
}

log.info('Starting YouTube Scraper...', {
    searchQueries: searchQueries.length,
    channelUrls: channelUrls.length,
    videoUrls: videoUrls.length,
});

const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);
const requestQueue = await RequestQueue.open();

// Enqueue searches
for (const q of searchQueries) {
    await requestQueue.addRequest({
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%3D%3D`,
        userData: { type: 'SEARCH', query: q },
    });
}

// Enqueue channels
for (const url of channelUrls) {
    const videosUrl = url.replace(/\/?$/, '/videos');
    await requestQueue.addRequest({
        url: videosUrl,
        userData: { type: 'CHANNEL', sourceUrl: url },
    });
}

// Enqueue direct videos
for (const url of videoUrls) {
    await requestQueue.addRequest({
        url,
        userData: { type: 'VIDEO', sourceLabel: 'direct' },
    });
}

const crawler = new PlaywrightCrawler({
    requestQueue,
    proxyConfiguration,
    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        },
    },
    browserPoolOptions: { useFingerprints: true },
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 120,
    maxRequestRetries: 2,

    async requestHandler({ page, request }) {
        const { type, query } = request.userData;

        // Block ads/tracking/heavy resources
        await page.route('**/*.{mp4,mp3,woff,woff2,ttf,otf}', r => r.abort());
        await page.route('**/(doubleclick|googlesyndication|googletagmanager)/**', r => r.abort());

        log.info(`[${type}] ${request.url}`);

        try {
            await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (e) {
            log.warning(`Navigation: ${e.message}`);
        }

        // Wait for ytInitialData to be injected
        await page.waitForFunction(() => !!window.ytInitialData, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const ytData = await getYtInitialData(page);

        if (!ytData) {
            log.warning(`No ytInitialData found at ${request.url}`);
            return;
        }

        // ── SEARCH ──
        if (type === 'SEARCH') {
            const videos = extractSearchResults(ytData, maxResultsPerSearch);
            log.info(`[SEARCH] "${query}" → ${videos.length} videos`);

            for (const video of videos) {
                if (video.url) {
                    await requestQueue.addRequest({
                        url: video.url,
                        userData: { type: 'VIDEO', sourceLabel: `search:${query}`, preview: video },
                        uniqueKey: `video_${video.videoId}`,
                    });
                }
            }
            return;
        }

        // ── CHANNEL ──
        if (type === 'CHANNEL') {
            // Get channel info
            let channelInfo = null;
            if (scrapeChannel) {
                channelInfo = extractChannelInfo(ytData);
                if (channelInfo) {
                    await Actor.pushData({ type: 'channel', ...channelInfo });
                    log.info(`✅ Channel: ${channelInfo.name} | ${channelInfo.subscriberCount}`);
                }
            }

            // Get videos
            const videos = extractChannelVideos(ytData, maxVideosPerChannel);
            log.info(`[CHANNEL] ${videos.length} videos found`);

            for (const video of videos) {
                if (video.url) {
                    await requestQueue.addRequest({
                        url: video.url,
                        userData: {
                            type: 'VIDEO',
                            sourceLabel: `channel:${channelInfo?.name || request.url}`,
                            preview: video,
                        },
                        uniqueKey: `video_${video.videoId}`,
                    });
                }
            }
            return;
        }

        // ── VIDEO ──
        if (type === 'VIDEO') {
            const playerResponse = await getYtPlayerResponse(page);
            const video = extractVideoDetails(ytData, playerResponse);

            if (!video || !video.title) {
                log.warning(`No video data at ${request.url}`);
                return;
            }

            log.info(`✅ ${video.title?.slice(0, 60)} | 👁 ${video.views?.toLocaleString() || 'N/A'} | ⏱ ${video.duration}`);

            // Scrape comments if needed
            let comments = [];
            if (scrapeComments) {
                try {
                    comments = await extractComments(page, maxCommentsPerVideo);
                    log.info(`   Comments: ${comments.length}`);
                } catch (e) {
                    log.warning(`Comments failed: ${e.message}`);
                }
            }

            await Actor.pushData({
                type: 'video',
                ...video,
                comments,
                sourceLabel: request.userData.sourceLabel,
            });
        }
    },

    failedRequestHandler({ request, error }) {
        log.error(`Failed: ${request.url} — ${error.message}`);
    },
});

await crawler.run();

const dataset = await Actor.openDataset();
const { itemCount } = await dataset.getInfo();
log.info(`✅ Done! Total items saved: ${itemCount}`);

await Actor.exit();
