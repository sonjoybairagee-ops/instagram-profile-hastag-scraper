# YouTube Channel & Video Scraper

Scrape YouTube videos, channels, and search results — **no API key required**. Extracts data directly from YouTube's internal data structure.

## Features

- **Search results** — find videos by keyword
- **Channel scraping** — all videos, subscribers, description, banner
- **Video details** — views, likes, duration, tags, chapters, related videos
- **Comments** — top comments with author, likes, date
- **No API limits** — works without YouTube Data API

## Input

| Field | Type | Description |
|-------|------|-------------|
| `searchQueries` | array | YouTube search keywords |
| `channelUrls` | array | YouTube channel URLs |
| `videoUrls` | array | Direct video URLs |
| `maxVideosPerChannel` | number | Max videos per channel (default: 30) |
| `maxResultsPerSearch` | number | Max results per search (default: 20) |
| `scrapeComments` | boolean | Extract comments (default: false) |
| `maxCommentsPerVideo` | number | Max comments per video (default: 20) |
| `scrapeChannel` | boolean | Extract channel info (default: true) |

## Output — Video

```json
{
  "type": "video",
  "videoId": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "channelName": "Rick Astley",
  "views": 1400000000,
  "likes": "1.5M",
  "duration": "3:33",
  "durationSeconds": 213,
  "publishedAt": "2009-10-25",
  "tags": ["rick astley", "never gonna give you up"],
  "chapters": [],
  "thumbnail": "https://i.ytimg.com/vi/...",
  "description": "...",
  "relatedVideos": [{ "title": "...", "views": "..." }],
  "comments": [{ "author": "...", "text": "...", "likes": "2.3K" }],
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

## Output — Channel

```json
{
  "type": "channel",
  "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw",
  "name": "Rick Astley",
  "handle": "@RickAstley",
  "subscriberCount": "3.8M subscribers",
  "videoCount": "82 videos",
  "description": "...",
  "avatar": "https://...",
  "banner": "https://..."
}
```

## Use cases

- Content research & competitor analysis
- Influencer marketing — find channels by niche
- Trend tracking by keyword
- Video performance benchmarking
- Comment sentiment analysis
