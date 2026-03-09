/**
 * Maps phone country calling codes to IANA timezones.
 * Only includes countries with a single primary timezone (or where one dominant timezone covers 90%+ of population).
 * Multi-timezone countries (US, Russia, Canada, Australia, China, Brazil, etc.) return null.
 */

const COUNTRY_CODE_TO_TIMEZONE: Record<string, string> = {
  // South Asia
  "91": "Asia/Kolkata",         // India
  "92": "Asia/Karachi",         // Pakistan
  "94": "Asia/Colombo",         // Sri Lanka
  "977": "Asia/Kathmandu",      // Nepal
  "880": "Asia/Dhaka",          // Bangladesh
  "960": "Indian/Maldives",     // Maldives
  "975": "Asia/Thimphu",        // Bhutan
  "93": "Asia/Kabul",           // Afghanistan

  // Southeast Asia
  "65": "Asia/Singapore",       // Singapore
  "66": "Asia/Bangkok",         // Thailand
  "84": "Asia/Ho_Chi_Minh",     // Vietnam
  "60": "Asia/Kuala_Lumpur",    // Malaysia
  "63": "Asia/Manila",          // Philippines
  "855": "Asia/Phnom_Penh",     // Cambodia
  "856": "Asia/Vientiane",      // Laos
  "95": "Asia/Yangon",          // Myanmar
  "673": "Asia/Brunei",         // Brunei

  // East Asia
  "81": "Asia/Tokyo",           // Japan
  "82": "Asia/Seoul",           // South Korea
  "850": "Asia/Pyongyang",      // North Korea
  "852": "Asia/Hong_Kong",      // Hong Kong
  "853": "Asia/Macau",          // Macau
  "886": "Asia/Taipei",         // Taiwan

  // Middle East
  "971": "Asia/Dubai",          // UAE
  "966": "Asia/Riyadh",         // Saudi Arabia
  "974": "Asia/Qatar",          // Qatar
  "973": "Asia/Bahrain",        // Bahrain
  "968": "Asia/Muscat",         // Oman
  "965": "Asia/Kuwait",         // Kuwait
  "962": "Asia/Amman",          // Jordan
  "961": "Asia/Beirut",         // Lebanon
  "964": "Asia/Baghdad",        // Iraq
  "98": "Asia/Tehran",          // Iran
  "972": "Asia/Jerusalem",      // Israel
  "970": "Asia/Gaza",           // Palestine
  "963": "Asia/Damascus",       // Syria
  "967": "Asia/Aden",           // Yemen

  // Europe (single timezone)
  "44": "Europe/London",        // UK
  "33": "Europe/Paris",         // France
  "49": "Europe/Berlin",        // Germany
  "39": "Europe/Rome",          // Italy
  "34": "Europe/Madrid",        // Spain
  "31": "Europe/Amsterdam",     // Netherlands
  "32": "Europe/Brussels",      // Belgium
  "41": "Europe/Zurich",        // Switzerland
  "43": "Europe/Vienna",        // Austria
  "46": "Europe/Stockholm",     // Sweden
  "47": "Europe/Oslo",          // Norway
  "45": "Europe/Copenhagen",    // Denmark
  "358": "Europe/Helsinki",     // Finland
  "354": "Atlantic/Reykjavik",  // Iceland
  "353": "Europe/Dublin",       // Ireland
  "48": "Europe/Warsaw",        // Poland
  "420": "Europe/Prague",       // Czech Republic
  "421": "Europe/Bratislava",   // Slovakia
  "36": "Europe/Budapest",      // Hungary
  "40": "Europe/Bucharest",     // Romania
  "359": "Europe/Sofia",        // Bulgaria
  "30": "Europe/Athens",        // Greece
  "90": "Europe/Istanbul",      // Turkey
  "380": "Europe/Kyiv",         // Ukraine
  "375": "Europe/Minsk",        // Belarus
  "370": "Europe/Vilnius",      // Lithuania
  "371": "Europe/Riga",         // Latvia
  "372": "Europe/Tallinn",      // Estonia
  "385": "Europe/Zagreb",       // Croatia
  "386": "Europe/Ljubljana",    // Slovenia
  "381": "Europe/Belgrade",     // Serbia
  "355": "Europe/Tirane",       // Albania
  "389": "Europe/Skopje",       // North Macedonia
  "382": "Europe/Podgorica",    // Montenegro
  "387": "Europe/Sarajevo",     // Bosnia

  // Africa
  "27": "Africa/Johannesburg",  // South Africa
  "234": "Africa/Lagos",        // Nigeria
  "254": "Africa/Nairobi",      // Kenya
  "233": "Africa/Accra",        // Ghana
  "256": "Africa/Kampala",      // Uganda
  "255": "Africa/Dar_es_Salaam",// Tanzania
  "251": "Africa/Addis_Ababa",  // Ethiopia
  "20": "Africa/Cairo",         // Egypt
  "212": "Africa/Casablanca",   // Morocco
  "216": "Africa/Tunis",        // Tunisia
  "213": "Africa/Algiers",      // Algeria

  // Americas (single timezone)
  "52": "America/Mexico_City",  // Mexico (dominant timezone)
  "57": "America/Bogota",       // Colombia
  "51": "America/Lima",         // Peru
  "56": "America/Santiago",     // Chile (dominant)
  "54": "America/Argentina/Buenos_Aires", // Argentina
  "598": "America/Montevideo",  // Uruguay
  "595": "America/Asuncion",    // Paraguay
  "593": "America/Guayaquil",   // Ecuador
  "58": "America/Caracas",      // Venezuela
  "506": "America/Costa_Rica",  // Costa Rica
  "507": "America/Panama",      // Panama
  "503": "America/El_Salvador", // El Salvador
  "502": "America/Guatemala",   // Guatemala
  "504": "America/Tegucigalpa", // Honduras
  "505": "America/Managua",     // Nicaragua
  "1876": "America/Jamaica",    // Jamaica
  "1868": "America/Port_of_Spain", // Trinidad

  // Oceania
  "64": "Pacific/Auckland",     // New Zealand
  "679": "Pacific/Fiji",        // Fiji
};

/**
 * Extract timezone from a phone number based on the country calling code.
 * Returns the IANA timezone string or null if:
 * - The country has multiple timezones (US +1, Russia +7, Canada +1, Australia +61, China +86, Brazil +55)
 * - The country code is unrecognized
 * - No phone number is available (e.g. Telegram-only users)
 */
export function timezoneFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Strip leading + and any spaces/dashes
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;

  // Try 4-digit, 3-digit, 2-digit, then 1-digit country codes
  for (const len of [4, 3, 2, 1]) {
    const prefix = digits.slice(0, len);
    if (COUNTRY_CODE_TO_TIMEZONE[prefix]) {
      return COUNTRY_CODE_TO_TIMEZONE[prefix];
    }
  }

  return null;
}
