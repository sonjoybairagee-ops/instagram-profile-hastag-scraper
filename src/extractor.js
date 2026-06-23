import { log } from 'apify';

/**
 * YouTube embeds all page data in window.ytInitialData and
 * window.ytInitialPlayerResponse — we extract from those directly.
 * This is faster and more reliable than DOM scraping.
 */

// Extract ytInitialData from page
export async function getYtInitialData(page) {
    return await page.evaluate(() => {
        try {
            return window.ytInitialData || null;
        } catch {
            return null;
        }
    });
}

export async function getYtPlayerResponse(page) {
    return await page.evaluate(() => {
        try {
            return window.ytInitialPlayerResponse || null;
        } catch {
            return null;
        }
    });
}

// ── SEARCH results ──
export function extractSearchResults(ytData, maxResults) {
    const videos = [];
    try {
        const contents = ytData?.contents?.twoColumnSearchResultsRenderer
            ?.primaryContents?.sectionListRenderer?.contents || [];

        for (const section of contents) {
            const items = section?.itemSectionRenderer?.contents || [];
            for (const item of items) {
                if (videos.length >= maxResults) break;
                const v = item?.videoRenderer;
                if (!v) continue;

                videos.push(formatVideoRenderer(v));
            }
            if (videos.length >= maxResults) break;
        }
    } catch (e) {
        log.warning(`Search extract error: ${e.message}`);
    }
    return videos;
}

// ── CHANNEL videos ──
export function extractChannelVideos(ytData, maxVideos) {
    const videos = [];
    try {
        // Try tabs → Videos tab
        const tabs = ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        let videoTab = null;

        for (const tab of tabs) {
            const t = tab?.tabRenderer;
            if (t?.title === 'Videos' || t?.selected) {
                videoTab = t;
                break;
            }
        }

        const richItems = videoTab?.content?.richGridRenderer?.contents || [];
        for (const item of richItems) {
            if (videos.length >= maxVideos) break;
            const v = item?.richItemRenderer?.content?.videoRenderer;
            if (!v) continue;
            videos.push(formatVideoRenderer(v));
        }
    } catch (e) {
        log.warning(`Channel videos extract error: ${e.message}`);
    }
    return videos;
}

// ── CHANNEL info ──
export function extractChannelInfo(ytData) {
    try {
        const header = ytData?.header?.pageHeaderRenderer
            || ytData?.header?.c4TabbedHeaderRenderer;

        if (!header) return null;

        // Subscriber count
        const subText = header?.subscriberCountText?.simpleText
            || header?.subscriberCountText?.runs?.[0]?.text
            || null;

        // Channel name
        const name = header?.title?.simpleText
            || header?.title?.runs?.[0]?.text
            || null;

        // Avatar
        const avatar = header?.avatar?.thumbnails?.slice(-1)[0]?.url
            || header?.thumbnail?.thumbnails?.slice(-1)[0]?.url
            || null;

        // Banner
        const banner = header?.banner?.thumbnails?.slice(-1)[0]?.url || null;

        // Channel ID / handle
        const channelId = ytData?.metadata?.channelMetadataRenderer?.externalId || null;
        const handle = ytData?.metadata?.channelMetadataRenderer?.vanityUrl
            || ytData?.microformat?.microformatDataRenderer?.urlCanonical
            || null;

        // Description
        const description = ytData?.metadata?.channelMetadataRenderer?.description || null;

        // Video count / view count from about
        const videosText = header?.videosCountText?.runs?.[0]?.text || null;

        // Keywords
        const keywords = ytData?.metadata?.channelMetadataRenderer?.keywords || null;

        return {
            channelId,
            name,
            handle,
            subscriberCount: subText,
            videoCount: videosText,
            description,
            avatar,
            banner,
            keywords,
        };
    } catch (e) {
        log.warning(`Channel info extract error: ${e.message}`);
        return null;
    }
}

