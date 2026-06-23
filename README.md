# Google Maps Business Scraper

Extract business data from Google Maps — no API key required. Search by keyword or scrape direct URLs.

## What it extracts

- **Basic info** — name, category, description, price level
- **Contact** — phone number, website, address, city, country
- **Location** — coordinates (lat/lng), plus code, Google Maps URL
- **Rating** — star rating, total review count, open/closed status
- **Hours** — opening hours for each day of the week
- **Photos** — business photos
- **Reviews** — reviewer name, rating, date, text, owner replies
- **Services** — service options, amenities, highlights
- **Social** — Facebook, Instagram, Twitter, LinkedIn links

## Input examples

**Search by keyword:**
```json
{
  "searchQueries": ["pizza restaurants in Chicago", "dentists in London"],
  "maxResultsPerQuery": 50,
  "scrapeReviews": true,
  "maxReviewsPerBusiness": 10
}
```

**Direct URLs:**
```json
{
  "directUrls": [
    "https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2922926"
  ]
}
```

## Output sample

```json
{
  "name": "Joe's Pizza",
  "category": "Pizza restaurant",
  "rating": 4.6,
  "reviewCount": 2341,
  "address": "7 Carmine St, New York, NY 10014",
  "city": "New York",
  "country": "USA",
  "phone": "+1 212-366-1182",
  "website": "joespizzanyc.com",
  "hours": {
    "Monday": "10:00 AM – 4:00 AM",
    "Tuesday": "10:00 AM – 4:00 AM"
  },
  "openStatus": "Open now",
  "coordinates": { "lat": 40.7305, "lng": -74.0021 },
  "photos": ["https://..."],
  "priceLevel": "$$",
  "reviews": [
    {
      "author": "John D.",
      "rating": 5,
      "date": "2 months ago",
      "text": "Best pizza in NYC!"
    }
  ],
  "serviceOptions": ["Dine-in", "Takeout", "Delivery"],
  "scrapedAt": "2026-06-23T..."
}
```

## Use cases

- Lead generation for local businesses
- Competitor research
- Market analysis
- Restaurant/hotel discovery
- Real estate neighborhood research
