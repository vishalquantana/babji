/**
 * Maps common city/country names to IANA timezones.
 * Used when the LLM extracts location facts from conversation and the tenant's timezone is still UTC.
 */

const CITY_MAP: Record<string, string> = {
  // India
  "mumbai": "Asia/Kolkata", "delhi": "Asia/Kolkata", "bangalore": "Asia/Kolkata",
  "bengaluru": "Asia/Kolkata", "hyderabad": "Asia/Kolkata", "chennai": "Asia/Kolkata",
  "kolkata": "Asia/Kolkata", "pune": "Asia/Kolkata", "ahmedabad": "Asia/Kolkata",
  "jaipur": "Asia/Kolkata", "lucknow": "Asia/Kolkata", "kochi": "Asia/Kolkata",
  "chandigarh": "Asia/Kolkata", "indore": "Asia/Kolkata", "gurgaon": "Asia/Kolkata",
  "gurugram": "Asia/Kolkata", "noida": "Asia/Kolkata", "india": "Asia/Kolkata",

  // US
  "new york": "America/New_York", "nyc": "America/New_York", "boston": "America/New_York",
  "miami": "America/New_York", "atlanta": "America/New_York", "washington": "America/New_York",
  "philadelphia": "America/New_York", "charlotte": "America/New_York",
  "chicago": "America/Chicago", "dallas": "America/Chicago", "houston": "America/Chicago",
  "austin": "America/Chicago", "san antonio": "America/Chicago", "minneapolis": "America/Chicago",
  "denver": "America/Denver", "phoenix": "America/Denver", "salt lake city": "America/Denver",
  "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles",
  "seattle": "America/Los_Angeles", "portland": "America/Los_Angeles",
  "las vegas": "America/Los_Angeles", "san diego": "America/Los_Angeles",
  "san jose": "America/Los_Angeles", "la": "America/Los_Angeles", "sf": "America/Los_Angeles",

  // UK
  "london": "Europe/London", "manchester": "Europe/London", "birmingham": "Europe/London",
  "edinburgh": "Europe/London", "glasgow": "Europe/London", "uk": "Europe/London",
  "england": "Europe/London", "scotland": "Europe/London",

  // Europe
  "paris": "Europe/Paris", "france": "Europe/Paris",
  "berlin": "Europe/Berlin", "munich": "Europe/Berlin", "frankfurt": "Europe/Berlin", "germany": "Europe/Berlin",
  "amsterdam": "Europe/Amsterdam", "netherlands": "Europe/Amsterdam",
  "rome": "Europe/Rome", "milan": "Europe/Rome", "italy": "Europe/Rome",
  "madrid": "Europe/Madrid", "barcelona": "Europe/Madrid", "spain": "Europe/Madrid",
  "lisbon": "Europe/Lisbon", "portugal": "Europe/Lisbon",
  "zurich": "Europe/Zurich", "geneva": "Europe/Zurich", "switzerland": "Europe/Zurich",
  "vienna": "Europe/Vienna", "austria": "Europe/Vienna",
  "stockholm": "Europe/Stockholm", "sweden": "Europe/Stockholm",
  "oslo": "Europe/Oslo", "norway": "Europe/Oslo",
  "copenhagen": "Europe/Copenhagen", "denmark": "Europe/Copenhagen",
  "helsinki": "Europe/Helsinki", "finland": "Europe/Helsinki",
  "dublin": "Europe/Dublin", "ireland": "Europe/Dublin",
  "warsaw": "Europe/Warsaw", "poland": "Europe/Warsaw",
  "prague": "Europe/Prague",
  "budapest": "Europe/Budapest", "hungary": "Europe/Budapest",
  "bucharest": "Europe/Bucharest", "romania": "Europe/Bucharest",
  "athens": "Europe/Athens", "greece": "Europe/Athens",
  "istanbul": "Europe/Istanbul", "turkey": "Europe/Istanbul",
  "kyiv": "Europe/Kyiv", "ukraine": "Europe/Kyiv",

  // Middle East
  "dubai": "Asia/Dubai", "abu dhabi": "Asia/Dubai", "uae": "Asia/Dubai",
  "riyadh": "Asia/Riyadh", "jeddah": "Asia/Riyadh", "saudi arabia": "Asia/Riyadh",
  "doha": "Asia/Qatar", "qatar": "Asia/Qatar",
  "kuwait city": "Asia/Kuwait", "kuwait": "Asia/Kuwait",
  "bahrain": "Asia/Bahrain", "manama": "Asia/Bahrain",
  "muscat": "Asia/Muscat", "oman": "Asia/Muscat",
  "amman": "Asia/Amman", "jordan": "Asia/Amman",
  "beirut": "Asia/Beirut", "lebanon": "Asia/Beirut",
  "tel aviv": "Asia/Jerusalem", "jerusalem": "Asia/Jerusalem", "israel": "Asia/Jerusalem",
  "tehran": "Asia/Tehran", "iran": "Asia/Tehran",

  // East/Southeast Asia
  "tokyo": "Asia/Tokyo", "osaka": "Asia/Tokyo", "japan": "Asia/Tokyo",
  "seoul": "Asia/Seoul", "south korea": "Asia/Seoul", "korea": "Asia/Seoul",
  "singapore": "Asia/Singapore",
  "hong kong": "Asia/Hong_Kong",
  "taipei": "Asia/Taipei", "taiwan": "Asia/Taipei",
  "bangkok": "Asia/Bangkok", "thailand": "Asia/Bangkok",
  "kuala lumpur": "Asia/Kuala_Lumpur", "malaysia": "Asia/Kuala_Lumpur",
  "manila": "Asia/Manila", "philippines": "Asia/Manila",
  "jakarta": "Asia/Jakarta", "indonesia": "Asia/Jakarta",
  "hanoi": "Asia/Ho_Chi_Minh", "ho chi minh": "Asia/Ho_Chi_Minh", "vietnam": "Asia/Ho_Chi_Minh",
  "beijing": "Asia/Shanghai", "shanghai": "Asia/Shanghai", "shenzhen": "Asia/Shanghai",
  "guangzhou": "Asia/Shanghai", "china": "Asia/Shanghai",

  // South Asia (non-India)
  "karachi": "Asia/Karachi", "lahore": "Asia/Karachi", "islamabad": "Asia/Karachi", "pakistan": "Asia/Karachi",
  "dhaka": "Asia/Dhaka", "bangladesh": "Asia/Dhaka",
  "colombo": "Asia/Colombo", "sri lanka": "Asia/Colombo",
  "kathmandu": "Asia/Kathmandu", "nepal": "Asia/Kathmandu",

  // Africa
  "lagos": "Africa/Lagos", "nigeria": "Africa/Lagos",
  "nairobi": "Africa/Nairobi", "kenya": "Africa/Nairobi",
  "cairo": "Africa/Cairo", "egypt": "Africa/Cairo",
  "johannesburg": "Africa/Johannesburg", "cape town": "Africa/Johannesburg", "south africa": "Africa/Johannesburg",
  "casablanca": "Africa/Casablanca", "morocco": "Africa/Casablanca",
  "accra": "Africa/Accra", "ghana": "Africa/Accra",

  // Americas
  "toronto": "America/Toronto", "vancouver": "America/Vancouver", "montreal": "America/Toronto",
  "mexico city": "America/Mexico_City", "mexico": "America/Mexico_City",
  "sao paulo": "America/Sao_Paulo", "rio de janeiro": "America/Sao_Paulo", "brazil": "America/Sao_Paulo",
  "buenos aires": "America/Argentina/Buenos_Aires", "argentina": "America/Argentina/Buenos_Aires",
  "bogota": "America/Bogota", "colombia": "America/Bogota",
  "lima": "America/Lima", "peru": "America/Lima",
  "santiago": "America/Santiago", "chile": "America/Santiago",

  // Oceania
  "sydney": "Australia/Sydney", "melbourne": "Australia/Melbourne", "brisbane": "Australia/Brisbane",
  "perth": "Australia/Perth", "adelaide": "Australia/Adelaide",
  "auckland": "Pacific/Auckland", "new zealand": "Pacific/Auckland",
};

/**
 * Try to extract a timezone from a text string (typically a memory fact).
 * Looks for known city or country names.
 */
export function timezoneFromText(text: string): string | null {
  const lower = text.toLowerCase();

  // Try multi-word matches first (longer names), then single words
  const sortedKeys = Object.keys(CITY_MAP).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    // Match as a whole word / phrase
    const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) {
      return CITY_MAP[key];
    }
  }

  return null;
}