// ── VIDEO details ──
export function extractVideoDetails(ytData, playerResponse) {
    try {
        const vd = playerResponse?.videoDetails;
        const micro = playerResponse?.microformat?.playerMicroformatRenderer;
        const streaming = playerResponse?.streamingData;

        // From ytInitialData: likes, comments count
        const primaryInfo = ytData?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer;
        const secondaryInfo = ytData?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents?.[1]?.videoSecondaryInfoRenderer;

        // Likes
        const likeBtn = primaryInfo?.videoActions?.menuRenderer?.topLevelButtons
            ?.find(b => b?.segmentedLikeDislikeButtonViewModel
                || b?.toggleButtonRenderer?.defaultText?.accessibility?.accessibilityData?.label?.includes('like'));
        const likesText = likeBtn?.segmentedLikeDislikeButtonViewModel
            ?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel
            ?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel?.title
            || likeBtn?.toggleButtonRenderer?.defaultText?.simpleText
            || null;

        // Comments count
        const commentsHeader = ytData?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents
            ?.find(c => c?.commentsEntryPointHeaderRenderer);
        const commentsCount = commentsHeader?.commentsEntryPointHeaderRenderer
            ?.commentCount?.simpleText || null;

        // Tags
        const tags = vd?.keywords || [];

        // Chapters
        const chapters = [];
        const markers = ytData?.playerOverlays?.playerOverlayRenderer
            ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer
            ?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap || [];
        for (const marker of markers) {
            if (marker?.key === 'AUTO_CHAPTERS' || marker?.key === 'DESCRIPTION_CHAPTERS') {
                for (const chapter of (marker?.value?.chapters || [])) {
                    chapters.push({
                        title: chapter?.chapterRenderer?.title?.simpleText,
                        timeRangeStartMillis: chapter?.chapterRenderer?.timeRangeStartMillis,
                    });
                }
            }
        }

        // Related videos
        const related = [];
        const watchNextContents = ytData?.contents?.twoColumnWatchNextResults
            ?.secondaryResults?.secondaryResults?.results || [];
        for (const item of watchNextContents.slice(0, 10)) {
            const r = item?.compactVideoRenderer;
            if (!r) continue;
            related.push({
                videoId: r.videoId,
                title: r.title?.simpleText || r.title?.runs?.[0]?.text,
                channelName: r.longBylineText?.runs?.[0]?.text,
                views: r.viewCountText?.simpleText,
                duration: r.lengthText?.simpleText,
                url: `https://www.youtube.com/watch?v=${r.videoId}`,
            });
        }

        return {
            videoId: vd?.videoId,
            title: vd?.title,
            description: vd?.shortDescription,
            channelId: vd?.channelId,
            channelName: vd?.author,
            views: vd?.viewCount ? parseInt(vd.viewCount) : null,
            likes: likesText,
            commentsCount,
            duration: formatDuration(vd?.lengthSeconds),
            durationSeconds: vd?.lengthSeconds ? parseInt(vd.lengthSeconds) : null,
            publishedAt: micro?.publishDate || micro?.uploadDate || null,
            isLive: vd?.isLiveContent || false,
            isPrivate: vd?.isPrivate || false,
            tags,
            chapters,
            thumbnail: vd?.thumbnail?.thumbnails?.slice(-1)[0]?.url || null,
            relatedVideos: related,
            url: `https://www.youtube.com/watch?v=${vd?.videoId}`,
        };
    } catch (e) {
        log.warning(`Video detail extract error: ${e.message}`);
        return null;
    }
}

// ── COMMENTS ──
export async function extractComments(page, maxComments) {
    // Scroll to load comments
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(2000);

    let prevCount = 0;
    for (let i = 0; i < 8; i++) {
        const count = await page.evaluate(() =>
            document.querySelectorAll('ytd-comment-thread-renderer').length
        );
        if (count >= maxComments || count === prevCount) break;
        prevCount = count;
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(1500);
    }

    return await page.evaluate((max) => {
        const comments = [];
        document.querySelectorAll('ytd-comment-thread-renderer').forEach(el => {
            if (comments.length >= max) return;
            const author = el.querySelector('#author-text span')?.textContent?.trim();
            const text = el.querySelector('#content-text')?.textContent?.trim();
            const likes = el.querySelector('#vote-count-middle')?.textContent?.trim();
            const date = el.querySelector('.published-time-text a')?.textContent?.trim();
            const isHearted = !!el.querySelector('#creator-heart-button');
            const isPinned = !!el.querySelector('#pinned-comment-badge');

            if (author && text) {
                comments.push({ author, text, likes: likes || '0', date, isHearted, isPinned });
            }
        });
        return comments;
    }, maxComments);
}

// ── Helpers ──
function formatVideoRenderer(v) {
    const videoId = v?.videoId;
    return {
        videoId,
        title: v?.title?.runs?.[0]?.text || v?.title?.simpleText || null,
        channelName: v?.ownerText?.runs?.[0]?.text
            || v?.longBylineText?.runs?.[0]?.text
            || null,
        channelUrl: v?.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
            ? `https://www.youtube.com${v.ownerText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl}`
            : null,
        views: parseViewCount(v?.viewCountText?.simpleText || v?.viewCountText?.runs?.[0]?.text),
        duration: v?.lengthText?.simpleText || null,
        publishedAt: v?.publishedTimeText?.simpleText || null,
        description: v?.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map(r => r.text).join('') || null,
        thumbnail: v?.thumbnail?.thumbnails?.slice(-1)[0]?.url || null,
        badges: (v?.badges || []).map(b => b?.metadataBadgeRenderer?.label).filter(Boolean),
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
    };
}

function parseViewCount(text) {
    if (!text) return null;
    const clean = text.replace(/[^0-9]/g, '');
    return clean ? parseInt(clean) : null;
}

function formatDuration(seconds) {
    if (!seconds) return null;
    const s = parseInt(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}
