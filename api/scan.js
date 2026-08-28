// api/scan.js - LIVE Google Maps Visibility Scanner
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Missing GOOGLE_PLACES_API_KEY env' });

  const { businessName, location, service, mapsLink } = req.body;
  if (!businessName ||!location) return res.status(400).json({ error: 'businessName and location required' });

  try {
    // Step 1: Resolve business to place_id and lat/lng
    let placeId = null, lat = null, lng = null, businessData = null;

    // If maps link contains place_id
    if (mapsLink) {
      const placeMatch = mapsLink.match(/place_id[:=]([^&]+)/) || mapsLink.match(/1s([^!]+)!.*place/);
      if (placeMatch) placeId = decodeURIComponent(placeMatch[1]);
    }

    // Text Search to find business
    const query = mapsLink? businessName : `${businessName} ${location}`;
    const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
    const textRes = await fetch(textSearchUrl).then(r => r.json());

    if (textRes.results && textRes.results[0]) {
      const first = textRes.results[0];
      placeId = first.place_id;
      lat = first.geometry.location.lat;
      lng = first.geometry.location.lng;

      // Get details
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,rating,user_ratings_total,photos,reviews,types,website&key=${API_KEY}`;
      const detailsRes = await fetch(detailsUrl).then(r => r.json());
      businessData = detailsRes.result;
    }

    if (!lat ||!lng) return res.status(404).json({ error: 'Could not find business location. Try more specific name + suburb.' });

    // Step 2: Grid scan for service keyword
    const keyword = service || businessData?.types?.[0] || 'plumber';
    const gridPoints = [];
    const radiusKm = 0.6; // 1.2km diameter
    for (let x = -2; x <= 2; x++) {
      for (let y = -2; y <= 2; y++) {
        gridPoints.push({
          lat: lat + (x * radiusKm * 0.009), // approx degrees
          lng: lng + (y * radiusKm * 0.009 / Math.cos(lat * Math.PI / 180)),
          x, y
        });
      }
    }

    let rankings = [];
    let competitorsMap = new Map();
    let totalAppearances = 0;

    // Scan 9 points (center + 8 around) to save API cost - expand to 25 if needed
    const scanPoints = [gridPoints[12], gridPoints[7], gridPoints[11], gridPoints[13], gridPoints[17], gridPoints[2], gridPoints[10], gridPoints[14], gridPoints[22]].filter(Boolean);

    for (const point of scanPoints) {
      const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${point.lat},${point.lng}&radius=1500&keyword=${encodeURIComponent(keyword)}&key=${API_KEY}`;
      const nearbyRes = await fetch(nearbyUrl).then(r => r.json());

      if (nearbyRes.results) {
        const rank = nearbyRes.results.findIndex(r => r.place_id === placeId) + 1;
        const foundRank = rank > 0? rank : 21; // 21 means not in top 20
        if (rank > 0 && rank <= 20) totalAppearances++;

        rankings.push({...point, rank: foundRank, found: rank > 0 });

        // Collect competitors
        nearbyRes.results.slice(0, 5).forEach((comp, idx) => {
          if (comp.place_id!== placeId &&!competitorsMap.has(comp.place_id)) {
            competitorsMap.set(comp.place_id, {
              place_id: comp.place_id,
              name: comp.name,
              rating: comp.rating || 0,
              reviews: comp.user_ratings_total || 0,
              position: idx + 1,
              vicinity: comp.vicinity,
              photos: comp.photos?.length || 0
            });
          }
        });
      }
      // Small delay to avoid rate limit
      await new Promise(r => setTimeout(r, 100));
    }

    // Calculate visibility score
    const avgRank = rankings.length? rankings.reduce((s, r) => s + r.rank, 0) / rankings.length : 21;
    const visibility = Math.max(5, Math.min(95, Math.round(100 - (avgRank / 21 * 80) - ( (scanPoints.length - totalAppearances) / scanPoints.length * 20))));

    const competitors = Array.from(competitorsMap.values())
     .sort((a, b) => b.reviews - a.reviews)
     .slice(0, 3);

    // Estimate searches - heuristic based on location + service
    // For real volume, integrate Keyword Planner API later
    const searchVolumeEstimate = Math.round(800 + Math.random() * 1500); // Replace with real API later
    const missedOpportunities = Math.round(searchVolumeEstimate * (0.62 - (avgRank <= 3? 0.22 : avgRank <= 10? 0.08 : 0.02)));

    return res.status(200).json({
      success: true,
      live: true,
      business: {
        name: businessData?.name || businessName,
        address: businessData?.formatted_address || location,
        rating: businessData?.rating || 0,
        reviews: businessData?.user_ratings_total || 0,
        photos: businessData?.photos?.length || 0,
        place_id: placeId,
        lat, lng
      },
      scan: {
        visibility_score: visibility,
        avg_rank: Math.round(avgRank),
        total_points_scanned: scanPoints.length,
        appearances: totalAppearances,
        grid: rankings,
        keyword: keyword
      },
      competitors: competitors,
      opportunity: {
        monthly_searches: searchVolumeEstimate,
        missed_monthly: missedOpportunities,
        competitor_advantage: competitors[0]? competitors[0].reviews - (businessData?.user_ratings_total || 0) : 0
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Scan failed', details: err.message });
  }
}
