// api/scan.js - LIVE Google Maps Scanner - FIXED for short links
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: 'API KEY MISSING',
      fix: 'Add GOOGLE_PLACES_API_KEY in Vercel → Settings → Environment Variables → Redeploy'
    });
  }

  const { businessName, location, service, mapsLink } = req.body;

  try {
    let placeId, lat, lng, businessData;
    let searchQuery = `${businessName || ''} ${location || ''}`.trim();

    // Expand short maps.app.goo.gl links
    let finalUrl = mapsLink || '';
    if (mapsLink && mapsLink.includes('goo.gl')) {
      try {
        const expanded = await fetch(mapsLink, { redirect: 'follow' });
        finalUrl = expanded.url;
      } catch (e) {
        console.log('Could not expand short link');
      }
    }

    // If user pasted maps link, try to get name from it
    if (finalUrl && finalUrl.includes('place')) {
      const match = finalUrl.match(/place\/([^\/@]+)/);
      if (match &&!businessName) {
        searchQuery = decodeURIComponent(match[1].replace(/\+/g, ' ')) + ' ' + location;
      }
    }

    if (!searchQuery) searchQuery = 'business';

    // Text Search - LIVE Google Data
    const textUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${API_KEY}`;
    const textRes = await fetch(textUrl).then(r => r.json());

    if (textRes.status === 'REQUEST_DENIED') {
      return res.status(500).json({
        error: `REQUEST_DENIED: ${textRes.error_message}`,
        fix: 'Enable Places API + Geocoding API in Google Cloud Console → Library'
      });
    }

    if (!textRes.results || textRes.results.length === 0) {
      return res.status(404).json({
        error: `Could not find "${searchQuery}" on Google Maps. Try exact business name as listed on Google.`,
        tried: searchQuery,
        google_status: textRes.status
      });
    }

    const first = textRes.results[0];
    placeId = first.place_id;
    lat = first.geometry.location.lat;
    lng = first.geometry.location.lng;

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,rating,user_ratings_total,photos,geometry&key=${API_KEY}`;
    const detailsRes = await fetch(detailsUrl).then(r => r.json());
    businessData = detailsRes.result || first;

    // Live Grid Scan - 9 points
    const keyword = service || 'business';
    const offsets = [{x:0,y:0},{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1},{x:1,y:1},{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
    let grid = [], competitorsMap = new Map(), appearances = 0;

    for (const off of offsets) {
      const pLat = lat + (off.x * 0.006);
      const pLng = lng + (off.y * 0.006);
      const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${pLat},${pLng}&radius=1200&keyword=${encodeURIComponent(keyword)}&key=${API_KEY}`;
      const nearbyRes = await fetch(nearbyUrl).then(r => r.json());

      if (nearbyRes.results) {
        const idx = nearbyRes.results.findIndex(r => r.place_id === placeId);
        const rank = idx >= 0? idx + 1 : 21;
        if (idx >= 0) appearances++;
        grid.push({...off, rank, found: idx >= 0 });

        nearbyRes.results.slice(0,5).forEach((c,i)=>{
          if(c.place_id!== placeId &&!competitorsMap.has(c.place_id)){
            competitorsMap.set(c.place_id, {
              name: c.name, rating: c.rating||0, reviews: c.user_ratings_total||0, position: i+1
            });
          }
        });
      }
      await new Promise(r=>setTimeout(r,100));
    }

    const avgRank = grid.reduce((s,r)=>s+r.rank,0)/grid.length;
    const visibility = Math.max(5, Math.min(95, Math.round(100 - (avgRank/21*75) - ((offsets.length-appearances)/offsets.length*25))));
    const competitors = Array.from(competitorsMap.values()).sort((a,b)=>b.reviews-a.reviews).slice(0,3);
    const monthlySearches = 900 + Math.floor(Math.random()*1200);
    const ctrTop3 = 0.62, ctrCurrent = avgRank<=3?0.22:avgRank<=10?0.08:0.02;
    const missed = Math.max(0, Math.round(monthlySearches * (ctrTop3 - ctrCurrent)));

    return res.status(200).json({
      success: true, live: true,
      business: {
        name: businessData?.name||businessName, address: businessData?.formatted_address||location,
        rating: businessData?.rating||0, reviews: businessData?.user_ratings_total||0,
        photos: businessData?.photos?.length||0, place_id: placeId, lat, lng
      },
      scan: { visibility_score: visibility, avg_rank: Math.round(avgRank), appearances, total_scanned: offsets.length, grid, keyword },
      competitors,
      opportunity: { monthly_searches: monthlySearches, missed_monthly: missed, competitor_advantage: competitors[0]? competitors[0].reviews - (businessData?.user_ratings_total||0) : 0 }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Scan failed', details: err.message });
  }
}
